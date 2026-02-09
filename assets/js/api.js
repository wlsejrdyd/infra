// assets/js/api.js
import { CONFIG } from './config.js';

/**
 * Prometheus 메트릭 조회
 * @param {string} query - PromQL 쿼리
 * @returns {Promise<number|null>}
 */
export async function fetchPrometheusMetric(query) {
  try {
    const res = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    
    if (data.status === 'success' && data.data.result.length > 0) {
      return parseFloat(data.data.result[0].value[1]);
    }
  } catch (e) {
    console.error('Prometheus fetch error:', e);
  }
  return null;
}

/**
 * 특정 서버의 메트릭 조회
 * @param {string} instance - node_exporter 인스턴스 (예: localhost:9100)
 * @returns {Promise<Object>}
 */
export async function fetchServerMetrics(instance) {
  const metrics = {
    cpu: null,
    memory: null,
    disk: null,
    uptime: null,
    status: 'offline'
  };

  try {
    // CPU 사용률
    const cpuQuery = `100 - (avg(irate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[5m])) * 100)`;
    metrics.cpu = await fetchPrometheusMetric(cpuQuery);

    if (metrics.cpu !== null) {
      metrics.status = 'online';
    }

    // 메모리 사용률
    const memTotalQuery = `node_memory_MemTotal_bytes{instance="${instance}"}`;
    const memAvailQuery = `node_memory_MemAvailable_bytes{instance="${instance}"}`;
    
    const memTotal = await fetchPrometheusMetric(memTotalQuery);
    const memAvail = await fetchPrometheusMetric(memAvailQuery);
    
    if (memTotal && memAvail) {
      metrics.memory = ((memTotal - memAvail) / memTotal * 100);
    }

    // 디스크 사용률
    const diskTotalQuery = `node_filesystem_size_bytes{instance="${instance}",mountpoint="/"}`;
    const diskAvailQuery = `node_filesystem_avail_bytes{instance="${instance}",mountpoint="/"}`;
    
    const diskTotal = await fetchPrometheusMetric(diskTotalQuery);
    const diskAvail = await fetchPrometheusMetric(diskAvailQuery);
    
    if (diskTotal && diskAvail) {
      metrics.disk = ((diskTotal - diskAvail) / diskTotal * 100);
    }

    // 업타임
    const bootTimeQuery = `node_boot_time_seconds{instance="${instance}"}`;
    const bootTime = await fetchPrometheusMetric(bootTimeQuery);
    
    if (bootTime) {
      const uptimeSec = Date.now() / 1000 - bootTime;
      metrics.uptime = {
        seconds: uptimeSec,
        days: Math.floor(uptimeSec / 86400),
        hours: Math.floor((uptimeSec % 86400) / 3600)
      };
    }

  } catch (e) {
    console.error(`Failed to fetch metrics for ${instance}:`, e);
  }

  return metrics;
}

/**
 * 서비스 상태 조회 (up 메트릭)
 * @returns {Promise<Object>}
 */
export async function fetchServiceStatus() {
  const statusMap = {};
  
  try {
    const res = await fetch(`${CONFIG.prometheusUrl}/api/v1/query?query=up`);
    const data = await res.json();
    
    if (data.status === 'success') {
      data.data.result.forEach(r => {
        statusMap[r.metric.job] = r.value[1] === '1';
      });
    }
  } catch (e) {
    console.error('Failed to fetch service status:', e);
  }
  
  return statusMap;
}

/**
 * Kubernetes 데이터 조회
 * @returns {Promise<Object>}
 */
export async function fetchKubernetesData() {
  const k8sData = {
    pods: [],
    nodes: [],
    stats: {
      Running: 0,
      Pending: 0,
      Failed: 0,
      Succeeded: 0,
      Unknown: 0
    }
  };

  try {
    // Pod 상태
    const podRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=kube_pod_status_phase`
    );
    const podData = await podRes.json();
    
    const pods = {};
    
    if (podData.status === 'success') {
      podData.data.result.forEach(r => {
        const podName = r.metric.pod;
        const namespace = r.metric.namespace;
        const phase = r.metric.phase;
        const value = r.value[1];
        
        if (value === '1') {
          pods[`${namespace}/${podName}`] = {
            name: podName,
            namespace,
            phase
          };
          k8sData.stats[phase] = (k8sData.stats[phase] || 0) + 1;
        }
      });
    }
    
    k8sData.pods = Object.values(pods);

    // Node 상태
    const nodeRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=kube_node_status_condition{condition="Ready",status="true"}`
    );
    const nodeData = await nodeRes.json();
    
    if (nodeData.status === 'success') {
      k8sData.nodes = nodeData.data.result.map(r => ({
        name: r.metric.node,
        ready: r.value[1] === '1'
      }));
    }

  } catch (e) {
    console.error('Failed to fetch Kubernetes data:', e);
  }

  return k8sData;
}

/**
 * GitHub Actions 워크플로우 조회
 * @returns {Promise<Array>}
 */
export async function fetchGithubWorkflows() {
  const allRuns = [];

  for (const repoConfig of CONFIG.githubRepos) {
    try {
      const res = await fetch(
        `/api/github/repos/${CONFIG.githubOwner}/${repoConfig.repo}/actions/runs?per_page=10`
      );
      const data = await res.json();
      
      if (data.workflow_runs) {
        data.workflow_runs.forEach(run => {
          allRuns.push({
            ...run,
            _repo: repoConfig.repo,
            _label: repoConfig.label,
            _color: repoConfig.color,
            _icon: repoConfig.icon
          });
        });
      }
    } catch (e) {
      console.error(`Failed to fetch ${repoConfig.repo}:`, e);
    }
  }

  // 최신순 정렬
  allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  return allRuns;
}

/**
 * Ansible 리포트 조회
 * @returns {Promise<Object>}
 */
export async function fetchAnsibleReport() {
  const report = {
    ok: 0,
    changed: 0,
    failed: 0,
    skipped: 0,
    logs: [],
    timestamp: null
  };

  try {
    const res = await fetch(`${CONFIG.reportsUrl}/`);
    const html = await res.text();
    
    // JSON 파일 목록 추출
    const jsonFiles = [...html.matchAll(/href="(report_[^"]+\.json)"/g)]
      .map(m => m[1])
      .sort()
      .reverse();

    if (jsonFiles.length > 0) {
      const latestFile = jsonFiles[0];
      const reportRes = await fetch(`${CONFIG.reportsUrl}/${latestFile}`);
      const latestReport = await reportRes.json();

      // 서비스 상태
      if (latestReport.services) {
        latestReport.services.forEach(svc => {
          if (svc.status === 'active') {
            report.ok++;
          } else {
            report.failed++;
          }
          
          report.logs.push({
            type: 'service',
            port: svc.port,
            name: svc.name,
            status: svc.status === 'active' ? 'ok' : 'failed',
            message: `${svc.name}: ${svc.status}`
          });
        });
      }

      // 포트 상태
      if (latestReport.ports) {
        latestReport.ports.forEach(port => {
          if (port.reachable) {
            report.ok++;
          } else {
            report.failed++;
          }
          
          report.logs.push({
            type: 'port',
            port: port.port,
            name: port.name,
            status: port.reachable ? 'ok' : 'failed',
            message: `${port.name}: ${port.reachable ? 'reachable' : 'unreachable'}`
          });
        });
      }

      report.timestamp = latestFile.replace('report_', '').replace('.json', '');
    }
  } catch (e) {
    console.error('Failed to fetch Ansible report:', e);
  }

  return report;
}

/**
 * 백업 상태 조회
 * @returns {Promise<Object>}
 */
export async function fetchBackupStatus() {
  const backupData = {
    salm: { success: 0, failed: 0, total: 0, files: [] },
    mgmt: { success: 0, failed: 0, total: 0, files: [] },
    db: { success: 0, failed: 0, total: 0, files: [] }
  };

  try {
    const res = await fetch(CONFIG.backupReportUrl);
    const data = await res.json();

    ['salm', 'mgmt', 'db'].forEach(type => {
      if (data[type]) {
        backupData[type] = {
          success: data[type].success || 0,
          failed: data[type].failed || 0,
          total: data[type].total || 0,
          files: data[type].files || []
        };
      }
    });
  } catch (e) {
    console.error('Failed to fetch backup status:', e);
  }

  return backupData;
}

/**
 * CPU 히스토리 조회 (차트용)
 * @param {string} instance 
 * @param {string} range - 시간 범위 (예: '1h')
 * @returns {Promise<Array>}
 */
export async function fetchCpuHistory(instance, range = '1h') {
  const history = [];
  
  try {
    const query = `100 - (avg(irate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[5m])) * 100)`;
    const res = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${Math.floor(Date.now()/1000) - 3600}&end=${Math.floor(Date.now()/1000)}&step=300`
    );
    const data = await res.json();
    
    if (data.status === 'success' && data.data.result.length > 0) {
      const values = data.data.result[0].values;
      return values.map(v => ({
        timestamp: v[0],
        value: parseFloat(v[1])
      }));
    }
  } catch (e) {
    console.error('Failed to fetch CPU history:', e);
  }
  
  return history;
}

/**
 * 서버 목록 조회
 * @returns {Promise<Object>}
 */
export async function fetchServersData() {
  try {
    const res = await fetch(CONFIG.serversDataUrl);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Failed to fetch servers data:', e);
    return { servers: [], defaultThresholds: {} };
  }
}

/**
 * 서버 목록 저장 (관리자 페이지용)
 * @param {Object} serversData 
 * @returns {Promise<boolean>}
 */
export async function saveServersData(serversData) {
  try {
    // 실제로는 백엔드 API로 POST 요청해야 함
    // 여기서는 localStorage에 임시 저장
    localStorage.setItem('servers_data', JSON.stringify(serversData));
    return true;
  } catch (e) {
    console.error('Failed to save servers data:', e);
    return false;
  }
}
