#!/usr/bin/env python3
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import threading
import requests as http_requests

app = Flask(__name__)
CORS(app)

SERVERS_FILE = '/app/infra/assets/data/servers.json'
ALERT_STATE_FILE = '/app/infra/api/alert_state.json'
ALERT_CONFIG_FILE = '/app/infra/api/alert_config.json'
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')

# 동시 알림 요청 시 중복 발송 방지 lock
_alert_lock = threading.Lock()


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
        
        return jsonify({'success': True, 'message': 'Servers saved successfully'}), 200
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
            # 이미 알림 발송된 서버면 중복 발송 안 함
            if server_id in state:
                return jsonify({'skipped': True, 'message': 'Alert already sent'}), 200

            emoji_map = {'warning': '⚠️', 'critical': '🔴', 'offline': '⚫'}
            label_map = {'warning': 'Warning', 'critical': 'Critical', 'offline': 'Offline'}
            emoji = emoji_map[status]
            label = label_map[status]
            text = f"{emoji} *[{label}] {server_name}* (`{server_id}`)\n상태가 {label}(으)로 변경되었습니다."

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

            ts = _slack_post_message(SLACK_CHANNEL, text)
            if ts:
                state[server_id] = {'ts': ts, 'status': status}
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


if __name__ == '__main__':
    # 개발 환경: 디버그 모드
    # 운영 환경: gunicorn 사용 권장
    app.run(host='127.0.0.1', port=5000, debug=False)
