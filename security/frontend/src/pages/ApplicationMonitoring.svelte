<script lang="ts">
  import { onMount } from 'svelte';
  import MetricTimeSeriesChart from '../components/charts/MetricTimeSeriesChart.svelte';
  import Icon from '../components/common/Icon.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import {
    APPLICATION_METRIC_DEFINITIONS,
    buildMetricChartGroups,
    extractProcessNames,
    formatMemoryBytes,
    formatUptimeDuration,
  } from '../lib/metrics-chart.ts';
  import { applicationStore } from '../stores/application.store.ts';

  let metricNameFilter = '';
  let processNameFilter = '';
  let selectedRange = 'all';

  const timeRanges = [
    { id: 'all', label: 'All' },
    { id: '15m', label: '15m' },
    { id: '1h', label: '1h' },
    { id: '6h', label: '6h' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
  ];

  function loadMetrics() {
    applicationStore.load({
      limit: 100,
      offset: 0,
      range: selectedRange === 'all' ? undefined : selectedRange,
    });
  }

  function handleRangeChange(rangeId: string) {
    selectedRange = rangeId;
    loadMetrics();
  }

  $: processNames = extractProcessNames(
    $applicationStore.metrics,
    $applicationStore.processes
  );

  $: chartGroups = buildMetricChartGroups($applicationStore.metrics, {
    metricNameFilter,
    processNameFilter,
  });

  onMount(() => {
    loadMetrics();
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
    <button type="button" on:click={loadMetrics} class="sec-btn-secondary">
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
                <td class="font-mono">{formatMemoryBytes(proc.memoryBytes)}</td>
                <td class="font-mono {proc.restartCount >= 3 ? 'text-amber-400 font-bold' : ''}">
                  {proc.restartCount}
                </td>
                <td class="font-mono text-slate-300">{formatUptimeDuration(proc.uptimeSeconds)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Historical Application Metrics Time-Series Section -->
  <div class="space-y-4">
    <div class="sec-card">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-white">Recorded Application Metrics History</h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Dedicated time-series charts per metric ({$applicationStore.metrics.length} samples loaded)
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Time Range Selector -->
          <div class="flex items-center gap-1" role="group" aria-label="Time window filter">
            {#each timeRanges as r (r.id)}
              <button
                type="button"
                on:click={() => handleRangeChange(r.id)}
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors {selectedRange ===
                r.id
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}"
              >
                {r.label}
              </button>
            {/each}
          </div>

          <!-- Process Filter -->
          <select
            bind:value={processNameFilter}
            aria-label="Filter by PM2 process"
            class="sec-input"
          >
            <option value="">All Processes</option>
            {#each processNames as pName (pName)}
              <option value={pName}>{pName}</option>
            {/each}
          </select>

          <!-- Metric Filter -->
          <select
            bind:value={metricNameFilter}
            aria-label="Filter by metric name"
            class="sec-input"
          >
            <option value="">All Metrics ({APPLICATION_METRIC_DEFINITIONS.length} Charts)</option>
            {#each APPLICATION_METRIC_DEFINITIONS as def (def.metricName)}
              <option value={def.metricName}>{def.title}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>

    {#if $applicationStore.loading && $applicationStore.metrics.length === 0}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {#each [1, 2, 3, 4] as _}
          <div class="sec-card h-64 animate-pulse bg-slate-900/60"></div>
        {/each}
      </div>
    {:else if $applicationStore.metrics.length === 0}
      <div class="sec-card py-10 text-center text-xs text-slate-500">
        No historical PM2 metrics recorded in the selected time window.
      </div>
    {:else}
      <div
        class="grid grid-cols-1 {chartGroups.length > 1 ? 'lg:grid-cols-2' : ''} gap-6"
      >
        {#each chartGroups as group, idx (group.metricName)}
          <div
            class={chartGroups.length > 1 &&
            chartGroups.length % 2 === 1 &&
            idx === chartGroups.length - 1
              ? 'lg:col-span-2'
              : ''}
          >
            <MetricTimeSeriesChart {group} />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
