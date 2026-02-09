// assets/js/pages/detail.js
import { fetchServersData, fetchServerMetrics, fetchCpuHistory, fetchServiceStatus, fetchKubernetesData } from '../api.js';
import { CONFIG } from '../config.js';
import { router } from '../router.js';

let currentServer = null;
let updateInterval = null;
let cpuChart = null;

/**
 * Detail 페이지 렌더링
 */
export async function renderDetail(params) {
  const serverId = params.id;
  const serversData = await fetchServersData();
  currentServer = serversData.servers.find(s => s.id === serverId);

  if (!currentServer) {
    document.getElementById('app').innerHTML = `
      <div class="main">
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <div class="empty-state-text">서버를 찾을 수 없습니다.</div>
          <button class="btn btn-primary" onclick="window.location.hash = '/overview'" style="margin-top: 1rem;">
            돌아가기
          </button>
        </div>
      </div>
    `;
    return;
  }

  const main = document.getElementById('app');
  main.innerHTML = `
    <div class="main">
      <!-- Back Button & Server Header -->
      <div style="margin-bottom: 1rem;">
        <button class="btn" onclick="window.location.hash = '/overview'">
          ← 목록으로
        </button>
      </div>

      <div class="server-header">
        <div class="server-info">
          <div class="server-icon-large">${currentServer.icon}</div>
          <div class="server-details">
            <h1>${currentServer.name}</h1>
            <div class="server-meta">
              <span class="badge info">${currentServer.project}</span>
              <span style="margin: 0 8px;">•</span>
              <span>${currentServer.instance}</span>
            </div>
          </div>
        </div>
        <div class="status-indicator" id="serverStatus" style="width: 16px; height: 16px;"></div>
      </div>

      <!-- Metrics Row -->
      <div class="grid-4">
        <div class="card">
          <div class="card-header">
            <span class="card-title">CPU Usage</span>
            <div style="font-size: 1.2rem;">💻</div>
          </div>
          <div class="metric-value" id="cpuValue">--</div>
          <div class="metric-sub">node_cpu_seconds_total</div>
          <div class="progress-bar">
            <div class="progress-fill" id="cpuBar" style="width: 0%; background: linear-gradient(90deg, var(--accent), #8b5cf6);"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Memory Usage</span>
            <div style="font-size: 1.2rem;">🧠</div>
          </div>
          <div class="metric-value" id="memValue">--</div>
          <div class="metric-sub">node_memory_Active_bytes</div>
          <div class="progress-bar">
            <div class="progress-fill" id="memBar" style="width: 0%; background: linear-gradient(90deg, var(--success), #34d399);"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Disk Usage</span>
            <div style="font-size: 1.2rem;">💾</div>
          </div>
          <div class="metric-value" id="diskValue">--</div>
          <div class="metric-sub">node_filesystem_avail_bytes</div>
          <div class="progress-bar">
            <div class="progress-fill" id="diskBar" style="width: 0%; background: linear-gradient(90deg, var(--warning), #fbbf24);"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Uptime</span>
            <div style="font-size: 1.2rem;">⏱️</div>
          </div>
          <div class="metric-value" id="uptimeValue">--</div>
          <div class="metric-sub">node_boot_time_seconds</div>
        </div>
      </div>

      <!-- Service Status & CPU Chart -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Service Status</span>
          </div>
          <div id="serviceGrid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
            <div class="loading">로딩 중...</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">CPU Usage (1h)</span>
          </div>
          <div class="chart-container">
            <canvas id="cpuChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Kubernetes Section -->
      <div class="section-title k8s">
        <span>☸️ Kubernetes Cluster</span>
      </div>
      <div class="grid-2" id="k8sSection">
        <div class="loading">Kubernetes 데이터 로딩 중...</div>
      </div>
    </div>
  `;

  // 초기 데이터 로드
  await updateMetrics();
  await updateServices();
  await updateK8s();
  initCpuChart();
  
  // 자동 업데이트 시작
  startAutoUpdate();
}

/**
 * 메트릭 업데이트
 */
async function updateMetrics() {
  const metrics = await fetchServerMetrics(currentServer.instance);
  
  // 상태 표시
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) {
    statusEl.className = `status-indicator ${metrics.status === 'online' ? 'healthy' : 'offline'}`;
  }

  // CPU
  if (metrics.cpu !== null) {
    document.getElementById('cpuValue').textContent = metrics.cpu.toFixed(1) + '%';
    document.getElementById('cpuBar').style.width = metrics.cpu + '%';
  }

  // Memory
  if (metrics.memory !== null) {
    document.getElementById('memValue').textContent = metrics.memory.toFixed(1) + '%';
    document.getElementById('memBar').style.width = metrics.memory + '%';
  }

  // Disk
  if (metrics.disk !== null) {
    document.getElementById('diskValue').textContent = metrics.disk.toFixed(1) + '%';
    document.getElementById('diskBar').style.width = metrics.disk + '%';
  }

  // Uptime
  if (metrics.uptime) {
    document.getElementById('uptimeValue').textContent = 
      `${metrics.uptime.days}d ${metrics.uptime.hours}h`;
  }
}

/**
 * 서비스 상태 업데이트
 */
async function updateServices() {
  const statusMap = await fetchServiceStatus();
  const serviceGrid = document.getElementById('serviceGrid');

  serviceGrid.innerHTML = CONFIG.services.map(svc => {
    let status = 'unknown';
    if (svc.job && statusMap[svc.job] !== undefined) {
      status = statusMap[svc.job] ? 'up' : 'down';
    }

    return `
      <div style="display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--bg-secondary); border-radius: 10px;">
        <div style="width: 36px; height: 36px; border-radius: 8px; background: ${svc.color}22; color: ${svc.color}; display: flex; align-items: center; justify-content: center; font-size: 1rem;">
          ${svc.icon}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.9rem;">${svc.name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">:${svc.port}</div>
        </div>
        <div class="service-status ${status}" style="width: 10px; height: 10px; border-radius: 50%;"></div>
      </div>
    `;
  }).join('');
}

/**
 * Kubernetes 데이터 업데이트
 */
async function updateK8s() {
  const k8sData = await fetchKubernetesData();
  const k8sSection = document.getElementById('k8sSection');

  k8sSection.innerHTML = `
    <div class="card k8s">
      <div class="card-header">
        <span class="card-title k8s">Pods Status</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
        ${k8sData.pods.length > 0 ? k8sData.pods.map(pod => {
          const statusClass = pod.phase === 'Running' ? 'success' : (pod.phase === 'Pending' ? 'pending' : 'failure');
          return `
            <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid var(${statusClass === 'success' ? '--success' : statusClass === 'pending' ? '--warning' : '--danger'});">
              <div>${pod.name}</div>
              <div style="margin-left: auto; font-size: 0.75rem; color: var(--text-muted);">${pod.phase}</div>
            </div>
          `;
        }).join('') : '<div class="loading">No pods found</div>'}
      </div>
    </div>

    <div class="card k8s">
      <div class="card-header">
        <span class="card-title k8s">Cluster Overview</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
        <div style="text-align: center; padding: 12px 8px; background: var(--bg-secondary); border-radius: 10px;">
          <div style="font-size: 1.4rem; font-weight: 700; color: var(--success);">${k8sData.stats.Running}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">RUNNING</div>
        </div>
        <div style="text-align: center; padding: 12px 8px; background: var(--bg-secondary); border-radius: 10px;">
          <div style="font-size: 1.4rem; font-weight: 700; color: var(--warning);">${k8sData.stats.Pending}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">PENDING</div>
        </div>
        <div style="text-align: center; padding: 12px 8px; background: var(--bg-secondary); border-radius: 10px;">
          <div style="font-size: 1.4rem; font-weight: 700; color: var(--danger);">${k8sData.stats.Failed + k8sData.stats.Unknown}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">FAILED</div>
        </div>
        <div style="text-align: center; padding: 12px 8px; background: var(--bg-secondary); border-radius: 10px;">
          <div style="font-size: 1.4rem; font-weight: 700; color: var(--kubernetes);">${k8sData.pods.length}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">TOTAL</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * CPU 차트 초기화
 */
async function initCpuChart() {
  const ctx = document.getElementById('cpuChart').getContext('2d');
  const history = await fetchCpuHistory(currentServer.instance);

  const labels = history.map((_, i) => `-${(history.length - 1 - i) * 5}m`);
  const data = history.map(h => h.value);

  cpuChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'CPU %',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        y: { min: 0, max: 100, grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } }
      }
    }
  });
}

/**
 * 자동 업데이트 시작
 */
function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async () => {
    await updateMetrics();
    await updateServices();
    await updateK8s();
  }, 10000);
}

/**
 * 정리
 */
export function cleanupDetail() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  if (cpuChart) {
    cpuChart.destroy();
    cpuChart = null;
  }
}
