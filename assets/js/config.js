// assets/js/config.js
export const CONFIG = {
  prometheusUrl: '/prometheus',
  reportsUrl: '/reports',
  backupReportUrl: '/reports/backup_status.json',
  serversDataUrl: '/assets/data/servers.json',
  
  refreshInterval: 10000,        // 10초
  chartUpdateInterval: 30000,    // 30초
  
  githubOwner: 'wlsejrdyd',
  githubRepos: [
    { repo: 'infra', label: 'Infra', color: '#3b82f6', icon: '🔧' },
    { repo: 'salm', label: 'SALM', color: '#ec4899', icon: '🏠' },
    { repo: 'mgmt', label: 'Mgmt', color: '#8b5cf6', icon: '⚙️' }
  ],
  
  services: [
    { name: 'Nginx', port: 80, icon: '🌐', color: 'var(--success)', job: null },
    { name: 'Prometheus', port: 9090, icon: '🔥', color: 'var(--prometheus)', job: 'prometheus' },
    { name: 'Grafana', port: 3000, icon: '📈', color: 'var(--grafana)', job: null },
    { name: 'Node Exporter', port: 9100, icon: '📡', color: '#8b5cf6', job: 'node' },
    { name: 'MariaDB', port: 9981, icon: '🗄️', color: 'var(--accent)', job: null },
    { name: 'Kube State Metrics', port: 30047, icon: '☸️', color: 'var(--kubernetes)', job: 'kube-state-metrics' }
  ]
};
