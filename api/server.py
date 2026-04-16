#!/usr/bin/env python3
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import re
import ssl
import socket
import threading
from datetime import datetime, timezone
import requests as http_requests

app = Flask(__name__)
CORS(app)

SERVERS_FILE = '/app/infra/assets/data/servers.json'
ALERT_STATE_FILE = '/app/infra/api/alert_state.json'
ALERT_CONFIG_FILE = '/app/infra/api/alert_config.json'
SSL_DOMAINS_FILE = '/app/infra/assets/data/ssl_domains.json'
PUSH_METRICS_FILE = '/app/infra/api/push_metrics.json'
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')

# 동시 요청 시 중복 방지 lock
_alert_lock = threading.Lock()
_push_lock = threading.Lock()


def _load_env_file():
    """api/.env 파일에서 환경변수 로드 (python-dotenv 없이)"""
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if line.startswith('export '):
                    line = line[7:]
                if '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)


_load_env_file()

# Slack 설정 — 환경변수에서 로드 (.env 또는 시스템 환경변수)
SLACK_BOT_TOKEN = os.environ.get('SLACK_BOT_TOKEN', '')
SLACK_CHANNEL = os.environ.get('SLACK_CHANNEL', '')

# Push 에이전트 인증키
PUSH_API_KEY = os.environ.get('PUSH_API_KEY', '')

# Loki 설정
LOKI_URL = os.environ.get('LOKI_URL', 'http://localhost:3100')
LOKI_ORG_ID = os.environ.get('LOKI_ORG_ID', 'fake')
LOKI_HEADERS = lambda: {'X-Scope-OrgID': LOKI_ORG_ID}

# Twilio 전화 알림
TWILIO_SID = os.environ.get('TWILIO_SID', '')
TWILIO_TOKEN = os.environ.get('TWILIO_TOKEN', '')
TWILIO_FROM = os.environ.get('TWILIO_FROM', '')
ALERT_PHONE = os.environ.get('ALERT_PHONE', '')

def _twilio_call(server_name, status):
    """Critical/Offline 시 전화 알림 (Twilio)"""
    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, ALERT_PHONE]):
        return
    try:
        from twilio.rest import Client
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        twiml = (
            f'<Response>'
            f'<Say language="ko-KR">경고. {server_name} 서버가 {status} 상태입니다. 즉시 확인하세요.</Say>'
            f'<Pause length="2"/>'
            f'<Say language="ko-KR">반복합니다. {server_name} 서버 {status}. 즉시 확인 바랍니다.</Say>'
            f'</Response>'
        )
        client.calls.create(twiml=twiml, to=ALERT_PHONE, from_=TWILIO_FROM)
    except Exception as e:
        print(f'[Twilio] Call failed: {e}')

# Prometheus 설정
PROMETHEUS_YML = os.environ.get('PROMETHEUS_YML', '/etc/prometheus/prometheus.yml')
PROMETHEUS_RELOAD_URL = os.environ.get('PROMETHEUS_RELOAD_URL', 'http://localhost:9090/-/reload')


def _sync_prometheus_targets():
    """servers.json의 pull 모드 서버를 prometheus.yml에 동기화"""
    try:
        import yaml
    except ImportError:
        app.logger.warning('[Prometheus] PyYAML not installed, skipping sync')
        return False

    if not os.path.exists(PROMETHEUS_YML):
        app.logger.warning(f'[Prometheus] {PROMETHEUS_YML} not found, skipping sync')
        return False

    try:
        # servers.json에서 pull 모드 서버 목록 추출
        with open(SERVERS_FILE, 'r', encoding='utf-8') as f:
            servers_data = json.load(f)

        pull_servers = [s for s in servers_data.get('servers', []) if s.get('mode', 'pull') == 'pull']

        # instance별로 node exporter / kube-state-metrics 분리
        node_targets = []
        kube_targets = []
        for s in pull_servers:
            inst = s.get('instance', '')
            if not inst or inst.startswith(('localhost', '127.0.0.1')):
                continue  # localhost는 수동 관리
            if ':' in inst:
                node_targets.append(inst)
                # kube-state-metrics: 같은 IP에 30047 포트 (있으면)
                ip = inst.split(':')[0]
                kube_target = f'{ip}:30047'
                if kube_target not in kube_targets:
                    kube_targets.append(kube_target)

        # prometheus.yml 로드
        with open(PROMETHEUS_YML, 'r') as f:
            prom_config = yaml.safe_load(f)

        if not prom_config or 'scrape_configs' not in prom_config:
            return False

        changed = False
        for job in prom_config['scrape_configs']:
            job_name = job.get('job_name', '')

            if job_name == 'node':
                existing = job.get('static_configs', [{}])[0].get('targets', [])
                # localhost 유지 + 외부 서버 동기화
                local = [t for t in existing if t.startswith(('localhost', '127.0.0.1'))]
                new_targets = sorted(set(local + node_targets))
                if sorted(existing) != new_targets:
                    job['static_configs'] = [{'targets': new_targets}]
                    changed = True

            elif job_name == 'kube-state-metrics':
                existing = job.get('static_configs', [{}])[0].get('targets', [])
                local = [t for t in existing if t.startswith(('localhost', '127.0.0.1'))]
                new_targets = sorted(set(local + kube_targets))
                if sorted(existing) != new_targets:
                    job['static_configs'] = [{'targets': new_targets}]
                    changed = True

        if changed:
            # 백업 후 저장
            import shutil
            backup = PROMETHEUS_YML + '.bak'
            shutil.copy2(PROMETHEUS_YML, backup)

            with open(PROMETHEUS_YML, 'w') as f:
                yaml.dump(prom_config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

            # Prometheus 핫리로드
            try:
                resp = http_requests.post(PROMETHEUS_RELOAD_URL, timeout=5)
                app.logger.info(f'[Prometheus] reload: {resp.status_code}')
            except Exception as e:
                app.logger.warning(f'[Prometheus] reload failed: {e}')

            app.logger.info(f'[Prometheus] targets synced: node={len(node_targets)}, kube={len(kube_targets)}')
            return True

        return False

    except Exception as e:
        app.logger.error(f'[Prometheus] sync error: {e}')
        return False


@app.route('/api/servers', methods=['GET'])
def get_servers():
    """서버 목록 조회"""
    try:
        with open(SERVERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/servers', methods=['POST'])
def save_servers():
    """서버 목록 저장"""
    try:
        data = request.get_json()
        
        # 유효성 검사
        if not data or 'servers' not in data:
            return jsonify({'error': 'Invalid data format'}), 400
        
        # 파일 저장
        with open(SERVERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        # Prometheus targets 동기화
        prom_synced = _sync_prometheus_targets()

        return jsonify({
            'success': True,
            'message': 'Servers saved successfully',
            'prometheus_synced': prom_synced
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """헬스체크"""
    return jsonify({'status': 'ok'}), 200


# ──────────────────────────────────
# Slack 알림 API
# ──────────────────────────────────

def _load_alert_state():
    """알림 상태 파일 로드 (서버별 마지막 알림 ts 저장)"""
    if os.path.exists(ALERT_STATE_FILE):
        with open(ALERT_STATE_FILE, 'r') as f:
            return json.load(f)
    return {}


def _save_alert_state(state):
    with open(ALERT_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def _slack_post_message(channel, text):
    """Slack 채널에 메시지 전송, ts 반환"""
    res = http_requests.post('https://slack.com/api/chat.postMessage', json={
        'channel': channel,
        'text': text,
    }, headers={
        'Authorization': f'Bearer {SLACK_BOT_TOKEN}',
        'Content-Type': 'application/json'
    })
    data = res.json()
    if data.get('ok'):
        return data.get('ts')
    else:
        app.logger.error(f"Slack postMessage failed: {data.get('error')}")
        return None


def _slack_reply(channel, thread_ts, text):
    """Slack 스레드에 댓글 전송"""
    res = http_requests.post('https://slack.com/api/chat.postMessage', json={
        'channel': channel,
        'thread_ts': thread_ts,
        'text': text,
    }, headers={
        'Authorization': f'Bearer {SLACK_BOT_TOKEN}',
        'Content-Type': 'application/json'
    })
    data = res.json()
    if not data.get('ok'):
        app.logger.error(f"Slack reply failed: {data.get('error')}")


def _load_alert_config():
    """알림 설정 로드 (enabled: true/false)"""
    if os.path.exists(ALERT_CONFIG_FILE):
        with open(ALERT_CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {'enabled': True}


def _save_alert_config(config):
    with open(ALERT_CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


@app.route('/api/alert/state', methods=['GET'])
def get_alert_state():
    """알림 상태 이력 조회"""
    return jsonify(_load_alert_state()), 200


@app.route('/api/alert/state/<server_id>', methods=['DELETE'])
def delete_alert_state(server_id):
    """특정 서버 알림 상태 삭제 (수동 해제)"""
    with _alert_lock:
        state = _load_alert_state()
        if server_id in state:
            del state[server_id]
            _save_alert_state(state)
            return jsonify({'deleted': True}), 200
        return jsonify({'error': 'Not found'}), 404


@app.route('/api/alert/config', methods=['GET'])
def get_alert_config():
    """알림 설정 조회"""
    return jsonify(_load_alert_config()), 200


@app.route('/api/alert/config', methods=['POST'])
def set_alert_config():
    """알림 설정 변경"""
    body = request.get_json()
    config = _load_alert_config()
    if 'enabled' in body:
        config['enabled'] = bool(body['enabled'])
    _save_alert_config(config)
    return jsonify(config), 200


@app.route('/api/alert', methods=['POST'])
def handle_alert():
    """
    프론트엔드에서 상태 변화 시 호출.
    Body: { "serverId": "xxx", "serverName": "xxx", "status": "warning|critical|healthy|offline" }

    - warning/critical: 알림 메시지 발송 (1회), ts 저장
    - healthy: 이전 알림이 있으면 스레드 댓글로 복구 알림, ts 삭제
    """
    # 알림 비활성화 시 Slack 발송 안 함
    alert_config = _load_alert_config()
    if not alert_config.get('enabled', True):
        return jsonify({'skipped': True, 'message': 'Alerts disabled'}), 200

    if not SLACK_BOT_TOKEN or not SLACK_CHANNEL:
        return jsonify({'error': 'Slack not configured'}), 503

    body = request.get_json()
    server_id = body.get('serverId')
    server_name = body.get('serverName', server_id)
    status = body.get('status')

    if not server_id or not status:
        return jsonify({'error': 'serverId and status are required'}), 400

    # lock으로 동시 요청 시 중복 발송 방지
    with _alert_lock:
        state = _load_alert_state()

        if status in ('warning', 'critical', 'offline'):
            # 같은 상태면 중복 발송 안 함. 상태가 바뀌면 새 알림 전송.
            if server_id in state and state[server_id].get('status') == status:
                return jsonify({'skipped': True, 'message': 'Same status, already sent'}), 200

            # 상태 변경 시 이전 알림 스레드에 변경 알림 + 새 메시지 발송
            prev_entry = state.get(server_id)
            if prev_entry and prev_entry.get('status') != status:
                prev_ts = prev_entry.get('ts')
                prev_st = prev_entry.get('status', '')
                if prev_ts:
                    _slack_reply(SLACK_CHANNEL, prev_ts,
                        f"🔄 상태 변경: {prev_st} → {status}")

            emoji_map = {'warning': '⚠️', 'critical': '🔴', 'offline': '⚫'}
            label_map = {'warning': 'Warning', 'critical': 'Critical', 'offline': 'Offline'}
            emoji = emoji_map[status]
            label = label_map[status]
            mention = '<!here> ' if status in ('critical', 'offline') else ''
            text = f"{mention}{emoji} *[{label}] {server_name}* (`{server_id}`)\n상태가 {label}(으)로 변경되었습니다."

            # 리소스 상세정보 추가
            metrics = body.get('metrics', {})
            if metrics:
                parts = []
                if metrics.get('cpu') is not None:
                    parts.append(f"CPU: {metrics['cpu']}%")
                if metrics.get('memory') is not None:
                    parts.append(f"MEM: {metrics['memory']}%")
                if metrics.get('disk') is not None:
                    parts.append(f"DISK: {metrics['disk']}%")
                if parts:
                    text += f"\n📊 {' | '.join(parts)}"
                # K8s Request 정보
                k8s_parts = []
                if metrics.get('cpuRequest') is not None:
                    k8s_parts.append(f"CPU Req: {metrics['cpuRequest']}%")
                if metrics.get('memoryRequest') is not None:
                    k8s_parts.append(f"MEM Req: {metrics['memoryRequest']}%")
                if k8s_parts:
                    text += f"\n☸️ K8s {' | '.join(k8s_parts)}"

            ts = _slack_post_message(SLACK_CHANNEL, text)

            # Critical/Offline 시 전화 알림
            if status in ('critical', 'offline'):
                threading.Thread(target=_twilio_call, args=(server_name, label), daemon=True).start()

            if ts:
                state[server_id] = {
                    'ts': ts,
                    'status': status,
                    'serverName': server_name,
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'metrics': metrics or {},
                }
                _save_alert_state(state)
                return jsonify({'sent': True, 'ts': ts}), 200
            else:
                return jsonify({'error': 'Failed to send Slack message'}), 500

        elif status == 'healthy':
            # 이전 알림이 있으면 스레드 댓글로 복구 알림
            if server_id in state:
                thread_ts = state[server_id]['ts']
                prev_status = state[server_id].get('status', '')
                if prev_status == 'offline':
                    text = f"✅ *[Reconnected] {server_name}* (`{server_id}`)\n서버가 다시 연결되었습니다."
                else:
                    text = f"✅ *[Recovered] {server_name}* (`{server_id}`)\n정상 범위로 복구되었습니다."
                _slack_reply(SLACK_CHANNEL, thread_ts, text)
                del state[server_id]
                _save_alert_state(state)
                return jsonify({'recovered': True}), 200
            return jsonify({'skipped': True, 'message': 'No prior alert'}), 200

    return jsonify({'skipped': True}), 200


# ──────────────────────────────────
# SSL 인증서 만료 체크 API
# ──────────────────────────────────

_DOMAIN_RE = re.compile(
    r'^(?:\*\.)?[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?'
    r'(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$'
)


def _check_ssl_cert(domain, port=443, timeout=5):
    """TLS 핸드셰이크로 인증서 정보 조회"""
    ctx = ssl.create_default_context()
    with ctx.wrap_socket(socket.socket(socket.AF_INET), server_hostname=domain) as s:
        s.settimeout(timeout)
        s.connect((domain, port))
        cert = s.getpeercert()

    not_after_str = cert['notAfter']
    not_after = datetime.strptime(not_after_str, '%b %d %H:%M:%S %Y %Z')
    days_remaining = (not_after.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days

    issuer_dict = {}
    for entry in cert.get('issuer', ()):
        for k, v in entry:
            issuer_dict[k] = v

    subject_dict = {}
    for entry in cert.get('subject', ()):
        for k, v in entry:
            subject_dict[k] = v

    return {
        'domain': domain,
        'port': port,
        'issuer': issuer_dict.get('organizationName', issuer_dict.get('commonName', '')),
        'subject': subject_dict.get('commonName', ''),
        'notBefore': cert.get('notBefore', ''),
        'notAfter': not_after_str,
        'daysRemaining': days_remaining,
        'serialNumber': cert.get('serialNumber', ''),
    }


def _load_ssl_domains():
    if os.path.exists(SSL_DOMAINS_FILE):
        with open(SSL_DOMAINS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'sslThresholds': {'warning': 30, 'critical': 7}, 'domains': []}


def _save_ssl_domains(data):
    with open(SSL_DOMAINS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@app.route('/api/ssl/domains', methods=['GET'])
def get_ssl_domains():
    """SSL 도메인 목록 조회"""
    return jsonify(_load_ssl_domains()), 200


@app.route('/api/ssl/domains', methods=['POST'])
def save_ssl_domains():
    """SSL 도메인 목록 저장"""
    try:
        data = request.get_json()
        if not data or 'domains' not in data:
            return jsonify({'error': 'Invalid data format'}), 400
        _save_ssl_domains(data)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ssl/check', methods=['GET'])
def check_ssl_single():
    """단건 SSL 인증서 체크"""
    domain = request.args.get('domain', '').strip()
    port = int(request.args.get('port', 443))

    if not domain or not _DOMAIN_RE.match(domain):
        return jsonify({'error': 'Invalid domain'}), 400
    if not (1 <= port <= 65535):
        return jsonify({'error': 'Invalid port'}), 400

    try:
        result = _check_ssl_cert(domain, port)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e), 'domain': domain}), 502


@app.route('/api/ssl/check-all', methods=['GET'])
def check_ssl_all():
    """전체 활성 도메인 SSL 체크"""
    config = _load_ssl_domains()
    thresholds = config.get('sslThresholds', {'warning': 30, 'critical': 7})
    results = []

    for d in config.get('domains', []):
        if not d.get('enabled', True):
            continue
        domain = d.get('domain', '')
        port = d.get('port', 443)
        try:
            info = _check_ssl_cert(domain, port)
            days = info['daysRemaining']
            if days < 0:
                info['status'] = 'expired'
            elif days <= thresholds.get('critical', 7):
                info['status'] = 'critical'
            elif days <= thresholds.get('warning', 30):
                info['status'] = 'warning'
            else:
                info['status'] = 'healthy'
            info['id'] = d.get('id', domain)
            info['description'] = d.get('description', '')
            results.append(info)
        except Exception as e:
            results.append({
                'id': d.get('id', domain),
                'domain': domain,
                'port': port,
                'status': 'error',
                'error': str(e),
                'description': d.get('description', ''),
            })

    return jsonify({'thresholds': thresholds, 'results': results}), 200


# ──────────────────────────────────
# Push 에이전트 메트릭 수신 API
# ──────────────────────────────────

def _load_push_metrics():
    if os.path.exists(PUSH_METRICS_FILE):
        with open(PUSH_METRICS_FILE, 'r') as f:
            return json.load(f)
    return {}


def _save_push_metrics(data):
    with open(PUSH_METRICS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


@app.route('/api/push/metrics', methods=['POST'])
def receive_push_metrics():
    """에이전트로부터 메트릭 수신 (서버별 pushApiKey 또는 마스터 PUSH_API_KEY 인증)"""
    body = request.get_json()
    if not body or not body.get('serverId'):
        return jsonify({'error': 'serverId is required'}), 400

    server_id = body['serverId']
    api_key = request.headers.get('X-Api-Key', '')

    # 서버별 pushApiKey 조회
    server_push_key = ''
    try:
        with open(SERVERS_FILE, 'r', encoding='utf-8') as f:
            servers_data = json.load(f)
        for srv in servers_data.get('servers', []):
            if srv.get('id') == server_id:
                server_push_key = srv.get('pushApiKey', '')
                break
    except Exception:
        pass

    # 인증: 서버별 키 → 마스터 키 순서로 확인
    if server_push_key:
        if api_key != server_push_key:
            return jsonify({'error': 'Unauthorized'}), 401
    elif PUSH_API_KEY:
        if api_key != PUSH_API_KEY:
            return jsonify({'error': 'Unauthorized'}), 401
    else:
        return jsonify({'error': 'Push API key not configured'}), 503

    with _push_lock:
        store = _load_push_metrics()

        # 레이트 리밋: 동일 서버 5초 이내 재전송 차단
        prev = store.get(server_id)
        if prev:
            last_ts = prev.get('lastUpdated', '')
            if last_ts:
                try:
                    last_dt = datetime.fromisoformat(last_ts.replace('Z', '+00:00'))
                    now_dt = datetime.now(timezone.utc)
                    if (now_dt - last_dt).total_seconds() < 5:
                        return jsonify({'error': 'Too many requests'}), 429
                except (ValueError, TypeError):
                    pass

        now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

        uptime_sec = body.get('uptime')
        uptime_obj = None
        if uptime_sec is not None:
            uptime_obj = {
                'seconds': uptime_sec,
                'days': int(uptime_sec) // 86400,
                'hours': (int(uptime_sec) % 86400) // 3600,
            }

        # 히스토리 유지 (차트용, 최대 120개 ≈ 1시간 at 30s)
        history = prev.get('history', []) if prev else []
        history.append({
            'timestamp': now_iso,
            'cpu': body.get('cpu'),
            'memory': body.get('memory'),
        })
        if len(history) > 120:
            history = history[-120:]

        store[server_id] = {
            'cpu': body.get('cpu'),
            'memory': body.get('memory'),
            'disk': body.get('disk'),
            'memoryTotal': body.get('memoryTotal'),
            'memoryUsed': body.get('memoryUsed'),
            'diskTotal': body.get('diskTotal'),
            'diskUsed': body.get('diskUsed'),
            'uptime': uptime_obj,
            'network': body.get('network'),
            'diskIO': body.get('diskIO'),
            'loadAverage': body.get('loadAverage'),
            'filesystems': body.get('filesystems'),
            'processes': body.get('processes'),
            'k8s': body.get('k8s'),
            'history': history,
            'status': 'online',
            'lastUpdated': now_iso,
        }
        _save_push_metrics(store)

    return jsonify({'success': True}), 200


@app.route('/api/push/metrics/<server_id>', methods=['GET'])
def get_push_metrics(server_id):
    """프론트엔드용 push 메트릭 조회"""
    store = _load_push_metrics()
    entry = store.get(server_id)

    if not entry:
        return jsonify({
            'cpu': None, 'memory': None, 'disk': None,
            'uptime': None, 'status': 'offline',
        }), 200

    # staleness 체크: 300초(5분) 이상 갱신 없으면 offline (에이전트 30초 × 10회 여유)
    last_ts = entry.get('lastUpdated', '')
    if last_ts:
        try:
            last_dt = datetime.fromisoformat(last_ts.replace('Z', '+00:00'))
            now_dt = datetime.now(timezone.utc)
            if (now_dt - last_dt).total_seconds() > 300:
                entry['status'] = 'offline'
        except (ValueError, TypeError):
            pass

    return jsonify(entry), 200


# ──────────────────────────────────
# Loki 로그 API (프록시)
# ──────────────────────────────────

@app.route('/api/loki/query_range', methods=['GET'])
def loki_query_range():
    """Loki query_range 프록시 — 프론트에서 직접 Loki 접근 불필요"""
    try:
        params = {
            'query': request.args.get('query', ''),
            'start': request.args.get('start', ''),
            'end': request.args.get('end', ''),
            'limit': request.args.get('limit', '500'),
            'direction': request.args.get('direction', 'backward'),
        }
        if not params['query']:
            return jsonify({'error': 'query parameter required'}), 400

        resp = http_requests.get(
            f'{LOKI_URL}/loki/api/v1/query_range',
            params=params,
            headers=LOKI_HEADERS(),
            timeout=15
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/loki/labels', methods=['GET'])
def loki_labels():
    """Loki 라벨 목록"""
    try:
        resp = http_requests.get(f'{LOKI_URL}/loki/api/v1/labels', headers=LOKI_HEADERS(), timeout=10)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/loki/label/<label_name>/values', methods=['GET'])
def loki_label_values(label_name):
    """Loki 특정 라벨의 값 목록"""
    try:
        resp = http_requests.get(
            f'{LOKI_URL}/loki/api/v1/label/{label_name}/values',
            headers=LOKI_HEADERS(),
            timeout=10
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────
# 자동 배포 Webhook
# ──────────────────────────────────

DEPLOY_SECRET = os.environ.get('DEPLOY_SECRET', '')
DEPLOY_DIR = os.environ.get('DEPLOY_DIR', '/app/infra')
INFRA_SERVICE = os.environ.get('INFRA_SERVICE', 'infra-api')

@app.route('/api/deploy', methods=['POST'])
def deploy_webhook():
    """GitHub Webhook → git pull + 서비스 재시작"""
    import subprocess, hmac, hashlib

    # Secret 검증 (설정된 경우)
    if DEPLOY_SECRET:
        sig = request.headers.get('X-Hub-Signature-256', '')
        body = request.get_data()
        expected = 'sha256=' + hmac.new(DEPLOY_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return jsonify({'error': 'Invalid signature'}), 403

    try:
        # git pull
        pull = subprocess.run(
            ['git', 'pull', 'origin', 'main'],
            cwd=DEPLOY_DIR,
            capture_output=True, text=True, timeout=30
        )

        if pull.returncode != 0:
            return jsonify({'error': 'git pull failed', 'stderr': pull.stderr}), 500

        # 변경 사항 있으면 서비스 재시작
        need_restart = 'server.py' in pull.stdout or 'Already up to date' not in pull.stdout
        restart_result = ''

        if need_restart:
            restart = subprocess.run(
                ['systemctl', 'restart', INFRA_SERVICE],
                capture_output=True, text=True, timeout=30
            )
            restart_result = f'restart: {restart.returncode}'

        app.logger.info(f'[Deploy] pull: {pull.stdout.strip()} | {restart_result}')

        return jsonify({
            'success': True,
            'pull': pull.stdout.strip(),
            'restarted': need_restart,
            'restart_result': restart_result
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/deploy/status', methods=['GET'])
def deploy_status():
    """현재 배포 상태 확인"""
    import subprocess
    try:
        result = subprocess.run(
            ['git', 'log', '--oneline', '-5'],
            cwd=DEPLOY_DIR,
            capture_output=True, text=True, timeout=10
        )
        return jsonify({
            'commits': result.stdout.strip().split('\n'),
            'service': INFRA_SERVICE
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────
# ICMP Ping API
# ──────────────────────────────────

@app.route('/api/ping', methods=['POST'])
def ping_hosts():
    """IP 목록 또는 CIDR 대역을 받아 ICMP ping 결과 반환"""
    import subprocess
    import ipaddress

    data = request.get_json()
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    targets = data.get('targets', [])
    cidr = data.get('cidr', '')
    timeout = min(int(data.get('timeout', 1)), 3)  # 최대 3초

    # CIDR 대역 → IP 목록 확장 (최대 /20 = 4096개)
    if cidr:
        try:
            network = ipaddress.ip_network(cidr, strict=False)
            if network.num_addresses > 4096:
                return jsonify({'error': 'CIDR too large (max /20)'}), 400
            targets = [str(ip) for ip in network.hosts()]
        except ValueError as e:
            return jsonify({'error': f'Invalid CIDR: {e}'}), 400

    if not targets:
        return jsonify({'error': 'No targets provided'}), 400
    if len(targets) > 4096:
        return jsonify({'error': 'Too many targets (max 4096)'}), 400

    results = []

    def ping_one(ip):
        try:
            # fping 사용 (없으면 ping fallback)
            r = subprocess.run(
                ['ping', '-c', '1', '-W', str(timeout), str(ip)],
                capture_output=True, text=True, timeout=timeout + 2
            )
            alive = r.returncode == 0
            # RTT 추출
            rtt = None
            if alive:
                import re as _re
                m = _re.search(r'time[=<]([\d.]+)', r.stdout)
                if m:
                    rtt = float(m.group(1))
            return {'ip': str(ip), 'alive': alive, 'rtt': rtt}
        except (subprocess.TimeoutExpired, Exception):
            return {'ip': str(ip), 'alive': False, 'rtt': None}

    # 병렬 ping (최대 64 스레드)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(64, len(targets))) as pool:
        results = list(pool.map(ping_one, targets))

    alive_count = sum(1 for r in results if r['alive'])
    return jsonify({
        'total': len(results),
        'alive': alive_count,
        'dead': len(results) - alive_count,
        'results': results
    }), 200


if __name__ == '__main__':
    # 개발 환경: 디버그 모드
    # 운영 환경: gunicorn 사용 권장
    app.run(host='127.0.0.1', port=5000, debug=False)
