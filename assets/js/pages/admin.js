// assets/js/pages/admin.js
import { fetchServersData, saveServersData, fetchSslDomains, saveSslDomains } from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let serversData = { servers: [], defaultThresholds: {} };
let sslData = { sslThresholds: { warning: 30, critical: 7 }, domains: [] };
let editingServer = null;
let editingSslDomain = null;

// 디버깅용 전역 노출
window._debugServersData = () => serversData;

export async function renderAdmin() {
  [serversData, sslData] = await Promise.all([fetchServersData(), fetchSslDomains()]);

  const main = document.getElementById('app');
  main.innerHTML = `
    <div class="main">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <div>
          <button class="btn" onclick="window.location.hash = '/overview'">
            ← 돌아가기
          </button>
        </div>
        <h1 style="font-size: 1.8rem;">서버 관리</h1>
        <button class="btn btn-primary" id="addServerBtn">
          ➕ 서버 추가
        </button>
      </div>

      <!-- Node Exporter Install Command -->
      <div class="card" style="margin-bottom: 1.5rem; background: var(--bg-secondary);">
        <div class="card-header">
          <span class="card-title">📦 Node Exporter 설치 (서버 모니터링)</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="installCmd" style="flex: 1; padding: 12px; background: var(--bg-primary); border-radius: 8px; font-family: monospace; font-size: 0.85rem; overflow-x: auto; white-space: nowrap;">curl -sSL https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz | tar xz && mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/ && useradd -rs /bin/false node_exporter && tee /etc/systemd/system/node_exporter.service > /dev/null &lt;&lt; 'SERVICE'
[Unit]
Description=Node Exporter
After=network.target
[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter
[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload && systemctl enable node_exporter && systemctl start node_exporter</code>
          <button class="btn btn-primary" id="copyInstallBtn">
            📋 복사
          </button>
        </div>
        <div style="margin-top: 0.75rem; padding: 0.6rem 0.8rem; background: var(--bg-primary); border-radius: 6px; font-size: 0.8rem;">
          <div style="color: var(--text-muted); margin-bottom: 0.3rem;">Prometheus 설정 (prometheus.yml)</div>
          <code style="color: var(--text-primary); font-size: 0.8rem;">- job_name: 'node'</code><br>
          <code style="color: var(--text-primary); font-size: 0.8rem;">&nbsp;&nbsp;static_configs:</code><br>
          <code style="color: var(--text-primary); font-size: 0.8rem;">&nbsp;&nbsp;&nbsp;&nbsp;- targets: ['<span style="color: var(--warning);">서버IP</span>:9100']</code>
        </div>
      </div>

      <!-- Kube-State-Metrics Install Command -->
      <div class="card" style="margin-bottom: 1.5rem; background: var(--bg-secondary);">
        <div class="card-header">
          <span class="card-title">☸️ Kube-State-Metrics 설치 (K8s 모니터링)</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="k8sInstallCmd" style="flex: 1; padding: 12px; background: var(--bg-primary); border-radius: 8px; font-family: monospace; font-size: 0.85rem; overflow-x: auto; white-space: nowrap;">kubectl apply -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role-binding.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/deployment.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service-account.yaml && kubectl apply -f - &lt;&lt;EOF
apiVersion: v1
kind: Service
metadata:
  name: kube-state-metrics-nodeport
  namespace: kube-system
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: kube-state-metrics
  ports:
    - port: 8080
      targetPort: http-metrics
      nodePort: 30047
EOF</code>
          <button class="btn btn-primary" id="copyK8sInstallBtn">
            📋 복사
          </button>
        </div>
        <div style="margin-top: 0.75rem; padding: 0.6rem 0.8rem; background: var(--bg-primary); border-radius: 6px; font-size: 0.8rem;">
          <div style="color: var(--text-muted); margin-bottom: 0.3rem;">Prometheus 설정 (prometheus.yml)</div>
          <code style="color: var(--text-primary); font-size: 0.8rem;">- job_name: 'kube-state-metrics'</code><br>
          <code style="color: var(--text-primary); font-size: 0.8rem;">&nbsp;&nbsp;static_configs:</code><br>
          <code style="color: var(--text-primary); font-size: 0.8rem;">&nbsp;&nbsp;&nbsp;&nbsp;- targets: ['<span style="color: var(--warning);">서버IP</span>:30047']</code>
        </div>
      </div>

      <!-- Thresholds Settings -->
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <span class="card-title">⚙️ 임계치 설정</span>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">CPU</label>
            <div style="display: flex; gap: 8px;">
              <input type="number" class="form-input" id="cpuWarning" 
                     value="${serversData.defaultThresholds.cpu.warning}" 
                     placeholder="경고" style="flex: 1;">
              <input type="number" class="form-input" id="cpuCritical" 
                     value="${serversData.defaultThresholds.cpu.critical}" 
                     placeholder="위험" style="flex: 1;">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Memory</label>
            <div style="display: flex; gap: 8px;">
              <input type="number" class="form-input" id="memWarning" 
                     value="${serversData.defaultThresholds.memory.warning}" 
                     placeholder="경고" style="flex: 1;">
              <input type="number" class="form-input" id="memCritical" 
                     value="${serversData.defaultThresholds.memory.critical}" 
                     placeholder="위험" style="flex: 1;">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Disk</label>
            <div style="display: flex; gap: 8px;">
              <input type="number" class="form-input" id="diskWarning" 
                     value="${serversData.defaultThresholds.disk.warning}" 
                     placeholder="경고" style="flex: 1;">
              <input type="number" class="form-input" id="diskCritical" 
                     value="${serversData.defaultThresholds.disk.critical}" 
                     placeholder="위험" style="flex: 1;">
            </div>
          </div>
        </div>
        <button class="btn btn-primary" id="saveThresholdsBtn" style="margin-top: 1rem;">
          💾 임계치 저장
        </button>
      </div>

      <!-- Server List -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📋 서버 목록</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">총 ${serversData.servers.length}대</span>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border);">
                <th style="text-align: left; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">아이콘</th>
                <th style="text-align: left; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">이름</th>
                <th style="text-align: left; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">프로젝트</th>
                <th style="text-align: left; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">인스턴스</th>
                <th style="text-align: left; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">설명</th>
                <th style="text-align: right; padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">액션</th>
              </tr>
            </thead>
            <tbody id="serverTableBody">
              ${renderServerTable()}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SSL 도메인 관리 -->
      <div class="card" style="margin-top: 1.5rem;">
        <div class="card-header">
          <span class="card-title">🔒 SSL 인증서 도메인 관리</span>
          <button class="btn btn-primary" id="addSslDomainBtn">➕ 도메인 추가</button>
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 1rem; align-items: center;">
          <label style="font-size: 0.85rem; color: var(--text-muted);">만료 임계치 (일)</label>
          <input type="number" class="form-input" id="sslWarningDays" value="${sslData.sslThresholds.warning}" style="width: 80px;" placeholder="경고">
          <input type="number" class="form-input" id="sslCriticalDays" value="${sslData.sslThresholds.critical}" style="width: 80px;" placeholder="위험">
          <button class="btn" id="saveSslThresholdsBtn">💾 저장</button>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border);">
                <th style="text-align: left; padding: 10px; font-size: 0.8rem; color: var(--text-muted);">도메인</th>
                <th style="text-align: left; padding: 10px; font-size: 0.8rem; color: var(--text-muted);">포트</th>
                <th style="text-align: left; padding: 10px; font-size: 0.8rem; color: var(--text-muted);">설명</th>
                <th style="text-align: center; padding: 10px; font-size: 0.8rem; color: var(--text-muted);">활성</th>
                <th style="text-align: right; padding: 10px; font-size: 0.8rem; color: var(--text-muted);">액션</th>
              </tr>
            </thead>
            <tbody id="sslDomainTableBody">
              ${renderSslDomainTable()}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Push Agent 설치 가이드 -->
      <div class="card" style="margin-top: 1.5rem; background: var(--bg-secondary);">
        <div class="card-header">
          <span class="card-title">📡 Push Agent 설치 (방화벽 차단 환경용)</span>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Node Exporter 포트(9100)에 접근할 수 없는 서버에서 사용합니다. 에이전트가 메트릭을 수집하여 모니터링 서버로 전송합니다.
        </div>
        <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem;">1. 에이전트 파일 복사</div>
        <code id="pushAgentSetup" style="display:block;padding:10px;background:var(--bg-primary);border-radius:8px;font-size:0.8rem;margin-bottom:0.75rem;white-space:pre-wrap;">scp agent/push_agent.py agent/agent_config.json user@TARGET_SERVER:~/push_agent/</code>
        <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem;">2. agent_config.json 수정</div>
        <code style="display:block;padding:10px;background:var(--bg-primary);border-radius:8px;font-size:0.8rem;margin-bottom:0.75rem;white-space:pre-wrap;">{
  "server_url": "https://infra.deok.kr/api/push/metrics",
  "server_id": "서버ID (admin에서 등록한 ID와 일치)",
  "api_key": "YOUR_PUSH_API_KEY",
  "interval": 30
}</code>
        <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem;">3. systemd 서비스 등록</div>
        <code id="pushSystemdCmd" style="display:block;padding:10px;background:var(--bg-primary);border-radius:8px;font-size:0.8rem;margin-bottom:0.5rem;white-space:pre-wrap;">cat > /etc/systemd/system/push-agent.service << 'EOF'
[Unit]
Description=Infra Push Monitoring Agent
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/push_agent/push_agent.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable push-agent && systemctl start push-agent</code>
        <button class="btn btn-primary" id="copyPushCmdBtn" style="margin-top:0.5rem;">📋 복사</button>
      </div>
    </div>

    <div id="serverModal" style="display: none;"></div>
    <div id="sslModal" style="display: none;"></div>
  `;

  // 이벤트 리스너 등록
  document.getElementById('addServerBtn').addEventListener('click', showAddServerModal);
  document.getElementById('copyInstallBtn').addEventListener('click', () => copyCmd('installCmd'));
  document.getElementById('copyK8sInstallBtn').addEventListener('click', () => copyCmd('k8sInstallCmd'));
  document.getElementById('saveThresholdsBtn').addEventListener('click', () => saveThresholds());

  // 서버 수정/삭제
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => showEditServerModal(btn.dataset.serverId));
  });
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteServer(btn.dataset.serverId));
  });

  // SSL 도메인 관리
  document.getElementById('addSslDomainBtn').addEventListener('click', showAddSslDomainModal);
  document.getElementById('saveSslThresholdsBtn').addEventListener('click', () => saveSslThresholds());
  document.querySelectorAll('[data-action="edit-ssl"]').forEach(btn => {
    btn.addEventListener('click', () => showEditSslDomainModal(btn.dataset.sslId));
  });
  document.querySelectorAll('[data-action="delete-ssl"]').forEach(btn => {
    btn.addEventListener('click', () => deleteSslDomain(btn.dataset.sslId));
  });

  // Push 가이드 복사
  document.getElementById('copyPushCmdBtn')?.addEventListener('click', () => copyCmd('pushSystemdCmd'));
}

function copyCmd(elementId) {
  const cmd = document.getElementById(elementId).textContent.trim();
  navigator.clipboard.writeText(cmd).then(() => {
    alert('복사되었습니다!');
  }).catch(err => {
    console.error('복사 실패:', err);
    alert('복사 실패. 수동으로 복사해주세요.');
  });
}

function renderServerTable() {
  return serversData.servers.map(server => {
    const mode = server.mode || 'pull';
    const modeBadge = mode === 'push'
      ? '<span class="badge" style="background:var(--accent);color:#fff;font-size:0.65rem;margin-left:4px;">PUSH</span>'
      : '';
    return `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 12px; font-size: 1.5rem;">${server.icon}</td>
      <td style="padding: 12px;">
        <div style="font-weight: 600;">${server.name}${modeBadge}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${server.id}</div>
      </td>
      <td style="padding: 12px;">
        <span class="badge info">${server.project}</span>
      </td>
      <td style="padding: 12px; font-family: monospace; font-size: 0.85rem;">${server.instance}</td>
      <td style="padding: 12px; font-size: 0.85rem; color: var(--text-muted);">${server.description}</td>
      <td style="padding: 12px; text-align: right;">
        <button class="btn" data-action="edit" data-server-id="${server.id}" style="margin-right: 4px;">
          ✏️ 수정
        </button>
        <button class="btn btn-danger" data-action="delete" data-server-id="${server.id}">
          🗑️ 삭제
        </button>
      </td>
    </tr>`;
  }).join('');
}

function showAddServerModal() {
  editingServer = null;
  showServerModal({
    id: '',
    name: '',
    project: '',
    instance: '',
    description: '',
    icon: '🖥️'
  });
}

function showEditServerModal(serverId) {
  editingServer = serversData.servers.find(s => s.id === serverId);
  if (editingServer) {
    showServerModal(editingServer);
  }
}

function showServerModal(server) {
  const mode = server.mode || 'pull';
  const modal = document.getElementById('serverModal');
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${editingServer ? '서버 수정' : '서버 추가'}</h2>
          <button class="modal-close" id="modalCloseBtn">✕</button>
        </div>

        <div class="form-group">
          <label class="form-label">서버 ID</label>
          <input type="text" class="form-input" id="serverId" value="${server.id}"
                 placeholder="예: prod-web-01" ${editingServer ? 'disabled' : ''}>
        </div>

        <div class="form-group">
          <label class="form-label">서버 이름</label>
          <input type="text" class="form-input" id="serverName" value="${server.name}"
                 placeholder="예: Production Web Server">
        </div>

        <div class="form-group">
          <label class="form-label">프로젝트</label>
          <input type="text" class="form-input" id="serverProject" value="${server.project}"
                 placeholder="예: SALM, Infrastructure">
        </div>

        <div class="form-group">
          <label class="form-label">모니터링 방식</label>
          <select class="form-input" id="serverMode">
            <option value="pull" ${mode === 'pull' ? 'selected' : ''}>Pull (Node Exporter)</option>
            <option value="push" ${mode === 'push' ? 'selected' : ''}>Push (Agent)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" id="instanceLabel">${mode === 'push' ? '서버 식별자' : '인스턴스 (IP:Port)'}</label>
          <input type="text" class="form-input" id="serverInstance" value="${server.instance}"
                 placeholder="${mode === 'push' ? '예: external-web-01' : '예: 10.0.1.10:9100'}">
        </div>

        <div class="form-group">
          <label class="form-label">아이콘</label>
          <input type="text" class="form-input" id="serverIcon" value="${server.icon}" 
                 placeholder="예: 🖥️, 🌐, 🔥">
        </div>

        <div class="form-group">
          <label class="form-label">설명</label>
          <input type="text" class="form-input" id="serverDescription" value="${server.description}" 
                 placeholder="서버 설명">
        </div>

        <div style="display: flex; gap: 8px; margin-top: 1.5rem;">
          <button class="btn" id="modalCancelBtn" style="flex: 1;">취소</button>
          <button class="btn btn-primary" id="modalSaveBtn" style="flex: 1;">
            ${editingServer ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </div>
  `;
  
  // 모달 이벤트
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalSaveBtn').addEventListener('click', saveServer);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  // mode 셀렉트 변경 시 라벨/플레이스홀더 동적 전환
  document.getElementById('serverMode').addEventListener('change', (e) => {
    const isPush = e.target.value === 'push';
    const label = document.getElementById('instanceLabel');
    const input = document.getElementById('serverInstance');
    if (label) label.textContent = isPush ? '서버 식별자' : '인스턴스 (IP:Port)';
    if (input) input.placeholder = isPush ? '예: external-web-01' : '예: 10.0.1.10:9100';
  });
}

async function saveServer() {
  const mode = document.getElementById('serverMode').value;
  const serverData = {
    id: document.getElementById('serverId').value.trim(),
    name: document.getElementById('serverName').value.trim(),
    project: document.getElementById('serverProject').value.trim(),
    instance: document.getElementById('serverInstance').value.trim(),
    icon: document.getElementById('serverIcon').value.trim(),
    description: document.getElementById('serverDescription').value.trim(),
    mode: mode,
  };

  if (!serverData.id || !serverData.name || !serverData.project || !serverData.instance) {
    alert('모든 필수 항목을 입력해주세요.');
    return;
  }

  if (editingServer) {
    const index = serversData.servers.findIndex(s => s.id === editingServer.id);
    serversData.servers[index] = { ...editingServer, ...serverData };
  } else {
    if (serversData.servers.find(s => s.id === serverData.id)) {
      alert('이미 존재하는 서버 ID입니다.');
      return;
    }
    serversData.servers.push(serverData);
  }

  const success = await saveServersData(serversData);
  
  if (success) {
    closeModal();
    document.getElementById('serverTableBody').innerHTML = renderServerTable();
    alert('서버가 저장되었습니다.');
  }
}

async function deleteServer(serverId) {
  if (!confirm('정말 이 서버를 삭제하시겠습니까?')) return;

  serversData.servers = serversData.servers.filter(s => s.id !== serverId);
  
  const success = await saveServersData(serversData);
  
  if (success) {
    document.getElementById('serverTableBody').innerHTML = renderServerTable();
    alert('서버가 삭제되었습니다.');
  }
}

async function saveThresholds() {
  console.log('saveThresholds called'); // 디버그
  
  const cpuWarn = parseInt(document.getElementById('cpuWarning').value);
  const cpuCrit = parseInt(document.getElementById('cpuCritical').value);
  const memWarn = parseInt(document.getElementById('memWarning').value);
  const memCrit = parseInt(document.getElementById('memCritical').value);
  const diskWarn = parseInt(document.getElementById('diskWarning').value);
  const diskCrit = parseInt(document.getElementById('diskCritical').value);
  
  console.log('Threshold values:', { cpuWarn, cpuCrit, memWarn, memCrit, diskWarn, diskCrit }); // 디버그
  
  serversData.defaultThresholds = {
    cpu: { warning: cpuWarn, critical: cpuCrit },
    memory: { warning: memWarn, critical: memCrit },
    disk: { warning: diskWarn, critical: diskCrit }
  };

  console.log('Calling saveServersData...', serversData); // 디버그
  const success = await saveServersData(serversData);
  console.log('Save result:', success); // 디버그
  
  if (success) {
    alert('임계치가 저장되었습니다.');
  }
}

function closeModal() {
  document.getElementById('serverModal').style.display = 'none';
}


// ──────────────────────────────────
// SSL 도메인 관리
// ──────────────────────────────────

function renderSslDomainTable() {
  return sslData.domains.map(d => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px; font-family: monospace; font-size: 0.85rem;">${d.domain}</td>
      <td style="padding: 10px; font-size: 0.85rem;">${d.port || 443}</td>
      <td style="padding: 10px; font-size: 0.85rem; color: var(--text-muted);">${d.description || ''}</td>
      <td style="padding: 10px; text-align: center;">${d.enabled !== false ? '✅' : '⏸️'}</td>
      <td style="padding: 10px; text-align: right;">
        <button class="btn" data-action="edit-ssl" data-ssl-id="${d.id}" style="margin-right: 4px;">✏️</button>
        <button class="btn btn-danger" data-action="delete-ssl" data-ssl-id="${d.id}">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function showAddSslDomainModal() {
  editingSslDomain = null;
  showSslDomainModal({ id: '', domain: '', port: 443, description: '', enabled: true });
}

function showEditSslDomainModal(sslId) {
  editingSslDomain = sslData.domains.find(d => d.id === sslId);
  if (editingSslDomain) showSslDomainModal(editingSslDomain);
}

function showSslDomainModal(domain) {
  const modal = document.getElementById('sslModal');
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-overlay" id="sslModalOverlay">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${editingSslDomain ? 'SSL 도메인 수정' : 'SSL 도메인 추가'}</h2>
          <button class="modal-close" id="sslModalCloseBtn">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">ID</label>
          <input type="text" class="form-input" id="sslDomainId" value="${domain.id}"
                 placeholder="예: main-site" ${editingSslDomain ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">도메인</label>
          <input type="text" class="form-input" id="sslDomainName" value="${domain.domain}"
                 placeholder="예: infra.deok.kr">
        </div>
        <div class="form-group">
          <label class="form-label">포트</label>
          <input type="number" class="form-input" id="sslDomainPort" value="${domain.port || 443}" placeholder="443">
        </div>
        <div class="form-group">
          <label class="form-label">설명</label>
          <input type="text" class="form-input" id="sslDomainDesc" value="${domain.description || ''}" placeholder="설명">
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="sslDomainEnabled" ${domain.enabled !== false ? 'checked' : ''}>
          <label for="sslDomainEnabled" class="form-label" style="margin:0;">활성화</label>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 1.5rem;">
          <button class="btn" id="sslModalCancelBtn" style="flex: 1;">취소</button>
          <button class="btn btn-primary" id="sslModalSaveBtn" style="flex: 1;">
            ${editingSslDomain ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('sslModalCloseBtn').addEventListener('click', closeSslModal);
  document.getElementById('sslModalCancelBtn').addEventListener('click', closeSslModal);
  document.getElementById('sslModalSaveBtn').addEventListener('click', saveSslDomain);
  document.getElementById('sslModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'sslModalOverlay') closeSslModal();
  });
}

function closeSslModal() {
  document.getElementById('sslModal').style.display = 'none';
}

async function saveSslDomain() {
  const domainData = {
    id: document.getElementById('sslDomainId').value.trim(),
    domain: document.getElementById('sslDomainName').value.trim(),
    port: parseInt(document.getElementById('sslDomainPort').value) || 443,
    description: document.getElementById('sslDomainDesc').value.trim(),
    enabled: document.getElementById('sslDomainEnabled').checked,
  };

  if (!domainData.id || !domainData.domain) {
    alert('ID와 도메인은 필수입니다.');
    return;
  }

  if (editingSslDomain) {
    const idx = sslData.domains.findIndex(d => d.id === editingSslDomain.id);
    sslData.domains[idx] = { ...editingSslDomain, ...domainData };
  } else {
    if (sslData.domains.find(d => d.id === domainData.id)) {
      alert('이미 존재하는 도메인 ID입니다.');
      return;
    }
    sslData.domains.push(domainData);
  }

  const success = await saveSslDomains(sslData);
  if (success) {
    closeSslModal();
    refreshSslTable();
    alert('SSL 도메인이 저장되었습니다.');
  }
}

async function deleteSslDomain(sslId) {
  if (!confirm('이 SSL 도메인을 삭제하시겠습니까?')) return;
  sslData.domains = sslData.domains.filter(d => d.id !== sslId);
  const success = await saveSslDomains(sslData);
  if (success) {
    refreshSslTable();
    alert('SSL 도메인이 삭제되었습니다.');
  }
}

async function saveSslThresholds() {
  sslData.sslThresholds = {
    warning: parseInt(document.getElementById('sslWarningDays').value) || 30,
    critical: parseInt(document.getElementById('sslCriticalDays').value) || 7,
  };
  const success = await saveSslDomains(sslData);
  if (success) alert('SSL 임계치가 저장되었습니다.');
}

function refreshSslTable() {
  const tbody = document.getElementById('sslDomainTableBody');
  if (tbody) {
    tbody.innerHTML = renderSslDomainTable();
    // 이벤트 재등록
    tbody.querySelectorAll('[data-action="edit-ssl"]').forEach(btn => {
      btn.addEventListener('click', () => showEditSslDomainModal(btn.dataset.sslId));
    });
    tbody.querySelectorAll('[data-action="delete-ssl"]').forEach(btn => {
      btn.addEventListener('click', () => deleteSslDomain(btn.dataset.sslId));
    });
  }
}


export function cleanupAdmin() {
  // 정리 작업
}
