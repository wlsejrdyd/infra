// assets/js/pages/detail.js — 모달 오버레이 방식
import {
  fetchServerMetricsUnified,
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

let refreshInterval;
let cpuChart;
let memoryChart;
let modalEl = null;
let _serversData = null;

export async function renderDetail(params) {
  const serverId = params.id;
  _serversData = await fetchServersData();
  const server = _serversData.servers.find(s => s.id === serverId);

  if (!server) {
    window.location.hash = '/overview';
    return;
  }

  // 기존 모달 제거
  cleanupDetail();

  // 모달 오버레이 생성
  modalEl = document.createElement('div');
  modalEl.id = 'detailModal';
  modalEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:500;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';

  // 모달 콘텐츠
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1A1F2B;border:1px solid #2A3444;border-radius:3px;width:92%;max-width:1200px;max-height:88vh;overflow-y:auto;padding:1.5rem;position:relative;animation:fadeIn 0.2s ease-out;box-shadow:0 20px 60px rgba(0,0,0,0.5);';

  modal.innerHTML = `
    <!-- 헤더 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid #1E2736;">
      <div style="display:flex;align-items:center;gap:1rem;">
        <div style="font-size:2rem;">${server.icon || '🖥️'}</div>
        <div>
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <h1 style="font-size:1.3rem;font-weight:700;font-family:'Space Grotesk',sans-serif;margin:0;">${server.name}</h1>
            <span style="font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:3px;background:rgba(16,185,129,0.15);color:#10B981;text-transform:uppercase;">${server.project}</span>
            <div class="status-indicator" id="serverStatus" style="width:8px;height:8px;"></div>
          </div>
          <div style="font-size:0.8rem;color:#6B7A90;margin-top:2px;">${server.instance} · ${server.mode === 'push' ? 'Push' : 'Pull'} Mode</div>
        </div>
      </div>
      <button onclick="window.location.hash='/overview'" style="background:none;border:1px solid #2A3444;color:#6B7A90;font-size:1.2rem;cursor:pointer;padding:4px 10px;border-radius:3px;transition:all 0.15s;" onmouseover="this.style.borderColor='#10B981';this.style.color='#E8ECF1'" onmouseout="this.style.borderColor='#2A3444';this.style.color='#6B7A90'">✕</button>
    </div>

    <!-- 상단: 리소스 + Network/DiskIO -->
    <div style="display:grid;grid-template-columns:7fr 3fr;gap:1rem;margin-bottom:1.25rem;">
      <div>
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:0.75rem;color:#A9ABB3;min-width:40px;font-weight:600;">CPU</span>
            <div class="progress-bar" style="flex:1;height:6px;background:#1C2028;"><div class="progress-fill" id="cpuProgress" style="background:#10B981;border-radius:2px;"></div></div>
            <span id="cpuValue" style="font-size:0.85rem;font-weight:700;font-family:'Space Grotesk',monospace;min-width:55px;text-align:right;">--%</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:0.75rem;color:#A9ABB3;min-width:40px;font-weight:600;">MEM</span>
            <div class="progress-bar" style="flex:1;height:6px;background:#1C2028;"><div class="progress-fill" id="memProgress" style="background:#10B981;border-radius:2px;"></div></div>
            <span id="memValue" style="font-size:0.85rem;font-weight:700;font-family:'Space Grotesk',monospace;min-width:55px;text-align:right;">--%</span>
            <span id="memDetail" style="font-size:0.7rem;color:#6B7A90;min-width:140px;"></span>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:0.75rem;color:#A9ABB3;min-width:40px;font-weight:600;">DISK</span>
            <div class="progress-bar" style="flex:1;height:6px;background:#1C2028;"><div class="progress-fill" id="diskProgress" style="background:#10B981;border-radius:2px;"></div></div>
            <span id="diskValue" style="font-size:0.85rem;font-weight:700;font-family:'Space Grotesk',monospace;min-width:55px;text-align:right;">--%</span>
            <span id="diskDetail" style="font-size:0.7rem;color:#6B7A90;min-width:140px;"></span>
          </div>
        </div>
        <div style="display:flex;gap:1.5rem;margin-top:0.8rem;padding-top:0.8rem;border-top:1px solid #1E2736;font-size:0.8rem;">
          <div><span style="color:#6B7A90;">Uptime </span><span id="uptimeValue" style="font-weight:600;">--</span></div>
          <div><span style="color:#6B7A90;">Load </span><span id="load1" style="font-weight:600;">--</span><span style="color:#6B7A90;"> / </span><span id="load5" style="font-weight:600;">--</span><span style="color:#6B7A90;"> / </span><span id="load15" style="font-weight:600;">--</span><span style="color:#6B7A90;font-size:0.7rem;"> (1/5/15m)</span></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 0.8rem;">
          <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;margin-bottom:0.4rem;text-transform:uppercase;">Network Traffic</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;"><span style="color:#6B7A90;font-size:0.75rem;">↓ In</span><span id="networkIn" style="font-size:0.85rem;font-weight:600;">-- B/s</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:#6B7A90;font-size:0.75rem;">↑ Out</span><span id="networkOut" style="font-size:0.85rem;font-weight:600;">-- B/s</span></div>
        </div>
        <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 0.8rem;">
          <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;margin-bottom:0.4rem;text-transform:uppercase;">Disk I/O</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;"><span style="color:#6B7A90;font-size:0.75rem;">Read</span><span id="diskRead" style="font-size:0.85rem;font-weight:600;">-- B/s</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:#6B7A90;font-size:0.75rem;">Write</span><span id="diskWrite" style="font-size:0.85rem;font-weight:600;">-- B/s</span></div>
        </div>
      </div>
    </div>

    <!-- 차트 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
      <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
        <div style="font-size:0.7rem;font-weight:600;color:#6B7A90;margin-bottom:0.5rem;text-transform:uppercase;">CPU Usage (1H)</div>
        <div style="position:relative;height:200px;"><canvas id="cpuChart"></canvas></div>
      </div>
      <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
        <div style="font-size:0.7rem;font-weight:600;color:#6B7A90;margin-bottom:0.5rem;text-transform:uppercase;">Memory Usage (1H)</div>
        <div style="position:relative;height:200px;"><canvas id="memoryChart"></canvas></div>
      </div>
    </div>

    <!-- 프로세스/K8s + 디스크 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
      <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-size:0.7rem;font-weight:600;color:#6B7A90;text-transform:uppercase;" id="infoCardTitle">TOP PROCESSES (CPU)</span>
          <span id="infoCardIcon" style="font-size:0.9rem;">📊</span>
        </div>
        <div id="topProcessContainer" style="max-height:200px;overflow-y:auto;">
          <div style="color:#6B7A90;font-size:0.8rem;">로딩 중...</div>
        </div>
      </div>
      <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-size:0.7rem;font-weight:600;color:#6B7A90;text-transform:uppercase;">Disk Usage (All Filesystems)</span>
          <span style="font-size:0.9rem;">💾</span>
        </div>
        <div id="allDisksContainer" style="max-height:200px;overflow-y:auto;">
          <div style="color:#6B7A90;font-size:0.8rem;">로딩 중...</div>
        </div>
      </div>
    </div>

    <!-- Storage (MinIO/Longhorn) -->
    <div id="storageSection" style="display:none;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div id="minioCard" style="display:none;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
          <div style="font-size:0.7rem;font-weight:600;color:#6B7A90;margin-bottom:0.5rem;text-transform:uppercase;">MinIO Storage</div>
          <div id="minioContent"></div>
        </div>
        <div id="longhornCard" style="display:none;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.8rem;">
          <div style="font-size:0.7rem;font-weight:600;color:#6B7A90;margin-bottom:0.5rem;text-transform:uppercase;">Longhorn Storage</div>
          <div id="longhornContent"></div>
        </div>
      </div>
    </div>
  `;

  modalEl.appendChild(modal);

  // 배경 클릭 시 닫기
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) window.location.hash = '/overview';
  });

  // ESC 키 닫기
  modalEl._escHandler = (e) => {
    if (e.key === 'Escape') window.location.hash = '/overview';
  };
  document.addEventListener('keydown', modalEl._escHandler);

  document.body.appendChild(modalEl);

  // 데이터 로드
  await updateServerData(server);
  refreshInterval = setInterval(() => updateServerData(server), 10000);
}

async function updateServerData(server) {
  const isPush = server.mode === 'push';
  const metrics = await fetchServerMetricsUnified(server);
  const networkTraffic = isPush ? (metrics.network || { inbound: null, outbound: null }) : await fetchNetworkTraffic(server.instance);
  const diskIO = isPush ? (metrics.diskIO || { read: null, write: null }) : await fetchDiskIO(server.instance);
  const loadAvg = isPush ? (metrics.loadAverage || { load1: null, load5: null, load15: null }) : await fetchLoadAverage(server.instance);

  const statusEl = document.getElementById('serverStatus');
  if (statusEl) statusEl.className = `status-indicator ${metrics.status}`;

  const barColor = (val, type) => {
    if (!val) return '#10B981';
    const th = { cpu: { warning: 80, critical: 90 }, memory: { warning: 80, critical: 90 }, disk: { warning: 80, critical: 90 } };
    if (val >= th[type].critical) return '#EF4444';
    if (val >= th[type].warning) return '#F59E0B';
    return '#10B981';
  };

  if (typeof metrics.cpu === 'number') {
    const el = document.getElementById('cpuProgress');
    const v = document.getElementById('cpuValue');
    if (el) { el.style.width = `${metrics.cpu}%`; el.style.background = barColor(metrics.cpu, 'cpu'); }
    if (v) v.textContent = `${metrics.cpu.toFixed(1)}%`;
  }
  if (typeof metrics.memory === 'number') {
    const el = document.getElementById('memProgress');
    const v = document.getElementById('memValue');
    if (el) { el.style.width = `${metrics.memory}%`; el.style.background = barColor(metrics.memory, 'memory'); }
    if (v) v.textContent = `${metrics.memory.toFixed(1)}%`;
    const d = document.getElementById('memDetail');
    if (d && metrics.memoryUsed && metrics.memoryTotal) d.textContent = `(${formatBytes(metrics.memoryUsed)} / ${formatBytes(metrics.memoryTotal)})`;
  }
  if (typeof metrics.disk === 'number') {
    const el = document.getElementById('diskProgress');
    const v = document.getElementById('diskValue');
    if (el) { el.style.width = `${metrics.disk}%`; el.style.background = barColor(metrics.disk, 'disk'); }
    if (v) v.textContent = `${metrics.disk.toFixed(1)}%`;
    const d = document.getElementById('diskDetail');
    if (d && metrics.diskUsed && metrics.diskTotal) d.textContent = `(${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)})`;
  }
  if (metrics.uptime) document.getElementById('uptimeValue').textContent = `${metrics.uptime.days}d ${metrics.uptime.hours}h`;
  if (networkTraffic.inbound !== null) document.getElementById('networkIn').textContent = formatBytes(networkTraffic.inbound) + '/s';
  if (networkTraffic.outbound !== null) document.getElementById('networkOut').textContent = formatBytes(networkTraffic.outbound) + '/s';
  if (diskIO.read !== null) document.getElementById('diskRead').textContent = formatBytes(diskIO.read) + '/s';
  if (diskIO.write !== null) document.getElementById('diskWrite').textContent = formatBytes(diskIO.write) + '/s';
  if (loadAvg.load1 !== null) document.getElementById('load1').textContent = loadAvg.load1.toFixed(2);
  if (loadAvg.load5 !== null) document.getElementById('load5').textContent = loadAvg.load5.toFixed(2);
  if (loadAvg.load15 !== null) document.getElementById('load15').textContent = loadAvg.load15.toFixed(2);

  // Storage
  if (!isPush) {
    const minio = await fetchMinioCapacity();
    const longhorn = await fetchLonghornCapacity();
    let showStorage = false;

    if (minio.total !== null) {
      showStorage = true;
      const mc = document.getElementById('minioCard');
      const cont = document.getElementById('minioContent');
      if (mc && cont) {
        mc.style.display = '';
        const pct = minio.usagePercent.toFixed(1);
        const color = minio.usagePercent >= 90 ? '#EF4444' : minio.usagePercent >= 80 ? '#F59E0B' : '#10B981';
        let html = `<div style="margin-bottom:0.75rem;"><div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;font-size:0.8rem;"><span>Cluster</span><span style="font-weight:600;color:${color};">${pct}% (${formatBytes(minio.used)} / ${formatBytes(minio.total)})</span></div><div style="height:5px;background:#1C2028;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${color};border-radius:2px;"></div></div></div>`;
        if (minio.buckets.length > 0) {
          html += `<div style="font-size:0.7rem;color:#6B7A90;margin-bottom:0.3rem;">Buckets</div>`;
          minio.buckets.forEach(b => { html += `<div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.15rem 0;"><span>${b.name}</span><span style="color:#6B7A90;">${formatBytes(b.size)}</span></div>`; });
        }
        cont.innerHTML = html;
      }
    }
    if (longhorn.nodes.length > 0) {
      showStorage = true;
      const lc = document.getElementById('longhornCard');
      const cont = document.getElementById('longhornContent');
      if (lc && cont) {
        lc.style.display = '';
        let html = '';
        longhorn.nodes.forEach(node => {
          const pct = node.usagePercent.toFixed(1);
          const color = node.usagePercent >= 90 ? '#EF4444' : node.usagePercent >= 80 ? '#F59E0B' : '#10B981';
          html += `<div style="margin-bottom:0.5rem;"><div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;font-size:0.8rem;"><span>${node.name}</span><span style="font-weight:600;color:${color};">${pct}% (${formatBytes(node.used)} / ${formatBytes(node.capacity)})</span></div><div style="height:5px;background:#1C2028;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${color};border-radius:2px;"></div></div></div>`;
        });
        if (longhorn.volumes.length > 0) {
          html += `<div style="font-size:0.7rem;color:#6B7A90;margin:0.5rem 0 0.3rem;">Volumes</div>`;
          longhorn.volumes.forEach(v => { html += `<div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.15rem 0;"><span>${v.name}</span><span style="color:#6B7A90;">${formatBytes(v.size)}</span></div>`; });
        }
        cont.innerHTML = html;
      }
    }
    const ss = document.getElementById('storageSection');
    if (ss && showStorage) ss.style.display = '';
  }

  // Disks
  const allDisks = isPush ? (metrics.filesystems || []) : await fetchAllDisks(server.instance);
  const dc = document.getElementById('allDisksContainer');
  if (dc && allDisks.length > 0) {
    dc.innerHTML = allDisks.sort((a, b) => a.mountpoint.localeCompare(b.mountpoint)).map(disk => {
      const pct = disk.usagePercent.toFixed(1);
      const color = disk.usagePercent >= 90 ? '#EF4444' : disk.usagePercent >= 80 ? '#F59E0B' : '#10B981';
      return `<div style="margin-bottom:0.5rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;"><span style="font-size:0.78rem;">${disk.mountpoint} <span style="color:#6B7A90;font-size:0.68rem;">(${disk.fstype})</span></span><span style="font-size:0.78rem;font-weight:600;color:${color};">${pct}% <span style="color:#6B7A90;font-weight:400;">(${formatBytes(disk.used)} / ${formatBytes(disk.total)})</span></span></div><div style="height:5px;background:#1C2028;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${color};border-radius:2px;"></div></div></div>`;
    }).join('');
  } else if (dc) {
    dc.innerHTML = '<div style="color:#6B7A90;font-size:0.8rem;">디스크 정보 없음</div>';
  }

  // Processes / K8s / SystemInfo
  const procContainer = document.getElementById('topProcessContainer');
  const titleEl = document.getElementById('infoCardTitle');
  const iconEl = document.getElementById('infoCardIcon');

  if (isPush) {
    const k8sData = metrics.k8s;
    if (k8sData && k8sData.pods && k8sData.pods.length > 0 && procContainer) {
      renderK8sPods(k8sData, procContainer, titleEl, iconEl, server.thresholds || _serversData.defaultThresholds);
    } else {
      const pushProcs = metrics.processes || [];
      if (procContainer && pushProcs.length > 0) {
        if (titleEl) titleEl.textContent = 'TOP PROCESSES (CPU)';
        if (iconEl) iconEl.textContent = '📊';
        renderProcessList(pushProcs, procContainer);
      } else if (procContainer) {
        if (titleEl) titleEl.textContent = 'PUSH MODE';
        if (iconEl) iconEl.textContent = '📡';
        procContainer.innerHTML = `<div style="color:#6B7A90;font-size:0.8rem;padding:0.5rem 0;">Push 에이전트 방식 · 마지막 수신: <strong>${metrics.lastUpdated ? new Date(metrics.lastUpdated).toLocaleString() : '--'}</strong></div>`;
      }
    }
  } else {
    const processes = await fetchTopProcesses(server.instance);
    if (procContainer && processes.length > 0) {
      if (titleEl) titleEl.textContent = 'TOP PROCESSES (CPU)';
      if (iconEl) iconEl.textContent = '📊';
      renderProcessList(processes, procContainer);
    } else if (procContainer) {
      const k8sRes = await fetchKubernetesPodResources(server.instance);
      if (k8sRes.pods.length > 0) {
        renderK8sPods(k8sRes, procContainer, titleEl, iconEl, server.thresholds || _serversData.defaultThresholds);
      } else {
        if (titleEl) titleEl.textContent = 'SYSTEM INFO';
        if (iconEl) iconEl.textContent = '🖥️';
        const sysInfo = await fetchSystemInfo(server.instance);
        const row = (l, v) => `<div style="display:flex;justify-content:space-between;padding:0.25rem 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.78rem;"><span style="color:#6B7A90;">${l}</span><span style="font-weight:600;">${v ?? '--'}</span></div>`;
        procContainer.innerHTML = row('Hostname', sysInfo.hostname) + row('OS / Arch', `${sysInfo.os ?? '--'} ${sysInfo.machine ?? ''}`) + row('Kernel', sysInfo.kernel) + row('Running Procs', sysInfo.procsRunning != null ? Math.round(sysInfo.procsRunning) : '--') + row('Open FDs', sysInfo.fileDescriptors != null ? Math.round(sysInfo.fileDescriptors).toLocaleString() : '--');
      }
    }
  }

  // Charts
  if (isPush) {
    const history = metrics.history || [];
    if (!cpuChart && history.length > 1) createChartsFromHistory(history);
    else if (cpuChart) updateChartsFromHistory(history);
  } else if (!cpuChart) {
    await createCharts(server.instance);
  }
}

function renderProcessList(processes, container) {
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:0 0 0.3rem;border-bottom:1px solid #1E2736;margin-bottom:0.2rem;">
      <span style="font-size:0.65rem;color:#6B7A90;font-weight:600;flex:1;">PROCESS</span>
      <span style="font-size:0.65rem;color:#6B7A90;font-weight:600;min-width:55px;text-align:right;">CPU</span>
      <span style="font-size:0.65rem;color:#6B7A90;font-weight:600;min-width:65px;text-align:right;">MEM</span>
    </div>
  ` + processes.map((p, i) => {
    const cpuColor = p.cpu >= 50 ? '#EF4444' : p.cpu >= 20 ? '#F59E0B' : '#E8ECF1';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.2rem 0;${i < processes.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.03);' : ''}"><span style="font-size:0.75rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.name}">${p.name}</span><span style="font-size:0.75rem;font-weight:600;min-width:55px;text-align:right;color:${cpuColor};">${p.cpu.toFixed(1)}%</span><span style="font-size:0.75rem;min-width:65px;text-align:right;color:#6B7A90;">${formatBytes(p.memory)}</span></div>`;
  }).join('');
}

function renderK8sPods(k8sData, container, titleEl, iconEl, thresholds) {
  if (titleEl) titleEl.textContent = `KUBERNETES — ${k8sData.nodeName || 'NODE'}`;
  if (iconEl) iconEl.textContent = '☸️';
  const fmtCpu = (c) => c >= 1 ? `${c.toFixed(1)}c` : `${Math.round(c * 1000)}m`;
  const phaseColor = (p) => p === 'Running' ? '#10B981' : p === 'Pending' ? '#F59E0B' : '#EF4444';
  const alloc = k8sData.nodeAllocatable;
  const active = k8sData.pods.filter(p => p.phase === 'Running' || p.phase === 'Pending');
  const cpuReq = active.reduce((s, p) => s + p.cpuReq, 0);
  const memReq = active.reduce((s, p) => s + p.memReq, 0);

  const cpuReqTh = (thresholds || {}).cpuRequest || { warning: 80, critical: 90 };
  const memReqTh = (thresholds || {}).memoryRequest || { warning: 80, critical: 90 };
  const cpuPct = alloc && alloc.cpu > 0 ? cpuReq / alloc.cpu * 100 : 0;
  const memPct = alloc && alloc.memory > 0 ? memReq / alloc.memory * 100 : 0;
  const cpuPctColor = cpuPct >= cpuReqTh.critical ? '#EF4444' : cpuPct >= cpuReqTh.warning ? '#F59E0B' : '#10B981';
  const memPctColor = memPct >= memReqTh.critical ? '#EF4444' : memPct >= memReqTh.warning ? '#F59E0B' : '#10B981';

  let html = `<div style="display:flex;gap:0.75rem;padding:0 0 0.4rem;border-bottom:1px solid #1E2736;margin-bottom:0.3rem;flex-wrap:wrap;font-size:0.7rem;">
    <span><span style="color:#10B981;font-weight:700;">${k8sData.summary.running}</span> <span style="color:#6B7A90;">Running</span></span>
    <span><span style="color:#F59E0B;font-weight:700;">${k8sData.summary.pending}</span> <span style="color:#6B7A90;">Pending</span></span>
    <span><span style="color:#EF4444;font-weight:700;">${k8sData.summary.failed}</span> <span style="color:#6B7A90;">Failed</span></span>
    ${alloc ? `<span style="margin-left:auto;color:#6B7A90;">CPU ${fmtCpu(cpuReq)}/${fmtCpu(alloc.cpu)} <span style="color:${cpuPctColor};font-weight:700;">(${cpuPct.toFixed(1)}%)</span> · MEM ${formatBytes(memReq)}/${formatBytes(alloc.memory)} <span style="color:${memPctColor};font-weight:700;">(${memPct.toFixed(1)}%)</span></span>` : ''}
  </div>`;

  k8sData.pods.forEach((pod, i) => {
    const name = pod.name.length > 28 ? pod.name.substring(0, 26) + '…' : pod.name;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.2rem 0;${i < k8sData.pods.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.03);' : ''}font-size:0.72rem;">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${pod.namespace}/${pod.name}"><span style="color:#6B7A90;font-size:0.65rem;">${pod.namespace}/</span>${name}</span>
      <span style="min-width:45px;text-align:right;font-weight:600;">${pod.cpuReq > 0 ? fmtCpu(pod.cpuReq) : '-'}</span>
      <span style="min-width:55px;text-align:right;color:#6B7A90;">${pod.memReq > 0 ? formatBytes(pod.memReq) : '-'}</span>
      <span style="font-size:0.5rem;min-width:16px;text-align:center;color:${phaseColor(pod.phase)};">⬤</span>
    </div>`;
  });
  container.innerHTML = html;
}

const chartOpts = {
  responsive: true, maintainAspectRatio: false, animation: false,
  plugins: { legend: { display: false } },
  scales: {
    y: { beginAtZero: true, max: 100, ticks: { color: '#6B7A90', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    x: { ticks: { color: '#6B7A90', maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
  }
};

function createChartsFromHistory(history) {
  const labels = history.map(h => new Date(h.timestamp).toLocaleTimeString());
  cpuChart = new Chart(document.getElementById('cpuChart').getContext('2d'), {
    type: 'line', data: { labels, datasets: [{ data: history.map(h => h.cpu), borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, fill: true, pointRadius: 0 }] }, options: chartOpts
  });
  memoryChart = new Chart(document.getElementById('memoryChart').getContext('2d'), {
    type: 'line', data: { labels, datasets: [{ data: history.map(h => h.memory), borderColor: 'rgba(236,72,153,1)', backgroundColor: 'rgba(236,72,153,0.1)', tension: 0.4, fill: true, pointRadius: 0 }] }, options: chartOpts
  });
}

function updateChartsFromHistory(history) {
  if (!history || history.length === 0) return;
  const labels = history.map(h => new Date(h.timestamp).toLocaleTimeString());
  if (cpuChart) { cpuChart.data.labels = labels; cpuChart.data.datasets[0].data = history.map(h => h.cpu); cpuChart.update('none'); }
  if (memoryChart) { memoryChart.data.labels = labels; memoryChart.data.datasets[0].data = history.map(h => h.memory); memoryChart.update('none'); }
}

async function createCharts(instance) {
  const cpuHistory = await fetchCpuHistory(instance);
  const memHistory = await fetchMemoryHistory(instance);
  cpuChart = new Chart(document.getElementById('cpuChart').getContext('2d'), {
    type: 'line', data: { labels: cpuHistory.map(d => new Date(d.timestamp * 1000).toLocaleTimeString()), datasets: [{ data: cpuHistory.map(d => d.value), borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, fill: true, pointRadius: 0 }] }, options: chartOpts
  });
  memoryChart = new Chart(document.getElementById('memoryChart').getContext('2d'), {
    type: 'line', data: { labels: memHistory.map(d => new Date(d.timestamp * 1000).toLocaleTimeString()), datasets: [{ data: memHistory.map(d => d.value), borderColor: 'rgba(236,72,153,1)', backgroundColor: 'rgba(236,72,153,0.1)', tension: 0.4, fill: true, pointRadius: 0 }] }, options: chartOpts
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
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  if (cpuChart) { cpuChart.destroy(); cpuChart = null; }
  if (memoryChart) { memoryChart.destroy(); memoryChart = null; }
  if (modalEl) {
    if (modalEl._escHandler) document.removeEventListener('keydown', modalEl._escHandler);
    modalEl.remove();
    modalEl = null;
  }
}
