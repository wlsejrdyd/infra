// assets/js/app.js
import { router } from '/assets/js/router.js';
import { renderOverview, cleanupOverview } from '/assets/js/pages/overview.js';
import { renderDetail, cleanupDetail } from '/assets/js/pages/detail.js';
import { renderAdmin, cleanupAdmin } from '/assets/js/pages/admin.js';

let currentCleanup = null;

/**
 * 앱 초기화
 */
function initApp() {
  // 헤더 렌더링
  renderHeader();
  
  // 시간 업데이트
  updateTime();
  setInterval(updateTime, 1000);

  // 라우트 등록
  router.addRoute('/overview', async (params) => {
    cleanup();
    await renderOverview(params);
    currentCleanup = cleanupOverview;
  });

  router.addRoute('/server/:id', async (params) => {
    cleanup();
    await renderDetail(params);
    currentCleanup = cleanupDetail;
  });

  router.addRoute('/admin', async (params) => {
    cleanup();
    await renderAdmin(params);
    currentCleanup = cleanupAdmin;
  });
}

/**
 * 헤더 렌더링
 */
function renderHeader() {
  const header = document.getElementById('header');
  header.innerHTML = `
    <div class="logo" onclick="window.location.hash = '/overview'" style="cursor: pointer;">
      <div class="logo-icon">📊</div>
      <span class="logo-text">Infrastructure Dashboard</span>
    </div>
    <div class="header-right">
      <div class="external-links">
        <a href="/prometheus" target="_blank" class="ext-link prometheus">🔥 Prometheus</a>
        <a href="/grafana" target="_blank" class="ext-link grafana">📈 Grafana</a>
      </div>
      <div class="header-stats">
        <div class="header-stat" data-status="healthy"><span class="stat-dot ok"></span><span class="stat-count" style="color:var(--success);" id="headerOk">-</span><span class="stat-label">정상</span></div>
        <div class="header-stat" data-status="warning"><span class="stat-dot warn"></span><span class="stat-count" style="color:var(--warning);" id="headerWarn">-</span><span class="stat-label">경고</span></div>
        <div class="header-stat" data-status="critical"><span class="stat-dot crit"></span><span class="stat-count" style="color:var(--danger);" id="headerCrit">-</span><span class="stat-label">위험</span></div>
        <div class="header-stat" data-status="offline"><span class="stat-dot off"></span><span class="stat-count" style="color:var(--text-muted);" id="headerOff">-</span><span class="stat-label">오프라인</span></div>
      </div>
      <div class="current-time" id="currentTime"></div>
    </div>
  `;
}

/**
 * 시간 업데이트
 */
function updateTime() {
  const now = new Date();
  const timeEl = document.getElementById('currentTime');
  if (timeEl) {
    timeEl.textContent = now.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
}

/**
 * 정리 함수 실행
 */
function cleanup() {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
}

// 앱 시작
initApp();
