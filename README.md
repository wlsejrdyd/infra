# Simplatform Monitoring (Obsidian Sentinel)

실시간 인프라 모니터링 대시보드. 다수의 서버 메트릭을 단일 화면에서 통합 모니터링합니다.

**Live**: https://infra.deok.kr

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6 Modules) |
| Design System | Obsidian Sentinel (Inter + Space Grotesk, Dark Theme) |
| Charts | Chart.js 3.9.1 (CDN), Canvas Sparkline |
| Backend API | Python Flask, Flask-CORS, PyYAML |
| Monitoring | Prometheus, Node Exporter, kube-state-metrics, Push Agent |
| Log Viewer | Loki + Promtail (K8s) |
| SSL Check | Python ssl/socket (TLS 핸드셰이크) |
| Alerting | 경고음(Web Audio), 브라우저 알림, 토스트, Slack Web API |
| Web Server | Nginx (리버스 프록시 + 정적 파일 서빙) |
| 배포 | cron 기반 자동 배포 (git pull + restart) |

---

## 프로젝트 구조

```
infra/
├── index.html                    # SPA 진입점
├── api/
│   ├── server.py                 # Flask API (서버 CRUD, Slack, SSL, Push, Loki 프록시, Prometheus 동기화)
│   ├── .env                      # 환경변수 (git 미추적)
│   ├── alert_state.json          # 알림 상태 추적 (런타임)
│   ├── alert_config.json         # 알림 ON/OFF (런타임)
│   └── push_metrics.json         # Push 메트릭 (런타임, git 미추적)
├── agent/
│   ├── push_agent.py             # Push 모니터링 에이전트
│   └── agent_config.json         # 에이전트 설정 템플릿
├── assets/
│   ├── css/
│   │   ├── variables.css         # Obsidian 테마, CSS 변수, 애니메이션
│   │   ├── layout.css            # 탭 네비, 상단바, 하단바, 그리드
│   │   └── components.css        # 카드, 버튼, 모달, 토스트, 폼
│   ├── js/
│   │   ├── app.js                # 앱 초기화, 탭 라우팅, 상단/하단바, 알림 드롭다운
│   │   ├── api.js                # 통합 메트릭 fetch (Pull/Push, SSL, K8s, MinIO, Longhorn)
│   │   ├── config.js             # 전역 설정 (Prometheus/Loki URL, 갱신주기)
│   │   ├── router.js             # 해시 기반 SPA 라우터
│   │   └── pages/
│   │       ├── overview.js       # NODES: 서버 카드 그리드 (sparkline, 슬라이딩)
│   │       ├── detail.js         # 서버 상세 모달 (차트, 프로세스, 스토리지)
│   │       ├── incidents.js      # INCIDENTS: 알림 이력 (active/resolved)
│   │       ├── logs.js           # LOGS: Loki 실시간 로그 뷰어
│   │       └── admin.js          # Settings: 서버/도메인/매뉴얼 탭
│   └── data/
│       ├── servers.json          # 서버 목록, 임계치 설정
│       └── ssl_domains.json      # SSL 도메인 설정
└── docs/
    └── preview.png               # UI 프리뷰
```

---

## 화면 구성

### NODES (메인 대시보드)
- 서버 카드 그리드: CPU/MEM/DISK + Sparkline 그래프
- Pinned 섹션 (critical/warning 고정) + Scroll 섹션 (자동 슬라이딩)
- 상태별 카드 스타일 (healthy=green, warning=orange gradient, critical=red glow, offline=grayscale)
- 프로젝트 셀렉트 필터, SSL 상태 바
- 카드 클릭 → 서버 상세 모달

### 서버 상세 (모달)
- CPU/MEM/DISK 프로그레스바 + Uptime/Load
- Network Traffic, Disk I/O
- CPU/Memory 1시간 히스토리 차트
- Top Processes / K8s Pod 리소스 / System Info
- 전체 파일시스템 디스크 사용량
- MinIO/Longhorn 스토리지 (Pull 전용)

### INCIDENTS (알림 이력)
- Active Incidents / Resolved Today / System Stability 요약
- ALL / ACTIVE / RESOLVED 필터
- LOGS 버튼 → 해당 서버 로그 검색, VIEW → 상세 모달

### LOGS (실시간 로그 뷰어)
- Loki 기반 터미널 스타일 로그 뷰어
- Namespace / Container / 시간 범위 / 로그 레벨 필터 (즉시 적용)
- Regex 검색, 자동 스크롤, 로그 내보내기
- 하단 통계: Errors / Warnings / Info / Total Lines

### Settings (관리)
- **서버 관리 탭**: 전역 임계치 + 서버 CRUD + 서버별 개별 임계치
- **SSL 도메인 탭**: 도메인 CRUD + 만료 임계치
- **설치 매뉴얼 탭**: Node Exporter, Kube-State-Metrics, Push Agent, Loki 연동 가이드

---

## 모니터링 방식

| 방식 | 설명 | 사용 환경 |
|------|------|-----------|
| **Pull** (기본) | Prometheus → Node Exporter 스크래핑 | 9100 포트 접근 가능 |
| **Push** | 에이전트가 메트릭을 API로 전송 | 방화벽으로 포트 접근 불가 |

---

## 알림 시스템

| 채널 | 동작 |
|------|------|
| 경고음 (Web Audio) | 880Hz 비프 2회 |
| 브라우저 알림 | 데스크톱 팝업 |
| 토스트 | 좌하단 5초 자동 소멸 |
| Slack | 채널 메시지 + 리소스 수치, 복구 시 스레드 댓글 |
| 알림 벨 드롭다운 | 최근 알림 목록 + Slack ON/OFF 토글 |

---

## 데이터 소스

| 데이터 | 소스 | 갱신 주기 |
|--------|------|----------|
| 시스템 메트릭 (Pull) | Prometheus > Node Exporter | 10초 |
| 시스템 메트릭 (Push) | Push Agent > Flask API | 30초 |
| K8s 상태 | Prometheus > kube-state-metrics / Push Agent | 10~30초 |
| MinIO / Longhorn | Prometheus | 10초 |
| SSL 인증서 | TLS 핸드셰이크 | 60초 |
| 로그 | Loki (Promtail 수집) | 10초 |

---

## 임계치

| 메트릭 | Warning | Critical |
|--------|---------|----------|
| CPU | 70% | 80% |
| Memory | 70% | 80% |
| Disk | 80% | 90% |
| K8s CPU Request | 80% | 90% |
| K8s MEM Request | 80% | 90% |

> 서버별 개별 임계치 설정 가능 (Admin → 서버 수정 → 서버별 임계치 사용 체크)

---

## 환경변수 (.env)

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL=C0AE871L3F0
PUSH_API_KEY=마스터_폴백_키
LOKI_URL=http://192.168.0.26:31100
LOKI_ORG_ID=1
DEPLOY_SECRET=webhook_secret (선택)
```

---

## 자동 배포

```bash
# crontab -e
* * * * * cd /app/infra && git fetch origin 2>/dev/null && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && git pull origin main && systemctl restart infra-api >> /app/infra/deploy.log 2>&1
```

---

## Prometheus 자동 동기화

서버 추가/삭제/수정 시 `prometheus.yml`의 targets를 자동 업데이트하고 Prometheus를 핫리로드합니다.

- Pull 모드 서버 → `node` job에 자동 추가/제거
- `--web.enable-lifecycle` 플래그 필요
- PyYAML 필요 (`pip install pyyaml`)

---

## Author

- GitHub: [@wlsejrdyd](https://github.com/wlsejrdyd)
- Email: wlsejrdyd@gmail.com
