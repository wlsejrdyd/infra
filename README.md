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
| Monitoring | Prometheus, Node Exporter, kube-state-metrics |
| Alerting | 경고음(Web Audio), 브라우저 알림, 토스트, Slack Web API |
| Web Server | Nginx (리버스 프록시 + 정적 파일 서빙) |
| OS | Rocky Linux 9 |

---

## 프로젝트 구조

```
infra/
├── index.html                    # SPA 진입점
├── api/
│   ├── server.py                 # Flask API (서버 CRUD, Slack 알림)
│   └── .env                      # 환경변수 (SLACK_BOT_TOKEN 등, git 미추적)
├── assets/
│   ├── css/
│   │   ├── variables.css         # CSS 변수, 다크 테마, 색상 정의
│   │   ├── layout.css            # 헤더, 툴바, 그리드, 스크롤 섹션 레이아웃
│   │   └── components.css        # 카드, 버튼, 모달, 상태 표시기 등
│   ├── js/
│   │   ├── app.js                # 앱 초기화, 헤더(인라인 상태 카운터), 라우터
│   │   ├── api.js                # Prometheus 메트릭 fetch (CPU, MEM, Disk, K8s, MinIO, Longhorn)
│   │   ├── config.js             # 전역 설정 (URL, 갱신주기)
│   │   ├── router.js             # 해시 기반 SPA 라우터
│   │   └── pages/
│   │       ├── overview.js       # 서버 목록 (pinned+scroll, 뷰모드, 슬라이딩)
│   │       ├── detail.js         # 서버 상세 (차트, 전체 디스크, MinIO/Longhorn)
│   │       └── admin.js          # 서버 관리 (추가/수정/삭제)
│   └── data/
│       └── servers.json          # 서버 목록 및 임계치 설정
└── preview-design.html           # 디자인 프리뷰 (개발용, 배포 불필요)
```

---

## 주요 기능

### Overview (메인 화면)
- 헤더에 인라인 상태 카운터 (정상/경고/위험/오프라인)
- 툴바: 프로젝트 필터 + 뷰 모드 토글 (3열/5열)
- **Pinned 섹션**: critical/warning 서버 고정 표시
- **Scroll 섹션**: healthy/offline 서버 멀티행 자동 좌우 슬라이딩 (hover 시 정지)
- 화면 높이에 맞게 행 수 자동 계산
- 상태별 자동 정렬: critical > warning > healthy > offline
- 헤더 상태 클릭 시 상태별 필터링 (토글)

### 서버 상세
- CPU/Memory 1시간 히스토리 차트
- 네트워크 트래픽(In/Out), 디스크 I/O, Load Average
- 전체 파일시스템 디스크 사용량 (ext4/xfs/btrfs/vfat/nfs/nfs4)
- MinIO 클러스터 용량 + 버킷별 사용량 (메트릭 존재 시 자동 표시)
- Longhorn 노드별 스토리지 + 볼륨 목록 (메트릭 존재 시 자동 표시)
- Kubernetes Pod 리소스 (kube-state-metrics 연동 시, process-exporter 없을 때 fallback)

### 오프라인 감지
- Prometheus `up` 메트릭으로 즉시 감지 (CPU staleness 5분 대기 없음)

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
- `alert_state.json`으로 서버별 알림 상태 추적

### 서버 관리
- 관리 페이지에서 서버 추가/수정/삭제
- Node Exporter 인스턴스 등록, 프로젝트 분류, 개별 임계치 설정
- Node Exporter / kube-state-metrics 설치 가이드 및 Prometheus 설정 예시 제공

---

## 데이터 소스

| 데이터 | 소스 | 갱신 주기 |
|--------|------|----------|
| 시스템 메트릭 (CPU, Memory, Disk) | Prometheus > Node Exporter | 10초 |
| 서비스 상태 | Prometheus `up` 메트릭 | 10초 |
| Kubernetes 상태 | Prometheus > kube-state-metrics | 10초 |
| MinIO 스토리지 | Prometheus > MinIO Exporter | 10초 (메트릭 존재 시) |
| Longhorn 스토리지 | Prometheus > Longhorn Exporter | 10초 (메트릭 존재 시) |

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
