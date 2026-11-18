<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import { applicationStore } from '../stores/application.store.ts';

  let metricNameFilter = '';

  function formatMemory(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatUptime(sec: number): string {
    if (!sec || sec <= 0) return '0s';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (hrs > 24) {
      return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
    }
    return `${hrs}h ${mins}m`;
  }

  function loadPage(offset = 0) {
    applicationStore.load({
      limit: 25,
      offset,
      metricName: metricNameFilter || undefined,
    });
  }

  onMount(() => {
    loadPage(0);
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Application Layer Monitoring — PM2</h1>
      <p class="text-xs text-slate-400">
        Managed Node.js process health, CPU & memory utilization, restart tracking, and uptime
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $applicationStore.error}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {$applicationStore.error}
    </div>
  {/if}

  <!-- PM2 Managed Process List -->
  <div class="sec-card">
    <h2 class="text-sm font-semibold text-white mb-3">PM2 Process Inventory</h2>
    {#if $applicationStore.loading && $applicationStore.processes.length === 0}
      <div class="py-8 text-center text-xs text-slate-400">Collecting PM2 process inventory...</div>
    {:else if $applicationStore.processes.length === 0}
      <div class="py-8 text-center text-xs text-slate-500">
        No active PM2 processes reported on this host.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>PM2 ID</th>
              <th>Process Name</th>
              <th>PID</th>
              <th>Status</th>
              <th>Mode / Instances</th>
              <th>CPU Usage</th>
              <th>Memory</th>
              <th>Restarts</th>
              <th>Uptime</th>
            </tr>
          </thead>
          <tbody>
            {#each $applicationStore.processes as proc (proc.pmId + '-' + proc.name)}
              <tr>
                <td class="font-mono">{proc.pmId}</td>
                <td class="font-semibold text-white font-mono">{proc.name}</td>
                <td class="font-mono text-slate-400">{proc.pid}</td>
                <td><SeverityBadge level={proc.status} /></td>
                <td class="font-mono text-xs">{proc.execMode} ({proc.instances})</td>
                <td class="font-mono {proc.cpuPercent > 80 ? 'text-rose-400 font-bold' : ''}">
                  {proc.cpuPercent.toFixed(1)}%
                </td>
                <td class="font-mono">{formatMemory(proc.memoryBytes)}</td>
                <td class="font-mono {proc.restartCount >= 3 ? 'text-amber-400 font-bold' : ''}">
                  {proc.restartCount}
                </td>
                <td class="font-mono text-slate-300">{formatUptime(proc.uptimeSeconds)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Historical Application Metrics Table -->
  <div class="sec-card space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-white">Recorded Application Metrics History</h2>
      <div class="flex items-center gap-2">
        <select
          bind:value={metricNameFilter}
          on:change={() => loadPage(0)}
          aria-label="Filter by metric name"
          class="sec-input"
        >
          <option value="">All Metrics</option>
          <option value="cpu_percent">CPU Usage (%)</option>
          <option value="memory_bytes">Memory (Bytes)</option>
          <option value="memory_percent">Memory (%)</option>
          <option value="restart_count">Restart Count</option>
          <option value="uptime_seconds">Uptime (Seconds)</option>
        </select>
      </div>
    </div>

    {#if $applicationStore.metrics.length === 0}
      <div class="py-8 text-center text-xs text-slate-500">No historical PM2 metrics recorded.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Recorded At</th>
              <th>Process</th>
              <th>Metric Name</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each $applicationStore.metrics as met (met.id)}
              <tr>
                <td class="font-mono text-slate-400">{new Date(met.recordedAt).toLocaleString()}</td>
                <td class="font-mono text-white">{met.labels?.process_name || '-'}</td>
                <td class="font-mono text-indigo-300">{met.metricName}</td>
                <td class="font-mono font-semibold">{Number(met.metricValue).toFixed(2)}</td>
                <td><SeverityBadge level={met.labels?.status || 'online'} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls
        pagination={$applicationStore.pagination}
        onPageChange={(off) => loadPage(off)}
      />
    {/if}
  </div>
</div>

