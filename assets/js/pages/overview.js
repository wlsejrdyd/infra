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
const sparklineHistory = {}; // key: serverId_cpu, serverId_mem, serverId_disk → [val, ...] (최근 20개)

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
  const MAX_H = 195;
  const MIN_H = 160;
  const rawH = Math.floor((availH - (rows - 1) * GAP) / rows);
  const h = clamp(MIN_H, rawH, MAX_H);
  const w = Math.floor(h * 1.9);
  const s = h / 160;
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
    radius: `${Math.max(4, Math.round(6 * s))}px`,
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
    const sel = document.getElementById('projectFilter');
    if (sel) sel.value = currentFilter;
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
          <h2>서버 리소스 현황</h2>
          <div class="overview-subtitle" id="overviewSubtitle">${serversData.servers.length}개 서버 · ${projects.length - 1}개 프로젝트 실시간 모니터링</div>
        </div>
        <div class="overview-header-actions">
          <select class="filter-select" id="projectFilter">
            ${projects.map(p => `<option value="${p}" ${p === currentFilter ? 'selected' : ''}>${p === 'all' ? '전체 프로젝트' : p}</option>`).join('')}
          </select>
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

  // 프로젝트 필터 (셀렉트박스)
  document.getElementById('projectFilter')?.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    renderServerGrid();
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

    // sparkline 히스토리 누적 (CPU/MEM/DISK, 최근 20개)
    ['cpu', 'memory', 'disk'].forEach(type => {
      const key = server.id + '_' + type;
      if (!sparklineHistory[key]) sparklineHistory[key] = [];
      const val = type === 'memory' ? metrics.memory : metrics[type];
      if (val != null) {
        sparklineHistory[key].push(val);
        if (sparklineHistory[key].length > 20) sparklineHistory[key].shift();
      }
    });

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
    sub.textContent = `${serversData.servers.length}개 서버 · ${projectCount}개 프로젝트 실시간 모니터링`;
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
        drawAllSparklines(pinnedGrid);
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

    // sparkline 그리기
    drawAllSparklines();

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
  const m = server._metrics || {};
  const status = server._status || 'offline';
  const off = status === 'offline';
  const s = v.height / 120;

  // ── 상태별 스타일 ──
  const SS = {
    healthy:  { border: '#1E2736', bg: '#1A1F2B', shadow: 'none', proj: '#10B981', led: '#10B981', opacity: '1', filter: 'none' },
    warning:  { border: 'rgba(245,158,11,0.4)', bg: 'linear-gradient(160deg, rgba(245,158,11,0.07) 0%, #1A1F2B 50%)', shadow: '0 0 12px rgba(245,158,11,0.05)', proj: '#F59E0B', led: '#F59E0B', opacity: '1', filter: 'none' },
    critical: { border: 'rgba(239,68,68,0.5)', bg: 'linear-gradient(160deg, rgba(239,68,68,0.09) 0%, #1A1F2B 50%)', shadow: '0 0 20px rgba(239,68,68,0.12)', proj: '#EF4444', led: '#EF4444', opacity: '1', filter: 'none' },
    offline:  { border: '#1E2736', bg: '#13161E', shadow: 'none', proj: '#4B5563', led: '#4B5563', opacity: '0.5', filter: 'grayscale(1)' },
  };
  const st = SS[status] || SS.offline;
  const critAnim = status === 'critical' ? 'animation:glow 2s ease-in-out infinite;' : '';

  // ── 색상 ──
  const gc = (val, type) => {
    if (val == null) return '#4B5563';
    const th = (server.thresholds || serversData.defaultThresholds)[type];
    if (!th) return '#10B981';
    if (val >= th.critical) return '#EF4444';
    if (val >= th.warning) return '#F59E0B';
    return '#10B981';
  };

  const cpu = m.cpu, mem = m.memory, disk = m.disk;

  // ── 스케일 ──
  const barH = Math.max(5, Math.round(6 * s));
  const lblFs = `${clamp(0.58, 0.68 * s, 0.8).toFixed(2)}rem`;
  const valFs = `${clamp(0.58, 0.72 * s, 0.85).toFixed(2)}rem`;
  const lblW = `${Math.max(28, Math.round(36 * s))}px`;
  const valW = `${Math.max(30, Math.round(38 * s))}px`;
  const rowGap = `${Math.max(6, Math.round(10 * s))}px`;
  const pad = `${Math.max(10, Math.round(14 * s))}px`;
  const nameFs = `${clamp(0.8, 1.05 * s, 1.2).toFixed(2)}rem`;
  const projFs = `${clamp(0.5, 0.58 * s, 0.68).toFixed(2)}rem`;
  const ledSize = `${Math.max(8, Math.round(10 * s))}px`;

  /**
   * 줄1: CPU          ~~~spark~~~  17%
   * 줄2: [=========progress bar=========]
   */
  const sparkW = Math.max(50, Math.round(60 * s));
  const sparkH = Math.max(14, Math.round(16 * s));

  const metricRow = (label, val, type, histKey) => {
    const barColor = gc(val, type);
    const pct = off ? 0 : (val || 0);
    const display = off || val == null ? '-- %' : `${val.toFixed(0)}%`;
    const hist = sparklineHistory[histKey];
    const hasHist = hist && hist.length >= 2;

    const th = (server.thresholds || serversData.defaultThresholds)[type];
    let valColor = '#E8ECF1';
    if (off) valColor = '#4B5563';
    else if (th && val != null) {
      if (val >= th.critical) valColor = '#EF4444';
      else if (val >= th.warning) valColor = '#F59E0B';
    }

    return `
      <div style="margin-top:${rowGap};">
        <div style="display:flex;align-items:flex-end;margin-bottom:3px;">
          <span style="font-size:${lblFs};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#A9ABB3;">${label}</span>
          <div style="flex:1;"></div>
          ${hasHist ? `<canvas data-sparkline="${histKey}" style="width:${sparkW}px;height:${sparkH}px;flex-shrink:0;margin-right:6px;"></canvas>` : ''}
          <span style="font-size:${valFs};font-weight:700;font-family:'Space Grotesk',monospace;color:${valColor};">${display}</span>
        </div>
        <div style="height:${barH}px;background:#1C2028;border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:all 0.5s ease;"></div>
        </div>
      </div>`;
  };

  // ── Offline 오버레이 ──
  const offlineOverlay = off ? `
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;z-index:1;">
      <div style="font-size:${Math.max(20, Math.round(28 * s))}px;opacity:0.3;margin-bottom:4px;">&#9888;</div>
      <div style="font-size:${projFs};font-weight:700;color:#4B5563;letter-spacing:1.5px;">NODE OFFLINE</div>
    </div>` : '';

  return `
    <div style="background:${st.bg};border:1px solid ${st.border};border-radius:${Math.max(4, Math.round(6 * s))}px;padding:${pad};cursor:${off ? 'default' : 'pointer'};width:${v.width}px;height:${v.height}px;flex-shrink:0;transition:all 0.25s;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;position:relative;opacity:${st.opacity};filter:${st.filter};box-shadow:${st.shadow};${critAnim}"
         onmouseover="if('${status}'!=='offline'){this.style.borderColor='#10B981';this.style.boxShadow='0 4px 24px rgba(16,185,129,0.10)';this.style.opacity='1';this.style.filter='none'}"
         onmouseout="this.style.borderColor='${st.border}';this.style.boxShadow='${st.shadow}';this.style.opacity='${st.opacity}';this.style.filter='${st.filter}'"
         onclick="if(!window._wasDragged)window.location.hash='/server/${server.id}'">
      ${offlineOverlay}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${Math.max(4, Math.round(8 * s))}px;${off ? 'opacity:0.3;' : ''}">
        <div style="overflow:hidden;flex:1;">
          <div style="font-size:${projFs};font-weight:700;color:${st.proj};text-transform:uppercase;letter-spacing:0.8px;">${server.project || ''}</div>
          <div style="font-size:${nameFs};font-weight:700;font-family:'Space Grotesk',var(--font-brand),sans-serif;letter-spacing:-0.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#E8ECF1;margin-top:2px;">${server.name}</div>
        </div>
        <div style="width:${ledSize};height:${ledSize};border-radius:50%;flex-shrink:0;margin-top:4px;background:${st.led};${status !== 'offline' ? 'animation:pulse 2s infinite;' : ''}"></div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;${off ? 'opacity:0.15;' : ''}">
        ${metricRow('CPU', cpu, 'cpu', server.id + '_cpu')}
        ${metricRow('MEM', mem, 'memory', server.id + '_memory')}
        ${metricRow('DISK', disk, 'disk', server.id + '_disk')}
      </div>
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

/**
 * Sparkline 그리기 (모든 canvas[data-sparkline])
 */
function drawAllSparklines(container) {
  const root = container || document;
  root.querySelectorAll('canvas[data-sparkline]').forEach(canvas => {
    const key = canvas.dataset.sparkline;
    const data = sparklineHistory[key];
    if (!data || data.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // 고해상도 대응 (2x)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padX = 2, padY = 3;

    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 100);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = (w - padX * 2) / (data.length - 1);

    // 색상: 마지막 값 기준
    const last = data[data.length - 1];
    const color = last >= 90 ? '#EF4444' : last >= 70 ? '#F59E0B' : '#10B981';

    // 점 좌표 계산
    const points = data.map((v, i) => ({
      x: padX + i * step,
      y: h - padY - ((v - min) / range) * (h - padY * 2)
    }));

    // Bezier 곡선으로 부드러운 선 그리기
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      ctx.quadraticCurveTo(prev.x + (cpx - prev.x) * 0.8, prev.y, cpx, (prev.y + curr.y) / 2);
      ctx.quadraticCurveTo(curr.x - (curr.x - cpx) * 0.8, curr.y, curr.x, curr.y);
    }
    ctx.stroke();

    // 영역 채우기 (fill-opacity 0.1)
    ctx.lineTo(points[points.length - 1].x, h);
    ctx.lineTo(points[0].x, h);
    ctx.closePath();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
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
