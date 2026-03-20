# Simplatform Monitoring

실시간 인프라 모니터링 대시보드

**Live**: https://infra.deok.kr

---

## 주요 기능

- **NODES** — 서버 리소스 실시간 모니터링 (CPU/MEM/DISK + Sparkline)
- **INCIDENTS** — 장애/알림 이력 관리
- **LOGS** — Loki 기반 실시간 로그 뷰어
- **Settings** — 서버 CRUD, SSL 도메인, 임계치, 설치 매뉴얼

## 기술 스택

Frontend: Vanilla JS (ES6 Modules), Chart.js, Canvas Sparkline
Backend: Python Flask
Monitoring: Prometheus, Node Exporter, Push Agent, Loki
Alerting: Slack, 브라우저 알림, 토스트
Design: Obsidian Sentinel (Inter + Space Grotesk)

## 모니터링 방식

| 방식 | 설명 |
|------|------|
| **Pull** | Prometheus → Node Exporter (9100 포트 접근 가능) |
| **Push** | 에이전트 → Flask API (방화벽 차단 환경) |

## 환경변수 (api/.env)

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL=채널ID
PUSH_API_KEY=마스터키
LOKI_URL=http://K8S_IP:31100
LOKI_ORG_ID=1
```

## 배포

```bash
# 자동 배포 (cron 1분 주기)
* * * * * cd /app/infra && git fetch origin 2>/dev/null && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && git pull origin main && systemctl restart infra-api >> /app/infra/deploy.log 2>&1
```

설치 매뉴얼은 Settings → 설치 매뉴얼 탭에서 확인

---

[@wlsejrdyd](https://github.com/wlsejrdyd)
