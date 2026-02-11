// assets/js/pages/detail.js
import { 
  fetchServerMetrics, 
  fetchCpuHistory, 
  fetchMemoryHistory,
  fetchNetworkTraffic,
  fetchDiskIO,
  fetchLoadAverage,
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
      <!-- Server Header -->
      <div class="card" style="margin-bottom: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
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
      </div>

      <!-- Metrics Cards -->
      <div class="grid-4" style="margin-bottom: 1.5rem;">
        <div class="card">
          <div class="card-header">
            <span class="card-title">CPU USAGE</span>
            <span class="card-icon" style="color: var(--color-blue);">💻</span>
          </div>
          <div class="metric-value" id="cpuValue">--%</div>
          <div class="progress-bar">
            <div class="progress-fill" id="cpuProgress" style="background: var(--color-blue);"></div>
          </div>
          <div class="metric-label" id="cpuLabel">node_cpu_seconds_total</div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">MEMORY USAGE</span>
            <span class="card-icon" style="color: var(--color-pink);">🧠</span>
          </div>
          <div class="metric-value" id="memValue">--%</div>
          <div class="progress-bar">
            <div class="progress-fill" id="memProgress" style="background: var(--color-pink);"></div>
          </div>
          <div class="metric-label" id="memLabel">node_memory_Active_bytes</div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">DISK USAGE</span>
            <span class="card-icon" style="color: var(--color-purple);">💾</span>
          </div>
          <div class="metric-value" id="diskValue">--%</div>
          <div class="progress-bar">
            <div class="progress-fill" id="diskProgress" style="background: var(--color-purple);"></div>
          </div>
          <div class="metric-label" id="diskLabel">node_filesystem_avail_bytes</div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">UPTIME</span>
            <span class="card-icon">⏱️</span>
          </div>
          <div class="metric-value" id="uptimeValue">--</div>
          <div class="metric-label" id="uptimeLabel">node_boot_time_seconds</div>
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

      <!-- Network & Disk I/O -->
      <div class="grid-2" style="margin-bottom: 1.5rem;">
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
      </div>

      <!-- Load Average -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">LOAD AVERAGE</span>
          <span class="card-icon">⚖️</span>
        </div>
        <div style="display: flex; justify-content: space-around; padding: 1rem 0;">
          <div style="text-align: center;">
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">1분</div>
            <div id="load1" style="font-size: 1.5rem; font-weight: 600;">--</div>
          </div>
          <div style="text-align: center;">
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">5분</div>
            <div id="load5" style="font-size: 1.5rem; font-weight: 600;">--</div>
          </div>
          <div style="text-align: center;">
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">15분</div>
            <div id="load15" style="font-size: 1.5rem; font-weight: 600;">--</div>
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
  }

  // Disk
  if (metrics.disk !== null) {
    document.getElementById('diskValue').textContent = `${metrics.disk.toFixed(1)}%`;
    document.getElementById('diskProgress').style.width = `${metrics.disk}%`;
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
