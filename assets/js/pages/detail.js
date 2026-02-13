// assets/js/pages/detail.js
import {
  fetchServerMetrics,
  fetchCpuHistory,
  fetchMemoryHistory,
  fetchNetworkTraffic,
  fetchDiskIO,
  fetchLoadAverage,
  fetchAllDisks,
  fetchTopProcesses,
  fetchKubernetesPodResources,
  fetchSystemInfo,
  fetchMinioCapacity,
  fetchLonghornCapacity,
  fetchServersData
} from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let refreshInterval;
let cpuChart;
let memoryChart;

export async function renderDetail(params) {
  const serverId = params.id;
  
  const serversData = await fetchServersData();
  const server = serversData.servers.find(s => s.id === serverId);
  
  if (!server) {
    document.getElementById('app').innerHTML = `
      <div class="main">
        <div class="card">
          <h2>서버를 찾을 수 없습니다.</h2>
          <button class="btn" onclick="window.location.hash = '/overview'">돌아가기</button>
        </div>
      </div>
    `;
    return;
  }

  const main = document.getElementById('app');
  main.innerHTML = `
    <div class="main">
      <!-- 상단: 서버 상태(7) + Network/Disk I/O(3) -->
      <div style="display: grid; grid-template-columns: 7fr 3fr; gap: 1rem; margin-bottom: 1.5rem;">
        <!-- 서버 상태 카드 -->
        <div class="card">
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
            <div style="font-size: 2.5rem;">${server.icon}</div>
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.25rem;">
                <h1 style="font-size: 1.5rem; margin: 0;">${server.name}</h1>
                <span class="badge info">${server.project}</span>
                <div class="status-indicator" id="serverStatus"></div>
              </div>
              <div style="font-size: 0.9rem; color: var(--text-muted);">${server.instance}</div>
            </div>
            <button class="btn" onclick="window.location.hash = '/overview'">← 돌아가기</button>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.6rem;">
            <!-- CPU -->
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 40px; font-weight: 600;">CPU</span>
              <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="cpuProgress" style="background: var(--success);"></div></div>
              <span id="cpuValue" style="font-size: 0.9rem; font-weight: 600; min-width: 55px; text-align: right;">--%</span>
              <span style="min-width: 160px;"></span>
            </div>
            <!-- Memory -->
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 40px; font-weight: 600;">MEM</span>
              <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="memProgress" style="background: var(--success);"></div></div>
              <span id="memValue" style="font-size: 0.9rem; font-weight: 600; min-width: 55px; text-align: right;">--%</span>
              <span id="memDetail" style="font-size: 0.75rem; color: var(--text-muted); min-width: 160px;"></span>
            </div>
            <!-- Disk -->
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 40px; font-weight: 600;">DISK</span>
              <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="diskProgress" style="background: var(--success);"></div></div>
              <span id="diskValue" style="font-size: 0.9rem; font-weight: 600; min-width: 55px; text-align: right;">--%</span>
              <span id="diskDetail" style="font-size: 0.75rem; color: var(--text-muted); min-width: 160px;"></span>
            </div>
          </div>

          <!-- Uptime & Load Average -->
          <div style="display: flex; gap: 1.5rem; margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid var(--border); font-size: 0.85rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span style="color: var(--text-muted);">Uptime</span>
              <span id="uptimeValue" style="font-weight: 600;">--</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span style="color: var(--text-muted);">Load</span>
              <span id="load1" style="font-weight: 600;">--</span>
              <span style="color: var(--text-muted);">/</span>
              <span id="load5" style="font-weight: 600;">--</span>
              <span style="color: var(--text-muted);">/</span>
              <span id="load15" style="font-weight: 600;">--</span>
              <span style="color: var(--text-muted); font-size: 0.75rem;">(1m/5m/15m)</span>
            </div>
          </div>
        </div>

        <!-- Network Traffic + Disk I/O (위/아래 배치, 컴팩트) -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <div class="card" style="padding: 0.6rem 1rem;">
            <div style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem;">📡 NETWORK TRAFFIC</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <span style="color: var(--text-muted); font-size: 0.8rem;">↓ In</span>
              <span id="networkIn" style="font-size: 0.95rem; font-weight: 600;">-- B/s</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted); font-size: 0.8rem;">↑ Out</span>
              <span id="networkOut" style="font-size: 0.95rem; font-weight: 600;">-- B/s</span>
            </div>
          </div>

          <div class="card" style="padding: 0.6rem 1rem;">
            <div style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem;">💿 DISK I/O</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <span style="color: var(--text-muted); font-size: 0.8rem;">📖 Read</span>
              <span id="diskRead" style="font-size: 0.95rem; font-weight: 600;">-- B/s</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted); font-size: 0.8rem;">✍️ Write</span>
              <span id="diskWrite" style="font-size: 0.95rem; font-weight: 600;">-- B/s</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid-2" style="margin-bottom: 1.5rem;">
        <div class="card">
          <div class="card-header">
            <span class="card-title">CPU USAGE (1H)</span>
          </div>
          <div style="position: relative; height: 250px;">
            <canvas id="cpuChart"></canvas>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">MEMORY USAGE (1H)</span>
          </div>
          <div style="position: relative; height: 250px;">
            <canvas id="memoryChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Top Processes / System Info + All Disks — 2열 -->
      <div class="grid-2" style="margin-bottom: 1.5rem;">
        <div class="card" style="display:flex;flex-direction:column;">
          <div class="card-header">
            <span class="card-title" id="infoCardTitle">TOP PROCESSES (CPU)</span>
            <span class="card-icon" id="infoCardIcon">📊</span>
          </div>
          <div id="topProcessContainer" style="flex:1;max-height:210px;overflow-y:auto;padding:0.5rem 0;">
            <div style="color: var(--text-muted); font-size: 0.9rem;">로딩 중...</div>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;">
          <div class="card-header">
            <span class="card-title">DISK USAGE (ALL FILESYSTEMS)</span>
            <span class="card-icon" style="color: var(--color-purple);">💾</span>
          </div>
          <div id="allDisksContainer" style="flex:1;max-height:210px;overflow-y:auto;padding:0.5rem 0;">
            <div style="color: var(--text-muted); font-size: 0.9rem;">디스크 정보를 불러오는 중...</div>
          </div>
        </div>
      </div>

      <!-- Storage (MinIO / Longhorn) — 메트릭 존재 시에만 표시 -->
      <div id="storageSection" style="display: none; margin-top: 1.5rem;">
        <div class="grid-2">
          <div class="card" id="minioCard" style="display: none;">
            <div class="card-header">
              <span class="card-title">MINIO STORAGE</span>
              <span class="card-icon">🪣</span>
            </div>
            <div id="minioContent" style="padding: 1rem 0;"></div>
          </div>

          <div class="card" id="longhornCard" style="display: none;">
            <div class="card-header">
              <span class="card-title">LONGHORN STORAGE</span>
              <span class="card-icon">🐂</span>
            </div>
            <div id="longhornContent" style="padding: 1rem 0;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 초기 데이터 로드
  await updateServerData(server);

  // 10초마다 갱신
  refreshInterval = setInterval(() => updateServerData(server), 10000);
}

async function updateServerData(server) {
  const metrics = await fetchServerMetrics(server.instance);
  const networkTraffic = await fetchNetworkTraffic(server.instance);
  const diskIO = await fetchDiskIO(server.instance);
  const loadAvg = await fetchLoadAverage(server.instance);

  // 상태 표시
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) {
    statusEl.className = `status-indicator ${metrics.status}`;
  }

  // 임계값 기반 색상 (overview 카드와 동일)
  const barColor = (val, type) => {
    if (!val) return 'var(--success)';
    const th = { cpu: { warning: 80, critical: 90 }, memory: { warning: 80, critical: 90 }, disk: { warning: 80, critical: 90 } };
    if (val >= th[type].critical) return 'var(--danger)';
    if (val >= th[type].warning) return 'var(--warning)';
    return 'var(--success)';
  };

  // CPU
  if (typeof metrics.cpu === 'number') {
    const cpuEl = document.getElementById('cpuProgress');
    const cpuValEl = document.getElementById('cpuValue');
    if (cpuEl) { cpuEl.style.width = `${metrics.cpu}%`; cpuEl.style.background = barColor(metrics.cpu, 'cpu'); }
    if (cpuValEl) cpuValEl.textContent = `${metrics.cpu.toFixed(1)}%`;
  }

  // Memory
  if (typeof metrics.memory === 'number') {
    const memEl = document.getElementById('memProgress');
    const memValEl = document.getElementById('memValue');
    if (memEl) { memEl.style.width = `${metrics.memory}%`; memEl.style.background = barColor(metrics.memory, 'memory'); }
    if (memValEl) memValEl.textContent = `${metrics.memory.toFixed(1)}%`;
    const memDetailEl = document.getElementById('memDetail');
    if (memDetailEl && metrics.memoryUsed && metrics.memoryTotal) {
      memDetailEl.textContent = `(${formatBytes(metrics.memoryUsed)} / ${formatBytes(metrics.memoryTotal)})`;
    }
  }

  // Disk
  if (typeof metrics.disk === 'number') {
    const diskEl = document.getElementById('diskProgress');
    const diskValEl = document.getElementById('diskValue');
    if (diskEl) { diskEl.style.width = `${metrics.disk}%`; diskEl.style.background = barColor(metrics.disk, 'disk'); }
    if (diskValEl) diskValEl.textContent = `${metrics.disk.toFixed(1)}%`;
    const diskDetailEl = document.getElementById('diskDetail');
    if (diskDetailEl && metrics.diskUsed && metrics.diskTotal) {
      diskDetailEl.textContent = `(${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)})`;
    }
  }

  // Uptime
  if (metrics.uptime) {
    document.getElementById('uptimeValue').textContent = `${metrics.uptime.days}d ${metrics.uptime.hours}h`;
  }

  // Network Traffic
  if (networkTraffic.inbound !== null) {
    document.getElementById('networkIn').textContent = formatBytes(networkTraffic.inbound) + '/s';
  }
  if (networkTraffic.outbound !== null) {
    document.getElementById('networkOut').textContent = formatBytes(networkTraffic.outbound) + '/s';
  }

  // Disk I/O
  if (diskIO.read !== null) {
    document.getElementById('diskRead').textContent = formatBytes(diskIO.read) + '/s';
  }
  if (diskIO.write !== null) {
    document.getElementById('diskWrite').textContent = formatBytes(diskIO.write) + '/s';
  }

  // Load Average
  if (loadAvg.load1 !== null) {
    document.getElementById('load1').textContent = loadAvg.load1.toFixed(2);
  }
  if (loadAvg.load5 !== null) {
    document.getElementById('load5').textContent = loadAvg.load5.toFixed(2);
  }
  if (loadAvg.load15 !== null) {
    document.getElementById('load15').textContent = loadAvg.load15.toFixed(2);
  }

  // MinIO / Longhorn 스토리지
  const minio = await fetchMinioCapacity();
  const longhorn = await fetchLonghornCapacity();
  let showStorage = false;

  if (minio.total !== null) {
    showStorage = true;
    const minioCard = document.getElementById('minioCard');
    const minioContent = document.getElementById('minioContent');
    if (minioCard && minioContent) {
      minioCard.style.display = '';
      const pct = minio.usagePercent.toFixed(1);
      const color = minio.usagePercent >= 90 ? 'var(--danger)' : minio.usagePercent >= 80 ? 'var(--warning)' : 'var(--success)';
      let html = `
        <div style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
            <span style="font-size: 0.9rem;">Cluster</span>
            <span style="font-weight: 600; color: ${color};">${pct}% (${formatBytes(minio.used)} / ${formatBytes(minio.total)})</span>
          </div>
          <div class="progress-bar" style="height: 6px;">
            <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
      if (minio.buckets.length > 0) {
        html += `<div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Buckets</div>`;
        minio.buckets.forEach(b => {
          html += `<div style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.25rem 0;">
            <span>${b.name}</span><span style="color: var(--text-muted);">${formatBytes(b.size)}</span>
          </div>`;
        });
      }
      minioContent.innerHTML = html;
    }
  }

  if (longhorn.nodes.length > 0) {
    showStorage = true;
    const lhCard = document.getElementById('longhornCard');
    const lhContent = document.getElementById('longhornContent');
    if (lhCard && lhContent) {
      lhCard.style.display = '';
      let html = '';
      longhorn.nodes.forEach(node => {
        const pct = node.usagePercent.toFixed(1);
        const color = node.usagePercent >= 90 ? 'var(--danger)' : node.usagePercent >= 80 ? 'var(--warning)' : 'var(--success)';
        html += `
          <div style="margin-bottom: 0.75rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
              <span style="font-size: 0.85rem;">${node.name}</span>
              <span style="font-size: 0.85rem; font-weight: 600; color: ${color};">${pct}% (${formatBytes(node.used)} / ${formatBytes(node.capacity)})</span>
            </div>
            <div class="progress-bar" style="height: 6px;">
              <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
            </div>
          </div>
        `;
      });
      if (longhorn.volumes.length > 0) {
        html += `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.75rem; margin-bottom: 0.5rem;">Volumes</div>`;
        longhorn.volumes.forEach(v => {
          html += `<div style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.25rem 0;">
            <span>${v.name}</span><span style="color: var(--text-muted);">${formatBytes(v.size)}</span>
          </div>`;
        });
      }
      lhContent.innerHTML = html;
    }
  }

  const storageSection = document.getElementById('storageSection');
  if (storageSection && showStorage) {
    storageSection.style.display = '';
  }

  // 전체 디스크 표시
  const allDisks = await fetchAllDisks(server.instance);
  const disksContainer = document.getElementById('allDisksContainer');
  if (disksContainer && allDisks.length > 0) {
    disksContainer.innerHTML = allDisks
      .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint))
      .map(disk => {
        const usedStr = formatBytes(disk.used);
        const totalStr = formatBytes(disk.total);
        const pct = disk.usagePercent.toFixed(1);
        const color = disk.usagePercent >= 90 ? 'var(--danger)' : disk.usagePercent >= 80 ? 'var(--warning)' : 'var(--success)';
        return `
          <div style="margin-bottom: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="font-size: 0.85rem; color: var(--text-primary);">${disk.mountpoint} <span style="color: var(--text-muted); font-size: 0.75rem;">(${disk.fstype})</span></span>
              <span style="font-size: 0.85rem; font-weight: 600; color: ${color};">${pct}% <span style="color: var(--text-muted); font-weight: 400;">(${usedStr} / ${totalStr})</span></span>
            </div>
            <div class="progress-bar" style="height: 6px;">
              <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
            </div>
          </div>
        `;
      }).join('');
  } else if (disksContainer) {
    disksContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem;">디스크 정보 없음</div>';
  }

  // Top Processes → Kubernetes Resources → System Info (fallback 순서)
  const processes = await fetchTopProcesses(server.instance);
  const procContainer = document.getElementById('topProcessContainer');
  const titleEl = document.getElementById('infoCardTitle');
  const iconEl = document.getElementById('infoCardIcon');

  if (procContainer && processes.length > 0) {
    // 1순위: process-exporter 데이터 있음 → 프로세스 목록
    if (titleEl) titleEl.textContent = 'TOP PROCESSES (CPU)';
    if (iconEl) iconEl.textContent = '📊';
    procContainer.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:0 0 0.4rem;border-bottom:1px solid var(--border);margin-bottom:0.3rem;">
        <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;flex:1;">PROCESS</span>
        <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;min-width:65px;text-align:right;">CPU</span>
        <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;min-width:75px;text-align:right;">MEM</span>
      </div>
    ` + processes.map((p, i) => {
      const cpuColor = p.cpu >= 50 ? 'var(--danger)' : p.cpu >= 20 ? 'var(--warning)' : 'var(--text-primary)';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.3rem 0;${i < processes.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.03);' : ''}">
          <span style="font-size:0.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.name}">${p.name}</span>
          <span style="font-size:0.82rem;font-weight:600;min-width:65px;text-align:right;color:${cpuColor};">${p.cpu.toFixed(1)}%</span>
          <span style="font-size:0.82rem;min-width:75px;text-align:right;color:var(--text-muted);">${formatBytes(p.memory)}</span>
        </div>`;
    }).join('');
  } else if (procContainer) {
    // 2순위: kube-state-metrics 데이터 시도 (서버 IP → 해당 노드 Pod만)
    const k8sRes = await fetchKubernetesPodResources(server.instance);
    if (k8sRes.pods.length > 0) {
      if (titleEl) titleEl.textContent = `KUBERNETES — ${k8sRes.nodeName || 'CLUSTER'}`;
      if (iconEl) iconEl.textContent = '☸️';

      const phaseColor = (phase) => {
        if (phase === 'Running') return 'var(--success)';
        if (phase === 'Pending') return 'var(--warning)';
        return 'var(--danger)';
      };
      const fmtCpu = (cores) => cores >= 1 ? `${cores.toFixed(1)}c` : `${Math.round(cores * 1000)}m`;

      // 요약 헤더
      const alloc = k8sRes.nodeAllocatable;
      const totalCpuReq = k8sRes.pods.reduce((s, p) => s + p.cpuReq, 0);
      const totalMemReq = k8sRes.pods.reduce((s, p) => s + p.memReq, 0);
      let html = `
        <div style="display:flex;gap:1rem;padding:0 0 0.5rem;border-bottom:1px solid var(--border);margin-bottom:0.4rem;flex-wrap:wrap;">
          <span style="font-size:0.75rem;"><span style="color:var(--success);font-weight:700;">${k8sRes.summary.running}</span> <span style="color:var(--text-muted);">Running</span></span>
          <span style="font-size:0.75rem;"><span style="color:var(--warning);font-weight:700;">${k8sRes.summary.pending}</span> <span style="color:var(--text-muted);">Pending</span></span>
          <span style="font-size:0.75rem;"><span style="color:var(--danger);font-weight:700;">${k8sRes.summary.failed}</span> <span style="color:var(--text-muted);">Failed</span></span>
          <span style="font-size:0.75rem;color:var(--text-muted);">Total <strong style="color:var(--text-primary);">${k8sRes.summary.total}</strong></span>
          ${alloc ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">CPU ${fmtCpu(totalCpuReq)}/${fmtCpu(alloc.cpu)} · MEM ${formatBytes(totalMemReq)}/${formatBytes(alloc.memory)}</span>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;padding:0 0 0.3rem;margin-bottom:0.2rem;">
          <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;flex:1;">POD</span>
          <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;min-width:50px;text-align:right;">CPU REQ</span>
          <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;min-width:65px;text-align:right;">MEM REQ</span>
          <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;min-width:18px;text-align:center;">⬤</span>
        </div>
      `;

      // Pod 목록
      k8sRes.pods.forEach((pod, i) => {
        const shortName = pod.name.length > 30 ? pod.name.substring(0, 28) + '…' : pod.name;
        html += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.25rem 0;${i < k8sRes.pods.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.03);' : ''}">
            <span style="font-size:0.78rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${pod.namespace}/${pod.name}">
              <span style="color:var(--text-muted);font-size:0.7rem;">${pod.namespace}/</span>${shortName}
            </span>
            <span style="font-size:0.78rem;min-width:50px;text-align:right;font-weight:600;">${pod.cpuReq > 0 ? fmtCpu(pod.cpuReq) : '-'}</span>
            <span style="font-size:0.78rem;min-width:65px;text-align:right;color:var(--text-muted);">${pod.memReq > 0 ? formatBytes(pod.memReq) : '-'}</span>
            <span style="font-size:0.5rem;min-width:18px;text-align:center;color:${phaseColor(pod.phase)};">⬤</span>
          </div>`;
      });

      procContainer.innerHTML = html;
    } else {
      // 3순위: fallback → 시스템 정보
      if (titleEl) titleEl.textContent = 'SYSTEM INFO';
      if (iconEl) iconEl.textContent = '🖥️';
      const sysInfo = await fetchSystemInfo(server.instance);
      const row = (label, value) => `
        <div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.03);">
          <span style="font-size:0.82rem;color:var(--text-muted);">${label}</span>
          <span style="font-size:0.82rem;font-weight:600;">${value ?? '--'}</span>
        </div>`;
      procContainer.innerHTML =
        row('Hostname', sysInfo.hostname) +
        row('OS / Arch', `${sysInfo.os ?? '--'} ${sysInfo.machine ?? ''}`) +
        row('Kernel', sysInfo.kernel) +
        row('Running Procs', sysInfo.procsRunning != null ? Math.round(sysInfo.procsRunning) : '--') +
        row('Blocked Procs', sysInfo.procsBlocked != null ? Math.round(sysInfo.procsBlocked) : '--') +
        row('Open FDs', sysInfo.fileDescriptors != null ? Math.round(sysInfo.fileDescriptors).toLocaleString() : '--') +
        row('Entropy', sysInfo.entropy != null ? Math.round(sysInfo.entropy).toLocaleString() : '--') +
        row('Context Switches', sysInfo.contextSwitches != null ? `${(sysInfo.contextSwitches / 1000).toFixed(1)}K/s` : '--');
    }
  }

  // 차트 생성 (첫 실행 시에만)
  if (!cpuChart) {
    await createCharts(server.instance);
  }
}

async function createCharts(instance) {
  const cpuHistory = await fetchCpuHistory(instance);
  const memoryHistory = await fetchMemoryHistory(instance);

  // CPU Chart
  const cpuCtx = document.getElementById('cpuChart').getContext('2d');
  cpuChart = new Chart(cpuCtx, {
    type: 'line',
    data: {
      labels: cpuHistory.map(d => new Date(d.timestamp * 1000).toLocaleTimeString()),
      datasets: [{
        label: 'CPU %',
        data: cpuHistory.map(d => d.value),
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: {
          ticks: { 
            color: '#9ca3af',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });

  // Memory Chart
  const memCtx = document.getElementById('memoryChart').getContext('2d');
  memoryChart = new Chart(memCtx, {
    type: 'line',
    data: {
      labels: memoryHistory.map(d => new Date(d.timestamp * 1000).toLocaleTimeString()),
      datasets: [{
        label: 'Memory %',
        data: memoryHistory.map(d => d.value),
        borderColor: 'rgba(236, 72, 153, 1)',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: {
          ticks: { 
            color: '#9ca3af',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes.toFixed(2) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function cleanupDetail() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (cpuChart) {
    cpuChart.destroy();
    cpuChart = null;
  }
  if (memoryChart) {
    memoryChart.destroy();
    memoryChart = null;
  }
}
