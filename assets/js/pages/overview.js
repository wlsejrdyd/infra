// assets/js/pages/overview.js
import { fetchServersData, fetchServerMetrics } from '/assets/js/api.js';

let serversData = { servers: [], defaultThresholds: {} };
let currentFilter = 'all';
let currentStatusFilter = 'all';
let currentRows = 3; // 3행 | 5행
let updateInterval = null;
let previousStatusMap = {};

// 슬라이딩 & 드래그 상태
let slideAnim = null;
let slidePos = 0;
let isPaused = false;
let isDragging = false;
let dragStartX = 0;
let dragStartPos = 0;

const GAP = 6;
let cardStyle = {};
let notificationPermission = false;
let alertEnabled = true; // 서버에서 로드
let audioCtx = null; // 재사용 AudioContext (브라우저 정책 대응)

// 브라우저 알림 권한 요청
if ('Notification' in window) {
  if (Notification.permission === 'granted') {
    notificationPermission = true;
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { notificationPermission = p === 'granted'; });
  }
}

// 첫 사용자 클릭 시 AudioContext 활성화 (Chrome autoplay 정책 대응)
document.addEventListener('click', () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: false });

/**
 * 경고음 재생 (Web Audio API — 외부 파일 불필요)
 */
function playAlertSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // 비프 2회
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
    console.warn('[알림소리] 재생 실패:', e.message);
  }
}

/**
 * 브라우저 알림 표시
 */
function showBrowserNotification(serverName, status) {
  const emoji = status === 'critical' ? '🔴' : status === 'warning' ? '⚠️' : status === 'offline' ? '⚫' : '✅';
  const label = status === 'critical' ? 'Critical' : status === 'warning' ? 'Warning' : status === 'offline' ? 'Offline' : 'Recovered';
  const body = `${serverName} — 상태가 ${label}(으)로 변경되었습니다.`;

  // 브라우저 Notification
  if (notificationPermission) {
    try {
      new Notification(`${emoji} Infrastructure Alert`, { body, icon: '/assets/favicon.ico', tag: serverName });
    } catch (e) { /* 무시 */ }
  }

  // 페이지 내 토스트 알림
  showToast(emoji, serverName, label);
}

/**
 * 페이지 내 토스트 알림 (브라우저 권한 없어도 동작)
 */
function showToast(emoji, serverName, label) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:60px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }

  const color = label === 'Critical' ? 'var(--danger)' : label === 'Warning' ? 'var(--warning)' : 'var(--success)';
  const toast = document.createElement('div');
  toast.style.cssText = `pointer-events:auto;background:var(--bg-card);border:1px solid ${color};border-left:4px solid ${color};border-radius:8px;padding:12px 16px;min-width:260px;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:fadeIn 0.3s ease-out;`;
  toast.innerHTML = `
    <div style="font-size:0.85rem;font-weight:700;margin-bottom:4px;">${emoji} ${label}</div>
    <div style="font-size:0.8rem;color:var(--text-muted);">${serverName}</div>
  `;
  container.appendChild(toast);

  // 5초 후 자동 제거
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function clamp(min, val, max) { return Math.min(max, Math.max(min, val)); }

/**
 * 카드 스타일 동적 계산 (행 수 + 가용 높이 기반)
 * 카드 최대 높이를 제한하고 남는 공간은 행 간격으로 분배
 */
function calcCardStyle(rows, availH) {
  const MAX_H = 155;
  const rawH = Math.floor((availH - (rows - 1) * GAP) / rows);
  const h = clamp(60, rawH, MAX_H);
  const w = Math.floor(h * 2.3);
  const s = h / 100;

  // 남는 공간을 행 간격으로 분배 (최대 30px)
  const usedH = rows * h;
  const extraGap = rows > 1 ? Math.min(Math.floor((availH - usedH) / (rows - 1)), 30) : 0;
  const dynGap = GAP + extraGap;

  return {
    width: w, height: h, dynGap,
    pad: `${Math.max(4, Math.round(8 * s))}px`,
    nameSize: `${clamp(0.6, 0.88 * s, 1.4).toFixed(2)}rem`,
    barH: `${Math.max(3, Math.round(5 * s))}px`,
    labelW: `${Math.max(22, Math.round(32 * s))}px`,
    lblSize: `${clamp(0.5, 0.65 * s, 1.0).toFixed(2)}rem`,
    valSize: `${clamp(0.5, 0.65 * s, 1.0).toFixed(2)}rem`,
    valW: `${Math.max(26, Math.round(34 * s))}px`,
    nameMb: `${Math.max(2, Math.round(4 * s))}px`,
    metricGap: `${Math.max(1, Math.round(3 * s))}px`,
    radius: `${Math.max(6, Math.round(10 * s))}px`,
    projSize: `${clamp(0.45, 0.55 * s, 0.75).toFixed(2)}rem`,
  };
}

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

  // 서버 데이터 + 알림 설정 병렬 로드
  const [sData, alertConfig] = await Promise.all([
    fetchServersData(),
    fetch('/api/alert/config').then(r => r.json()).catch(() => ({ enabled: true }))
  ]);
  serversData = sData;
  alertEnabled = alertConfig.enabled !== false;

  // 프로젝트 목록 추출
  const projects = ['all', ...new Set(serversData.servers.map(s => s.project))];

  app.innerHTML = `
    <div class="overview-layout">
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
            <button class="view-btn ${currentRows === 3 ? 'active' : ''}" data-rows="3">3행</button>
            <button class="view-btn ${currentRows === 5 ? 'active' : ''}" data-rows="5">5행</button>
          </div>
          <button class="project-filter-btn" onclick="location.reload()">🔄</button>
          <button class="project-filter-btn ${alertEnabled ? 'active' : ''}" id="alertToggleBtn" title="Slack 알림 ON/OFF">${alertEnabled ? '🔔 Slack' : '🔕 Slack'}</button>
          <button class="project-filter-btn active" onclick="window.location.hash='/admin'">⚙️ 관리</button>
        </div>
      </div>

      <div class="overview-content">
        <div class="pinned-section" id="pinnedSection">
          <div class="section-label">🔴 주의 필요 — 고정 표시</div>
          <div class="pinned-grid" id="pinnedGrid"></div>
        </div>

        <div class="scroll-section" id="scrollSection">
          <div class="section-label" id="scrollLabel">✅ 정상 / 💤 오프라인</div>
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

  // 행 모드 토글
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRows = parseInt(btn.dataset.rows);
      renderServerGrid();
    });
  });

  // 알림 토글 (서버 측 저장 — 모든 클라이언트 공통 적용)
  document.getElementById('alertToggleBtn')?.addEventListener('click', async () => {
    alertEnabled = !alertEnabled;
    const btn = document.getElementById('alertToggleBtn');
    btn.textContent = alertEnabled ? '🔔 Slack' : '🔕 Slack';
    btn.classList.toggle('active', alertEnabled);
    try {
      await fetch('/api/alert/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: alertEnabled })
      });
    } catch (e) {
      console.error('[알림설정] 저장 실패:', e);
    }
  });

  // pendingStatusFilter 적용 (다른 페이지에서 헤더 상태 클릭 → overview 진입 시)
  if (window._pendingStatusFilter) {
    currentStatusFilter = window._pendingStatusFilter;
    delete window._pendingStatusFilter;
    document.querySelectorAll('.header-stat').forEach(s => {
      s.classList.toggle('active', s.dataset.status === currentStatusFilter);
    });
  }

  // 드래그 스크롤 설정
  setupDragScroll();

  // 윈도우 리사이즈
  window._overviewResizeHandler = () => {
    clearTimeout(window._overviewResizeTimer);
    window._overviewResizeTimer = setTimeout(renderServerGrid, 200);
  };
  window.addEventListener('resize', window._overviewResizeHandler);

  // 초기 렌더링
  await updateServerGrid();
  startAutoUpdate();
}

/**
 * 드래그 스크롤 설정 (마우스 + 터치)
 */
function setupDragScroll() {
  const container = document.getElementById('scrollContainer');
  if (!container) return;

  // 드래그 시작
  function onDragStart(clientX) {
    isDragging = true;
    isPaused = true;
    dragStartX = clientX;
    dragStartPos = slidePos;
    window._wasDragged = false;
    container.style.cursor = 'grabbing';
  }

  // 드래그 중
  function onDragMove(clientX) {
    if (!isDragging) return;
    const dx = clientX - dragStartX;
    if (Math.abs(dx) > 5) window._wasDragged = true;
    applySlidePos(dragStartPos - dx);
  }

  // 드래그 끝
  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    isPaused = false;
    container.style.cursor = 'grab';
    // wasDragged 플래그를 약간 지연 후 리셋 (click 이벤트 방지용)
    setTimeout(() => { window._wasDragged = false; }, 50);
  }

  // 마우스 이벤트
  container.addEventListener('mousedown', e => { e.preventDefault(); onDragStart(e.clientX); });
  window.addEventListener('mousemove', e => onDragMove(e.clientX));
  window.addEventListener('mouseup', onDragEnd);

  // 터치 이벤트
  container.addEventListener('touchstart', e => onDragStart(e.touches[0].clientX), { passive: true });
  container.addEventListener('touchmove', e => onDragMove(e.touches[0].clientX), { passive: true });
  container.addEventListener('touchend', onDragEnd);

  container.style.cursor = 'grab';
}

/**
 * 슬라이드 위치 적용 (0 ~ maxScroll 범위 제한)
 */
function applySlidePos(newPos) {
  const track = document.getElementById('scrollTrack');
  if (!track) return;

  const container = document.getElementById('scrollContainer');
  const maxScroll = container
    ? Math.max(0, track.scrollWidth - container.clientWidth)
    : slideMaxScroll;
  newPos = Math.max(0, Math.min(newPos, maxScroll));

  slidePos = newPos;
  track.style.transform = `translateX(-${slidePos}px)`;
}

/**
 * 서버 그리드 업데이트 (메트릭 fetch + 상태 판정)
 */
async function updateServerGrid() {
  const stats = { healthy: 0, warning: 0, critical: 0, offline: 0 };

  // 모든 서버 메트릭 병렬 fetch (순차 대비 ~N배 빠름)
  await Promise.all(serversData.servers.map(async (server) => {
    const metrics = await fetchServerMetrics(server.instance);
    server._metrics = metrics;
    const status = getServerStatus(metrics, serversData.defaultThresholds);
    server._status = status;
    stats[status]++;
  }));

  // 상태 변화 감지 → Slack 알림
  // - warning/critical/offline: 첫 로드 시에도 알림 시도 (백엔드가 중복 차단)
  // - healthy 복구: 이전에 warning/critical/offline이었던 경우만
  for (const server of serversData.servers) {
    const prev = previousStatusMap[server.id];
    const curr = server._status;
    const isAlert = curr === 'warning' || curr === 'critical' || curr === 'offline';
    const isRecovery = curr === 'healthy' && prev && (prev === 'warning' || prev === 'critical' || prev === 'offline');
    const isNewAlert = isAlert && (!prev || prev !== curr);

    if (prev !== curr) {
      console.log(`[상태변화] ${server.name}: ${prev || '(초기)'} → ${curr}`);
    }
    if (isNewAlert || isRecovery) {
      console.log(`[알림발송] ${server.name}: ${curr} (Slack ${alertEnabled ? 'ON' : 'OFF'})`);
      playAlertSound();
      showBrowserNotification(server.name, curr);
      if (alertEnabled) {
        sendAlertToBackend(server.id, server.name, curr);
      }
    }
    previousStatusMap[server.id] = curr;
  }

  // 헤더 통계
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
 * 서버 그리드 렌더링 (pinned + scroll, 동적 카드 크기, 드래그 스크롤)
 */
function renderServerGrid() {
  let filteredServers = serversData.servers.filter(s => {
    const projectMatch = currentFilter === 'all' || s.project === currentFilter;
    const statusMatch = currentStatusFilter === 'all' || s._status === currentStatusFilter;
    return projectMatch && statusMatch;
  });

  // 상태별 정렬: critical → warning → healthy → offline
  const statusOrder = { critical: 0, warning: 1, healthy: 2, offline: 3 };
  filteredServers.sort((a, b) => (statusOrder[a._status] ?? 4) - (statusOrder[b._status] ?? 4));

  // 상태 필터가 활성화된 경우: pinned/scrolling 분리 없이 모두 scrolling에 표시
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

  // Layout 확정 후 높이 계산
  requestAnimationFrame(() => {
    const availH = container.clientHeight;
    if (availH <= 0) return;

    // 카드 스타일 계산 (행 수 기반, 높이 제한 + 남은 공간 → 행 간격)
    cardStyle = calcCardStyle(currentRows, availH);
    const dg = cardStyle.dynGap;
    const trackH = currentRows * cardStyle.height + (currentRows - 1) * dg;
    track.style.height = trackH + 'px';
    track.style.gap = dg + 'px';

    // Pinned 섹션 (같은 카드 크기 사용)
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

    // 레이블
    const scrollLabel = document.getElementById('scrollLabel');
    if (scrolling.length === 0) {
      if (scrollLabel) scrollLabel.textContent = '필터에 해당하는 서버가 없습니다.';
      return;
    }
    if (scrollLabel) {
      const statusLabels = { all: '✅ 정상 / 💤 오프라인', healthy: '✅ Healthy', warning: '⚠️ Warning', critical: '🔴 Critical', offline: '💤 Offline' };
      const label = statusLabels[currentStatusFilter] || statusLabels.all;
      scrollLabel.innerHTML = `${label} — ${currentRows}행 <span style="font-size:0.6rem;color:var(--text-muted);margin-left:8px;font-weight:400;">(드래그로 좌우 이동)</span>`;
    }

    // 카드 렌더링 (복제 없이 등록된 서버만 표시)
    const cards = scrolling.map(s => renderCompactCard(s)).join('');
    track.innerHTML = cards;

    // 슬라이딩 필요 여부: 콘텐츠가 컨테이너보다 넓으면 슬라이딩
    const colCount = Math.ceil(scrolling.length / currentRows);
    const contentW = colCount * cardStyle.width + (colCount - 1) * dg;
    const containerW = container.clientWidth;
    const maxScroll = Math.max(0, contentW - containerW);

    if (maxScroll > 0) {
      startSliding(maxScroll);
    }
  });
}

/**
 * 컴팩트 카드 렌더링
 */
function renderCompactCard(server) {
  const v = cardStyle;
  const metrics = server._metrics || {};
  const status = server._status || 'offline';
  const off = status === 'offline';
  const bc = status === 'critical' ? 'var(--danger)' : status === 'warning' ? 'var(--warning)' : 'var(--border)';

  const gc = (val, type) => {
    if (!val) return 'var(--text-muted)';
    const th = serversData.defaultThresholds[type];
    if (val >= th.critical) return 'var(--danger)';
    if (val >= th.warning) return 'var(--warning)';
    return 'var(--success)';
  };

  const cpu = metrics.cpu;
  const mem = metrics.memory;
  const disk = metrics.disk;

  return `
    <div style="background:var(--bg-card);border:1px solid ${bc};border-radius:${v.radius};padding:${v.pad};cursor:pointer;width:${v.width}px;height:${v.height}px;flex-shrink:0;transition:border-color 0.2s;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;"
         onmouseover="this.style.borderColor='var(--accent)'"
         onmouseout="this.style.borderColor='${bc}'"
         onclick="if(!window._wasDragged)window.location.hash='/server/${server.id}'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${v.nameMb};">
        <div style="display:flex;align-items:center;gap:5px;overflow:hidden;flex:1;">
          <div class="si ${status}"></div>
          <span style="font-size:${v.nameSize};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${server.name}</span>
        </div>
        <span style="font-size:${v.projSize};color:var(--text-muted);flex-shrink:0;margin-left:4px;">${server.project}</span>
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
 * 자동 슬라이딩 (핑퐁: 끝까지 → 2초 대기 → 처음으로 → 2초 대기 → 반복)
 * @param {number} maxScroll — 최대 스크롤 거리(px)
 */
let slideMaxScroll = 0;
let slideDirection = 1; // 1: 오른쪽으로, -1: 왼쪽으로
let slidePauseUntil = 0;
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
      if (now < slidePauseUntil) {
        // 대기 중
      } else {
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
  if ((cpu && cpu >= thresholds.cpu.critical) || (memory && memory >= thresholds.memory.critical) || (disk && disk >= thresholds.disk.critical)) return 'critical';
  if ((cpu && cpu >= thresholds.cpu.warning) || (memory && memory >= thresholds.memory.warning) || (disk && disk >= thresholds.disk.warning)) return 'warning';
  return 'healthy';
}

function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => updateServerGrid(), 10000);
}

/**
 * Slack 알림 전송
 */
async function sendAlertToBackend(serverId, serverName, status) {
  try {
    const res = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, serverName, status })
    });
    const data = await res.json();
    console.log(`[Slack API] ${serverName}(${status}):`, res.status, data);
  } catch (e) {
    console.error('[Slack API] 요청 실패:', e);
  }
}

/**
 * 헤더 상태 필터 토글 (app.js에서 호출)
 */
export function setOverviewStatusFilter(status) {
  currentStatusFilter = currentStatusFilter === status ? 'all' : status;
  document.querySelectorAll('.header-stat').forEach(s => {
    s.classList.toggle('active', s.dataset.status === currentStatusFilter);
  });
  renderServerGrid();
}

/**
 * 정리
 */
export function cleanupOverview() {
  if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
  stopSliding();

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

  if (window._overviewResizeHandler) {
    window.removeEventListener('resize', window._overviewResizeHandler);
    window._overviewResizeHandler = null;
  }
}
