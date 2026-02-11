// assets/js/pages/overview.js
import { fetchServersData, fetchServerMetrics } from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let serversData = { servers: [], defaultThresholds: {} };
let currentFilter = 'all';
let currentStatusFilter = 'all';
let currentView = 'medium'; // large | medium
let updateInterval = null;
let previousStatusMap = {};  // 상태 변화 감지용

// 슬라이딩 관련 상태
let slideAnim = null;
let slidePos = 0;
let isPaused = false;

// 뷰 설정 (카드 크기)
const VIEW_CONFIG = {
  large:  { width: 280, height: 110, pad: '0.85rem', nameSize: '0.95rem', barH: '5px', labelW: '36px', lblSize: '0.7rem', valSize: '0.7rem', valW: '34px', nameMb: '0.4rem', metricGap: '3px', radius: '12px' },
  medium: { width: 200, height: 82,  pad: '0.55rem',  nameSize: '0.82rem', barH: '4px', labelW: '28px', lblSize: '0.62rem', valSize: '0.62rem', valW: '30px', nameMb: '0.25rem', metricGap: '2px', radius: '10px' },
};

const GAP = 6; // px

/**
 * Overview 페이지 렌더링
 */
export async function renderOverview() {
  // body를 full-height 레이아웃으로 전환
  document.body.style.height = '100vh';
  document.body.style.overflow = 'hidden';
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';

  const app = document.getElementById('app');
  app.style.flex = '1';
  app.style.display = 'flex';
  app.style.flexDirection = 'column';
  app.style.overflow = 'hidden';
  app.style.minHeight = '0';

  // 서버 데이터 로드
  serversData = await fetchServersData();

  // 프로젝트 목록 추출
  const projects = ['all', ...new Set(serversData.servers.map(s => s.project))];

  app.innerHTML = `
    <div class="overview-layout">
      <!-- Toolbar -->
      <div class="overview-toolbar">
        <div class="project-filter" id="projectFilter">
          ${projects.map(proj => `
            <button class="project-filter-btn ${proj === 'all' ? 'active' : ''}"
                    data-project="${proj}">
              ${proj === 'all' ? '전체' : proj}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div class="view-toggle">
            <button class="view-btn ${currentView === 'large' ? 'active' : ''}" data-view="large">3열</button>
            <button class="view-btn ${currentView === 'medium' ? 'active' : ''}" data-view="medium">5열</button>
          </div>
          <button class="project-filter-btn" onclick="location.reload()">🔄</button>
          <button class="project-filter-btn active" onclick="window.location.hash='/admin'">⚙️ 관리</button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="overview-content">
        <!-- Pinned: critical + warning (항상 고정) -->
        <div class="pinned-section" id="pinnedSection">
          <div class="section-label">🔴 주의 필요 — 고정 표시</div>
          <div class="pinned-grid" id="pinnedGrid"></div>
        </div>

        <!-- Scrolling: healthy + offline (자동 슬라이딩) -->
        <div class="scroll-section" id="scrollSection">
          <div class="section-label" id="scrollLabel">✅ 정상 / 💤 오프라인</div>
          <div class="scroll-container" id="scrollContainer">
            <div class="scroll-track" id="scrollTrack"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 프로젝트 필터 버튼 이벤트
  document.querySelectorAll('.project-filter-btn[data-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.project-filter-btn[data-project]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.project;
      renderServerGrid();
    });
  });

  // 뷰 모드 토글 이벤트
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      renderServerGrid();
    });
  });

  // 헤더 상태 카드 클릭 이벤트 (상태 필터 토글)
  document.querySelectorAll('.header-stat').forEach(stat => {
    stat.addEventListener('click', () => {
      const status = stat.dataset.status;
      if (currentStatusFilter === status) {
        currentStatusFilter = 'all';
      } else {
        currentStatusFilter = status;
      }
      document.querySelectorAll('.header-stat').forEach(s => {
        s.classList.toggle('active', s.dataset.status === currentStatusFilter);
      });
      renderServerGrid();
    });
  });

  // Hover pause for sliding
  const scrollContainer = document.getElementById('scrollContainer');
  if (scrollContainer) {
    scrollContainer.addEventListener('mouseenter', () => { isPaused = true; });
    scrollContainer.addEventListener('mouseleave', () => { isPaused = false; });
  }

  // 윈도우 리사이즈 대응
  window._overviewResizeHandler = () => {
    clearTimeout(window._overviewResizeTimer);
    window._overviewResizeTimer = setTimeout(renderServerGrid, 200);
  };
  window.addEventListener('resize', window._overviewResizeHandler);

  // 초기 렌더링 및 업데이트 시작
  await updateServerGrid();
  startAutoUpdate();
}

/**
 * 서버 그리드 업데이트 (메트릭 fetch + 상태 판정)
 */
async function updateServerGrid() {
  const stats = { healthy: 0, warning: 0, critical: 0, offline: 0 };

  for (const server of serversData.servers) {
    const metrics = await fetchServerMetrics(server.instance);
    server._metrics = metrics;
    const status = getServerStatus(metrics, serversData.defaultThresholds);
    server._status = status;
    stats[status]++;
  }

  // 상태 변화 감지 → Slack 알림
  for (const server of serversData.servers) {
    const prevStatus = previousStatusMap[server.id];
    const currStatus = server._status;
    if (prevStatus && prevStatus !== currStatus) {
      if (currStatus === 'warning' || currStatus === 'critical' || currStatus === 'healthy') {
        sendAlertToBackend(server.id, server.name, currStatus);
      }
    }
    previousStatusMap[server.id] = currStatus;
  }

  // 헤더 통계 업데이트
  const okEl = document.getElementById('headerOk');
  const warnEl = document.getElementById('headerWarn');
  const critEl = document.getElementById('headerCrit');
  const offEl = document.getElementById('headerOff');
  if (okEl) okEl.textContent = stats.healthy;
  if (warnEl) warnEl.textContent = stats.warning;
  if (critEl) critEl.textContent = stats.critical;
  if (offEl) offEl.textContent = stats.offline;

  renderServerGrid();
}

/**
 * 서버 그리드 렌더링 (pinned + scroll 분리, 멀티행 슬라이딩)
 */
function renderServerGrid() {
  // 프로젝트 필터 + 상태 필터 적용
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

  // Pinned(critical/warning) vs Scrolling(healthy/offline) 분리
  const pinned = filteredServers.filter(s => s._status === 'critical' || s._status === 'warning');
  const scrolling = filteredServers.filter(s => s._status === 'healthy' || s._status === 'offline');

  // Pinned 섹션 렌더링
  const pinnedSection = document.getElementById('pinnedSection');
  const pinnedGrid = document.getElementById('pinnedGrid');
  if (pinnedSection && pinnedGrid) {
    if (pinned.length > 0) {
      pinnedSection.style.display = '';
      pinnedGrid.innerHTML = pinned.map(s => renderCompactCard(s)).join('');
    } else {
      pinnedSection.style.display = 'none';
    }
  }

  // Scrolling 섹션 렌더링 (멀티행 + 자동 슬라이딩)
  const track = document.getElementById('scrollTrack');
  const container = document.getElementById('scrollContainer');
  if (!track || !container) return;

  stopSliding();
  track.innerHTML = '';
  track.style.height = '0';
  track.style.transform = 'translateX(0)';

  if (scrolling.length === 0) {
    const scrollLabel = document.getElementById('scrollLabel');
    if (scrollLabel) scrollLabel.textContent = '모든 서버가 주의 상태이거나 필터에 해당하는 서버가 없습니다.';
    return;
  }

  // Layout 확정 후 높이 계산
  requestAnimationFrame(() => {
    const availH = container.clientHeight;
    const v = VIEW_CONFIG[currentView];

    // 화면에 맞는 행 수 (짤리면 한 줄 제거)
    const rows = Math.max(1, Math.floor((availH + GAP) / (v.height + GAP)));
    const trackH = rows * (v.height + GAP) - GAP;
    track.style.height = trackH + 'px';

    // 레이블 업데이트
    const scrollLabel = document.getElementById('scrollLabel');
    if (scrollLabel) {
      scrollLabel.innerHTML = `✅ 정상 / 💤 오프라인 — ${rows}행 자동 슬라이딩 <span style="font-size:0.6rem;color:var(--text-muted);margin-left:8px;font-weight:400;">(hover 시 정지)</span>`;
    }

    // 카드 렌더링
    const cards = scrolling.map(s => renderCompactCard(s)).join('');
    track.innerHTML = cards;

    // 슬라이딩 필요 여부 확인
    requestAnimationFrame(() => {
      if (track.scrollWidth > container.clientWidth) {
        track.innerHTML = cards + cards;
        startSliding();
      }
    });
  });
}

/**
 * 컴팩트 카드 렌더링 (overview용)
 */
function renderCompactCard(server) {
  const v = VIEW_CONFIG[currentView];
  const metrics = server._metrics || {};
  const status = server._status || 'offline';
  const off = status === 'offline';
  const bc = status === 'critical' ? 'var(--danger)' : status === 'warning' ? 'var(--warning)' : 'var(--border)';

  const gc = (val, type) => {
    if (!val) return 'var(--text-muted)';
    const thresholds = serversData.defaultThresholds[type];
    if (val >= thresholds.critical) return 'var(--danger)';
    if (val >= thresholds.warning) return 'var(--warning)';
    return 'var(--success)';
  };

  const cpu = metrics.cpu;
  const mem = metrics.memory;
  const disk = metrics.disk;

  return `
    <div style="background:var(--bg-card);border:1px solid ${bc};border-radius:${v.radius};padding:${v.pad};cursor:pointer;width:${v.width}px;height:${v.height}px;flex-shrink:0;transition:border-color 0.2s;overflow:hidden;"
         onmouseover="this.style.borderColor='var(--accent)'"
         onmouseout="this.style.borderColor='${bc}'"
         onclick="window.location.hash='/server/${server.id}'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${v.nameMb};">
        <div style="display:flex;align-items:center;gap:5px;overflow:hidden;flex:1;">
          <div class="si ${status}"></div>
          <span style="font-size:${v.nameSize};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${server.name}</span>
        </div>
        <span style="font-size:0.55rem;color:var(--text-muted);flex-shrink:0;margin-left:4px;">${server.project}</span>
      </div>
      ${[
        { label: 'CPU',  val: cpu,  type: 'cpu' },
        { label: 'MEM',  val: mem,  type: 'memory' },
        { label: 'DISK', val: disk, type: 'disk' },
      ].map((m, i) => `
        <div style="display:flex;align-items:center;gap:4px;${i ? 'margin-top:'+v.metricGap+';' : ''}">
          <span style="font-size:${v.lblSize};color:var(--text-muted);min-width:${v.labelW};">${m.label}</span>
          <div class="pbar" style="flex:1;height:${v.barH};"><div class="pfill" style="width:${off ? 0 : (m.val || 0)}%;background:${gc(m.val, m.type)};"></div></div>
          <span style="font-size:${v.valSize};font-weight:600;min-width:${v.valW};text-align:right;color:${gc(m.val, m.type)};">${off || !m.val ? '--' : m.val.toFixed(1)}%</span>
        </div>
      `).join('')}
    </div>`;
}

/**
 * 자동 슬라이딩 시작
 */
function startSliding() {
  if (slideAnim) cancelAnimationFrame(slideAnim);
  slidePos = 0;

  const track = document.getElementById('scrollTrack');
  if (!track) return;

  const speed = 0.3; // px/frame (~18px/sec at 60fps)

  function step() {
    if (!isPaused) {
      slidePos += speed;
      const halfWidth = track.scrollWidth / 2;
      if (halfWidth > 0 && slidePos >= halfWidth) {
        slidePos = 0;
      }
      track.style.transform = `translateX(-${slidePos}px)`;
    }
    slideAnim = requestAnimationFrame(step);
  }

  slideAnim = requestAnimationFrame(step);
}

/**
 * 슬라이딩 중지
 */
function stopSliding() {
  if (slideAnim) {
    cancelAnimationFrame(slideAnim);
    slideAnim = null;
  }
}

/**
 * 서버 상태 판정
 */
function getServerStatus(metrics, thresholds) {
  if (metrics.status === 'offline') return 'offline';

  const { cpu, memory, disk } = metrics;

  if (
    (cpu && cpu >= thresholds.cpu.critical) ||
    (memory && memory >= thresholds.memory.critical) ||
    (disk && disk >= thresholds.disk.critical)
  ) {
    return 'critical';
  }

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
 * 자동 업데이트 시작
 */
function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    updateServerGrid();
  }, 10000);
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
  stopSliding();

  // body 스타일 복원
  document.body.style.height = '';
  document.body.style.overflow = '';
  document.body.style.display = '';
  document.body.style.flexDirection = '';

  const app = document.getElementById('app');
  if (app) {
    app.style.flex = '';
    app.style.display = '';
    app.style.flexDirection = '';
    app.style.overflow = '';
    app.style.minHeight = '';
  }

  // 리사이즈 핸들러 제거
  if (window._overviewResizeHandler) {
    window.removeEventListener('resize', window._overviewResizeHandler);
    window._overviewResizeHandler = null;
  }
}
