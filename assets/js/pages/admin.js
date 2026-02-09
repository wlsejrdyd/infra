// assets/js/pages/admin.js
import { fetchServersData, saveServersData } from '../api.js';
import { router } from '../router.js';

let serversData = { servers: [], defaultThresholds: {} };
let editingServer = null;

/**
 * Admin 페이지 렌더링
 */
export async function renderAdmin() {
  serversData = await fetchServersData();
  
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
        <button class="btn btn-primary" onclick="window.showAddServerModal()">
          ➕ 서버 추가
        </button>
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
        <button class="btn btn-primary" onclick="window.saveThresholds()" style="margin-top: 1rem;">
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

    <!-- Add/Edit Server Modal -->
    <div id="serverModal" style="display: none;"></div>
  `;

  // 전역 함수 등록
  window.showAddServerModal = showAddServerModal;
  window.showEditServerModal = showEditServerModal;
  window.deleteServer = deleteServer;
  window.saveThresholds = saveThresholds;
  window.closeModal = closeModal;
  window.saveServer = saveServer;
}

/**
 * 서버 테이블 렌더링
 */
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
        <button class="btn" onclick="window.showEditServerModal('${server.id}')" style="margin-right: 4px;">
          ✏️ 수정
        </button>
        <button class="btn btn-danger" onclick="window.deleteServer('${server.id}')">
          🗑️ 삭제
        </button>
      </td>
    </tr>
  `).join('');
}

/**
 * 서버 추가 모달
 */
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

/**
 * 서버 수정 모달
 */
function showEditServerModal(serverId) {
  editingServer = serversData.servers.find(s => s.id === serverId);
  if (editingServer) {
    showServerModal(editingServer);
  }
}

/**
 * 서버 모달 표시
 */
function showServerModal(server) {
  const modal = document.getElementById('serverModal');
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target === this) window.closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${editingServer ? '서버 수정' : '서버 추가'}</h2>
          <button class="modal-close" onclick="window.closeModal()">✕</button>
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
          <button class="btn" onclick="window.closeModal()" style="flex: 1;">취소</button>
          <button class="btn btn-primary" onclick="window.saveServer()" style="flex: 1;">
            ${editingServer ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 서버 저장
 */
function saveServer() {
  const serverData = {
    id: document.getElementById('serverId').value.trim(),
    name: document.getElementById('serverName').value.trim(),
    project: document.getElementById('serverProject').value.trim(),
    instance: document.getElementById('serverInstance').value.trim(),
    icon: document.getElementById('serverIcon').value.trim(),
    description: document.getElementById('serverDescription').value.trim()
  };

  // 유효성 검사
  if (!serverData.id || !serverData.name || !serverData.project || !serverData.instance) {
    alert('모든 필수 항목을 입력해주세요.');
    return;
  }

  if (editingServer) {
    // 수정
    const index = serversData.servers.findIndex(s => s.id === editingServer.id);
    serversData.servers[index] = { ...editingServer, ...serverData };
  } else {
    // 추가 - ID 중복 체크
    if (serversData.servers.find(s => s.id === serverData.id)) {
      alert('이미 존재하는 서버 ID입니다.');
      return;
    }
    serversData.servers.push(serverData);
  }

  // 저장
  saveServersData(serversData);
  closeModal();
  
  // 테이블 업데이트
  document.getElementById('serverTableBody').innerHTML = renderServerTable();
  
  alert('서버가 저장되었습니다.');
}

/**
 * 서버 삭제
 */
function deleteServer(serverId) {
  if (!confirm('정말 이 서버를 삭제하시겠습니까?')) return;

  serversData.servers = serversData.servers.filter(s => s.id !== serverId);
  saveServersData(serversData);
  
  // 테이블 업데이트
  document.getElementById('serverTableBody').innerHTML = renderServerTable();
  
  alert('서버가 삭제되었습니다.');
}

/**
 * 임계치 저장
 */
function saveThresholds() {
  serversData.defaultThresholds = {
    cpu: {
      warning: parseInt(document.getElementById('cpuWarning').value),
      critical: parseInt(document.getElementById('cpuCritical').value)
    },
    memory: {
      warning: parseInt(document.getElementById('memWarning').value),
      critical: parseInt(document.getElementById('memCritical').value)
    },
    disk: {
      warning: parseInt(document.getElementById('diskWarning').value),
      critical: parseInt(document.getElementById('diskCritical').value)
    }
  };

  saveServersData(serversData);
  alert('임계치가 저장되었습니다.');
}

/**
 * 모달 닫기
 */
function closeModal() {
  document.getElementById('serverModal').style.display = 'none';
}

/**
 * 정리
 */
export function cleanupAdmin() {
  // 전역 함수 제거
  delete window.showAddServerModal;
  delete window.showEditServerModal;
  delete window.deleteServer;
  delete window.saveThresholds;
  delete window.closeModal;
  delete window.saveServer;
}
