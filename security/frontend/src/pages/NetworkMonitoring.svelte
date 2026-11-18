<script lang="ts">
  import { onMount } from 'svelte';
  import HorizontalBarChart from '../components/charts/HorizontalBarChart.svelte';
  import TrafficChart from '../components/charts/TrafficChart.svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import { isValidIPFilter } from '../lib/validators.ts';
  import { networkStore } from '../stores/network.store.ts';

  let sourceIpFilter = '';
  let eventTypeFilter = '';
  let filterError = '';

  function loadPage(offset = 0) {
    filterError = '';
    if (!isValidIPFilter(sourceIpFilter)) {
      filterError = 'Invalid IPv4/IPv6 filter format.';
      return;
    }
    networkStore.load({
      limit: 20,
      offset,
      sourceIp: sourceIpFilter.trim() || undefined,
      eventType: eventTypeFilter || undefined,
    });
  }

  onMount(() => {
    loadPage(0);
  });

  $: topIpBars = ($networkStore.statistics?.topSourceIps || []).map((x) => ({
    label: x.ip,
    value: x.count,
  }));

  $: protoBars = ($networkStore.statistics?.protocolDistribution || []).map((x) => ({
    label: x.protocol,
    value: x.count,
  }));
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Network Layer Monitoring — Firewalld</h1>
      <p class="text-xs text-slate-400">
        Dropped packets, rejected connections, protocol breakdown, and port probe frequency
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $networkStore.error || filterError}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {filterError || $networkStore.error}
    </div>
  {/if}

  {#if $networkStore.statistics}
    {@const st = $networkStore.statistics}
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="sec-card">
        <div class="text-xs text-slate-400">Total Dropped Packets</div>
        <div class="text-2xl font-bold text-rose-400 font-mono mt-1">
          {st.totalDropped.toLocaleString()}
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">Total Rejected Connections</div>
        <div class="text-2xl font-bold text-amber-400 font-mono mt-1">
          {st.totalRejected.toLocaleString()}
        </div>
      </div>
      <div class="sec-card">
        <div class="text-xs text-slate-400">Distinct Blocked Source IPs</div>
        <div class="text-2xl font-bold text-white font-mono mt-1">
          {st.uniqueSourceIps.toLocaleString()}
        </div>
      </div>
    </div>

    <TrafficChart series={st.timeline || []} title="Firewall Connection Rejection & Drop Timeline" />

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <HorizontalBarChart title="Top Blocked Source IP Addresses" items={topIpBars} barColor="bg-rose-500" />
      <HorizontalBarChart title="Protocol Distribution (TCP / UDP / ICMP)" items={protoBars} barColor="bg-indigo-500" />
    </div>
  {/if}

  <!-- Firewall Events Table -->
  <div class="sec-card space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-white">Firewalld Telemetry Events</h2>
      <form
        on:submit|preventDefault={() => loadPage(0)}
        class="flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          bind:value={sourceIpFilter}
          placeholder="Filter by Source IP..."
          aria-label="Filter by Source IP"
          class="sec-input"
        />
        <select bind:value={eventTypeFilter} aria-label="Filter by event type" class="sec-input">
          <option value="">All Actions</option>
          <option value="connection_reject">Connection Reject</option>
          <option value="packet_drop">Packet Drop</option>
        </select>
        <button type="submit" class="sec-btn-primary">Apply Filter</button>
      </form>
    </div>

    {#if $networkStore.loading}
      <div class="py-8 text-center text-xs text-slate-400">Loading firewall telemetry...</div>
    {:else if $networkStore.events.length === 0}
      <div class="py-8 text-center text-xs text-slate-500">No firewall events match the current filter.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event Type</th>
              <th>Source IP</th>
              <th>Destination IP</th>
              <th>Protocol</th>
              <th>Src Port</th>
              <th>Dst Port</th>
              <th>Freq/min</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {#each $networkStore.events as ev (ev.id)}
              <tr>
                <td class="font-mono text-slate-400">{new Date(ev.occurredAt).toLocaleString()}</td>
                <td>{ev.eventType}</td>
                <td class="font-mono text-slate-100">{ev.sourceIp || '-'}</td>
                <td class="font-mono text-slate-300">{ev.destinationIp || '-'}</td>
                <td class="font-mono">{ev.eventData?.protocol || '-'}</td>
                <td class="font-mono">{ev.eventData?.source_port || '-'}</td>
                <td class="font-mono font-semibold text-amber-300">{ev.eventData?.destination_port || '-'}</td>
                <td class="font-mono">{ev.eventData?.source_ip_freq_per_min ?? 1}</td>
                <td><SeverityBadge level={ev.severity} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={$networkStore.pagination} onPageChange={(off) => loadPage(off)} />
    {/if}
  </div>
</div>

