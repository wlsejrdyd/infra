// assets/js/api.js
import { CONFIG } from '/assets/js/config.js';

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

export async function fetchServerMetrics(instance) {
  const metrics = {
    cpu: null,
    memory: null,
    disk: null,
    uptime: null,
    status: 'offline'
  };

  try {
    // up 메트릭으로 서버 온라인 여부를 먼저 확인 (staleness 문제 방지)
    const upQuery = `up{instance="${instance}"}`;
    const upValue = await fetchPrometheusMetric(upQuery);

    if (upValue !== 1) {
      // up 메트릭이 0이거나 없으면 즉시 offline 반환
      return metrics;
    }

    metrics.status = 'online';

    // 모든 메트릭 병렬 fetch (순차 대비 ~6배 빠름)
    const cpuQuery = `100 - (avg(irate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[5m])) * 100)`;
    const diskSizeQuery = `node_filesystem_size_bytes{instance="${instance}",fstype=~"ext4|xfs|btrfs|vfat"}`;
    const diskAvailQuery = `node_filesystem_avail_bytes{instance="${instance}",fstype=~"ext4|xfs|btrfs|vfat"}`;

    const [cpu, memTotal, memAvail, diskSizeData, diskAvailData, bootTime] = await Promise.all([
      fetchPrometheusMetric(cpuQuery),
      fetchPrometheusMetric(`node_memory_MemTotal_bytes{instance="${instance}"}`),
      fetchPrometheusMetric(`node_memory_MemAvailable_bytes{instance="${instance}"}`),
      fetch(`${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(diskSizeQuery)}`).then(r => r.json()).catch(() => null),
      fetch(`${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(diskAvailQuery)}`).then(r => r.json()).catch(() => null),
      fetchPrometheusMetric(`node_boot_time_seconds{instance="${instance}"}`),
    ]);

    metrics.cpu = cpu;

    if (memTotal && memAvail) {
      metrics.memory = ((memTotal - memAvail) / memTotal * 100);
    }

    // 모든 실제 파일시스템 중 사용률 가장 높은 디스크
    if (diskSizeData?.status === 'success' && diskAvailData?.status === 'success') {
      const availMap = {};
      diskAvailData.data.result.forEach(r => {
        availMap[r.metric.mountpoint] = parseFloat(r.value[1]);
      });

      let maxUsage = 0;
      diskSizeData.data.result.forEach(r => {
        const total = parseFloat(r.value[1]);
        const avail = availMap[r.metric.mountpoint];
        if (total > 0 && avail !== undefined) {
          const usage = ((total - avail) / total) * 100;
          if (usage > maxUsage) maxUsage = usage;
        }
      });

      if (maxUsage > 0) metrics.disk = maxUsage;
    }

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

export async function fetchKubernetesData() {
  const k8sData = {
    pods: [],
    nodes: [],
    stats: { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 }
  };

  try {
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
          pods[`${namespace}/${podName}`] = { name: podName, namespace, phase };
          k8sData.stats[phase] = (k8sData.stats[phase] || 0) + 1;
        }
      });
    }
    
    k8sData.pods = Object.values(pods);

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

  allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  return allRuns;
}

export async function fetchAnsibleReport() {
  const report = { ok: 0, changed: 0, failed: 0, skipped: 0, logs: [], timestamp: null };

  try {
    const res = await fetch(`${CONFIG.reportsUrl}/`);
    const html = await res.text();
    
    const jsonFiles = [...html.matchAll(/href="(report_[^"]+\.json)"/g)]
      .map(m => m[1])
      .sort()
      .reverse();

    if (jsonFiles.length > 0) {
      const latestFile = jsonFiles[0];
      const reportRes = await fetch(`${CONFIG.reportsUrl}/${latestFile}`);
      const latestReport = await reportRes.json();

      if (latestReport.services) {
        latestReport.services.forEach(svc => {
          if (svc.status === 'active') report.ok++;
          else report.failed++;
          
          report.logs.push({
            type: 'service',
            port: svc.port,
            name: svc.name,
            status: svc.status === 'active' ? 'ok' : 'failed',
            message: `${svc.name}: ${svc.status}`
          });
        });
      }

      if (latestReport.ports) {
        latestReport.ports.forEach(port => {
          if (port.reachable) report.ok++;
          else report.failed++;
          
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
      return values.map(v => ({ timestamp: v[0], value: parseFloat(v[1]) }));
    }
  } catch (e) {
    console.error('Failed to fetch CPU history:', e);
  }
  
  return history;
}

/**
 * 서버 목록 조회 (백엔드 API)
 */
export async function fetchServersData() {
  try {
    const res = await fetch('/api/servers');
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Failed to fetch servers data:', e);
    return { servers: [], defaultThresholds: {} };
  }
}

/**
 * 서버 목록 저장 (백엔드 API) - 실제 구현
 */
export async function saveServersData(serversData) {
  try {
    console.log('saveServersData: Sending POST to /api/servers', serversData);
    
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serversData)
    });
    
    console.log('saveServersData: Response status', res.status);
    
    const result = await res.json();
    console.log('saveServersData: Response data', result);
    
    if (res.ok && result.success) {
      return true;
    } else {
      console.error('Failed to save:', result.error);
      alert('저장 실패: ' + (result.error || '알 수 없는 오류'));
      return false;
    }
  } catch (e) {
    console.error('Failed to save servers data:', e);
    alert('저장 실패: 서버 연결 오류');
    return false;
  }
}

/**
 * 메모리 히스토리 조회 (차트용)
 */
export async function fetchMemoryHistory(instance, range = '1h') {
  const history = [];
  
  try {
    const query = `100 - (node_memory_MemAvailable_bytes{instance="${instance}"} / node_memory_MemTotal_bytes{instance="${instance}"} * 100)`;
    const res = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${Math.floor(Date.now()/1000) - 3600}&end=${Math.floor(Date.now()/1000)}&step=300`
    );
    const data = await res.json();
    
    if (data.status === 'success' && data.data.result.length > 0) {
      const values = data.data.result[0].values;
      return values.map(v => ({ timestamp: v[0], value: parseFloat(v[1]) }));
    }
  } catch (e) {
    console.error('Failed to fetch memory history:', e);
  }
  
  return history;
}

/**
 * 네트워크 트래픽 조회
 */
export async function fetchNetworkTraffic(instance) {
  const traffic = { inbound: null, outbound: null };
  
  try {
    // Inbound (receive)
    const inQuery = `rate(node_network_receive_bytes_total{instance="${instance}",device!~"lo|docker.*|veth.*"}[5m])`;
    const inRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(inQuery)}`
    );
    const inData = await inRes.json();
    
    if (inData.status === 'success' && inData.data.result.length > 0) {
      // 모든 인터페이스 합산
      traffic.inbound = inData.data.result.reduce((sum, r) => sum + parseFloat(r.value[1]), 0);
    }
    
    // Outbound (transmit)
    const outQuery = `rate(node_network_transmit_bytes_total{instance="${instance}",device!~"lo|docker.*|veth.*"}[5m])`;
    const outRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(outQuery)}`
    );
    const outData = await outRes.json();
    
    if (outData.status === 'success' && outData.data.result.length > 0) {
      traffic.outbound = outData.data.result.reduce((sum, r) => sum + parseFloat(r.value[1]), 0);
    }
  } catch (e) {
    console.error('Failed to fetch network traffic:', e);
  }
  
  return traffic;
}

/**
 * 디스크 I/O 조회
 */
export async function fetchDiskIO(instance) {
  const diskIO = { read: null, write: null };
  
  try {
    // Read
    const readQuery = `rate(node_disk_read_bytes_total{instance="${instance}"}[5m])`;
    const readRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(readQuery)}`
    );
    const readData = await readRes.json();
    
    if (readData.status === 'success' && readData.data.result.length > 0) {
      diskIO.read = readData.data.result.reduce((sum, r) => sum + parseFloat(r.value[1]), 0);
    }
    
    // Write
    const writeQuery = `rate(node_disk_written_bytes_total{instance="${instance}"}[5m])`;
    const writeRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(writeQuery)}`
    );
    const writeData = await writeRes.json();
    
    if (writeData.status === 'success' && writeData.data.result.length > 0) {
      diskIO.write = writeData.data.result.reduce((sum, r) => sum + parseFloat(r.value[1]), 0);
    }
  } catch (e) {
    console.error('Failed to fetch disk I/O:', e);
  }
  
  return diskIO;
}

/**
 * 전체 디스크(파일시스템) 조회 — rootfs 외 모든 실제 디스크
 */
export async function fetchAllDisks(instance) {
  const disks = [];

  try {
    const sizeQuery = `node_filesystem_size_bytes{instance="${instance}",fstype=~"ext4|xfs|btrfs|vfat"}`;
    const availQuery = `node_filesystem_avail_bytes{instance="${instance}",fstype=~"ext4|xfs|btrfs|vfat"}`;

    const sizeRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(sizeQuery)}`
    );
    const sizeData = await sizeRes.json();

    const availRes = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(availQuery)}`
    );
    const availData = await availRes.json();

    if (sizeData.status === 'success' && availData.status === 'success') {
      const availMap = {};
      availData.data.result.forEach(r => {
        availMap[r.metric.mountpoint] = parseFloat(r.value[1]);
      });

      sizeData.data.result.forEach(r => {
        const mountpoint = r.metric.mountpoint;
        const total = parseFloat(r.value[1]);
        const avail = availMap[mountpoint];
        if (total > 0 && avail !== undefined) {
          disks.push({
            mountpoint,
            fstype: r.metric.fstype,
            device: r.metric.device || '',
            total,
            avail,
            used: total - avail,
            usagePercent: ((total - avail) / total) * 100
          });
        }
      });
    }
  } catch (e) {
    console.error('Failed to fetch all disks:', e);
  }

  return disks;
}

/**
 * Prometheus 벡터 쿼리 — 여러 결과를 배열로 반환
 */
async function fetchPrometheusVector(query) {
  try {
    const res = await fetch(
      `${CONFIG.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    if (data.status === 'success') {
      return data.data.result;
    }
  } catch (e) {
    console.error('Prometheus vector fetch error:', e);
  }
  return [];
}

/**
 * MinIO 클러스터 용량 조회
 */
export async function fetchMinioCapacity() {
  const minio = { total: null, used: null, usagePercent: null, buckets: [] };

  try {
    const totalResults = await fetchPrometheusVector('minio_cluster_capacity_usable_total_bytes');
    const freeResults = await fetchPrometheusVector('minio_cluster_capacity_usable_free_bytes');

    if (totalResults.length > 0 && freeResults.length > 0) {
      minio.total = parseFloat(totalResults[0].value[1]);
      const free = parseFloat(freeResults[0].value[1]);
      minio.used = minio.total - free;
      minio.usagePercent = minio.total > 0 ? (minio.used / minio.total) * 100 : 0;
    }

    // 버킷별 용량
    const bucketResults = await fetchPrometheusVector('minio_bucket_usage_total_bytes');
    bucketResults.forEach(r => {
      minio.buckets.push({
        name: r.metric.bucket,
        size: parseFloat(r.value[1])
      });
    });
  } catch (e) {
    console.error('Failed to fetch MinIO capacity:', e);
  }

  return minio;
}

/**
 * Longhorn 스토리지 용량 조회
 */
export async function fetchLonghornCapacity() {
  const longhorn = { nodes: [], volumes: [] };

  try {
    // 노드별 스토리지
    const capResults = await fetchPrometheusVector('longhorn_node_storage_capacity_bytes');
    const usageResults = await fetchPrometheusVector('longhorn_node_storage_usage_bytes');

    const usageMap = {};
    usageResults.forEach(r => {
      usageMap[r.metric.node] = parseFloat(r.value[1]);
    });

    capResults.forEach(r => {
      const node = r.metric.node;
      const capacity = parseFloat(r.value[1]);
      const used = usageMap[node] || 0;
      longhorn.nodes.push({
        name: node,
        capacity,
        used,
        usagePercent: capacity > 0 ? (used / capacity) * 100 : 0
      });
    });

    // 볼륨별 용량
    const volResults = await fetchPrometheusVector('longhorn_volume_actual_size_bytes');
    volResults.forEach(r => {
      longhorn.volumes.push({
        name: r.metric.volume,
        size: parseFloat(r.value[1])
      });
    });
  } catch (e) {
    console.error('Failed to fetch Longhorn capacity:', e);
  }

  return longhorn;
}

/**
 * Load Average 조회
 */
export async function fetchLoadAverage(instance) {
  const loadAvg = { load1: null, load5: null, load15: null };
  
  try {
    const load1 = await fetchPrometheusMetric(`node_load1{instance="${instance}"}`);
    const load5 = await fetchPrometheusMetric(`node_load5{instance="${instance}"}`);
    const load15 = await fetchPrometheusMetric(`node_load15{instance="${instance}"}`);
    
    loadAvg.load1 = load1;
    loadAvg.load5 = load5;
    loadAvg.load15 = load15;
  } catch (e) {
    console.error('Failed to fetch load average:', e);
  }
  
  return loadAvg;
}
