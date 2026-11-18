<script lang="ts">
  import { onMount } from 'svelte';
  import HorizontalBarChart from '../components/charts/HorizontalBarChart.svelte';
  import TrafficChart from '../components/charts/TrafficChart.svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import { isValidIPFilter } from '../lib/validators.ts';
  import { webStore } from '../stores/web.store.ts';

  let sourceIpFilter = '';
  let eventTypeFilter = '';
  let filterError = '';

  function loadPage(offset = 0) {
    filterError = '';
    if (!isValidIPFilter(sourceIpFilter)) {
      filterError = 'Invalid IPv4/IPv6 filter format.';
      return;
    }
    webStore.load({
      limit: 20,
      offset,
      sourceIp: sourceIpFilter.trim() || undefined,
      eventType: eventTypeFilter || undefined,
    });
  }

  onMount(() => {
    loadPage(0);
  });

  $: statusBars = ($webStore.statistics?.statusDistribution || []).map((s) => ({
    label: `HTTP ${s.statusGroup}`,
    value: s.count,
  }));

  $: topIpBars = ($webStore.statistics?.topSourceIps || []).map((ip) => ({
    label: ip.ip,
    value: ip.count,
  }));
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Web Layer Monitoring — Nginx</h1>
      <p class="text-xs text-slate-400">
        HTTP request volume, status code distribution, P95/P99 latency, top endpoints, and error logs
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $webStore.error || filterError}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {filterError || $webStore.error}
    </div>
  {/if}

  {#if $webStore.statistics}
    {@const st = $webStore.statistics}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <div class="sec-card">
        <div class="text-xs text-slate-400">Total HTTP Requests</div>
        <div class="text-xl font-bold text-white font-mono mt-1">
          {st.totalRequests.toLocaleString()}
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">Nginx & 5xx Errors</div>
        <div class="text-xl font-bold text-rose-400 font-mono mt-1">
          {st.totalErrors.toLocaleString()}
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">Avg Duration</div>
        <div class="text-xl font-bold text-slate-100 font-mono mt-1">
          {st.avgRequestDurationMs.toFixed(2)} ms
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">P95 Latency</div>
        <div class="text-xl font-bold text-indigo-300 font-mono mt-1">
          {st.p95RequestDurationMs.toFixed(2)} ms
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">P99 Latency</div>
        <div class="text-xl font-bold text-amber-300 font-mono mt-1">
          {st.p99RequestDurationMs.toFixed(2)} ms
        </div>
      </div>
    </div>

    <TrafficChart series={st.timeline || []} title="Nginx HTTP Request & Error Rate Timeline" />

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <HorizontalBarChart title="HTTP Status Code Distribution" items={statusBars} barColor="bg-indigo-500" />
      <HorizontalBarChart title="Top Client Source IPs" items={topIpBars} barColor="bg-sky-500" />
    </div>

    <!-- Top Endpoints Table -->
    <div class="sec-card">
      <h2 class="text-sm font-semibold text-white mb-3">Top Requested Endpoints</h2>
      {#if !st.topEndpoints || st.topEndpoints.length === 0}
        <p class="text-xs text-slate-500 py-4 text-center">No endpoint statistics recorded yet.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="sec-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Requests</th>
                <th>Avg Duration</th>
                <th>4xx/5xx Count</th>
              </tr>
            </thead>
            <tbody>
              {#each st.topEndpoints as ep}
                <tr>
                  <td class="font-mono font-semibold text-indigo-300">{ep.method}</td>
                  <td class="font-mono">{ep.endpoint}</td>
                  <td class="font-mono">{ep.count.toLocaleString()}</td>
                  <td class="font-mono">{ep.avgDurationMs.toFixed(2)} ms</td>
                  <td class="font-mono text-amber-300">{ep.errorCount}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Access & Error Events Table -->
  <div class="sec-card space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-white">Nginx Access & Error Log Events</h2>
      <form on:submit|preventDefault={() => loadPage(0)} class="flex flex-wrap items-center gap-2">
        <input
          type="text"
          bind:value={sourceIpFilter}
          placeholder="Filter by Source IP..."
          aria-label="Filter by Source IP"
          class="sec-input"
        />
        <select bind:value={eventTypeFilter} aria-label="Filter by log type" class="sec-input">
          <option value="">All Web Events</option>
          <option value="http_request">HTTP Access Requests</option>
          <option value="nginx_error">Nginx Error Logs</option>
        </select>
        <button type="submit" class="sec-btn-primary">Filter</button>
      </form>
    </div>

    {#if $webStore.loading}
      <div class="py-8 text-center text-xs text-slate-400">Loading web telemetry...</div>
    {:else if $webStore.requests.length === 0}
      <div class="py-8 text-center text-xs text-slate-500">No Nginx events found.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Source IP</th>
              <th>Method / Level</th>
              <th>Endpoint / Message</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {#each $webStore.requests as req (req.id)}
              <tr>
                <td class="font-mono text-slate-400">{new Date(req.occurredAt).toLocaleString()}</td>
                <td>{req.eventType}</td>
                <td class="font-mono">{req.sourceIp || '-'}</td>
                <td class="font-mono">{req.eventData?.method || req.eventData?.level || '-'}</td>
                <td class="font-mono max-w-md truncate" title={req.eventData?.endpoint || req.eventData?.message}>
                  {req.eventData?.endpoint || req.eventData?.message || '-'}
                </td>
                <td class="font-mono">{req.eventData?.status_code ?? '-'}</td>
                <td class="font-mono">
                  {req.eventData?.request_duration_ms !== undefined
                    ? `${Number(req.eventData.request_duration_ms).toFixed(1)} ms`
                    : '-'}
                </td>
                <td><SeverityBadge level={req.severity} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={$webStore.pagination} onPageChange={(off) => loadPage(off)} />
    {/if}
  </div>
</div>

