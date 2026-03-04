#!/usr/bin/env python3
"""경량 Push 모니터링 에이전트 — Python 3.6+ stdlib only.

타겟 서버에서 시스템 메트릭을 수집하여 모니터링 서버 API로 전송한다.
/proc 파일시스템 기반 (Linux 전용).

수집 항목:
  CPU, Memory, Disk, Uptime, Load Average,
  Network Traffic, Disk I/O, Filesystems, Top Processes

사용법:
  1. agent_config.json 설정
  2. python3 push_agent.py
  3. 또는 systemd 서비스로 등록
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent_config.json')

_CLK_TCK = os.sysconf('SC_CLK_TCK') if hasattr(os, 'sysconf') else 100
_PAGE_SIZE = os.sysconf('SC_PAGE_SIZE') if hasattr(os, 'sysconf') else 4096

# 실제 블록 디바이스 패턴 (파티션 제외)
_BLOCKDEV_RE = re.compile(r'^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|hd[a-z]+|dm-\d+)$')

# 가상 네트워크 인터페이스 제외
_VIRT_IFACE = ('lo', 'docker', 'veth', 'br-', 'virbr', 'flannel', 'cni', 'cali')

# 실제 파일시스템 타입
_REAL_FS = {'ext4', 'xfs', 'btrfs', 'vfat', 'nfs', 'nfs4', 'zfs'}


# ── /proc 카운터 읽기 (rate 계산용, 두 번 호출) ──

def _read_cpu_stat():
    with open('/proc/stat', 'r') as f:
        line = f.readline()
    parts = line.split()
    values = [int(v) for v in parts[1:]]
    idle = values[3] + values[4]
    return idle, sum(values)


def _read_net_dev():
    """네트워크 인터페이스별 rx/tx bytes"""
    result = {}
    try:
        with open('/proc/net/dev', 'r') as f:
            for line in f:
                line = line.strip()
                if ':' not in line:
                    continue
                iface, data = line.split(':', 1)
                iface = iface.strip()
                if any(iface.startswith(p) for p in _VIRT_IFACE):
                    continue
                parts = data.split()
                result[iface] = (int(parts[0]), int(parts[8]))
    except (IOError, OSError):
        pass
    return result


def _read_diskstats():
    """블록 디바이스별 read/write bytes"""
    result = {}
    try:
        with open('/proc/diskstats', 'r') as f:
            for line in f:
                parts = line.split()
                if len(parts) < 14:
                    continue
                device = parts[2]
                if not _BLOCKDEV_RE.match(device):
                    continue
                result[device] = (int(parts[5]) * 512, int(parts[9]) * 512)
    except (IOError, OSError):
        pass
    return result


def _read_proc_times():
    """모든 프로세스의 CPU 시간과 메모리 (pid → (comm, cputime, rss))"""
    result = {}
    try:
        for entry in os.listdir('/proc'):
            if not entry.isdigit():
                continue
            try:
                with open('/proc/{}/stat'.format(entry), 'r') as f:
                    stat = f.read()
                i = stat.rfind(')')
                if i < 0:
                    continue
                comm = stat[stat.index('(') + 1:i]
                fields = stat[i + 2:].split()
                utime = int(fields[11])
                stime = int(fields[12])
                rss = int(fields[21]) * _PAGE_SIZE
                result[int(entry)] = (comm, utime + stime, rss)
            except (IOError, OSError, ValueError, IndexError):
                continue
    except (IOError, OSError):
        pass
    return result


# ── 단일 읽기 메트릭 ──

def read_memory():
    """메모리 사용률 + 총량/사용량 (bytes)"""
    meminfo = {}
    with open('/proc/meminfo', 'r') as f:
        for line in f:
            parts = line.split()
            key = parts[0].rstrip(':')
            meminfo[key] = int(parts[1]) * 1024
    total = meminfo.get('MemTotal', 0)
    available = meminfo.get('MemAvailable', 0)
    if total == 0:
        return 0.0, 0, 0
    used = total - available
    return round(used / total * 100, 2), total, used


def read_uptime():
    """시스템 가동 시간 (초)"""
    with open('/proc/uptime', 'r') as f:
        return float(f.readline().split()[0])


def read_load_average():
    """Load average (1m, 5m, 15m)"""
    with open('/proc/loadavg', 'r') as f:
        parts = f.readline().split()
    return {'load1': float(parts[0]), 'load5': float(parts[1]), 'load15': float(parts[2])}


def read_all_filesystems():
    """모든 실제 파일시스템 조회"""
    seen = set()
    filesystems = []
    try:
        with open('/proc/mounts', 'r') as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                device, mountpoint, fstype = parts[0], parts[1], parts[2]
                if fstype not in _REAL_FS or mountpoint in seen:
                    continue
                seen.add(mountpoint)
                try:
                    st = os.statvfs(mountpoint)
                    total = st.f_frsize * st.f_blocks
                    avail = st.f_frsize * st.f_bavail
                    if total == 0:
                        continue
                    used = total - avail
                    filesystems.append({
                        'mountpoint': mountpoint,
                        'fstype': fstype,
                        'device': device,
                        'total': total,
                        'avail': avail,
                        'used': used,
                        'usagePercent': round(used / total * 100, 2),
                    })
                except OSError:
                    continue
    except (IOError, OSError):
        pass
    return filesystems


# ── K8s 리소스 수집 (kubectl 필요, 없으면 스킵) ──

def _run_cmd(args, timeout=15):
    """명령 실행 후 stdout 반환, 실패 시 None"""
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, _ = proc.communicate(timeout=timeout)
        if proc.returncode != 0:
            return None
        return stdout.decode('utf-8')
    except Exception:
        return None


def _parse_k8s_cpu(val):
    """K8s CPU 값 → cores (float). 예: '100m' → 0.1, '2' → 2.0"""
    if not val:
        return 0
    val = str(val)
    if val.endswith('m'):
        return int(val[:-1]) / 1000
    return float(val)


def _parse_k8s_memory(val):
    """K8s 메모리 값 → bytes (int). 예: '256Mi' → 268435456"""
    if not val:
        return 0
    val = str(val)
    suffixes = {'Ki': 1024, 'Mi': 1024 ** 2, 'Gi': 1024 ** 3, 'Ti': 1024 ** 4}
    for suffix, mult in suffixes.items():
        if val.endswith(suffix):
            return int(val[:-len(suffix)]) * mult
    try:
        return int(val)
    except ValueError:
        return 0


def _detect_node_name():
    """현재 서버의 K8s 노드 이름 자동 감지"""
    hostname = os.uname()[1]

    # 방법1: hostname이 곧 노드 이름인 경우 (가장 일반적)
    out = _run_cmd(['kubectl', 'get', 'node', hostname, '-o', 'name'], timeout=5)
    if out and out.strip():
        return hostname

    # 방법2: 전체 노드에서 Hostname/InternalIP로 매칭
    out = _run_cmd(['kubectl', 'get', 'nodes', '-o', 'json'], timeout=10)
    if out:
        try:
            for node in json.loads(out).get('items', []):
                for addr in node.get('status', {}).get('addresses', []):
                    if addr.get('address') == hostname:
                        return node['metadata']['name']
        except Exception:
            pass

    return None


def read_k8s_resources(node_name_override=None):
    """K8s Pod 리소스 조회. kubectl 없거나 K8s 노드가 아니면 None 반환."""
    node_name = node_name_override or _detect_node_name()
    if not node_name:
        return None

    # Pod 목록 (현재 노드에 스케줄된 것만)
    pod_out = _run_cmd([
        'kubectl', 'get', 'pods', '-A', '-o', 'json',
        '--field-selector', 'spec.nodeName={}'.format(node_name),
    ])
    if not pod_out:
        return None

    try:
        pod_data = json.loads(pod_out)
    except (json.JSONDecodeError, ValueError):
        return None

    # 노드 allocatable
    node_alloc = None
    node_out = _run_cmd(['kubectl', 'get', 'node', node_name, '-o', 'json'], timeout=10)
    if node_out:
        try:
            alloc = json.loads(node_out).get('status', {}).get('allocatable', {})
            node_alloc = {
                'cpu': _parse_k8s_cpu(alloc.get('cpu')),
                'memory': _parse_k8s_memory(alloc.get('memory')),
            }
        except Exception:
            pass

    # Pod 파싱
    pods = []
    summary = {'total': 0, 'running': 0, 'pending': 0, 'failed': 0}

    for item in pod_data.get('items', []):
        meta = item.get('metadata', {})
        spec = item.get('spec', {})
        status = item.get('status', {})
        phase = status.get('phase', 'Unknown')

        summary['total'] += 1
        key = phase.lower()
        if key in summary:
            summary[key] += 1

        cpu_req = cpu_lim = mem_req = mem_lim = 0
        for ctr in spec.get('containers', []):
            res = ctr.get('resources', {})
            req = res.get('requests', {})
            lim = res.get('limits', {})
            cpu_req += _parse_k8s_cpu(req.get('cpu'))
            mem_req += _parse_k8s_memory(req.get('memory'))
            cpu_lim += _parse_k8s_cpu(lim.get('cpu'))
            mem_lim += _parse_k8s_memory(lim.get('memory'))

        pods.append({
            'name': meta.get('name', ''),
            'namespace': meta.get('namespace', ''),
            'phase': phase,
            'cpuReq': cpu_req,
            'memReq': mem_req,
            'cpuLim': cpu_lim,
            'memLim': mem_lim,
        })

    pods.sort(key=lambda p: p['cpuReq'], reverse=True)

    return {
        'nodeName': node_name,
        'nodeAllocatable': node_alloc,
        'pods': pods,
        'summary': summary,
    }


# ── 메트릭 통합 수집 ──

def collect_metrics():
    """전체 메트릭 수집 (1초 샘플링으로 rate 기반 메트릭 계산)"""
    # t0 카운터
    cpu_idle1, cpu_total1 = _read_cpu_stat()
    net1 = _read_net_dev()
    disk1 = _read_diskstats()
    proc1 = _read_proc_times()

    time.sleep(1)

    # t1 카운터
    cpu_idle2, cpu_total2 = _read_cpu_stat()
    net2 = _read_net_dev()
    disk2 = _read_diskstats()
    proc2 = _read_proc_times()

    # CPU 사용률
    d_idle = cpu_idle2 - cpu_idle1
    d_total = cpu_total2 - cpu_total1
    cpu_pct = round((1.0 - d_idle / d_total) * 100, 2) if d_total > 0 else 0.0

    # 네트워크 트래픽 (bytes/s, 1초 간격이므로 delta = rate)
    rx = sum(net2[i][0] - net1[i][0] for i in net2 if i in net1)
    tx = sum(net2[i][1] - net1[i][1] for i in net2 if i in net1)

    # 디스크 I/O (bytes/s)
    dr = sum(disk2[d][0] - disk1[d][0] for d in disk2 if d in disk1)
    dw = sum(disk2[d][1] - disk1[d][1] for d in disk2 if d in disk1)

    # Top 프로세스 (프로세스 이름별 합산, CPU 상위 10개)
    proc_cpu = {}
    proc_mem = {}
    for pid, (comm, cputime2, rss) in proc2.items():
        if pid in proc1:
            delta = cputime2 - proc1[pid][1]
            if delta < 0:
                continue
            cpu_val = round(delta / _CLK_TCK * 100, 2)
            proc_cpu[comm] = proc_cpu.get(comm, 0) + cpu_val
            proc_mem[comm] = proc_mem.get(comm, 0) + rss

    top = sorted(proc_cpu.items(), key=lambda x: x[1], reverse=True)[:10]
    processes = [{'name': n, 'cpu': c, 'memory': proc_mem.get(n, 0)} for n, c in top]

    # 단일 읽기 메트릭
    mem_pct, mem_total, mem_used = read_memory()
    uptime = read_uptime()
    load_avg = read_load_average()
    filesystems = read_all_filesystems()

    # disk: 사용률 최대 파일시스템
    disk_pct, disk_total, disk_used = 0.0, 0, 0
    for fs in filesystems:
        if fs['usagePercent'] > disk_pct:
            disk_pct = fs['usagePercent']
            disk_total = fs['total']
            disk_used = fs['used']

    result = {
        'cpu': cpu_pct,
        'memory': mem_pct,
        'memoryTotal': mem_total,
        'memoryUsed': mem_used,
        'disk': disk_pct,
        'diskTotal': disk_total,
        'diskUsed': disk_used,
        'uptime': uptime,
        'loadAverage': load_avg,
        'network': {'inbound': rx, 'outbound': tx},
        'diskIO': {'read': dr, 'write': dw},
        'filesystems': filesystems,
        'processes': processes,
    }

    # K8s 리소스 (kubectl 사용 가능한 경우에만)
    try:
        k8s = read_k8s_resources()
        if k8s is not None:
            result['k8s'] = k8s
    except Exception:
        pass

    return result


def push_metrics(config, metrics):
    """모니터링 서버로 메트릭 전송"""
    payload = json.dumps({**metrics, 'serverId': config['server_id']}).encode('utf-8')
    req = urllib.request.Request(
        config['server_url'],
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'X-Api-Key': config['api_key'],
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return res.status


def main():
    if not os.path.exists(CONFIG_FILE):
        print('[ERROR] 설정 파일 없음: {}'.format(CONFIG_FILE), file=sys.stderr)
        sys.exit(1)

    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)

    for key in ('server_url', 'server_id', 'api_key'):
        if not config.get(key):
            print('[ERROR] 설정 누락: {}'.format(key), file=sys.stderr)
            sys.exit(1)

    interval = config.get('interval', 30)
    print('[INFO] Push agent 시작 — server_id={}, interval={}s'.format(config['server_id'], interval))

    while True:
        try:
            metrics = collect_metrics()
            status = push_metrics(config, metrics)
            net = metrics.get('network', {})
            k8s_info = ''
            if 'k8s' in metrics:
                k8s_info = ' K8s={}pods'.format(metrics['k8s']['summary']['total'])
            print('[OK] CPU={}% MEM={}% DISK={}% NET={}B/s↓ {}B/s↑{} → {}'.format(
                metrics['cpu'], metrics['memory'], metrics['disk'],
                net.get('inbound', 0), net.get('outbound', 0), k8s_info, status))
        except urllib.error.URLError as e:
            print('[ERROR] 전송 실패: {}'.format(e), file=sys.stderr)
        except Exception as e:
            print('[ERROR] {}'.format(e), file=sys.stderr)
        time.sleep(interval)


if __name__ == '__main__':
    main()
