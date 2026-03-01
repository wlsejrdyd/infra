# Infra Monitoring Dashboard - 필요 서버 스펙

## 1. 모니터링 서버 (infra.deok.kr)

대시보드 + Prometheus + Grafana를 호스팅하는 메인 서버.

### 최소 사양

| 항목 | 스펙 | 비고 |
|------|------|------|
| OS | Rocky Linux 9 / Ubuntu 22+ | 현재 Rocky 9 사용 |
| CPU | 2 vCPU | Prometheus scrape + Flask API |
| Memory | 4 GB | Prometheus TSDB 메모리 상주 |
| Disk | 50 GB SSD | Prometheus 데이터 15일 보존 기준 |
| Network | 100 Mbps | 대상 서버와 내부 통신 |

### 권장 사양 (대상 서버 20대 이상)

| 항목 | 스펙 | 비고 |
|------|------|------|
| CPU | 4 vCPU | Prometheus 쿼리 + Grafana 동시 사용 |
| Memory | 8 GB | Prometheus 메트릭 캐시 충분 확보 |
| Disk | 100 GB SSD | Prometheus 30일 보존, Grafana 플러그인 |
| Network | 1 Gbps | 다수 서버 scrape 트래픽 |

### 디스크 용량 산정 (실측 기반)

> **실측 환경:** 10대 서버 + kube-state-metrics 2개, retention 15일, WAL 압축(snappy)
> **데이터 경로:** `/var/lib/prometheus/`
> **측정일:** 2026-02-26

```
실측: 15일 풀 적재 시 ~3.3 GB (일일 ~220 MB)

시리즈 구성:
- 전체: 48,999개
- kube-state-metrics: 27,139개 (55%)
- node_exporter: 21,106개 (43%)

용량 추정 (실측 기반):
- K8s 포함 10대: 일일 ~220MB → 15일 ~3.3GB → 30일 ~6.6GB
- node_exporter만 10대: 일일 ~100MB → 15일 ~1.5GB → 30일 ~3GB
- 50대 (K8s 포함): 15일 ~16GB → 30일 ~33GB
```

### 필요 포트

| 포트 | 서비스 | 방향 | 비고 |
|------|--------|------|------|
| 80 | Nginx | Inbound | 웹 서비스 |
| 443 | Nginx (TLS) | Inbound | HTTPS (선택) |
| 5000 | Flask API | Loopback | 내부 전용 (Nginx 프록시) |
| 9090 | Prometheus | Loopback | 내부 전용 (Nginx 프록시) |
| 3000 | Grafana | Loopback | 내부 전용 (Nginx 프록시) |
| 9100 | Node Exporter | Loopback | 자기 자신 모니터링 |

---

## 2. 대상 서버 (모니터링 에이전트)

모니터링 대상이 되는 각 서버에 필요한 사항.

### 필수 설치: Node Exporter

| 항목 | 스펙 |
|------|------|
| CPU 오버헤드 | < 1% (무시 가능) |
| Memory 오버헤드 | ~15 MB RSS |
| Disk | ~20 MB (바이너리) |
| 포트 | 9100/tcp (Inbound, Prometheus에서 접근) |

### 선택 설치 (K8s 클러스터인 경우)

| 컴포넌트 | 포트 | 오버헤드 | 용도 |
|-----------|------|----------|------|
| kube-state-metrics | 30047 (NodePort) | CPU < 1%, MEM ~50MB | Pod/Deployment 상태 |
| MinIO Exporter | 9000 | 내장 (추가 비용 없음) | 오브젝트 스토리지 메트릭 |
| Longhorn Manager | 9500 | 내장 (추가 비용 없음) | 분산 스토리지 메트릭 |

### 방화벽 요구사항

```
대상 서버 → 모니터링 서버: 불필요 (pull 방식)
모니터링 서버 → 대상 서버:
  - 9100/tcp (Node Exporter) — 필수
  - 30047/tcp (kube-state-metrics) — K8s 클러스터 시
  - 9000/tcp (MinIO) — MinIO 운영 시
  - 9500/tcp (Longhorn) — Longhorn 운영 시
```

---

## 3. 네트워크 요구사항

### 내부 통신

```
모니터링 서버 ──(10초 주기)──→ 대상 서버 Node Exporter (:9100)
모니터링 서버 ──(10초 주기)──→ K8s NodePort (:30047, :9000, :9500)
```

- 대역폭: scrape 1회당 ~50KB/타겟, 10대 기준 초당 ~50KB 미만
- 레이턴시: 동일 네트워크 내 < 1ms 권장

### 외부 통신

| 대상 | 용도 | 필수 여부 |
|------|------|-----------|
| `slack.com/api/*` | Slack 알림 발송 | Slack 사용 시 필수 |
| `cdnjs.cloudflare.com` | Chart.js CDN | 최초 로드 시 (캐시됨) |

---

## 4. 프로젝트별 서버 현황 (현재)

| 프로젝트 | 서버 수 | 서버 목록 | 비고 |
|----------|---------|-----------|------|
| 메인서버 | 1 | deok (Rocky, localhost) | 모니터링 서버 겸용 |
| TEST | 4 | jdy-ubuntu-24, jdy-master-node-01~03 | dev K3s 클러스터 |
| TEST | 1 | jdy-download | 패키지 다운로드용 |
| DATALAKE | 4 | DataLake-PoC-DB-01, DataLake-PoC-01~03 | DataLake PoC |
| **합계** | **10** | | |

---

## 5. 확장 시 고려사항

| 규모 | 모니터링 서버 스펙 | Prometheus 설정 |
|------|-------------------|-----------------|
| ~10대 | 2 CPU / 4GB / 50GB | 기본 설정 |
| 10~30대 | 4 CPU / 8GB / 50GB | `--storage.tsdb.retention.time=30d` |
| 30~100대 | 8 CPU / 16GB / 100GB SSD | Federation 또는 Thanos 검토 |
| 100대+ | 전용 Prometheus 클러스터 | Thanos / Victoria Metrics 권장 |

### 스케일링 병목 지점

1. **Prometheus TSDB**: 서버 수 × 메트릭 수에 비례하여 메모리/디스크 증가
2. **브라우저 렌더링**: 서버 50대 이상 시 overview 페이지 DOM 노드 증가 → 페이지네이션 검토
3. **Slack API Rate Limit**: 동시 다수 서버 장애 시 알림 큐잉 필요 (현재 threading lock으로 직렬 처리)
