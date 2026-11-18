<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import type { TelemetryEvent } from '../lib/types/telemetry.ts';
  import { isValidIPFilter } from '../lib/validators.ts';
  import { eventsStore } from '../stores/events.store.ts';

  let source = '';
  let severity = '';
  let sourceIp = '';
  let timeRange = '24h';
  let filterError = '';
  let selectedEvent: TelemetryEvent | null = null;

  function computeFromISO(range: string): string | undefined {
    const now = Date.now();
    switch (range) {
      case '15m':
        return new Date(now - 15 * 60_000).toISOString();
      case '1h':
        return new Date(now - 60 * 60_000).toISOString();
      case '6h':
        return new Date(now - 6 * 3600_000).toISOString();
      case '24h':
        return new Date(now - 24 * 3600_000).toISOString();
      case '7d':
        return new Date(now - 7 * 24 * 3600_000).toISOString();
      case '30d':
        return new Date(now - 30 * 24 * 3600_000).toISOString();
      default:
        return undefined;
    }
  }

  function loadPage(offset = 0) {
    filterError = '';
    if (!isValidIPFilter(sourceIp)) {
      filterError = 'Invalid IPv4/IPv6 address filter.';
      return;
    }
    eventsStore.load({
      limit: 25,
      offset,
      source: source || undefined,
      severity: severity || undefined,
      sourceIp: sourceIp.trim() || undefined,
      from: computeFromISO(timeRange),
    });
  }

  onMount(() => {
    loadPage(0);
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Unified Security Events Timeline</h1>
      <p class="text-xs text-slate-400">
        Normalized security telemetry across Firewalld, Nginx, and PM2 with real-time SSE updates
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $eventsStore.error || filterError}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {filterError || $eventsStore.error}
    </div>
  {/if}

  <!-- Filters -->
  <div class="sec-card">
    <form on:submit|preventDefault={() => loadPage(0)} class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <select bind:value={source} aria-label="Filter by telemetry source" class="sec-input">
        <option value="">All Sources</option>
        <option value="firewalld">Firewalld</option>
        <option value="nginx">Nginx</option>
        <option value="pm2">PM2</option>
      </select>

      <select bind:value={severity} aria-label="Filter by severity" class="sec-input">
        <option value="">All Severities</option>
        <option value="info">Info</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>

      <input
        type="text"
        bind:value={sourceIp}
        placeholder="Source IP (e.g. 198.51.100.25)"
        aria-label="Filter by source IP"
        class="sec-input"
      />

      <select bind:value={timeRange} aria-label="Filter by time window" class="sec-input">
        <option value="15m">Last 15 minutes</option>
        <option value="1h">Last 1 hour</option>
        <option value="6h">Last 6 hours</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>

      <button type="submit" class="sec-btn-primary justify-center">Apply Filters</button>
    </form>
  </div>

  <!-- Events Table -->
  <div class="sec-card space-y-4">
    {#if $eventsStore.loading}
      <div class="py-10 text-center text-xs text-slate-400">Loading security event timeline...</div>
    {:else if $eventsStore.events.length === 0}
      <div class="py-10 text-center text-xs text-slate-500">No security telemetry events match your filters.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Occurred At</th>
              <th>Source</th>
              <th>Event Type</th>
              <th>Source IP</th>
              <th>Severity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {#each $eventsStore.events as ev (ev.id)}
              <tr>
                <td class="font-mono text-slate-400">{new Date(ev.occurredAt).toLocaleString()}</td>
                <td class="uppercase font-mono text-xs text-indigo-300">{ev.source}</td>
                <td>{ev.eventType}</td>
                <td class="font-mono">{ev.sourceIp || '-'}</td>
                <td><SeverityBadge level={ev.severity} /></td>
                <td>
                  <button
                    type="button"
                    on:click={() => (selectedEvent = ev)}
                    class="px-2.5 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={$eventsStore.pagination} onPageChange={(off) => loadPage(off)} />
    {/if}
  </div>

  <!-- Event Details Modal -->
  {#if selectedEvent}
    <div class="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
      <div class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white">Telemetry Event Details</h3>
          <button
            type="button"
            on:click={() => (selectedEvent = null)}
            class="text-slate-400 hover:text-white cursor-pointer"
            aria-label="Close modal"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span class="text-slate-400 block">Event ID</span>
            <span class="font-mono text-slate-200">{selectedEvent.id}</span>
          </div>
          <div>
            <span class="text-slate-400 block">Occurred At</span>
            <span class="font-mono text-slate-200">{new Date(selectedEvent.occurredAt).toLocaleString()}</span>
          </div>
          <div>
            <span class="text-slate-400 block">Source / Type</span>
            <span class="font-mono text-indigo-300">{selectedEvent.source} / {selectedEvent.eventType}</span>
          </div>
          <div>
            <span class="text-slate-400 block">Source IP</span>
            <span class="font-mono text-slate-200">{selectedEvent.sourceIp || 'N/A'}</span>
          </div>
        </div>

        <div>
          <span class="text-xs text-slate-400 block mb-1">Normalized Event Payload (JSONB)</span>
          <pre class="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">{JSON.stringify(selectedEvent.eventData, null, 2)}</pre>
        </div>
      </div>
    </div>
  {/if}
</div>

