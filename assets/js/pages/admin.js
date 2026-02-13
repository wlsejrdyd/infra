// assets/js/pages/admin.js
import { fetchServersData, saveServersData } from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let serversData = { servers: [], defaultThresholds: {} };
let editingServer = null;

// 디버깅용 전역 노출
window._debugServersData = () => serversData;

export async function renderAdmin() {
  serversData = await fetchServersData();
  
  console.log('Admin page loaded, serversData:', serversData); // 디버그
  
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
          <span class="card-title">📦 새 서버 추가 시 필요한 설치 명령어 (root 로 실행)</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="installCmd" style="flex: 1; padding: 12px; background: var(--bg-primary); border-radius: 8px; font-family: monospace; font-size: 0.85rem; overflow-x: auto; white-space: nowrap;">
            curl -sSL https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz | tar xz && mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/ && useradd -rs /bin/false node_exporter && tee /etc/systemd/system/node_exporter.service > /dev/null << 'SERVICE'
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
systemctl daemon-reload && systemctl enable node_exporter && systemctl start node_exporter
	  </code>
          <button class="btn btn-primary" id="copyInstallBtn">
            📋 복사
          </button>
        </div>
      </div>

      <!-- Kube-State-Metrics Install Command -->
      <div class="card" style="margin-bottom: 1.5rem; background: var(--bg-secondary);">
        <div class="card-header">
          <span class="card-title">☸️ Kubernetes 모니터링 추가 시 설치 명령어 (K8s 클러스터에서 실행)</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="k8sInstallCmd" style="flex: 1; padding: 12px; background: var(--bg-primary); border-radius: 8px; font-family: monospace; font-size: 0.85rem; overflow-x: auto; white-space: nowrap;">kubectl apply -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role-binding.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/deployment.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service.yaml -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service-account.yaml && kubectl patch svc kube-state-metrics -n kube-system -p '{"spec":{"type":"NodePort","ports":[{"port":8080,"targetPort":"http-metrics","nodePort":30047}]}}'</code>
          <button class="btn btn-primary" id="copyK8sInstallBtn">
            📋 복사
          </button>
        </div>
        <div style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted);">
          설치 후 Prometheus 설정에 추가: <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 4px;">- job_name: 'kube-state-metrics'</code> → <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 4px;">targets: ['서버IP:30047']</code>
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
    </div>

    <div id="serverModal" style="display: none;"></div>
  `;

  // 이벤트 리스너 등록 (onclick 대신 addEventListener 사용)
  document.getElementById('addServerBtn').addEventListener('click', showAddServerModal);
  document.getElementById('copyInstallBtn').addEventListener('click', () => copyCmd('installCmd'));
  document.getElementById('copyK8sInstallBtn').addEventListener('click', () => copyCmd('k8sInstallCmd'));
  document.getElementById('saveThresholdsBtn').addEventListener('click', async () => {
    console.log('Save button clicked'); // 디버그
    await saveThresholds();
  });
  
  // 서버 수정/삭제 버튼에 이벤트 등록
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => showEditServerModal(btn.dataset.serverId));
  });
  
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteServer(btn.dataset.serverId));
  });
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
  return serversData.servers.map(server => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 12px; font-size: 1.5rem;">${server.icon}</td>
      <td style="padding: 12px;">
        <div style="font-weight: 600;">${server.name}</div>
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
    </tr>
  `).join('');
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
          <label class="form-label">인스턴스 (IP:Port)</label>
          <input type="text" class="form-input" id="serverInstance" value="${server.instance}" 
                 placeholder="예: 10.0.1.10:9100">
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
}

async function saveServer() {
  const serverData = {
    id: document.getElementById('serverId').value.trim(),
    name: document.getElementById('serverName').value.trim(),
    project: document.getElementById('serverProject').value.trim(),
    instance: document.getElementById('serverInstance').value.trim(),
    icon: document.getElementById('serverIcon').value.trim(),
    description: document.getElementById('serverDescription').value.trim()
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

export function cleanupAdmin() {
  // 정리 작업
}
