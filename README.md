# INFRA - Infrastructure Monitoring Dashboard

실시간 인프라 모니터링 대시보드. 다수의 서버 메트릭을 단일 화면에서 통합 모니터링합니다.

**Live**: https://infra.deok.kr

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6 Modules) |
| Charts | Chart.js 3.9.1 (CDN) |
| Backend API | Python Flask, Flask-CORS |
| Monitoring | Prometheus, Node Exporter, kube-state-metrics, Push Agent |
| SSL Check | Python ssl/socket (TLS 핸드셰이크 기반 인증서 만료 체크) |
| Alerting | 경고음(Web Audio), 브라우저 알림, 토스트, Slack Web API |
| Web Server | Nginx (리버스 프록시 + 정적 파일 서빙) |
| OS | Rocky Linux 9 |

---

## 프로젝트 구조

```
infra/
├── index.html                    # SPA 진입점
├── api/
│   ├── server.py                 # Flask API (서버 CRUD, Slack 알림, SSL 체크, Push 수신)
│   ├── .env                      # 환경변수 (SLACK_BOT_TOKEN, PUSH_API_KEY 등, git 미추적)
│   ├── alert_state.json          # 서버별 알림 상태 추적 (런타임 생성)
│   ├── alert_config.json         # 알림 ON/OFF 설정 (런타임 생성)
│   └── push_metrics.json         # Push 에이전트 메트릭 저장 (런타임 생성, git 미추적)
├── agent/
│   ├── push_agent.py             # Push 모니터링 에이전트 (대상 서버에 배포)
│   └── agent_config.json         # 에이전트 설정 템플릿
├── assets/
│   ├── css/
│   │   ├── variables.css         # CSS 변수, 다크 테마, 색상 정의
│   │   ├── layout.css            # 헤더, 툴바, 그리드, 스크롤 섹션 레이아웃
│   │   └── components.css        # 카드, 버튼, 모달, 상태 표시기 등
│   ├── js/
│   │   ├── app.js                # 앱 초기화, 헤더(인라인 상태 카운터), 라우터
│   │   ├── api.js                # 통합 메트릭 fetch (Pull/Push 자동 분기, SSL, K8s, MinIO, Longhorn)
│   │   ├── config.js             # 전역 설정 (URL, 갱신주기, GitHub 연동, 서비스 목록)
│   │   ├── router.js             # 해시 기반 SPA 라우터
│   │   └── pages/
│   │       ├── overview.js       # 서버 목록 (pinned+scroll, 뷰모드, 슬라이딩, SSL 상태 바)
│   │       ├── detail.js         # 서버 상세 (차트, 전체 디스크, MinIO/Longhorn, Push 메트릭)
│   │       └── admin.js          # 서버 관리 (추가/수정/삭제, 모드 선택, SSL 도메인 관리)
│   └── data/
│       ├── servers.json          # 서버 목록 및 임계치 설정
│       └── ssl_domains.json      # SSL 인증서 도메인 설정
├── docs/
│   └── preview.png               # UI 프리뷰 이미지
└── preview-design.html           # 디자인 프리뷰 (개발용, 배포 불필요)
```

---

## 주요 기능

### Overview (메인 화면)
- 헤더에 인라인 상태 카운터 (정상/경고/위험/오프라인)
- 툴바: 프로젝트 필터 + 뷰 모드 토글 (3열/5열)
- **Pinned 섹션**: critical/warning 서버 고정 표시
- **Scroll 섹션**: healthy/offline 서버 멀티행 자동 좌우 슬라이딩 (hover 시 정지)
- **SSL 상태 바**: 등록된 도메인의 인증서 잔여일 표시 (색상 코딩: 초록>30일, 노랑7~30일, 빨강<7일)
- 화면 높이에 맞게 행 수 자동 계산
- 상태별 자동 정렬: critical > warning > healthy > offline
- 헤더 상태 클릭 시 상태별 필터링 (토글)
- Pull/Push 모드 서버 통합 표시 (자동 분기)

### 서버 상세
- CPU/Memory 히스토리 차트 (Pull: Prometheus 1시간, Push: 에이전트 히스토리)
- 네트워크 트래픽(In/Out), 디스크 I/O, Load Average
- 전체 파일시스템 디스크 사용량 (ext4/xfs/btrfs/vfat/nfs/nfs4)
- MinIO 클러스터 용량 + 버킷별 사용량 (메트릭 존재 시 자동 표시, Pull 전용)
- Longhorn 노드별 스토리지 + 볼륨 목록 (메트릭 존재 시 자동 표시, Pull 전용)
- Kubernetes Pod 리소스 (Pull: kube-state-metrics, Push: kubectl 기반)
- Top 프로세스 (Pull: process-exporter, Push: /proc 기반)

### 모니터링 방식

| 방식 | 설명 | 사용 환경 |
|------|------|-----------|
| **Pull** (기본) | Prometheus → Node Exporter 스크래핑 | 9100 포트 접근 가능 |
| **Push** | 에이전트가 메트릭을 API로 전송 | 방화벽으로 포트 접근 불가 |

Push 에이전트 수집 항목: CPU, Memory, Disk, Uptime, Load Average, Network Traffic, Disk I/O, 전체 파일시스템, Top 10 프로세스, K8s Pod 리소스 (kubectl 사용 가능 시)

### SSL 인증서 만료 체크
- TLS 핸드셰이크 기반 인증서 만료일 조회
- 도메인별 잔여일 실시간 표시 (Overview SSL 상태 바)
- 임계치 초과 시 Slack 알림 연동
- Admin 페이지에서 도메인 CRUD + 임계치 설정

### 오프라인 감지
- **Pull 모드**: Prometheus `up` 메트릭으로 즉시 감지
- **Push 모드**: 90초 이상 메트릭 미수신 시 오프라인 판정

### 알림 시스템
상태 변화(warning/critical/offline/복구) 시 다중 채널로 알림 발송:

| 알림 채널 | 동작 | 설정 |
|-----------|------|------|
| 경고음 (Web Audio API) | 880Hz 비프 2회 재생 | 항상 활성 |
| 브라우저 알림 (Notification API) | 데스크톱 알림 팝업 | 브라우저 권한 필요 |
| 토스트 알림 | 페이지 내 우측 상단 토스트 (5초 자동 소멸) | 항상 활성 |
| Slack | 채널 메시지 + 리소스 상세 (CPU/MEM/DISK %) | 토글 ON/OFF, Bot Token 필요 |

- warning/critical 진입: Slack 채널에 메시지 전송 (중복 발송 차단, 리소스 수치 포함)
- healthy 복구: 이전 알림 스레드에 댓글로 복구 알림
- SSL 만료 임박: 상태 변화 시 Slack 알림
- `alert_state.json`으로 서버별 알림 상태 추적
- `alert_config.json`으로 Slack 알림 전체 ON/OFF 토글 (`/api/alert/config`)

### GitHub 연동
- 헤더에 연결된 GitHub 리포지토리 커밋 활동 표시 (infra, salm, mgmt)

### 서버 관리
- 관리 페이지에서 서버 추가/수정/삭제
- 모니터링 방식 선택 (Pull / Push)
- Node Exporter 인스턴스 등록, 프로젝트 분류, 개별 임계치 설정
- Node Exporter / kube-state-metrics 설치 가이드 및 Prometheus 설정 예시 제공
- SSL 도메인 관리 (추가/수정/삭제, 임계치 설정)
- Push Agent 설치 가이드 (systemd 서비스 등록)

---

## 데이터 소스

| 데이터 | 소스 | 갱신 주기 |
|--------|------|----------|
| 시스템 메트릭 (Pull) | Prometheus > Node Exporter | 10초 |
| 시스템 메트릭 (Push) | Push Agent > Flask API | 30초 (설정 가능) |
| 서비스 상태 | Prometheus `up` / Push staleness | 10초 |
| Kubernetes 상태 (Pull) | Prometheus > kube-state-metrics | 10초 |
| Kubernetes 상태 (Push) | Push Agent > kubectl | 30초 |
| MinIO 스토리지 | Prometheus > MinIO Exporter | 10초 (메트릭 존재 시) |
| Longhorn 스토리지 | Prometheus > Longhorn Exporter | 10초 (메트릭 존재 시) |
| SSL 인증서 | TLS 핸드셰이크 (Python ssl) | 60초 |

---

## 포트 맵

| 포트 | 서비스 | 프로토콜 | 비고 |
|------|--------|----------|------|
| 80 | Nginx | TCP | 웹 서버 (정적 파일 + 리버스 프록시) |
| 5000 | Flask API | TCP | 서버 CRUD, Slack 알림 (내부) |
| 9090 | Prometheus | TCP | 메트릭 수집/쿼리 |
| 9100 | Node Exporter | TCP | 서버별 시스템 메트릭 |
| 3000 | Grafana | TCP | 대시보드 (선택) |
| 9981 | MariaDB | TCP | 데이터베이스 (모니터링 대상) |
| 30047 | kube-state-metrics | NodePort | K8s 오브젝트 상태 메트릭 |
| 9000 | MinIO | TCP | 오브젝트 스토리지 + 메트릭 (`/minio/v2/metrics/cluster`) |
| 9500 | Longhorn Manager | TCP | 분산 스토리지 메트릭 |

> MinIO/Longhorn이 K8s 내부에서 실행 중이면 NodePort 서비스를 생성하여 Prometheus가 외부에서 scrape할 수 있도록 포트를 열어야 합니다.

---

## 임계치 기본값

| 메트릭 | Warning | Critical |
|--------|---------|----------|
| CPU | 70% | 80% |
| Memory | 70% | 80% |
| Disk | 80% | 90% |

---

## 실행 방법

### Frontend

Nginx 또는 정적 파일 서버로 프로젝트 루트를 서빙합니다. 빌드 과정 없이 바로 동작합니다.

```bash
# 로컬 개발 시
python -m http.server 8080
```

> Prometheus, Grafana 프록시 등 실제 데이터 연동은 Nginx 설정이 필요합니다.

### Backend API

```bash
cd api
pip install flask flask-cors requests
python server.py
```

개발 모드로 `localhost:5000`에서 실행됩니다. 프로덕션에서는 gunicorn을 사용합니다.

---

## Push Agent 설정

방화벽으로 Node Exporter 포트(9100)에 접근할 수 없는 서버에서 사용합니다.

### 1. 서버 등록

Admin 페이지에서 모니터링 방식을 **Push**로 선택하여 서버를 추가합니다.

### 2. API 키 설정

모니터링 서버의 `api/.env`에 Push API 키를 추가합니다:

```env
PUSH_API_KEY=원하는_키_값
```

> Flask 재시작 필요.

### 3. 에이전트 배포

대상 서버에 에이전트 파일을 복사하고 설정합니다:

```bash
scp agent/push_agent.py agent/agent_config.json user@TARGET_SERVER:~/push_agent/
```

`agent_config.json` 수정:

```json
{
  "server_url": "https://infra.deok.kr/api/push/metrics",
  "server_id": "admin에서 등록한 서버 ID",
  "api_key": "api/.env에 설정한 PUSH_API_KEY",
  "interval": 30
}
```

### 4. systemd 서비스 등록

```bash
cat > /etc/systemd/system/push-agent.service << 'EOF'
[Unit]
Description=Infra Push Monitoring Agent
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/user/push_agent/push_agent.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable push-agent && systemctl start push-agent
```

### 5. 확인

```bash
# 에이전트 로그
journalctl -u push-agent -f

# API 직접 테스트
curl https://infra.deok.kr/api/push/metrics/서버ID
```

---

## SSL 인증서 모니터링 설정

### 1. 도메인 등록

Admin 페이지의 **SSL 인증서 도메인 관리** 섹션에서 모니터링할 도메인을 추가합니다.

### 2. 임계치 설정

| 상태 | 기본값 | 설명 |
|------|--------|------|
| Warning | 30일 | 인증서 만료까지 30일 이하 |
| Critical | 7일 | 인증서 만료까지 7일 이하 |

### 3. 확인

```bash
# 단건 체크
curl "https://infra.deok.kr/api/ssl/check?domain=example.com&port=443"

# 전체 도메인 체크
curl "https://infra.deok.kr/api/ssl/check-all"
```

Overview 페이지의 툴바 아래에 SSL 상태 바가 표시됩니다.

---

## Slack 알림 설정

### 1. Slack App 생성

1. https://api.slack.com/apps > Create New App > From scratch
2. OAuth & Permissions > Bot Token Scopes에 `chat:write`, `chat:write.public` 추가
3. Install App > Bot User OAuth Token 복사 (`xoxb-...`)

### 2. 환경변수 설정

`api/.env` 파일 생성:

```env
SLACK_BOT_TOKEN=xoxb-여기에-토큰-값
SLACK_CHANNEL=C091Z6DBT16
PUSH_API_KEY=push-에이전트-인증-키
```

> `.env` 파일은 `.gitignore`에 포함되어 git에 추적되지 않습니다.
> server.py가 시작 시 자동으로 `api/.env`를 로드합니다 (python-dotenv 불필요).

### 3. 동작 흐름

```
서버 정상 → warning/critical 진입
  → Slack 채널에 메시지 전송 (ts 저장, 중복 차단)

서버 warning/critical → healthy 복구
  → 이전 메시지 스레드에 복구 댓글
  → alert_state에서 해당 서버 삭제
```

### 4. 테스트

```bash
# 경고 알림 테스트
curl -X POST http://localhost:5000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"serverId":"test-01","serverName":"테스트서버","status":"warning"}'

# 복구 알림 테스트 (이전 경고의 스레드에 댓글)
curl -X POST http://localhost:5000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"serverId":"test-01","serverName":"테스트서버","status":"healthy"}'
```

---

## Nginx 설정 (참고)

```nginx
# Flask API 프록시
location /api/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# Prometheus 프록시
location /prometheus/ {
    proxy_pass http://localhost:9090/;
}

# Grafana 프록시
location /grafana/ {
    proxy_pass http://localhost:3000/;
}
```

---

## Author

- GitHub: [@wlsejrdyd](https://github.com/wlsejrdyd)
- Email: wlsejrdyd@gmail.com
