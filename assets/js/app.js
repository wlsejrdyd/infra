// assets/js/app.js
import { router } from '/assets/js/router.js';
import { renderOverview, cleanupOverview, setOverviewStatusFilter } from '/assets/js/pages/overview.js';
import { renderDetail, cleanupDetail } from '/assets/js/pages/detail.js';
import { renderAdmin, cleanupAdmin } from '/assets/js/pages/admin.js';

let currentCleanup = null;

/**
 * 앱 초기화
 */
function initApp() {
  renderTopbar();
  renderStatusbar();
  updateTime();
  setInterval(updateTime, 1000);

  // 라우트 등록
  router.addRoute('/overview', async (params) => {
    cleanup();
    setActiveTab('nodes');
    await renderOverview(params);
    currentCleanup = cleanupOverview;
  });

  router.addRoute('/server/:id', async (params) => {
    cleanup();
    setActiveTab('nodes');
    await renderDetail(params);
    currentCleanup = cleanupDetail;
  });

  router.addRoute('/admin', async (params) => {
    cleanup();
    setActiveTab('admin');
    await renderAdmin(params);
    currentCleanup = cleanupAdmin;
  });
}

/**
 * 탭 활성화
 */
function setActiveTab(tabId) {
  document.querySelectorAll('.topbar-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
}

/**
 * 상단바 렌더링
 */
function renderTopbar() {
  const topbar = document.getElementById('topbar');
  topbar.innerHTML = `
    <div class="topbar-brand" onclick="window.location.hash='/overview'">
      <h1>Simplatform Monitoring</h1>
    </div>

    <div class="topbar-tabs">
      <button class="topbar-tab active" data-tab="nodes" onclick="window.location.hash='/overview'">Nodes</button>
      <button class="topbar-tab" data-tab="clusters" onclick="window.location.hash='/overview'" title="Coming soon">Clusters</button>
      <button class="topbar-tab" data-tab="incidents" onclick="window.location.hash='/overview'" title="Coming soon">Incidents</button>
      <button class="topbar-tab" data-tab="logs" onclick="window.location.hash='/overview'" title="Coming soon">Logs</button>
    </div>

    <div class="topbar-badges">
      <div class="status-pill healthy" data-status="healthy">
        <span class="pill-dot"></span>
        <span>정상: <strong id="pillOk">-</strong></span>
      </div>
      <div class="status-pill warning" data-status="warning">
        <span class="pill-dot"></span>
        <span>경고: <strong id="pillWarn">-</strong></span>
      </div>
      <div class="status-pill danger" data-status="critical">
        <span class="pill-dot"></span>
        <span>위험: <strong id="pillCrit">-</strong></span>
      </div>
      <div class="status-pill offline" data-status="offline">
        <span class="pill-dot"></span>
        <span>오프라인: <strong id="pillOff">-</strong></span>
      </div>
    </div>

    <div class="topbar-search">
      <span class="search-icon">&#128269;</span>
      <input type="text" placeholder="Search infra..." id="topbarSearch">
    </div>

    <div class="topbar-actions">
      <a href="/grafana" target="_blank" class="ext-link grafana" title="Grafana">&#128200; Grafana</a>
      <a href="/prometheus" target="_blank" class="ext-link prometheus" title="Prometheus">&#128293; Prometheus</a>
      <button class="topbar-btn" title="Settings" onclick="window.location.hash='/admin'">&#9881;</button>
    </div>
  `;

  // 상태 pill 클릭 → 필터 토글
  topbar.querySelectorAll('.status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const status = pill.dataset.status;
      const onOverview = (window.location.hash || '#/overview').includes('/overview');
      if (onOverview) {
        setOverviewStatusFilter(status);
      } else {
        window._pendingStatusFilter = status;
        window.location.hash = '/overview';
      }
    });
  });

  // 검색
  const searchInput = document.getElementById('topbarSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (window.__overviewSearch) {
        window.__overviewSearch(searchInput.value);
      }
    });
  }
}

/**
 * 하단 상태바 렌더링
 */
function renderStatusbar() {
  const statusbar = document.getElementById('statusbar');
  statusbar.innerHTML = `
    <div class="statusbar-item">
      <span class="sb-icon">&#128339;</span>
      <span>LAST UPDATED: <span id="sbLastUpdated">-</span></span>
    </div>
    <div class="statusbar-item">
      <span class="sb-icon">&#128338;</span>
      <span id="sbCurrentTime"></span>
    </div>
    <div class="statusbar-right">
      <span class="status-led"></span>
      <span class="system-status" id="sbSystemStatus">SYSTEM STABLE - NO CRITICAL INCIDENTS</span>
    </div>
  `;
}

/**
 * 상단바 배지 업데이트 (overview에서 호출)
 */
export function updateTopbarBadges(counts) {
  const ok = document.getElementById('pillOk');
  const warn = document.getElementById('pillWarn');
  const crit = document.getElementById('pillCrit');
  const off = document.getElementById('pillOff');

  if (ok) ok.textContent = counts.healthy || 0;
  if (warn) warn.textContent = counts.warning || 0;
  if (crit) crit.textContent = counts.critical || 0;
  if (off) off.textContent = counts.offline || 0;

  // 시스템 상태
  const sbStatus = document.getElementById('sbSystemStatus');
  if (sbStatus) {
    if (counts.critical > 0) {
      sbStatus.textContent = `${counts.critical} CRITICAL INCIDENT${counts.critical > 1 ? 'S' : ''}`;
      sbStatus.style.color = 'var(--danger)';
    } else if (counts.warning > 0) {
      sbStatus.textContent = `${counts.warning} WARNING${counts.warning > 1 ? 'S' : ''}`;
      sbStatus.style.color = 'var(--warning)';
    } else {
      sbStatus.textContent = 'SYSTEM STABLE - NO CRITICAL INCIDENTS';
      sbStatus.style.color = 'var(--accent)';
    }
  }

  // notification 뱃지
  const notifBtn = document.getElementById('btnNotification');
  if (notifBtn) {
    if (counts.critical > 0 || counts.warning > 0) {
      notifBtn.classList.add('has-notification');
    } else {
      notifBtn.classList.remove('has-notification');
    }
  }
}

/**
 * 마지막 업데이트 시간
 */
export function updateLastUpdated() {
  const el = document.getElementById('sbLastUpdated');
  if (el) {
    el.textContent = new Date().toLocaleString('ko-KR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  }
}

/**
 * 시간 업데이트
 */
function updateTime() {
  const el = document.getElementById('sbCurrentTime');
  if (el) {
    el.textContent = new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }
}

/**
 * 정리
 */
function cleanup() {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
}

// 앱 시작
initApp();
