// assets/js/app.js
import { router } from '/assets/js/router.js';
import { renderOverview, cleanupOverview, setOverviewStatusFilter } from '/assets/js/pages/overview.js';
import { renderDetail, cleanupDetail } from '/assets/js/pages/detail.js';
import { renderAdmin, cleanupAdmin } from '/assets/js/pages/admin.js';
import { renderLogs, cleanupLogs } from '/assets/js/pages/logs.js';
import { renderIncidents, cleanupIncidents } from '/assets/js/pages/incidents.js';

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
    // 모달이 열려있으면 모달만 닫기 (overview 재렌더 방지)
    const existingModal = document.getElementById('detailModal');
    if (existingModal) {
      cleanupDetail();
      return;
    }
    cleanup();
    setActiveTab('nodes');
    await renderOverview(params);
    currentCleanup = cleanupOverview;
  });

  router.addRoute('/server/:id', async (params) => {
    // overview를 파괴하지 않고 모달을 오버레이
    setActiveTab('nodes');
    await renderDetail(params);
  });

  router.addRoute('/admin', async (params) => {
    cleanup();
    setActiveTab('admin');
    await renderAdmin(params);
    currentCleanup = cleanupAdmin;
  });

  router.addRoute('/incidents', async (params) => {
    cleanup();
    setActiveTab('incidents');
    await renderIncidents(params);
    currentCleanup = cleanupIncidents;
  });

  router.addRoute('/logs', async (params) => {
    cleanup();
    setActiveTab('logs');
    await renderLogs(params);
    currentCleanup = cleanupLogs;
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
      <button class="topbar-tab" data-tab="incidents" onclick="window.location.hash='/incidents'">Incidents</button>
      <button class="topbar-tab" data-tab="logs" onclick="window.location.hash='/logs'">Logs</button>
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
      <button class="topbar-btn" id="btnNotification" title="Alerts">&#128276;</button>
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

  // 알림 버튼
  document.getElementById('btnNotification')?.addEventListener('click', toggleAlertDropdown);

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

/**
 * 알림 드롭다운 토글
 */
async function toggleAlertDropdown() {
  let dropdown = document.getElementById('alertDropdown');
  if (dropdown) { dropdown.remove(); return; }

  dropdown = document.createElement('div');
  dropdown.id = 'alertDropdown';
  dropdown.style.cssText = 'position:fixed;top:var(--topbar-height);right:60px;width:360px;max-height:420px;background:#1A1F2B;border:1px solid #2A3444;border-radius:3px;box-shadow:0 12px 40px rgba(0,0,0,0.5);z-index:600;overflow:hidden;animation:fadeIn 0.15s ease-out;';

  // Slack 설정 + 알림 이력 로드
  let alertConfig = { enabled: true };
  let alertState = {};
  try {
    [alertConfig, alertState] = await Promise.all([
      fetch('/api/alert/config').then(r => r.json()).catch(() => ({ enabled: true })),
      fetch('/api/alert/state').then(r => r.json()).catch(() => ({}))
    ]);
  } catch (e) { /* */ }

  const entries = Object.entries(alertState).sort((a, b) => {
    const tA = a[1].timestamp || '';
    const tB = b[1].timestamp || '';
    return tB.localeCompare(tA);
  });

  dropdown.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid #1E2736;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.8rem;font-weight:700;">Alerts</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.7rem;color:#6B7A90;">Slack</span>
        <button id="slackToggleBtn" style="padding:3px 10px;border-radius:3px;border:1px solid ${alertConfig.enabled ? '#10B981' : '#2A3444'};background:${alertConfig.enabled ? 'rgba(16,185,129,0.15)' : 'transparent'};color:${alertConfig.enabled ? '#10B981' : '#6B7A90'};font-size:0.7rem;font-weight:700;cursor:pointer;">${alertConfig.enabled ? 'ON' : 'OFF'}</button>
      </div>
    </div>
    <div style="max-height:340px;overflow-y:auto;padding:6px;">
      ${entries.length === 0 ? '<div style="padding:20px;text-align:center;color:#6B7A90;font-size:0.8rem;">알림 이력 없음</div>' :
        entries.map(([id, info]) => {
          const isSSL = id.startsWith('ssl:');
          const statusColor = info.status === 'critical' ? '#EF4444' : info.status === 'warning' ? '#F59E0B' : '#6B7A90';
          const time = info.timestamp ? new Date(info.timestamp).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '--';
          return `<div style="padding:8px 10px;border-bottom:1px solid rgba(30,39,54,0.5);display:flex;align-items:center;gap:10px;">
            <div style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${isSSL ? '🔒 ' : ''}${info.serverName || id}</div>
              <div style="font-size:0.65rem;color:#6B7A90;">${info.status || '--'} · ${time}</div>
            </div>
          </div>`;
        }).join('')
      }
    </div>
  `;

  document.body.appendChild(dropdown);

  // Slack 토글
  dropdown.querySelector('#slackToggleBtn')?.addEventListener('click', async () => {
    alertConfig.enabled = !alertConfig.enabled;
    try {
      await fetch('/api/alert/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: alertConfig.enabled })
      });
    } catch (e) { /* */ }
    const btn = dropdown.querySelector('#slackToggleBtn');
    btn.textContent = alertConfig.enabled ? 'ON' : 'OFF';
    btn.style.borderColor = alertConfig.enabled ? '#10B981' : '#2A3444';
    btn.style.background = alertConfig.enabled ? 'rgba(16,185,129,0.15)' : 'transparent';
    btn.style.color = alertConfig.enabled ? '#10B981' : '#6B7A90';
  });

  // 바깥 클릭 시 닫기
  setTimeout(() => {
    const closer = (e) => {
      if (!dropdown.contains(e.target) && e.target.id !== 'btnNotification') {
        dropdown.remove();
        document.removeEventListener('click', closer);
      }
    };
    document.addEventListener('click', closer);
  }, 10);
}

// 앱 시작
initApp();
