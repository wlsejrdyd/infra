// assets/js/pages/admin.js
import { fetchServersData, saveServersData, fetchSslDomains, saveSslDomains } from '/assets/js/api.js';
import { router } from '/assets/js/router.js';

let serversData = { servers: [], defaultThresholds: {} };
let sslData = { sslThresholds: { warning: 30, critical: 7 }, domains: [] };
let editingServer = null;
let editingSslDomain = null;

// 디버깅용 전역 노출
window._debugServersData = () => serversData;

let currentAdminTab = 'servers';

export async function renderAdmin() {
  [serversData, sslData] = await Promise.all([fetchServersData(), fetchSslDomains()]);

  const main = document.getElementById('app');
  main.innerHTML = `
    <div class="page-content" style="max-width:1400px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
        <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.4rem;font-weight:700;">Settings</h2>
        <button class="btn" onclick="window.location.hash='/overview'" style="font-size:0.78rem;">← 돌아가기</button>
      </div>

      <!-- 탭 -->
      <div style="display:flex;gap:2px;border-bottom:1px solid #1E2736;margin-bottom:1.25rem;">
        <button class="admin-tab active" data-tab="servers">서버 관리</button>
        <button class="admin-tab" data-tab="domains">SSL 도메인</button>
        <button class="admin-tab" data-tab="guide">설치 매뉴얼</button>
      </div>

      <!-- 탭 콘텐츠 -->
      <div id="adminTabContent"></div>

      <div id="serverModal" style="display:none;"></div>
      <div id="sslModal" style="display:none;"></div>
    </div>
  `;

  // 탭 전환
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAdminTab = btn.dataset.tab;
      renderAdminTab();
    });
  });

  renderAdminTab();
}

function renderAdminTab() {
  const container = document.getElementById('adminTabContent');
  if (!container) return;

  if (currentAdminTab === 'servers') renderServersTab(container);
  else if (currentAdminTab === 'domains') renderDomainsTab(container);
  else if (currentAdminTab === 'guide') renderGuideTab(container);
}

function renderServersTab(container) {
  container.innerHTML = `
    <!-- 전역 임계치 -->
    <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;margin-bottom:1.25rem;">
      <div style="font-size:0.7rem;font-weight:600;color:#6B7A90;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.75rem;">전역 임계치 (기본값)</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
        ${['cpu', 'memory', 'disk'].map(type => {
          const label = type === 'cpu' ? 'CPU' : type === 'memory' ? 'Memory' : 'Disk';
          return `<div>
            <div style="font-size:0.68rem;color:#A9ABB3;margin-bottom:4px;">${label} (W/C)</div>
            <div style="display:flex;gap:4px;">
              <input type="number" class="form-input" id="${type}Warning" value="${serversData.defaultThresholds[type].warning}" style="padding:5px 8px;font-size:0.78rem;">
              <input type="number" class="form-input" id="${type}Critical" value="${serversData.defaultThresholds[type].critical}" style="padding:5px 8px;font-size:0.78rem;">
            </div>
          </div>`;
        }).join('')}
        ${['cpuRequest', 'memoryRequest'].map(type => {
          const label = type === 'cpuRequest' ? 'K8s CPU Req' : 'K8s MEM Req';
          return `<div>
            <div style="font-size:0.68rem;color:#A9ABB3;margin-bottom:4px;">${label} (W/C)</div>
            <div style="display:flex;gap:4px;">
              <input type="number" class="form-input" id="${type}Warning" value="${(serversData.defaultThresholds[type] || {warning:80}).warning}" style="padding:5px 8px;font-size:0.78rem;">
              <input type="number" class="form-input" id="${type}Critical" value="${(serversData.defaultThresholds[type] || {critical:90}).critical}" style="padding:5px 8px;font-size:0.78rem;">
            </div>
          </div>`;
        }).join('')}
      </div>
      <button class="btn btn-primary" id="saveThresholdsBtn" style="margin-top:0.75rem;font-size:0.75rem;">임계치 저장</button>
    </div>

    <!-- 서버 목록 -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
      <span style="font-size:0.8rem;font-weight:600;color:#A9ABB3;">서버 목록 (${serversData.servers.length}대)</span>
      <button class="btn btn-primary" id="addServerBtn" style="font-size:0.75rem;">+ 서버 추가</button>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th>아이콘</th><th>이름</th><th>프로젝트</th><th>인스턴스</th><th>임계치</th><th style="text-align:right;">액션</th>
        </tr></thead>
        <tbody id="serverTableBody">${renderServerTable()}</tbody>
      </table>
    </div>
  `;

  document.getElementById('addServerBtn').addEventListener('click', showAddServerModal);
  document.getElementById('saveThresholdsBtn').addEventListener('click', () => saveThresholds());
  document.getElementById('serverTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') showEditServerModal(btn.dataset.serverId);
    if (btn.dataset.action === 'delete') deleteServer(btn.dataset.serverId);
  });
}

function renderDomainsTab(container) {
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
      <div style="display:flex;gap:8px;align-items:center;">
        <span style="font-size:0.8rem;font-weight:600;color:#A9ABB3;">SSL 인증서 도메인</span>
        <span style="font-size:0.7rem;color:#6B7A90;">만료 임계치(일):</span>
        <input type="number" class="form-input" id="sslWarningDays" value="${sslData.sslThresholds.warning}" style="width:60px;padding:4px 8px;font-size:0.78rem;">
        <input type="number" class="form-input" id="sslCriticalDays" value="${sslData.sslThresholds.critical}" style="width:60px;padding:4px 8px;font-size:0.78rem;">
        <button class="btn" id="saveSslThresholdsBtn" style="font-size:0.72rem;">저장</button>
      </div>
      <button class="btn btn-primary" id="addSslDomainBtn" style="font-size:0.75rem;">+ 도메인 추가</button>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th>도메인</th><th>포트</th><th>설명</th><th style="text-align:center;">활성</th><th style="text-align:right;">액션</th>
        </tr></thead>
        <tbody id="sslDomainTableBody">${renderSslDomainTable()}</tbody>
      </table>
    </div>
  `;

  document.getElementById('addSslDomainBtn').addEventListener('click', showAddSslDomainModal);
  document.getElementById('saveSslThresholdsBtn').addEventListener('click', () => saveSslThresholds());
  document.getElementById('sslDomainTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-ssl') showEditSslDomainModal(btn.dataset.sslId);
    if (btn.dataset.action === 'delete-ssl') deleteSslDomain(btn.dataset.sslId);
  });
}

function renderGuideTab(container) {
  container.innerHTML = `
    <!-- Pull 모드: Node Exporter -->
    <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;margin-bottom:1rem;">
      <div style="font-size:0.75rem;font-weight:600;color:#A9ABB3;text-transform:uppercase;margin-bottom:0.5rem;">Pull 모드: Node Exporter 설치</div>
      <div style="font-size:0.78rem;color:#6B7A90;margin-bottom:0.75rem;">Prometheus가 직접 메트릭을 수집하는 방식. 대상 서버에서 9100 포트 접근이 가능해야 합니다.</div>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">Step 1. Node Exporter 설치 + systemd 등록 (원커맨드)</div>
      <code id="installCmd" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">curl -sSL https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz | tar xz && sudo mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/ && rm -rf node_exporter-1.7.0.linux-amd64 && sudo useradd -rs /bin/false node_exporter 2>/dev/null; sudo tee /etc/systemd/system/node_exporter.service > /dev/null << 'EOF'
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
EOF
sudo systemctl daemon-reload && sudo systemctl enable node_exporter && sudo systemctl start node_exporter && sudo systemctl status node_exporter</code>
      <button class="btn" id="copyInstallBtn" style="font-size:0.7rem;margin-bottom:0.5rem;">복사</button>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">Step 2. Settings에서 서버 등록</div>
      <div style="padding:0.5rem;background:#0B0E14;border-radius:3px;font-size:0.72rem;color:#6B7A90;">
        Settings → 서버 관리 → <strong style="color:#10B981;">+ 서버 추가</strong> → 모니터링 방식: <strong>Pull</strong> → 인스턴스: <strong style="color:#F59E0B;">서버IP:9100</strong><br>
        저장하면 <strong style="color:#10B981;">prometheus.yml에 자동 등록</strong>되고 Prometheus가 핫리로드됩니다.
      </div>
    </div>

    <!-- Pull 모드: Kube-State-Metrics -->
    <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;margin-bottom:1rem;">
      <div style="font-size:0.75rem;font-weight:600;color:#A9ABB3;text-transform:uppercase;margin-bottom:0.5rem;">Pull 모드: Kube-State-Metrics 설치 (K8s 클러스터)</div>
      <div style="font-size:0.78rem;color:#6B7A90;margin-bottom:0.75rem;">K8s Pod 리소스(CPU/MEM Request) 모니터링. 클러스터 마스터 노드에서 실행.</div>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">설치 + NodePort 생성</div>
      <code id="k8sInstallCmd" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">kubectl apply -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role-binding.yaml \\
  -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/cluster-role.yaml \\
  -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/deployment.yaml \\
  -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service.yaml \\
  -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/master/examples/standard/service-account.yaml

kubectl apply -f - <<'EOF'
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
EOF

echo "확인: curl -s http://localhost:30047/metrics | head -5"</code>
      <button class="btn" id="copyK8sInstallBtn" style="font-size:0.7rem;">복사</button>
    </div>

    <!-- Push Agent -->
    <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;">
      <div style="font-size:0.75rem;font-weight:600;color:#A9ABB3;text-transform:uppercase;margin-bottom:0.5rem;">Push Agent 설치 (방화벽 차단 환경)</div>
      <div style="font-size:0.78rem;color:#6B7A90;margin-bottom:0.75rem;">Node Exporter 포트(9100)에 접근 불가한 서버에서 사용. 대상 서버에 SSH 접속 후 아래 명령어를 순서대로 실행.</div>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">Step 1. 에이전트 다운로드 + 설정 생성 (원커맨드)</div>
      <code id="pushStep1" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">mkdir -p ~/sim_mon_agent && cd ~/sim_mon_agent && curl -skO https://infra.deok.kr/agent/push_agent.py && cat > agent_config.json << 'CONF'
{
  "server_url": "https://infra.deok.kr/api/push/metrics",
  "server_id": "여기에_서버ID_입력",
  "api_key": "여기에_API_KEY_입력",
  "interval": 30
}
CONF
echo "=== 설정 확인 ===" && cat agent_config.json</code>
      <button class="btn" id="copyPushStep1" style="font-size:0.7rem;margin-bottom:0.75rem;">Step 1 복사</button>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">Step 2. systemd 서비스 등록 + 시작</div>
      <code id="pushStep2" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">sudo tee /etc/systemd/system/sim-mon-agent.service > /dev/null << 'EOF'
[Unit]
Description=SIM Monitoring Agent
After=network.target
[Service]
Type=simple
User=nubison
WorkingDirectory=/home/nubison/sim_mon_agent
ExecStart=/usr/bin/python3 /home/nubison/sim_mon_agent/push_agent.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable sim-mon-agent && sudo systemctl start sim-mon-agent && sudo systemctl status sim-mon-agent</code>
      <button class="btn" id="copyPushStep2" style="font-size:0.7rem;margin-bottom:0.75rem;">Step 2 복사</button>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">Step 3. 동작 확인</div>
      <code id="pushStep3" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;"># 로그 확인
journalctl -u sim-mon-agent -f --no-pager -n 20

# 에이전트 재시작 (설정 변경 후)
sudo systemctl restart sim-mon-agent

# 에이전트 중지
sudo systemctl stop sim-mon-agent</code>
      <button class="btn" id="copyPushStep3" style="font-size:0.7rem;margin-bottom:0.75rem;">Step 3 복사</button>

      <div style="font-size:0.72rem;font-weight:600;color:#10B981;margin-bottom:0.3rem;">에이전트 업데이트 (패치)</div>
      <code id="pushPatch" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">cd ~/sim_mon_agent && curl -skO https://infra.deok.kr/agent/push_agent.py && sudo systemctl restart sim-mon-agent && journalctl -u sim-mon-agent --no-pager -n 5</code>
      <button class="btn" id="copyPushPatch" style="font-size:0.7rem;margin-bottom:0.75rem;">패치 명령 복사</button>

      <div style="margin-top:0.5rem;padding:0.5rem;background:#0B0E14;border-radius:3px;font-size:0.7rem;color:#6B7A90;">
        <strong style="color:#F59E0B;">참고:</strong> server_id와 api_key는 Settings → 서버 관리 → Push 모드로 서버 등록 시 자동 생성됩니다.
      </div>
    </div>

    <!-- Loki 로그 연동 -->
    <div style="background:#151a24;border:1px solid #1E2736;border-radius:3px;padding:1rem;margin-top:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <span style="font-size:0.75rem;font-weight:600;color:#A9ABB3;text-transform:uppercase;">Loki 로그 연동 (LOGS 탭)</span>
      </div>
      <div style="font-size:0.78rem;color:#6B7A90;margin-bottom:0.75rem;">K8s 클러스터의 Loki + Promtail에서 수집한 로그를 LOGS 탭에서 조회합니다.</div>

      <div style="font-size:0.72rem;font-weight:600;color:#A9ABB3;margin-bottom:0.3rem;">1. Loki Gateway NodePort 생성</div>
      <code id="lokiNpCmd" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: loki-gateway-np
  namespace: monitoring
spec:
  type: NodePort
  selector:
    app.kubernetes.io/component: gateway
    app.kubernetes.io/instance: loki
    app.kubernetes.io/name: loki
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 31100
EOF</code>

      <div style="font-size:0.72rem;font-weight:600;color:#A9ABB3;margin-bottom:0.3rem;">2. Promtail tenant ID 확인</div>
      <code style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">kubectl get secret -n monitoring promtail -o jsonpath='{.data.promtail\\.yaml}' | base64 -d | grep tenant_id</code>

      <div style="font-size:0.72rem;font-weight:600;color:#A9ABB3;margin-bottom:0.3rem;">3. infra 서버 api/.env 설정</div>
      <code id="lokiEnvCmd" style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">LOKI_URL=http://K8S_NODE_IP:31100
LOKI_ORG_ID=1</code>

      <div style="font-size:0.72rem;font-weight:600;color:#A9ABB3;margin-bottom:0.3rem;">4. 연결 테스트</div>
      <code style="display:block;padding:8px;background:#0B0E14;border-radius:3px;font-size:0.72rem;margin-bottom:0.5rem;white-space:pre-wrap;font-family:monospace;">curl -s -H "X-Scope-OrgID: 1" "http://K8S_NODE_IP:31100/loki/api/v1/label/namespace/values"
# {"status":"success","data":["database","default","monitoring",...]} 이 나오면 성공</code>

      <div style="font-size:0.72rem;color:#6B7A90;margin-top:0.5rem;">설정 후 Flask 재시작 → LOGS 탭에서 실시간 로그 조회 가능</div>
      <button class="btn" id="copyLokiNpBtn" style="font-size:0.7rem;margin-top:0.5rem;">NodePort 명령 복사</button>
    </div>
  `;

  document.getElementById('copyInstallBtn')?.addEventListener('click', () => copyCmd('installCmd'));
  document.getElementById('copyK8sInstallBtn')?.addEventListener('click', () => copyCmd('k8sInstallCmd'));
  document.getElementById('copyPushStep1')?.addEventListener('click', () => copyCmd('pushStep1'));
  document.getElementById('copyPushStep2')?.addEventListener('click', () => copyCmd('pushStep2'));
  document.getElementById('copyPushStep3')?.addEventListener('click', () => copyCmd('pushStep3'));
  document.getElementById('copyPushPatch')?.addEventListener('click', () => copyCmd('pushPatch'));
  document.getElementById('copyLokiNpBtn')?.addEventListener('click', () => copyCmd('lokiNpCmd'));
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
      ? '<span style="font-size:0.6rem;font-weight:700;padding:2px 5px;border-radius:2px;background:rgba(16,185,129,0.15);color:#10B981;margin-left:4px;">PUSH</span>'
      : '';
    const thLabel = server.thresholds ? '<span style="font-size:0.6rem;color:#10B981;">개별</span>' : '<span style="font-size:0.6rem;color:#6B7A90;">기본</span>';
    return `
    <tr>
      <td style="font-size:1.3rem;">${server.icon}</td>
      <td>
        <div style="font-weight:600;font-size:0.82rem;">${server.name}${modeBadge}</div>
        <div style="font-size:0.68rem;color:#6B7A90;">${server.id}</div>
      </td>
      <td><span class="badge info">${server.project}</span></td>
      <td style="font-family:monospace;font-size:0.78rem;">${server.instance}</td>
      <td>${thLabel}</td>
      <td style="text-align:right;">
        <button class="btn" data-action="edit" data-server-id="${server.id}" style="font-size:0.72rem;padding:3px 8px;margin-right:4px;">수정</button>
        <button class="btn btn-danger" data-action="delete" data-server-id="${server.id}" style="font-size:0.72rem;padding:3px 8px;">삭제</button>
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
                 list="projectList" placeholder="예: SALM, Infrastructure" autocomplete="off">
          <datalist id="projectList">
            ${[...new Set(serversData.servers.map(s => s.project).filter(Boolean))].map(p => `<option value="${p}">`).join('')}
          </datalist>
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

        <div class="form-group" id="pushApiKeyGroup" style="display: ${mode === 'push' ? 'block' : 'none'};">
          <label class="form-label">Push API Key</label>
          <div style="display: flex; gap: 6px;">
            <input type="text" class="form-input" id="pushApiKey" value="${server.pushApiKey || ''}"
                   readonly style="flex: 1; font-family: monospace; font-size: 0.85rem;">
            <button type="button" class="btn" id="copyApiKeyBtn" title="복사" style="padding: 0.4rem 0.7rem;">📋</button>
            <button type="button" class="btn" id="regenApiKeyBtn" title="재생성" style="padding: 0.4rem 0.7rem;">🔄</button>
          </div>
          <small style="color: var(--text-secondary); margin-top: 4px; display: block;">
            Push Agent의 agent_config.json &gt; api_key에 이 값을 설정하세요.
          </small>
        </div>

        <!-- 서버별 임계치 (개별 설정, 비어있으면 기본값 사용) -->
        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem;">
            <input type="checkbox" id="useCustomThresholds" ${server.thresholds ? 'checked' : ''}>
            <label for="useCustomThresholds" style="font-size:0.8rem;font-weight:600;color:var(--text-muted);cursor:pointer;">서버별 임계치 사용 (체크 해제 시 기본값 적용)</label>
          </div>
          <div id="customThresholdsSection" style="display:${server.thresholds ? 'block' : 'none'};">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
              ${['cpu', 'memory', 'disk'].map(type => {
                const th = server.thresholds || serversData.defaultThresholds;
                const label = type === 'cpu' ? 'CPU' : type === 'memory' ? 'Memory' : 'Disk';
                return `<div>
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">${label}</div>
                  <div style="display:flex;gap:4px;">
                    <input type="number" class="form-input" id="srv_${type}_warn" value="${th[type]?.warning || ''}" placeholder="경고" style="padding:6px 8px;font-size:0.8rem;">
                    <input type="number" class="form-input" id="srv_${type}_crit" value="${th[type]?.critical || ''}" placeholder="위험" style="padding:6px 8px;font-size:0.8rem;">
                  </div>
                </div>`;
              }).join('')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
              ${['cpuRequest', 'memoryRequest'].map(type => {
                const th = server.thresholds || serversData.defaultThresholds;
                const label = type === 'cpuRequest' ? 'K8s CPU Req' : 'K8s MEM Req';
                return `<div>
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">${label}</div>
                  <div style="display:flex;gap:4px;">
                    <input type="number" class="form-input" id="srv_${type}_warn" value="${(th[type] || {}).warning || ''}" placeholder="경고" style="padding:6px 8px;font-size:0.8rem;">
                    <input type="number" class="form-input" id="srv_${type}_crit" value="${(th[type] || {}).critical || ''}" placeholder="위험" style="padding:6px 8px;font-size:0.8rem;">
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
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

  // Push API Key: 신규 push 서버이고 키가 없으면 자동 생성
  if (mode === 'push' && !server.pushApiKey) {
    document.getElementById('pushApiKey').value = _generateApiKey();
  }

  // 복사 버튼
  document.getElementById('copyApiKeyBtn').addEventListener('click', () => {
    const key = document.getElementById('pushApiKey').value;
    navigator.clipboard.writeText(key).then(() => alert('API Key가 복사되었습니다.'));
  });

  // 재생성 버튼
  document.getElementById('regenApiKeyBtn').addEventListener('click', () => {
    if (confirm('API Key를 재생성하면 기존 에이전트의 키도 변경해야 합니다. 계속하시겠습니까?')) {
      document.getElementById('pushApiKey').value = _generateApiKey();
    }
  });

  // 서버별 임계치 토글
  document.getElementById('useCustomThresholds').addEventListener('change', (e) => {
    document.getElementById('customThresholdsSection').style.display = e.target.checked ? 'block' : 'none';
  });

  // mode 셀렉트 변경 시 라벨/플레이스홀더 + API Key 필드 토글
  document.getElementById('serverMode').addEventListener('change', (e) => {
    const isPush = e.target.value === 'push';
    const label = document.getElementById('instanceLabel');
    const input = document.getElementById('serverInstance');
    if (label) label.textContent = isPush ? '서버 식별자' : '인스턴스 (IP:Port)';
    if (input) input.placeholder = isPush ? '예: external-web-01' : '예: 10.0.1.10:9100';

    const keyGroup = document.getElementById('pushApiKeyGroup');
    keyGroup.style.display = isPush ? 'block' : 'none';
    if (isPush && !document.getElementById('pushApiKey').value) {
      document.getElementById('pushApiKey').value = _generateApiKey();
    }
  });
}

function _generateApiKey() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
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

  // push 모드일 때만 pushApiKey 저장
  if (mode === 'push') {
    serverData.pushApiKey = document.getElementById('pushApiKey').value.trim();
  }

  // 서버별 임계치
  if (document.getElementById('useCustomThresholds').checked) {
    serverData.thresholds = {};
    ['cpu', 'memory', 'disk'].forEach(type => {
      const w = parseInt(document.getElementById(`srv_${type}_warn`).value);
      const c = parseInt(document.getElementById(`srv_${type}_crit`).value);
      if (!isNaN(w) && !isNaN(c)) serverData.thresholds[type] = { warning: w, critical: c };
    });
    ['cpuRequest', 'memoryRequest'].forEach(type => {
      const w = parseInt(document.getElementById(`srv_${type}_warn`).value);
      const c = parseInt(document.getElementById(`srv_${type}_crit`).value);
      if (!isNaN(w) && !isNaN(c)) serverData.thresholds[type] = { warning: w, critical: c };
    });
    // 빈 객체면 제거
    if (Object.keys(serverData.thresholds).length === 0) delete serverData.thresholds;
  } else {
    delete serverData.thresholds;
  }

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
  
  const cpuReqWarn = parseInt(document.getElementById('cpuRequestWarning').value);
  const cpuReqCrit = parseInt(document.getElementById('cpuRequestCritical').value);
  const memReqWarn = parseInt(document.getElementById('memRequestWarning').value);
  const memReqCrit = parseInt(document.getElementById('memRequestCritical').value);

  serversData.defaultThresholds = {
    cpu: { warning: cpuWarn, critical: cpuCrit },
    memory: { warning: memWarn, critical: memCrit },
    disk: { warning: diskWarn, critical: diskCrit },
    cpuRequest: { warning: cpuReqWarn, critical: cpuReqCrit },
    memoryRequest: { warning: memReqWarn, critical: memReqCrit }
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
