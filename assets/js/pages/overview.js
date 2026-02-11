// assets/js/pages/overview.js
import { fetchServersData, fetchServerMetrics } from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let serversData = { servers: [], defaultThresholds: {} };
let currentFilter = 'all';
let currentStatusFilter = 'all';
let updateInterval = null;
let previousStatusMap = {};  // 상태 변화 감지용

/**
 * Overview 페이지 렌더링
 */
export async function renderOverview() {
  const main = document.getElementById('app');
  
  // 서버 데이터 로드
  serversData = await fetchServersData();
  
  // 프로젝트 목록 추출
  const projects = ['all', ...new Set(serversData.servers.map(s => s.project))];
  
  main.innerHTML = `
    <div class="main">
      <!-- Header Section -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <div>
          <h1 style="font-size: 1.8rem; margin-bottom: 0.5rem;">서버 모니터링</h1>
          <p style="color: var(--text-muted); font-size: 0.9rem;">
            총 <span id="totalServers">${serversData.servers.length}</span>대 서버 운영 중
          </p>
        </div>
        <div style="display: flex; gap: 1rem; align-items: center;">
          <button class="btn" onclick="location.reload()">
            🔄 새로고침
          </button>
          <button class="btn btn-primary" onclick="window.location.hash = '/admin'">
            ⚙️ 서버 관리
          </button>
        </div>
      </div>

      <!-- Stats Cards (클릭하여 상태별 필터링) -->
      <div class="grid-4" id="statsCards">
        <div class="card stats-card" data-status="healthy" style="cursor: pointer; transition: outline 0.2s;">
          <div class="card-header">
            <span class="card-title">정상 서버</span>
            <div style="font-size: 1.5rem;">✅</div>
          </div>
          <div class="metric-value" style="color: var(--success);" id="healthyCount">-</div>
          <div class="metric-sub">정상 동작 중</div>
        </div>

        <div class="card stats-card" data-status="warning" style="cursor: pointer; transition: outline 0.2s;">
          <div class="card-header">
            <span class="card-title">경고 상태</span>
            <div style="font-size: 1.5rem;">⚠️</div>
          </div>
          <div class="metric-value" style="color: var(--warning);" id="warningCount">-</div>
          <div class="metric-sub">임계치 근접</div>
        </div>

        <div class="card stats-card" data-status="critical" style="cursor: pointer; transition: outline 0.2s;">
          <div class="card-header">
            <span class="card-title">위험 상태</span>
            <div style="font-size: 1.5rem;">🔴</div>
          </div>
          <div class="metric-value" style="color: var(--danger);" id="criticalCount">-</div>
          <div class="metric-sub">즉시 확인 필요</div>
        </div>

        <div class="card stats-card" data-status="offline" style="cursor: pointer; transition: outline 0.2s;">
          <div class="card-header">
            <span class="card-title">오프라인</span>
            <div style="font-size: 1.5rem;">💤</div>
          </div>
          <div class="metric-value" style="color: var(--text-muted);" id="offlineCount">-</div>
          <div class="metric-sub">연결 안됨</div>
        </div>
      </div>

      <!-- Project Filter -->
      <div class="project-filter" id="projectFilter">
        ${projects.map(proj => `
          <button class="project-filter-btn ${proj === 'all' ? 'active' : ''}" 
                  data-project="${proj}">
            ${proj === 'all' ? '🌐 전체' : `📁 ${proj}`}
          </button>
        `).join('')}
      </div>

      <!-- Server Grid -->
      <div class="server-grid" id="serverGrid">
        <div class="loading">서버 정보를 불러오는 중...</div>
      </div>
    </div>
  `;

  // 프로젝트 필터 버튼 이벤트
  document.querySelectorAll('.project-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.project-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.project;
      renderServerGrid();
    });
  });

  // 상태 카드 클릭 이벤트 (토글 방식: 다시 클릭하면 전체 보기)
  document.querySelectorAll('.stats-card').forEach(card => {
    card.addEventListener('click', () => {
      const status = card.dataset.status;
      if (currentStatusFilter === status) {
        currentStatusFilter = 'all';
      } else {
        currentStatusFilter = status;
      }
      // 활성 카드 하이라이트
      document.querySelectorAll('.stats-card').forEach(c => {
        c.style.outline = c.dataset.status === currentStatusFilter ? '2px solid var(--accent)' : 'none';
      });
      renderServerGrid();
    });
  });

  // 초기 렌더링 및 업데이트 시작
  await updateServerGrid();
  startAutoUpdate();
}

/**
 * 서버 그리드 업데이트
 */
async function updateServerGrid() {
  const stats = { healthy: 0, warning: 0, critical: 0, offline: 0 };
  
  // 각 서버의 메트릭 조회
  for (const server of serversData.servers) {
    const metrics = await fetchServerMetrics(server.instance);
    server._metrics = metrics;
    
    // 상태 판정
    const status = getServerStatus(metrics, serversData.defaultThresholds);
    server._status = status;
    
    // 통계 업데이트
    stats[status]++;
  }

  // 상태 변화 감지 → Slack 알림
  for (const server of serversData.servers) {
    const prevStatus = previousStatusMap[server.id];
    const currStatus = server._status;

    if (prevStatus && prevStatus !== currStatus) {
      // warning/critical 진입 시 알림, healthy 복구 시 댓글
      if (currStatus === 'warning' || currStatus === 'critical' || currStatus === 'healthy') {
        sendAlertToBackend(server.id, server.name, currStatus);
      }
    }
    previousStatusMap[server.id] = currStatus;
  }

  // 통계 카드 업데이트
  document.getElementById('healthyCount').textContent = stats.healthy;
  document.getElementById('warningCount').textContent = stats.warning;
  document.getElementById('criticalCount').textContent = stats.critical;
  document.getElementById('offlineCount').textContent = stats.offline;

  // 그리드 렌더링
  renderServerGrid();
}

/**
 * 서버 그리드 렌더링
 */
function renderServerGrid() {
  const grid = document.getElementById('serverGrid');
  
  // 프로젝트 필터 + 상태 필터 동시 적용
  let filteredServers = serversData.servers.filter(s => {
    const projectMatch = currentFilter === 'all' || s.project === currentFilter;
    const statusMatch = currentStatusFilter === 'all' || s._status === currentStatusFilter;
    return projectMatch && statusMatch;
  });

  // 상태별 자동 정렬: critical → warning → healthy → offline
  const statusOrder = { critical: 0, warning: 1, healthy: 2, offline: 3 };
  filteredServers.sort((a, b) => {
    const orderA = statusOrder[a._status] ?? 4;
    const orderB = statusOrder[b._status] ?? 4;
    return orderA - orderB;
  });

  if (filteredServers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <div class="empty-state-text">해당 프로젝트에 서버가 없습니다.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredServers.map(server => {
    const metrics = server._metrics || {};
    const status = server._status || 'offline';
    
    return `
      <div class="server-card ${status}" onclick="window.location.hash = '/server/${server.id}'">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.5rem;">
              <span style="font-size: 1.5rem;">${server.icon}</span>
              <span style="font-size: 0.7rem; padding: 2px 6px; background: var(--bg-secondary); border-radius: 4px; color: var(--text-muted);">
                ${server.project}
              </span>
            </div>
            <h3 style="font-size: 1.1rem; margin-bottom: 0.25rem;">${server.name}</h3>
            <p style="font-size: 0.75rem; color: var(--text-muted);">${server.instance}</p>
          </div>
          <div class="status-indicator ${status}"></div>
        </div>

        <!-- CPU -->
        <div class="mini-progress">
          <span class="metric-label" style="min-width: 50px;">CPU</span>
          <div class="mini-progress-bar">
            <div class="mini-progress-fill" style="width: ${metrics.cpu || 0}%; background: ${getProgressColor(metrics.cpu, 'cpu', serversData.defaultThresholds)};"></div>
          </div>
          <span class="mini-progress-label">${metrics.cpu ? metrics.cpu.toFixed(1) : '--'}%</span>
        </div>

        <!-- Memory -->
        <div class="mini-progress">
          <span class="metric-label" style="min-width: 50px;">MEM</span>
          <div class="mini-progress-bar">
            <div class="mini-progress-fill" style="width: ${metrics.memory || 0}%; background: ${getProgressColor(metrics.memory, 'memory', serversData.defaultThresholds)};"></div>
          </div>
          <span class="mini-progress-label">${metrics.memory ? metrics.memory.toFixed(1) : '--'}%</span>
        </div>

        <!-- Disk -->
        <div class="mini-progress">
          <span class="metric-label" style="min-width: 50px;">DISK</span>
          <div class="mini-progress-bar">
            <div class="mini-progress-fill" style="width: ${metrics.disk || 0}%; background: ${getProgressColor(metrics.disk, 'disk', serversData.defaultThresholds)};"></div>
          </div>
          <span class="mini-progress-label">${metrics.disk ? metrics.disk.toFixed(1) : '--'}%</span>
        </div>

        <!-- Uptime -->
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
          <span>⏱️ Uptime</span>
          <span>${metrics.uptime ? `${metrics.uptime.days}d ${metrics.uptime.hours}h` : '--'}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 서버 상태 판정
 */
function getServerStatus(metrics, thresholds) {
  if (metrics.status === 'offline') return 'offline';
  
  const { cpu, memory, disk } = metrics;
  
  // Critical 체크
  if (
    (cpu && cpu >= thresholds.cpu.critical) ||
    (memory && memory >= thresholds.memory.critical) ||
    (disk && disk >= thresholds.disk.critical)
  ) {
    return 'critical';
  }
  
  // Warning 체크
  if (
    (cpu && cpu >= thresholds.cpu.warning) ||
    (memory && memory >= thresholds.memory.warning) ||
    (disk && disk >= thresholds.disk.warning)
  ) {
    return 'warning';
  }
  
  return 'healthy';
}

/**
 * 프로그레스 바 색상
 */
function getProgressColor(value, type, thresholds) {
  if (!value) return 'var(--text-muted)';
  
  const threshold = thresholds[type];
  if (value >= threshold.critical) return 'var(--danger)';
  if (value >= threshold.warning) return 'var(--warning)';
  return 'var(--success)';
}

/**
 * 자동 업데이트 시작
 */
function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    updateServerGrid();
  }, 10000); // 10초마다 업데이트
}

/**
 * Slack 알림 전송 (백엔드 경유)
 */
async function sendAlertToBackend(serverId, serverName, status) {
  try {
    await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, serverName, status })
    });
  } catch (e) {
    console.error('Failed to send alert:', e);
  }
}

/**
 * 정리
 */
export function cleanupOverview() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}
