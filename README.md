# Infrastructure Dashboard

실시간 인프라 모니터링 대시보드 with Prometheus, Grafana, Ansible, GitHub Actions

![Dashboard Preview](docs/preview.png)

## 🌐 Live Demo

- **Dashboard**: https://project1.deok.kr
- **Prometheus**: https://project1.deok.kr/prometheus
- **Grafana**: https://project1.deok.kr/grafana

---

## 📋 Overview

역량을 보여주기 위한 통합 모니터링 시스템입니다.

### 주요 기능

| 기능 | 설명 |
|------|------|
| **실시간 메트릭** | CPU, Memory, Disk, Network 사용률 |
| **서비스 상태** | Nginx, MariaDB, Spring Boot 등 서비스 Up/Down |
| **CI/CD 현황** | GitHub Actions 파이프라인 성공/실패 이력 |
| **Ansible 로그** | 자동화 작업 실행 결과 (OK/Changed/Failed) |
| **Grafana 연동** | 상세 메트릭 대시보드 임베드 |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                           │
│                   (CI/CD Pipeline + Ansible)                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Deploy
                          ▼
┌────────────────────────────────────────────────────────────────┐
│                     Rocky Linux VM                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Nginx     │  │ Spring Boot │  │  MariaDB    │             │
│  │  :80/:443   │  │   :8082     │  │   :9981     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Prometheus  │  │  Grafana    │  │Node Exporter│             │
│  │   :9090     │  │   :3000     │  │   :9100     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Infrastructure
- **OS**: Rocky Linux 9
- **Web Server**: Nginx (Reverse Proxy + SSL)
- **Database**: MariaDB 10.x
- **Virtualization**: Hyper-V

### Monitoring
- **Prometheus**: 메트릭 수집 및 저장
- **Grafana**: 시각화 대시보드
- **Node Exporter**: 시스템 메트릭 수집

### Backend
- **Java 17**
- **Spring Boot 3.x**
- **Spring Data JPA**

### Frontend
- **HTML5 / CSS3 / Vanilla JavaScript**
- **Chart.js**: 실시간 차트

### DevOps
- **Ansible**: 서버 프로비저닝 자동화
- **GitHub Actions**: CI/CD 파이프라인
- **Docker** (Optional)

---

## 📁 Project Structure

```
/app/project1/
├── frontend/
│   ├── index.html          # 메인 대시보드
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
│
├── backend/
│   └── src/
│       └── main/
│           ├── java/
│           │   └── kr/deok/project1/
│           │       ├── Application.java
│           │       ├── controller/
│           │       ├── service/
│           │       ├── repository/
│           │       └── entity/
│           └── resources/
│               └── application.yml
│
├── ansible/
│   ├── inventory/
│   │   └── hosts.yml
│   ├── playbooks/
│   │   ├── site.yml          # 메인 플레이북
│   │   ├── setup-nginx.yml
│   │   ├── setup-mariadb.yml
│   │   ├── setup-monitoring.yml
│   │   └── deploy-app.yml
│   └── roles/
│       ├── common/
│       ├── nginx/
│       ├── mariadb/
│       ├── prometheus/
│       └── grafana/
│
├── .github/
│   └── workflows/
│       ├── ci.yml            # Build & Test
│       ├── cd.yml            # Deploy to Production
│       └── ansible.yml       # Run Ansible Playbook
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── docs/
│   └── preview.png
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

```bash
# Java 17
sudo dnf install java-17-openjdk-devel

# MariaDB
sudo dnf install mariadb-server

# Nginx
sudo dnf install nginx

# Prometheus & Grafana
# See ansible/playbooks/setup-monitoring.yml
```

### Installation

```bash
# Clone repository
git clone https://github.com/your-username/project1.git
cd project1

# Run Ansible playbook (전체 설정)
cd ansible
ansible-playbook -i inventory/hosts.yml playbooks/site.yml

# Or manually start services
sudo systemctl start nginx mariadb prometheus grafana-server
```

### Build & Run

```bash
# Backend
cd backend
./gradlew bootRun

# Frontend는 Nginx에서 static 파일로 서빙
```

---

## 📊 Prometheus Queries

대시보드에서 사용하는 주요 PromQL:

```promql
# CPU Usage
100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Memory Usage
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100

# Disk Usage
(node_filesystem_size_bytes{mountpoint="/"} - node_filesystem_avail_bytes{mountpoint="/"}) / node_filesystem_size_bytes{mountpoint="/"} * 100

# Service Up/Down
up{job="node"}
```

---

## 🔧 Configuration

### Nginx (`/etc/nginx/conf.d/project1.conf`)

```nginx
server {
    listen 80;
    server_name project1.deok.kr;

    location / {
        root /app/project1/frontend;
        index index.html;
    }

    location /api {
        proxy_pass http://localhost:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Prometheus (`/etc/prometheus/prometheus.yml`)

```yaml
scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
  
  - job_name: 'spring-boot'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8082']
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow

1. **Push to main** → Build & Test
2. **Test passed** → Deploy to server via SSH
3. **Deploy done** → Run Ansible for configuration
4. **Complete** → Notify (Slack/Discord)

```yaml
# .github/workflows/cd.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /app/project1
            git pull origin main
            ./gradlew bootJar
            sudo systemctl restart project1
```

---

## 📝 License

MIT License

---

## 👤 Author

- GitHub: [JINDEOKYONG](https://github.com/wlsejrdyd)
- Email: wlsejrdyd@gmail.com
