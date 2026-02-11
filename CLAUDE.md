# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Infrastructure monitoring dashboard (infra.deok.kr) — a vanilla JavaScript SPA that aggregates real-time metrics from Prometheus, Kubernetes, GitHub Actions, and Ansible into a single dark-themed dashboard. Backend is a minimal Python Flask API for server configuration persistence.

## Architecture

**Frontend (Vanilla SPA)**
- `index.html` — single entry point, loads ES6 modules
- `assets/js/router.js` — custom hash-based router with pattern matching (routes: `/overview`, `/server/:id`, `/admin`)
- `assets/js/app.js` — app initialization, mounts router and starts data refresh loops
- `assets/js/api.js` — all data fetching: Prometheus queries, K8s metrics, GitHub Actions API, Ansible reports
- `assets/js/config.js` — central config (Prometheus URL, refresh intervals, monitored repos/services)
- `assets/js/pages/` — page modules: `overview.js` (server grid), `detail.js` (metrics charts), `admin.js` (server CRUD)

**Backend**
- `api/server.py` — Flask app with CORS; endpoints: `GET/POST /api/servers`, `GET /api/health`
- Server data stored in `assets/data/servers.json`

**Styling**
- `assets/css/variables.css` — CSS custom properties (dark theme colors, status colors, service colors)
- `assets/css/layout.css` — grid system, header, responsive layouts
- `assets/css/components.css` — buttons, cards, badges, modals, progress bars

## Data Flow

| Source | Endpoint/Path | Refresh |
|--------|--------------|---------|
| Prometheus (system metrics) | `/prometheus/api/v1/query` | 10s |
| kube-state-metrics (K8s) | `/prometheus/api/v1/query` | 10s |
| GitHub Actions | `/api/github/repos/{owner}/{repo}/actions/runs` (Nginx proxy) | 60s |
| Ansible reports | `/reports/*.json` | 60s |
| Backup status | `/reports/backup_status.json` | 60s |

GitHub API calls are proxied through Nginx (see `location /api/github/` in Nginx config) to attach the auth token server-side.

## Running Locally

**Frontend** — serve the project root with any static file server (e.g., `python -m http.server 8080`). Requires Prometheus and Nginx proxy to be available for live data.

**Backend API:**
```bash
cd api
pip install flask flask-cors
python server.py          # development: localhost:5000
# production: gunicorn server:app
```

## Deployment

Deployed via GitHub Actions CD pipeline (SSH to production server → `git pull` → `nginx reload`). Triggered on push to `main`.

Required GitHub Actions secrets: `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`, `SERVER_PORT`.

## Key Conventions

- Language: Korean is used in UI labels, README, and code comments
- No build step or bundler — vanilla HTML/CSS/JS served directly by Nginx
- Charts use Chart.js 3.9.1 (loaded via CDN in index.html)
- Server configs (IDs, instances, thresholds) live in `assets/data/servers.json`
- Monitored repos: `infra`, `salm`, `mgmt` (GitHub owner: `wlsejrdyd`)
- Monitored services: Nginx, Prometheus, Grafana, Node Exporter, MariaDB, Kube State Metrics
- `*_bak` files in `assets/js/` are manual backups of previous versions
