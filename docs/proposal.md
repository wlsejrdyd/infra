# Infra Monitoring Dashboard - 기획안

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | Infrastructure Monitoring Dashboard |
| URL | https://infra.deok.kr |
| 목적 | 다수 프로젝트의 온프레미스 서버를 단일 화면에서 실시간 통합 모니터링 |
| 개발 방식 | 자체 개발 (오픈소스 스택 기반) |
| 현재 상태 | 운영 중 (v1) |

## 2. 배경 및 필요성

- 고객 프로젝트(DataLake, SNStech, Neobiotek 등)별로 서버가 분산되어 있음
- Grafana만으로는 **전체 서버 상태를 한눈에** 파악하기 어려움
- 장애 발생 시 **즉각 인지 → Slack 알림** 자동화 필요
- 프로젝트별 서버 그룹핑, 임계치 커스터마이징 요구

## 3. 대상 사용자

| 사용자 | 용도 |
|--------|------|
| 인프라 엔지니어 | 전체 서버 상태 실시간 모니터링, 장애 대응 |
| 프로젝트 담당자 | 담당 프로젝트 서버 상태 확인 |
| 경영진 | 인프라 운영 현황 대시보드 열람 |

## 4. 핵심 기능

### 4-1. 메인 Overview
- 전체 서버 상태 카운터 (정상/경고/위험/오프라인)
- 프로젝트별 필터링
- 이상 서버 상단 고정 (Pinned), 정상 서버 자동 슬라이딩
- 3열/5열 뷰 모드 전환

### 4-2. 서버 상세
- CPU/Memory 1시간 히스토리 차트
- 네트워크 트래픽, 디스크 I/O, Load Average
- 전체 파일시스템 디스크 사용량
- K8s Pod 리소스 (kube-state-metrics 연동)
- MinIO/Longhorn 스토리지 현황 (해당 시 자동 표시)

### 4-3. 알림 시스템 (다채널)
- 경고음 (Web Audio API)
- 브라우저 알림 (Notification API)
- 토스트 알림 (페이지 내)
- Slack 채널 알림 (스레드 기반 복구 추적)
- 알림 ON/OFF 토글

### 4-4. 서버 관리
- 웹 UI에서 서버 추가/수정/삭제
- Node Exporter 인스턴스 등록
- 프로젝트 분류, 개별 임계치 설정

### 4-5. 외부 연동
- Prometheus 직접 링크
- Grafana 직접 링크
- GitHub 리포지토리 활동 표시

## 5. 범위

### In Scope
- 서버 시스템 메트릭 수집 및 시각화 (CPU, Memory, Disk, Network, Load)
- K8s 클러스터 Pod 상태 모니터링
- MinIO/Longhorn 스토리지 모니터링
- 다채널 알림 (경고음, 브라우저, 토스트, Slack)
- 서버 CRUD 관리 UI

### Out of Scope
- 애플리케이션 레벨 APM (Application Performance Monitoring)
- 로그 수집/분석 (Loki/ELK 영역)
- CI/CD 파이프라인 모니터링
- 사용자 인증/권한 관리 (현재 미구현)

## 6. 기술적 제약사항

| 항목 | 내용 |
|------|------|
| 빌드 도구 없음 | Vanilla JS (ES6 Modules), CDN 의존 (Chart.js) |
| SPA 라우팅 | Hash 기반 (`#/overview`, `#/server/:id`, `#/admin`) |
| 데이터 저장 | 파일 기반 (`servers.json`, `alert_state.json`) — DB 미사용 |
| 인증 | 미구현 (Nginx 레벨 IP 제한 또는 Basic Auth 권장) |
| HTTPS | Nginx 또는 상위 프록시에서 TLS 종료 |

## 7. 향후 로드맵

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| P1 | 사용자 인증 | 로그인/권한 분리 (관리자 vs 읽기전용) |
| P1 | 알림 규칙 세분화 | 서버별/메트릭별 알림 임계치 개별 설정 |
| P2 | 히스토리 대시보드 | 일간/주간 트렌드 리포트 |
| P2 | 모바일 반응형 | 모바일 레이아웃 최적화 |
| P3 | 다크/라이트 테마 전환 | 현재 다크 고정 → 토글 |
| P3 | 멀티 Prometheus | 여러 Prometheus 인스턴스 통합 |
