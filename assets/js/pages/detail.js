// assets/js/pages/detail.js
import {
  fetchServerMetrics,
  fetchCpuHistory,
  fetchMemoryHistory,
  fetchNetworkTraffic,
  fetchDiskIO,
  fetchLoadAverage,
  fetchAllDisks,
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
      <!-- Server Header (주요 지표 통합) -->
      <div class="card" style="margin-bottom: 1.5rem;">
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
            <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="cpuProgress" style="background: var(--color-blue);"></div></div>
            <span id="cpuValue" style="font-size: 0.9rem; font-weight: 600; min-width: 55px; text-align: right;">--%</span>
          </div>
          <!-- Memory -->
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 40px; font-weight: 600;">MEM</span>
            <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="memProgress" style="background: var(--color-pink);"></div></div>
            <span id="memValue" style="font-size: 0.9rem; font-weight: 600; min-width: 55px; text-align: right;">--%</span>
            <span id="memDetail" style="font-size: 0.75rem; color: var(--text-muted); min-width: 160px;"></span>
          </div>
          <!-- Disk -->
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 40px; font-weight: 600;">DISK</span>
            <div class="progress-bar" style="flex: 1; height: 8px;"><div class="progress-fill" id="diskProgress" style="background: var(--color-purple);"></div></div>
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

      <!-- Network & Disk I/O & All Disks — 3열 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 1rem; margin-bottom: 1.5rem;">
        <div class="card">
          <div class="card-header">
            <span class="card-title">NETWORK TRAFFIC</span>
            <span class="card-icon">📡</span>
          </div>
          <div style="padding: 1rem 0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
              <span style="color: var(--text-muted);">↓ Inbound</span>
              <span id="networkIn" style="font-size: 1.25rem; font-weight: 600;">-- MB/s</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">↑ Outbound</span>
              <span id="networkOut" style="font-size: 1.25rem; font-weight: 600;">-- MB/s</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">DISK I/O</span>
            <span class="card-icon">💿</span>
          </div>
          <div style="padding: 1rem 0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
              <span style="color: var(--text-muted);">📖 Read</span>
              <span id="diskRead" style="font-size: 1.25rem; font-weight: 600;">-- MB/s</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">✍️ Write</span>
              <span id="diskWrite" style="font-size: 1.25rem; font-weight: 600;">-- MB/s</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">DISK USAGE (ALL FILESYSTEMS)</span>
            <span class="card-icon" style="color: var(--color-purple);">💾</span>
          </div>
          <div id="allDisksContainer" style="padding: 1rem 0;">
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

  // CPU
  if (metrics.cpu !== null) {
    document.getElementById('cpuValue').textContent = `${metrics.cpu.toFixed(1)}%`;
    document.getElementById('cpuProgress').style.width = `${metrics.cpu}%`;
  }

  // Memory
  if (metrics.memory !== null) {
    document.getElementById('memValue').textContent = `${metrics.memory.toFixed(1)}%`;
    document.getElementById('memProgress').style.width = `${metrics.memory}%`;
    const memDetailEl = document.getElementById('memDetail');
    if (memDetailEl && metrics.memoryUsed && metrics.memoryTotal) {
      memDetailEl.textContent = `(${formatBytes(metrics.memoryUsed)} / ${formatBytes(metrics.memoryTotal)})`;
    }
  }

  // Disk
  if (metrics.disk !== null) {
    document.getElementById('diskValue').textContent = `${metrics.disk.toFixed(1)}%`;
    document.getElementById('diskProgress').style.width = `${metrics.disk}%`;
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
