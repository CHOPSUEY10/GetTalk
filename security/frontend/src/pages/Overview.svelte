<script lang="ts">
  import { onMount } from 'svelte';
  import TrafficChart from '../components/charts/TrafficChart.svelte';
  import Icon from '../components/common/Icon.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import { dashboardStore } from '../stores/dashboard.store.ts';

  let selectedRange = '24h';

  function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleRangeChange(range: string) {
    selectedRange = range;
    dashboardStore.load(range);
  }

  onMount(() => {
    dashboardStore.load(selectedRange);
  });
</script>

<div class="space-y-6">
  <!-- Header & Time Range Controls -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Security & Telemetry Overview</h1>
      <p class="text-xs text-slate-400">
        Passive host monitoring across Network (Firewalld), Web (Nginx), and Application (PM2) layers
      </p>
    </div>

    <div class="flex items-center gap-2">
      {#each ['15m', '1h', '6h', '24h', '7d'] as r}
        <button
          type="button"
          on:click={() => handleRangeChange(r)}
          class="px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors {selectedRange === r
            ? 'bg-indigo-600 text-white border-indigo-500'
            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}"
        >
          {r}
        </button>
      {/each}
      <button
        type="button"
        on:click={() => dashboardStore.load(selectedRange)}
        class="sec-btn-secondary"
        aria-label="Refresh overview"
      >
        <Icon name="refresh" size="xs" />
        <span>Refresh</span>
      </button>
    </div>
  </div>

  {#if $dashboardStore.error}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {$dashboardStore.error}
    </div>
  {/if}

  {#if $dashboardStore.loading && !$dashboardStore.overview}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
      {#each [1, 2, 3, 4, 5, 6] as _}
        <div class="sec-card h-24 animate-pulse bg-slate-900/60"></div>
      {/each}
    </div>
  {:else if $dashboardStore.overview}
    {@const ov = $dashboardStore.overview}
    <!-- Key Telemetry KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Overall System Health</div>
        <div class="flex items-center gap-2 mt-1">
          <SeverityBadge level={ov.overallHealth} />
        </div>
      </div>

      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Total HTTP Requests</div>
        <div class="text-xl font-bold text-white font-mono">
          {ov.totalHttpRequests.toLocaleString()}
        </div>
      </div>

      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Firewall Blocked</div>
        <div class="text-xl font-bold text-rose-400 font-mono">
          {ov.firewallBlockedEvents.toLocaleString()}
        </div>
      </div>

      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Avg Application CPU</div>
        <div class="text-xl font-bold text-white font-mono">
          {ov.averageCpuPercent.toFixed(1)}%
        </div>
      </div>

      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Total Process Memory</div>
        <div class="text-xl font-bold text-white font-mono">
          {formatBytes(ov.totalMemoryBytes)}
        </div>
      </div>

      <div class="sec-card">
        <div class="text-xs text-slate-400 mb-1">Active Security Alerts</div>
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold text-amber-400 font-mono">{ov.activeAlertsCount}</span>
          {#if ov.criticalAlertsCount > 0}
            <span class="text-xs text-rose-400 font-semibold">({ov.criticalAlertsCount} critical)</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Traffic & Anomaly Timeline Chart -->
    <TrafficChart series={$dashboardStore.traffic} />

    <!-- Recent Security Alerts & Recent Telemetry Events -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="sec-card">
        <h2 class="text-sm font-semibold text-white mb-3">Active & Recent Security Alerts</h2>
        {#if !ov.recentAlerts || ov.recentAlerts.length === 0}
          <p class="text-xs text-slate-500 py-6 text-center">No active security alerts detected.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="sec-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {#each ov.recentAlerts as alert (alert.id)}
                  <tr>
                    <td class="font-mono text-indigo-300">{alert.ruleId}</td>
                    <td class="max-w-xs truncate" title={alert.description}>{alert.title}</td>
                    <td><SeverityBadge level={alert.severity} /></td>
                    <td><SeverityBadge level={alert.status} /></td>
                    <td class="font-mono">{alert.eventCount}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <div class="sec-card">
        <h2 class="text-sm font-semibold text-white mb-3">Recent Security Telemetry Events</h2>
        {#if !ov.recentEvents || ov.recentEvents.length === 0}
          <p class="text-xs text-slate-500 py-6 text-center">No recent telemetry events ingested.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="sec-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Layer</th>
                  <th>Type</th>
                  <th>Source IP</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {#each ov.recentEvents as ev (ev.id)}
                  <tr>
                    <td class="font-mono text-slate-400">
                      {new Date(ev.occurredAt).toLocaleTimeString()}
                    </td>
                    <td class="uppercase font-mono text-xs">{ev.source}</td>
                    <td>{ev.eventType}</td>
                    <td class="font-mono">{ev.sourceIp || '-'}</td>
                    <td><SeverityBadge level={ev.severity} /></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

