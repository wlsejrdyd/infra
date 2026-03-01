# Infra Monitoring Dashboard - 서비스 흐름도

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        모니터링 서버 (Rocky Linux 9)                  │
│                         infra.deok.kr                                │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────────┐  │
│  │  Nginx   │───→│  Frontend    │    │  Prometheus (9090)        │  │
│  │  (:80)   │    │  (SPA)       │    │  ┌─────────────────────┐  │  │
│  │          │───→│              │───→│  │ scrape targets      │  │  │
│  │          │    └──────────────┘    │  │ - node_exporter     │  │  │
│  │          │                        │  │ - kube-state-metrics│  │  │
│  │          │───→┌──────────────┐    │  │ - minio-metrics     │  │  │
│  │          │    │  Flask API   │    │  │ - longhorn-metrics  │  │  │
│  │          │    │  (:5000)     │    │  └─────────────────────┘  │  │
│  └──────────┘    └──────┬───────┘    └───────────────────────────┘  │
│                         │                                           │
│                         │            ┌───────────────────────────┐  │
│                         └───────────→│  Grafana (:3000)          │  │
│                                      │  (상세 분석용)              │  │
│                                      └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │                    │
         │ scrape             │ Slack API
         ▼                    ▼
┌─────────────────┐   ┌──────────────┐
│  대상 서버들      │   │  Slack       │
│  (Node Exporter) │   │  (#channel)  │
└─────────────────┘   └──────────────┘
```

## 2. 요청 흐름 (사용자 → 데이터)

```
사용자 (브라우저)
  │
  │ HTTPS (infra.deok.kr)
  ▼
┌──────────────────────────────────────────────────┐
│ Nginx (:80)                                      │
│                                                  │
│  /                  → 정적 파일 서빙 (index.html) │
│  /assets/*          → 정적 파일 (CSS, JS, JSON)  │
│  /api/*             → Flask API (127.0.0.1:5000) │
│  /prometheus/*      → Prometheus (localhost:9090) │
│  /grafana/*         → Grafana (localhost:3000)    │
└──────────────────────────────────────────────────┘
```

## 3. 메트릭 수집 흐름

```
┌────────────────────────────────────────────────────────────────────┐
│                    Prometheus (10초 주기 scrape)                     │
└────────────────────┬───────────────────────────────────────────────┘
                     │
      ┌──────────────┼──────────────┬──────────────┬────────────────┐
      ▼              ▼              ▼              ▼                ▼
 Node Exporter  kube-state-    MinIO Exporter  Longhorn        Prometheus
 (:9100)        metrics        (:9000)         Manager         self-monitor
                (:30047)                       (:9500)
      │              │              │              │
      ▼              ▼              ▼              ▼
 CPU, Memory    Pod status     Bucket size    Node storage
 Disk, Network  Container      Cluster        Volume list
 Load Average   resources      capacity       Replica count
 Filesystem     Deployment
```

## 4. 프론트엔드 데이터 흐름

```
┌──────────────────────────────────────────────────────┐
│ Frontend (SPA)                                       │
│                                                      │
│  app.js (초기화)                                      │
│    │                                                 │
│    ├── router.js (해시 라우팅)                         │
│    │     ├── #/overview  → overview.js                │
│    │     ├── #/server/:id → detail.js                │
│    │     └── #/admin     → admin.js                  │
│    │                                                 │
│    └── config.js (설정)                               │
│                                                      │
│  api.js (데이터 계층)                                  │
│    │                                                 │
│    ├── fetchCpuUsage()      ──→ /prometheus/api/v1/  │
│    ├── fetchMemoryUsage()   ──→ /prometheus/api/v1/  │
│    ├── fetchDiskUsage()     ──→ /prometheus/api/v1/  │
│    ├── fetchNetworkTraffic()──→ /prometheus/api/v1/  │
│    ├── fetchLoadAverage()   ──→ /prometheus/api/v1/  │
│    ├── fetchKubePods()      ──→ /prometheus/api/v1/  │
│    ├── fetchMinioMetrics()  ──→ /prometheus/api/v1/  │
│    ├── fetchLonghornMetrics()─→ /prometheus/api/v1/  │
│    └── fetchUpStatus()      ──→ /prometheus/api/v1/  │
│                                                      │
│  overview.js                                         │
│    ├── 10초마다 전체 서버 메트릭 갱신                     │
│    ├── 상태 판정 (임계치 비교)                           │
│    ├── 상태 변화 감지 → 알림 트리거                      │
│    └── 카드 렌더링 (pinned / scroll 분리)              │
└──────────────────────────────────────────────────────┘
```

## 5. 알림 흐름

```
overview.js (상태 변화 감지)
  │
  ├── 1. 경고음 재생 (Web Audio API, 880Hz × 2회)
  │
  ├── 2. 브라우저 알림 (Notification API)
  │
  ├── 3. 토스트 표시 (5초 자동 소멸)
  │
  └── 4. POST /api/alert
           │
           ▼
      Flask API (server.py)
           │
           ├── alert_config.json 확인 (비활성화 시 skip)
           │
           ├── alert_state.json 확인 (중복 발송 차단)
           │
           ├── [warning/critical/offline]
           │     └── Slack chat.postMessage → 채널 메시지
           │           └── ts 저장 (alert_state.json)
           │
           └── [healthy 복구]
                 └── Slack chat.postMessage (thread_ts)
                       └── 이전 알림 스레드에 복구 댓글
                             └── alert_state에서 삭제
```

## 6. 서버 관리 흐름

```
admin.js (관리 페이지)
  │
  ├── GET /api/servers → servers.json 로드
  │
  ├── 서버 추가/수정/삭제 (UI)
  │
  └── POST /api/servers → servers.json 저장
        │
        └── overview.js 다음 갱신 주기에 반영
```

## 7. 상태 판정 로직

```
메트릭 값 수집 (10초마다)
  │
  ├── up == 0 ?
  │     └── YES → offline
  │
  ├── CPU/MEM/DISK 중 하나라도 critical 초과?
  │     └── YES → critical
  │
  ├── CPU/MEM/DISK 중 하나라도 warning 초과?
  │     └── YES → warning
  │
  └── 모두 정상
        └── healthy

※ 임계치 기본값:
  CPU    — warning: 70%, critical: 80%
  Memory — warning: 70%, critical: 80%
  Disk   — warning: 80%, critical: 90%
※ 서버별 개별 임계치 오버라이드 가능 (admin에서 설정)
```

## 8. 배포 구성

```
모니터링 서버 (Rocky Linux 9)
  │
  ├── systemd: nginx.service
  │     └── /etc/nginx/conf.d/infra.conf
  │           ├── root /app/infra/       (정적 파일)
  │           ├── proxy_pass :5000       (Flask API)
  │           ├── proxy_pass :9090       (Prometheus)
  │           └── proxy_pass :3000       (Grafana)
  │
  ├── systemd: prometheus.service
  │     └── /etc/prometheus/prometheus.yml (scrape 설정)
  │
  ├── gunicorn (프로덕션) 또는 python server.py (개발)
  │     └── /app/infra/api/server.py
  │
  └── systemd: grafana-server.service (선택)
```
