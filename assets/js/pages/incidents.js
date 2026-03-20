// assets/js/pages/incidents.js — 장애/알림 이력 관리

let refreshInterval = null;
let currentFilter = 'all'; // all, active, resolved
let alertState = {};
let alertHistory = [];

export async function renderIncidents() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-content" style="max-width:1400px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">
        <div>
          <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.4rem;font-weight:700;">System Incidents Log</h2>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <div style="display:flex;border:1px solid #2A3444;border-radius:3px;overflow:hidden;">
            <button class="incident-filter-btn active" data-filter="all">ALL</button>
            <button class="incident-filter-btn" data-filter="active">ACTIVE</button>
            <button class="incident-filter-btn" data-filter="resolved">RESOLVED</button>
          </div>
        </div>
      </div>

      <!-- 요약 카드 -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1.25rem;">
          <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Active Incidents</div>
          <div style="display:flex;align-items:flex-end;gap:12px;">
            <span id="activeCount" style="font-size:2.2rem;font-weight:700;font-family:'Space Grotesk',monospace;color:#EF4444;">--</span>
            <span style="font-size:0.8rem;color:#6B7A90;margin-bottom:4px;">Currently requiring attention</span>
          </div>
        </div>
        <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1.25rem;">
          <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Resolved Today</div>
          <div id="resolvedToday" style="font-size:2.2rem;font-weight:700;font-family:'Space Grotesk',monospace;color:#10B981;">--</div>
        </div>
        <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1.25rem;">
          <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">System Stability</div>
          <div id="stability" style="font-size:2.2rem;font-weight:700;font-family:'Space Grotesk',monospace;color:#10B981;">--</div>
        </div>
      </div>

      <!-- 테이블 헤더 -->
      <div style="display:flex;padding:8px 16px;font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1E2736;">
        <span style="width:60px;">STATUS</span>
        <span style="flex:1;">INCIDENT & NODE</span>
        <span style="width:160px;">TIMESTAMP</span>
        <span style="width:100px;text-align:right;">ACTIONS</span>
      </div>

      <!-- 인시던트 목록 -->
      <div id="incidentList" style="margin-top:4px;">
        <div style="padding:24px;text-align:center;color:#6B7A90;">로딩 중...</div>
      </div>
    </div>
  `;

  // 필터 버튼
  document.querySelectorAll('.incident-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.incident-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  // DISMISS 버튼 → 알림 해제
  window.__dismissAlert = async (serverId) => {
    try {
      await fetch(`/api/alert/state/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
      await loadIncidents();
    } catch (e) { console.error('dismiss failed:', e); }
  };

  // LOGS 버튼 → 해당 서버 이름으로 로그 검색
  window.__goToServerLogs = (serverName) => {
    window._pendingLogSearch = serverName;
    window.location.hash = '/logs';
  };

  await loadIncidents();
  refreshInterval = setInterval(loadIncidents, 15000);
}

async function loadIncidents() {
  try {
    alertState = await fetch('/api/alert/state').then(r => r.json());
  } catch (e) { alertState = {}; }

  // alert_state를 리스트로 변환
  alertHistory = Object.entries(alertState).map(([id, info]) => ({
    id,
    serverName: info.serverName || id,
    status: info.status || 'unknown',
    timestamp: info.timestamp || null,
    ts: info.ts || null,
    metrics: info.metrics || {},
    isSSL: id.startsWith('ssl:'),
    resolved: info.status === 'healthy' || info.status === 'recovered',
  }));

  // 시간순 정렬 (최신 먼저)
  alertHistory.sort((a, b) => {
    const tA = a.timestamp || '';
    const tB = b.timestamp || '';
    return tB.localeCompare(tA);
  });

  // 통계
  const active = alertHistory.filter(i => !i.resolved);
  const today = new Date().toISOString().substring(0, 10);
  const resolvedToday = alertHistory.filter(i => i.resolved && i.timestamp && i.timestamp.startsWith(today));
  const total = alertHistory.length;
  const stab = total > 0 ? ((total - active.length) / total * 100).toFixed(1) : '100.0';

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('activeCount', active.length);
  el('resolvedToday', resolvedToday.length);
  el('stability', `${stab}%`);

  const activeEl = document.getElementById('activeCount');
  if (activeEl) activeEl.style.color = active.length > 0 ? '#EF4444' : '#10B981';

  renderList();
}

function renderList() {
  const list = document.getElementById('incidentList');
  if (!list) return;

  let filtered = alertHistory;
  if (currentFilter === 'active') filtered = alertHistory.filter(i => !i.resolved);
  if (currentFilter === 'resolved') filtered = alertHistory.filter(i => i.resolved);

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:#6B7A90;font-size:0.85rem;">해당하는 인시던트가 없습니다.</div>';
    return;
  }

  list.innerHTML = filtered.map(inc => {
    const statusIcon = inc.status === 'critical'
      ? '<div style="width:32px;height:32px;border-radius:50%;background:rgba(239,68,68,0.15);border:2px solid #EF4444;display:flex;align-items:center;justify-content:center;font-size:0.8rem;">🔴</div>'
      : inc.status === 'warning'
      ? '<div style="width:32px;height:32px;border-radius:50%;background:rgba(245,158,11,0.15);border:2px solid #F59E0B;display:flex;align-items:center;justify-content:center;font-size:0.8rem;">⚠️</div>'
      : inc.resolved
      ? '<div style="width:32px;height:32px;border-radius:50%;background:rgba(16,185,129,0.15);border:2px solid #10B981;display:flex;align-items:center;justify-content:center;font-size:0.8rem;">✅</div>'
      : '<div style="width:32px;height:32px;border-radius:50%;background:rgba(107,122,144,0.15);border:2px solid #6B7A90;display:flex;align-items:center;justify-content:center;font-size:0.8rem;">⚫</div>';

    const borderColor = inc.status === 'critical' ? '#EF4444' : inc.status === 'warning' ? '#F59E0B' : inc.resolved ? '#10B981' : '#1E2736';

    const statusLabel = inc.resolved
      ? '<span style="color:#10B981;font-size:0.7rem;font-weight:600;">Resolved</span>'
      : inc.status === 'critical'
      ? '<span style="color:#EF4444;font-size:0.7rem;font-weight:600;">Critical</span>'
      : inc.status === 'warning'
      ? '<span style="color:#F59E0B;font-size:0.7rem;font-weight:600;">Warning</span>'
      : `<span style="color:#6B7A90;font-size:0.7rem;font-weight:600;">${inc.status}</span>`;

    const time = inc.timestamp ? formatTime(inc.timestamp) : '--';

    // 원인 상세: 메트릭 기반
    const m = inc.metrics || {};
    let cause = '';
    if (inc.isSSL) {
      cause = `SSL 인증서 만료 임박 (${m.daysRemaining || '?'}일)`;
    } else if (inc.status === 'offline') {
      cause = '서버 연결 불가 (Prometheus scrape 실패 또는 Push 미수신)';
    } else {
      const parts = [];
      if (m.cpu) parts.push(`CPU ${m.cpu}%`);
      if (m.memory) parts.push(`MEM ${m.memory}%`);
      if (m.disk) parts.push(`DISK ${m.disk}%`);
      if (m.cpuRequest) parts.push(`K8s CPU Req ${m.cpuRequest}%`);
      if (m.memoryRequest) parts.push(`K8s MEM Req ${m.memoryRequest}%`);
      cause = parts.length > 0 ? parts.join(' · ') : '상세 정보 없음';
    }

    return `
      <div style="display:flex;align-items:center;padding:12px 16px;border-left:3px solid ${borderColor};background:#151a24;border-radius:0 3px 3px 0;margin-bottom:6px;${inc.resolved ? 'opacity:0.6;' : ''}">
        <div style="width:50px;flex-shrink:0;">${statusIcon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:3px;">${inc.serverName}</div>
          <div style="font-size:0.72rem;color:#A9ABB3;margin-bottom:3px;">${cause}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:0.62rem;padding:2px 6px;background:#1C2028;border-radius:2px;color:#6B7A90;font-family:monospace;">${inc.id}</span>
            ${statusLabel}
          </div>
        </div>
        <div style="width:140px;flex-shrink:0;font-size:0.72rem;color:#6B7A90;">${time}</div>
        <div style="width:160px;flex-shrink:0;text-align:right;display:flex;gap:4px;justify-content:flex-end;">
          <button class="btn" style="font-size:0.65rem;padding:3px 8px;" onclick="window.__goToServerLogs('${inc.serverName}')">LOGS</button>
          ${!inc.resolved ? `<button class="btn btn-primary" style="font-size:0.65rem;padding:3px 8px;" onclick="window.location.hash='/server/${inc.id}'">VIEW</button>` : ''}
          <button class="btn" style="font-size:0.65rem;padding:3px 8px;color:#6B7A90;" onclick="window.__dismissAlert('${inc.id}')" title="알림 해제">✕</button>
        </div>
      </div>`;
  }).join('');
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (isToday) return `TODAY, ${time}`;
    if (isYesterday) return `YESTERDAY, ${time}`;
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + `, ${time}`;
  } catch (e) { return ts; }
}

export function cleanupIncidents() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}
