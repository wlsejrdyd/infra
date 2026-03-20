// assets/js/pages/logs.js — 실시간 로그 뷰어 (Loki 기반)

let refreshInterval = null;
let autoScroll = true;
let currentQuery = '{namespace="database"}';
let currentLevel = { critical: true, warning: true, info: true, debug: false };
let regexFilter = '';

export async function renderLogs() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <!-- 헤더 -->
      <div style="padding:1rem 1.5rem 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
          <div>
            <div style="font-size:0.65rem;font-weight:700;color:#10B981;text-transform:uppercase;letter-spacing:1px;">● LIVE_STREAM_ACTIVE</div>
            <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.4rem;font-weight:700;margin-top:4px;">Real-time System Logs</h2>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="filter-select" id="logNamespace" style="min-width:160px;">
              <option value='{namespace="database"}'>database</option>
              <option value='{namespace="default"}'>default</option>
              <option value='{namespace="kube-system"}'>kube-system</option>
              <option value='{namespace="argocd"}'>argocd</option>
            </select>
            <select class="filter-select" id="logContainer">
              <option value="">All Containers</option>
              <option value="pxc">pxc</option>
              <option value="proxysql">proxysql</option>
              <option value="logs">logs</option>
            </select>
            <button class="btn btn-primary" id="exportLogsBtn">Export Logs</button>
          </div>
        </div>
      </div>

      <!-- 본문: 사이드바 + 로그 -->
      <div style="display:flex;flex:1;overflow:hidden;padding:0 1.5rem 1rem;gap:1rem;">
        <!-- 좌측 컨트롤 -->
        <div style="width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:1rem;">
          <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.75rem;">Control Center</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <span style="font-size:0.8rem;">Auto-scroll</span>
              <label style="position:relative;width:36px;height:20px;cursor:pointer;">
                <input type="checkbox" id="autoScrollToggle" checked style="opacity:0;width:0;height:0;">
                <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:#1C2028;border-radius:10px;transition:0.2s;"></span>
                <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#10B981;border-radius:50%;transition:0.2s;" id="autoScrollKnob"></span>
              </label>
            </div>
            <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Time Range</div>
            <select class="filter-select" id="logTimeRange" style="width:100%;margin-bottom:1rem;">
              <option value="15">Last 15 minutes</option>
              <option value="60">Last 1 hour</option>
              <option value="360">Last 6 hours</option>
              <option value="1440">Last 24 hours</option>
            </select>
            <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Log Levels</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:1rem;">
              <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;">
                <input type="checkbox" class="log-level-cb" data-level="critical" checked style="accent-color:#EF4444;"> <span style="color:#EF4444;font-weight:600;">CRITICAL</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;">
                <input type="checkbox" class="log-level-cb" data-level="warning" checked style="accent-color:#F59E0B;"> <span style="color:#F59E0B;font-weight:600;">WARNING</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;">
                <input type="checkbox" class="log-level-cb" data-level="info" checked style="accent-color:#10B981;"> <span style="color:#10B981;font-weight:600;">INFO</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;">
                <input type="checkbox" class="log-level-cb" data-level="debug"> <span style="color:#6B7A90;font-weight:600;">DEBUG</span>
              </label>
            </div>
            <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Regex Search</div>
            <input type="text" class="form-input" id="logRegex" placeholder="^(?i)error.*" style="font-size:0.75rem;font-family:monospace;">
          </div>

          <!-- 통계 -->
          <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Ingestion Rate</div>
            <div style="font-size:1.5rem;font-weight:700;font-family:'Space Grotesk',monospace;" id="logRate">--</div>
            <div style="font-size:0.7rem;color:#6B7A90;">lines/min</div>
          </div>
        </div>

        <!-- 로그 터미널 -->
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div style="background:#0D1117;border:1px solid #1E2736;border-radius:3px 3px 0 0;padding:6px 12px;display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#EF4444;"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#F59E0B;"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#10B981;"></span>
            <span style="flex:1;text-align:center;font-size:0.7rem;color:#6B7A90;font-family:monospace;">loki — logs viewer</span>
          </div>
          <div id="logTerminal" style="flex:1;background:#0B0E14;border:1px solid #1E2736;border-top:none;border-radius:0 0 3px 3px;overflow-y:auto;padding:0.75rem;font-family:'JetBrains Mono',monospace,Consolas;font-size:0.72rem;line-height:1.6;">
            <div style="color:#6B7A90;">Connecting to Loki...</div>
          </div>
          <!-- 하단 상태바 -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 12px;background:#151a24;border:1px solid #1E2736;border-top:none;border-radius:0 0 3px 3px;font-size:0.65rem;color:#6B7A90;">
            <span>LINES: <span id="logLineCount" style="color:#10B981;">0</span></span>
            <span>ENCODING: UTF-8</span>
            <span>● <span style="color:#10B981;">CONNECTED</span></span>
          </div>
        </div>
      </div>

      <!-- 하단 통계 바 -->
      <div style="display:flex;gap:1rem;padding:0 1.5rem 1rem;">
        <div style="flex:1;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 1rem;display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.2rem;">🔴</span>
          <div><div style="font-size:0.6rem;color:#6B7A90;text-transform:uppercase;">Errors (Last Hr)</div><div id="statErrors" style="font-size:1.1rem;font-weight:700;font-family:'Space Grotesk',monospace;">--</div></div>
        </div>
        <div style="flex:1;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 1rem;display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.2rem;">⚠️</span>
          <div><div style="font-size:0.6rem;color:#6B7A90;text-transform:uppercase;">Warnings (Last Hr)</div><div id="statWarnings" style="font-size:1.1rem;font-weight:700;font-family:'Space Grotesk',monospace;">--</div></div>
        </div>
        <div style="flex:1;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 1rem;display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.2rem;">ℹ️</span>
          <div><div style="font-size:0.6rem;color:#6B7A90;text-transform:uppercase;">Info (Last Hr)</div><div id="statInfo" style="font-size:1.1rem;font-weight:700;font-family:'Space Grotesk',monospace;">--</div></div>
        </div>
        <div style="flex:1;background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:0.6rem 1rem;display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.2rem;">📊</span>
          <div><div style="font-size:0.6rem;color:#6B7A90;text-transform:uppercase;">Total Lines</div><div id="statTotal" style="font-size:1.1rem;font-weight:700;font-family:'Space Grotesk',monospace;color:#10B981;">--</div></div>
        </div>
      </div>
    </div>
  `;

  // 이벤트
  document.getElementById('autoScrollToggle').addEventListener('change', (e) => {
    autoScroll = e.target.checked;
    const knob = document.getElementById('autoScrollKnob');
    knob.style.left = autoScroll ? '2px' : '18px';
    knob.style.background = autoScroll ? '#10B981' : '#6B7A90';
  });

  document.querySelectorAll('.log-level-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      currentLevel[cb.dataset.level] = cb.checked;
    });
  });

  document.getElementById('logNamespace').addEventListener('change', (e) => {
    currentQuery = e.target.value;
    fetchLogs();
  });

  document.getElementById('logContainer').addEventListener('change', () => fetchLogs());
  document.getElementById('logTimeRange').addEventListener('change', () => fetchLogs());
  document.getElementById('logRegex').addEventListener('input', debounce(() => {
    regexFilter = document.getElementById('logRegex').value;
    fetchLogs();
  }, 500));

  document.getElementById('exportLogsBtn').addEventListener('click', exportLogs);

  // 초기 로드 + 라벨 로드
  // incidents에서 넘어온 검색어 적용
  if (window._pendingLogSearch) {
    regexFilter = window._pendingLogSearch;
    document.getElementById('logRegex').value = regexFilter;
    delete window._pendingLogSearch;
  }

  await loadNamespaces();
  await fetchLogs();
  refreshInterval = setInterval(fetchLogs, 10000);
}

async function loadNamespaces() {
  try {
    const resp = await fetch('/api/loki/label/namespace/values');
    const data = await resp.json();
    if (data.data) {
      const sel = document.getElementById('logNamespace');
      sel.innerHTML = data.data.map(ns =>
        `<option value='{namespace="${ns}"}' ${ns === 'database' ? 'selected' : ''}>${ns}</option>`
      ).join('');
    }
  } catch (e) { /* Loki 미연결 시 기본값 유지 */ }
}

async function fetchLogs() {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;

  const minutes = parseInt(document.getElementById('logTimeRange')?.value || '15');
  const now = Date.now();
  const start = (now - minutes * 60 * 1000) * 1000000; // nanoseconds
  const end = now * 1000000;

  const container = document.getElementById('logContainer')?.value;
  let query = currentQuery;
  if (container) {
    query = query.replace('}', `,container="${container}"}`);
  }
  if (regexFilter) {
    query += ` |~ \`${regexFilter}\``;
  }

  try {
    const resp = await fetch(`/api/loki/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&limit=500&direction=backward`);
    const data = await resp.json();

    if (data.data && data.data.result) {
      const lines = [];
      let errors = 0, warnings = 0, infos = 0;

      data.data.result.forEach(stream => {
        const labels = stream.stream || {};
        const source = labels.container || labels.app || labels.pod || 'unknown';

        (stream.values || []).forEach(([ts, line]) => {
          const time = new Date(parseInt(ts) / 1000000);
          const timeStr = time.toISOString().replace('T', ' ').substring(0, 23);

          // 로그 레벨 감지
          let level = 'info';
          const lower = line.toLowerCase();
          if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) { level = 'critical'; errors++; }
          else if (lower.includes('warn')) { level = 'warning'; warnings++; }
          else if (lower.includes('debug') || lower.includes('trace')) { level = 'debug'; }
          else { infos++; }

          if (!currentLevel[level]) return;

          lines.push({ time: timeStr, source, line, level, ts: parseInt(ts) });
        });
      });

      // 시간순 정렬 (오래된 것부터)
      lines.sort((a, b) => a.ts - b.ts);

      // 렌더링
      const levelColors = {
        critical: '#EF4444',
        warning: '#F59E0B',
        info: '#10B981',
        debug: '#6B7A90'
      };
      const levelLabels = {
        critical: '[ERROR]',
        warning: '[WARN]',
        info: '[INFO]',
        debug: '[DEBUG]'
      };

      terminal.innerHTML = lines.map(l => {
        const c = levelColors[l.level];
        const escaped = l.line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div style="display:flex;gap:12px;padding:1px 0;${l.level === 'critical' ? 'background:rgba(239,68,68,0.06);' : ''}">
          <span style="color:#4B5563;flex-shrink:0;white-space:nowrap;">${l.time}</span>
          <span style="color:${c};font-weight:700;flex-shrink:0;min-width:55px;">${levelLabels[l.level]}</span>
          <span style="color:#10B981;flex-shrink:0;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.source}</span>
          <span style="color:#A9ABB3;word-break:break-all;">${escaped}</span>
        </div>`;
      }).join('') || '<div style="color:#6B7A90;">No logs found for this query.</div>';

      // 통계
      const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      el('logLineCount', lines.length);
      el('statErrors', errors);
      el('statWarnings', warnings);
      el('statInfo', infos);
      el('statTotal', lines.length);
      el('logRate', Math.round(lines.length / (minutes || 1)));

      // 자동 스크롤
      if (autoScroll) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  } catch (e) {
    terminal.innerHTML = `<div style="color:#EF4444;">Loki 연결 실패: ${e.message}</div><div style="color:#6B7A90;margin-top:4px;">.env에 LOKI_URL 설정을 확인하세요.</div>`;
  }
}

function exportLogs() {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;
  const text = terminal.innerText;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function cleanupLogs() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}
