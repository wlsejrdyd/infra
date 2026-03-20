// assets/js/pages/overview.js
import { fetchServersData, fetchServerMetricsUnified, fetchSslStatus, fetchKubernetesPodResources } from '/assets/js/api.js';
import { updateTopbarBadges, updateLastUpdated } from '/assets/js/app.js';

let serversData = { servers: [], defaultThresholds: {} };
let currentFilter = 'all';
let currentStatusFilter = 'all';
let currentSearchQuery = '';
let currentRows = 3;
let updateInterval = null;
let previousStatusMap = {};

// 슬라이딩 & 드래그
let slideAnim = null;
let slidePos = 0;
let isPaused = false;
let isDragging = false;
let dragStartX = 0;
let dragStartPos = 0;
let slideMaxScroll = 0;
let slideDirection = 1;
let slidePauseUntil = 0;

const GAP = 8;
let cardStyle = {};
let notificationPermission = false;
let alertEnabled = true;
let audioCtx = null;

// 브라우저 알림 권한
if ('Notification' in window) {
  if (Notification.permission === 'granted') {
    notificationPermission = true;
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { notificationPermission = p === 'granted'; });
  }
}

// AudioContext 활성화
document.addEventListener('click', () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: false });

function playAlertSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.25].forEach(delay => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + delay + 0.15);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + 0.15);
    });
  } catch (e) {
    console.warn('[alert sound] failed:', e.message);
  }
}

function showBrowserNotification(serverName, status) {
  const emoji = status === 'critical' ? '🔴' : status === 'warning' ? '⚠️' : status === 'offline' ? '⚫' : '✅';
  const label = status === 'critical' ? 'Critical' : status === 'warning' ? 'Warning' : status === 'offline' ? 'Offline' : 'Recovered';
  if (notificationPermission) {
    try { new Notification(`${emoji} Infrastructure Alert`, { body: `${serverName} — ${label}`, tag: serverName }); } catch (e) { /* */ }
  }
  showToast(emoji, serverName, label);
}

function showToast(emoji, serverName, label) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const cls = label === 'Critical' ? 'danger' : label === 'Warning' ? 'warning' : 'success';
  const toast = document.createElement('div');
  toast.className = `toast ${cls}`;
  toast.innerHTML = `<div style="font-weight:700;margin-bottom:2px;">${emoji} ${label}</div><div style="color:var(--text-muted);">${serverName}</div>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 5000);
}

function clamp(min, val, max) { return Math.min(max, Math.max(min, val)); }

function calcCardStyle(rows, availH) {
  const MAX_H = 155;
  const rawH = Math.floor((availH - (rows - 1) * GAP) / rows);
  const h = clamp(60, rawH, MAX_H);
  const w = Math.floor(h * 2.3);
  const s = h / 100;
  const usedH = rows * h;
  const extraGap = rows > 1 ? Math.min(Math.floor((availH - usedH) / (rows - 1)), 30) : 0;
  const dynGap = GAP + extraGap;

  return {
    width: w, height: h, dynGap,
    pad: `${Math.max(6, Math.round(10 * s))}px`,
    nameSize: `${clamp(0.6, 0.88 * s, 1.4).toFixed(2)}rem`,
    barH: `${Math.max(3, Math.round(5 * s))}px`,
    labelW: `${Math.max(22, Math.round(32 * s))}px`,
    lblSize: `${clamp(0.5, 0.65 * s, 1.0).toFixed(2)}rem`,
    valSize: `${clamp(0.5, 0.65 * s, 1.0).toFixed(2)}rem`,
    valW: `${Math.max(26, Math.round(34 * s))}px`,
    nameMb: `${Math.max(3, Math.round(6 * s))}px`,
    metricGap: `${Math.max(2, Math.round(4 * s))}px`,
    radius: `${Math.max(8, Math.round(12 * s))}px`,
    projSize: `${clamp(0.45, 0.55 * s, 0.7).toFixed(2)}rem`,
  };
}

/**
 * Overview 렌더링
 */
export async function renderOverview() {
  const app = document.getElementById('app');

  // 서버 데이터 + 알림 설정 로드
  const [sData, alertConfig] = await Promise.all([
    fetchServersData(),
    fetch('/api/alert/config').then(r => r.json()).catch(() => ({ enabled: true }))
  ]);
  serversData = sData;
  alertEnabled = alertConfig.enabled !== false;

  // 프로젝트 목록 추출
  const projects = ['all', ...new Set(serversData.servers.map(s => s.project))];

  // 글로벌 핸들러 등록
  window.__overviewProjectFilter = (project) => {
    currentFilter = currentFilter === project ? 'all' : project;
    // 필터 버튼 활성화 업데이트
    document.querySelectorAll('.project-filter-btn[data-project]').forEach(b => {
      b.classList.toggle('active', b.dataset.project === currentFilter);
    });
    renderServerGrid();
  };

  window.__overviewSearch = (query) => {
    currentSearchQuery = query.toLowerCase().trim();
    renderServerGrid();
  };

  app.innerHTML = `
    <div class="overview-layout">
      <div class="overview-header">
        <div>
          <h2>System Resource Overview</h2>
          <div class="overview-subtitle" id="overviewSubtitle">Real-time status of ${serversData.servers.length} infrastructure nodes</div>
        </div>
        <div class="overview-header-actions">
          <div class="project-filter" id="projectFilter">
            ${projects.map(p => `<button class="project-filter-btn ${p === currentFilter ? 'active' : ''}" data-project="${p}">${p === 'all' ? 'ALL' : p}</button>`).join('')}
          </div>
          <div class="view-toggle">
            <button class="view-btn ${currentRows === 3 ? 'active' : ''}" data-rows="3">3R</button>
            <button class="view-btn ${currentRows === 5 ? 'active' : ''}" data-rows="5">5R</button>
          </div>
          <button class="btn-outline btn" id="alertToggleBtn" title="Slack Alert ON/OFF">${alertEnabled ? '🔔 Slack' : '🔕 Slack'}</button>
        </div>
      </div>

      <div class="ssl-bar" id="sslStatusBar" style="display:none;"></div>

      <div class="overview-content">
        <div class="pinned-section" id="pinnedSection" style="display:none;">
          <div class="section-label">ATTENTION REQUIRED</div>
          <div class="pinned-grid" id="pinnedGrid"></div>
        </div>

        <div class="scroll-section" id="scrollSection">
          <div class="section-label" id="scrollLabel">ALL NODES</div>
          <div class="scroll-container" id="scrollContainer">
            <div class="scroll-track" id="scrollTrack"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 프로젝트 필터
  document.querySelectorAll('.project-filter-btn[data-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.project-filter-btn[data-project]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.project;
      renderServerGrid();
    });
  });

  // 행 토글
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRows = parseInt(btn.dataset.rows);
      renderServerGrid();
    });
  });

  // 알림 토글
  document.getElementById('alertToggleBtn')?.addEventListener('click', async () => {
    alertEnabled = !alertEnabled;
    const btn = document.getElementById('alertToggleBtn');
    btn.textContent = alertEnabled ? '🔔 Slack' : '🔕 Slack';
    try {
      await fetch('/api/alert/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: alertEnabled })
      });
    } catch (e) { console.error('[alert config] save failed:', e); }
  });

  // 예약 필터 적용
  if (window._pendingStatusFilter) {
    currentStatusFilter = window._pendingStatusFilter;
    delete window._pendingStatusFilter;
  }
  if (window._pendingProjectFilter) {
    currentFilter = window._pendingProjectFilter;
    delete window._pendingProjectFilter;
  }

  setupDragScroll();

  window._overviewResizeHandler = () => {
    clearTimeout(window._overviewResizeTimer);
    window._overviewResizeTimer = setTimeout(renderServerGrid, 200);
  };
  window.addEventListener('resize', window._overviewResizeHandler);

  await updateServerGrid();
  updateSslStatusBar();
  startAutoUpdate();
}

function setupDragScroll() {
  const container = document.getElementById('scrollContainer');
  if (!container) return;

  function onDragStart(clientX) {
    isDragging = true;
    isPaused = true;
    dragStartX = clientX;
    dragStartPos = slidePos;
    window._wasDragged = false;
    container.style.cursor = 'grabbing';
  }

  function onDragMove(clientX) {
    if (!isDragging) return;
    const dx = clientX - dragStartX;
    if (Math.abs(dx) > 5) window._wasDragged = true;
    applySlidePos(dragStartPos - dx);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    isPaused = false;
    container.style.cursor = 'grab';
    setTimeout(() => { window._wasDragged = false; }, 50);
  }

  container.addEventListener('mousedown', e => { e.preventDefault(); onDragStart(e.clientX); });
  window.addEventListener('mousemove', e => onDragMove(e.clientX));
  window.addEventListener('mouseup', onDragEnd);
  container.addEventListener('touchstart', e => onDragStart(e.touches[0].clientX), { passive: true });
  container.addEventListener('touchmove', e => onDragMove(e.touches[0].clientX), { passive: true });
  container.addEventListener('touchend', onDragEnd);
  container.style.cursor = 'grab';
}

function applySlidePos(newPos) {
  const track = document.getElementById('scrollTrack');
  if (!track) return;
  const container = document.getElementById('scrollContainer');
  const maxScroll = container ? Math.max(0, track.scrollWidth - container.clientWidth) : slideMaxScroll;
  newPos = Math.max(0, Math.min(newPos, maxScroll));
  slidePos = newPos;
  track.style.transform = `translateX(-${slidePos}px)`;
}

/**
 * 서버 그리드 업데이트 (메트릭 fetch + 상태 판정)
 */
async function updateServerGrid() {
  const stats = { healthy: 0, warning: 0, critical: 0, offline: 0 };

  await Promise.all(serversData.servers.map(async (server) => {
    const metrics = await fetchServerMetricsUnified(server);

    let k8sData = null;
    if (server.mode === 'push') {
      k8sData = metrics.k8s || null;
    } else {
      try {
        const k8sRes = await fetchKubernetesPodResources(server.instance);
        if (k8sRes && k8sRes.nodeAllocatable) k8sData = k8sRes;
      } catch (e) { /* */ }
    }

    if (k8sData && k8sData.nodeAllocatable && k8sData.pods) {
      const activePods = k8sData.pods.filter(p => p.phase === 'Running' || p.phase === 'Pending');
      const totalCpuReq = activePods.reduce((sum, p) => sum + (p.cpuReq || 0), 0);
      const totalMemReq = activePods.reduce((sum, p) => sum + (p.memReq || 0), 0);
      const allocCpu = k8sData.nodeAllocatable.cpu || 0;
      const allocMem = k8sData.nodeAllocatable.memory || 0;
      if (allocCpu > 0) metrics.cpuRequestPct = (totalCpuReq / allocCpu) * 100;
      if (allocMem > 0) metrics.memRequestPct = (totalMemReq / allocMem) * 100;
    }

    server._metrics = metrics;
    const th = server.thresholds || serversData.defaultThresholds;
    const status = getServerStatus(metrics, th);
    server._status = status;
    stats[status]++;
  }));

  // 상태 변화 → 알림
  for (const server of serversData.servers) {
    const prev = previousStatusMap[server.id];
    const curr = server._status;
    const isAlert = curr === 'warning' || curr === 'critical' || curr === 'offline';
    const isRecovery = curr === 'healthy' && prev && (prev === 'warning' || prev === 'critical' || prev === 'offline');
    const isNewAlert = isAlert && (!prev || prev !== curr);

    if (isNewAlert || isRecovery) {
      playAlertSound();
      showBrowserNotification(server.name, curr);
      if (alertEnabled) {
        const m = server._metrics || {};
        sendAlertToBackend(server.id, server.name, curr, {
          cpu: m.cpu != null ? m.cpu.toFixed(1) : null,
          memory: m.memory != null ? m.memory.toFixed(1) : null,
          disk: m.disk != null ? m.disk.toFixed(1) : null,
          cpuRequest: m.cpuRequestPct != null ? m.cpuRequestPct.toFixed(1) : null,
          memoryRequest: m.memRequestPct != null ? m.memRequestPct.toFixed(1) : null,
        });
      }
    }
    previousStatusMap[server.id] = curr;
  }

  // 상단바 + 하단바 업데이트
  stats.total = serversData.servers.length;
  updateTopbarBadges(stats);
  updateLastUpdated();

  // 서브타이틀 업데이트
  const sub = document.getElementById('overviewSubtitle');
  if (sub) {
    const projectCount = new Set(serversData.servers.map(s => s.project)).size;
    sub.textContent = `Real-time status of ${serversData.servers.length} infrastructure nodes across ${projectCount} clusters`;
  }

  renderServerGrid();
}

/**
 * 서버 그리드 렌더링
 */
function renderServerGrid() {
  let filteredServers = serversData.servers.filter(s => {
    const projectMatch = currentFilter === 'all' || s.project === currentFilter;
    const statusMatch = currentStatusFilter === 'all' || s._status === currentStatusFilter;
    const searchMatch = !currentSearchQuery || s.name.toLowerCase().includes(currentSearchQuery) || (s.project || '').toLowerCase().includes(currentSearchQuery);
    return projectMatch && statusMatch && searchMatch;
  });

  const statusOrder = { critical: 0, warning: 1, healthy: 2, offline: 3 };
  filteredServers.sort((a, b) => (statusOrder[a._status] ?? 4) - (statusOrder[b._status] ?? 4));

  const pinned = currentStatusFilter === 'all'
    ? filteredServers.filter(s => s._status === 'critical' || s._status === 'warning')
    : [];
  const scrolling = currentStatusFilter === 'all'
    ? filteredServers.filter(s => s._status === 'healthy' || s._status === 'offline')
    : filteredServers;

  const track = document.getElementById('scrollTrack');
  const container = document.getElementById('scrollContainer');
  if (!track || !container) return;

  stopSliding();
  track.innerHTML = '';
  track.style.height = '0';
  track.style.transform = 'translateX(0)';
  slidePos = 0;

  requestAnimationFrame(() => {
    const availH = container.clientHeight;
    if (availH <= 0) return;

    cardStyle = calcCardStyle(currentRows, availH);
    const dg = cardStyle.dynGap;
    const trackH = currentRows * cardStyle.height + (currentRows - 1) * dg;
    track.style.height = trackH + 'px';
    track.style.gap = dg + 'px';

    // Pinned
    const pinnedSection = document.getElementById('pinnedSection');
    const pinnedGrid = document.getElementById('pinnedGrid');
    if (pinnedSection && pinnedGrid) {
      if (pinned.length > 0) {
        pinnedSection.style.display = '';
        pinnedGrid.style.gap = dg + 'px';
        pinnedGrid.innerHTML = pinned.map(s => renderNodeCard(s)).join('');
      } else {
        pinnedSection.style.display = 'none';
      }
    }

    const scrollLabel = document.getElementById('scrollLabel');
    if (scrolling.length === 0) {
      if (scrollLabel) scrollLabel.textContent = 'No nodes matching filter';
      return;
    }
    if (scrollLabel) {
      const labels = { all: 'ALL NODES', healthy: 'HEALTHY', warning: 'WARNING', critical: 'CRITICAL', offline: 'OFFLINE' };
      scrollLabel.textContent = `${labels[currentStatusFilter] || labels.all} — ${scrolling.length} nodes`;
    }

    track.innerHTML = scrolling.map(s => renderNodeCard(s)).join('');

    const colCount = Math.ceil(scrolling.length / currentRows);
    const contentW = colCount * cardStyle.width + (colCount - 1) * dg;
    const containerW = container.clientWidth;
    const maxScroll = Math.max(0, contentW - containerW);
    if (maxScroll > 0) startSliding(maxScroll);
  });
}

/**
 * 노드 카드 렌더링 (Obsidian 디자인)
 */
function renderNodeCard(server) {
  const v = cardStyle;
  const metrics = server._metrics || {};
  const status = server._status || 'offline';
  const off = status === 'offline';

  // 상태별 보더 색상
  const borderColor = status === 'critical' ? 'var(--danger)'
    : status === 'warning' ? 'var(--warning)'
    : 'var(--border)';

  // 상태별 배경 글로우
  const bgGlow = status === 'critical' ? 'rgba(255,92,92,0.04)'
    : status === 'warning' ? 'rgba(245,166,35,0.04)'
    : 'transparent';

  // 프로젝트 라벨 색상
  const projColor = status === 'critical' ? 'var(--danger)'
    : status === 'warning' ? 'var(--warning)'
    : 'var(--accent)';

  const gc = (val, type) => {
    if (!val && val !== 0) return 'var(--text-dim)';
    const th = (server.thresholds || serversData.defaultThresholds)[type];
    if (!th) return 'var(--success)';
    if (val >= th.critical) return 'var(--danger)';
    if (val >= th.warning) return 'var(--warning)';
    return 'var(--success)';
  };

  const cpu = metrics.cpu;
  const mem = metrics.memory;
  const disk = metrics.disk;

  return `
    <div style="background:${bgGlow};border:1px solid ${borderColor};border-radius:${v.radius};padding:${v.pad};cursor:pointer;width:${v.width}px;height:${v.height}px;flex-shrink:0;transition:all 0.2s;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;position:relative;"
         onmouseover="this.style.borderColor='var(--accent)';this.style.boxShadow='0 4px 20px rgba(105,246,184,0.08)'"
         onmouseout="this.style.borderColor='${borderColor}';this.style.boxShadow='none'"
         onclick="if(!window._wasDragged)window.location.hash='/server/${server.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${v.nameMb};">
        <div style="overflow:hidden;flex:1;">
          <div style="font-size:${v.projSize};font-weight:700;color:${projColor};text-transform:uppercase;letter-spacing:0.5px;">${server.project || ''}</div>
          <div style="font-size:${v.nameSize};font-weight:700;font-family:var(--font-brand);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);margin-top:1px;">${server.name}</div>
        </div>
        <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:2px;background:${status === 'critical' ? 'var(--danger)' : status === 'warning' ? 'var(--warning)' : status === 'healthy' ? 'var(--success)' : 'var(--text-muted)'};${status !== 'offline' ? 'animation:pulse 2s infinite;' : ''}"></div>
      </div>
      ${[
        { label: 'CPU',  val: cpu,  type: 'cpu' },
        { label: 'MEM',  val: mem,  type: 'memory' },
        { label: 'DISK', val: disk, type: 'disk' },
      ].map((m, i) => `
        <div style="display:flex;align-items:center;gap:4px;${i ? 'margin-top:' + v.metricGap + ';' : ''}">
          <span style="font-size:${v.lblSize};color:var(--text-dim);min-width:${v.labelW};font-weight:600;">${m.label}</span>
          <div style="flex:1;height:${v.barH};background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${off ? 0 : (m.val || 0)}%;background:${gc(m.val, m.type)};border-radius:2px;transition:width 0.4s;"></div>
          </div>
          <span style="font-size:${v.valSize};font-weight:700;font-family:var(--font-brand);min-width:${v.valW};text-align:right;color:${gc(m.val, m.type)};">${off || m.val == null ? '--' : m.val.toFixed(0)}%</span>
        </div>
      `).join('')}
    </div>`;
}

function startSliding(maxScroll) {
  if (slideAnim) cancelAnimationFrame(slideAnim);
  const track = document.getElementById('scrollTrack');
  if (!track) return;

  slideMaxScroll = maxScroll;
  slideDirection = 1;
  slidePauseUntil = 0;
  const speed = 0.3;

  function step() {
    if (!isPaused && !isDragging) {
      const now = performance.now();
      if (now >= slidePauseUntil) {
        slidePos += speed * slideDirection;
        if (slidePos >= slideMaxScroll) {
          slidePos = slideMaxScroll;
          slideDirection = -1;
          slidePauseUntil = now + 2000;
        } else if (slidePos <= 0) {
          slidePos = 0;
          slideDirection = 1;
          slidePauseUntil = now + 2000;
        }
      }
      track.style.transform = `translateX(-${slidePos}px)`;
    }
    slideAnim = requestAnimationFrame(step);
  }
  slideAnim = requestAnimationFrame(step);
}

function stopSliding() {
  if (slideAnim) { cancelAnimationFrame(slideAnim); slideAnim = null; }
}

function getServerStatus(metrics, thresholds) {
  if (metrics.status === 'offline') return 'offline';
  const { cpu, memory, disk, cpuRequestPct, memRequestPct } = metrics;
  const cpuReqTh = thresholds.cpuRequest || { warning: 80, critical: 90 };
  const memReqTh = thresholds.memoryRequest || { warning: 80, critical: 90 };

  if ((cpu && cpu >= thresholds.cpu.critical) || (memory && memory >= thresholds.memory.critical) || (disk && disk >= thresholds.disk.critical)
    || (cpuRequestPct != null && cpuRequestPct >= cpuReqTh.critical) || (memRequestPct != null && memRequestPct >= memReqTh.critical)) return 'critical';
  if ((cpu && cpu >= thresholds.cpu.warning) || (memory && memory >= thresholds.memory.warning) || (disk && disk >= thresholds.disk.warning)
    || (cpuRequestPct != null && cpuRequestPct >= cpuReqTh.warning) || (memRequestPct != null && memRequestPct >= memReqTh.warning)) return 'warning';
  return 'healthy';
}

let _sslCheckCounter = 0;
function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    updateServerGrid();
    _sslCheckCounter++;
    if (_sslCheckCounter % 6 === 0) updateSslStatusBar();
  }, 10000);
}

async function sendAlertToBackend(serverId, serverName, status, metrics = {}) {
  try {
    await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, serverName, status, metrics })
    });
  } catch (e) { console.error('[Slack API] failed:', e); }
}

export function setOverviewStatusFilter(status) {
  currentStatusFilter = currentStatusFilter === status ? 'all' : status;
  // 상단바 pill 활성화 토글
  document.querySelectorAll('.status-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.status === currentStatusFilter);
  });
  renderServerGrid();
}

let _previousSslStatusMap = {};
async function updateSslStatusBar() {
  const bar = document.getElementById('sslStatusBar');
  if (!bar) return;

  const data = await fetchSslStatus();
  const results = data.results || [];
  if (results.length === 0) { bar.style.display = 'none'; return; }

  bar.style.display = 'flex';
  const colorMap = { healthy: 'var(--success)', warning: 'var(--warning)', critical: 'var(--danger)', expired: 'var(--danger)', error: 'var(--text-muted)' };
  const label = '<span style="font-size:0.68rem;color:var(--text-dim);margin-right:4px;font-weight:600;">SSL</span>';
  const pills = results.map(r => {
    const color = colorMap[r.status] || 'var(--text-muted)';
    const days = r.daysRemaining != null ? `${r.daysRemaining}d` : r.status;
    const title = r.notAfter ? `Expires: ${r.notAfter} (${r.daysRemaining}d)\nIssuer: ${r.issuer}` : (r.error || r.status);
    return `<span style="font-size:0.65rem;padding:2px 8px;border-radius:10px;border:1px solid ${color};color:${color};cursor:default;white-space:nowrap;" title="${title}">${r.domain} ${days}</span>`;
  }).join('');
  bar.innerHTML = label + pills;

  for (const r of results) {
    const prev = _previousSslStatusMap[r.id];
    const curr = r.status;
    if (prev && prev !== curr && (curr === 'warning' || curr === 'critical' || curr === 'expired')) {
      playAlertSound();
      showBrowserNotification(`SSL: ${r.domain}`, curr === 'expired' ? 'critical' : curr);
      if (alertEnabled) {
        sendAlertToBackend(`ssl:${r.id}`, `SSL: ${r.domain}`, curr === 'expired' ? 'critical' : curr, { daysRemaining: r.daysRemaining });
      }
    }
    _previousSslStatusMap[r.id] = curr;
  }
}

export function cleanupOverview() {
  if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
  stopSliding();
  if (window._overviewResizeHandler) {
    window.removeEventListener('resize', window._overviewResizeHandler);
    window._overviewResizeHandler = null;
  }
  window.__overviewProjectFilter = null;
  window.__overviewSearch = null;
}
