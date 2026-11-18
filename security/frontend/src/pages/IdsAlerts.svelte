<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import type { AlertStatus, SecurityAlert } from '../lib/types/telemetry.ts';
  import { alertsStore } from '../stores/alerts.store.ts';
  import { authStore } from '../stores/auth.store.ts';
  import { uiStore } from '../stores/ui.store.ts';

  let severityFilter = '';
  let statusFilter = '';
  let ruleIdFilter = '';
  let selectedAlert: SecurityAlert | null = null;

  $: canMutateAlert =
    $authStore.user?.role === 'admin' || $authStore.user?.role === 'analyst';

  function loadPage(offset = 0) {
    alertsStore.load({
      limit: 20,
      offset,
      severity: severityFilter || undefined,
      status: statusFilter || undefined,
      ruleId: ruleIdFilter.trim().toUpperCase() || undefined,
    });
  }

  async function handleStatusChange(id: string, nextStatus: AlertStatus) {
    try {
      await alertsStore.updateStatus(id, nextStatus);
      uiStore.notify(`Alert status updated to ${nextStatus}.`, 'success');
    } catch (err: any) {
      uiStore.notify(err?.message || 'Failed to update alert status', 'error');
    }
  }

  onMount(() => {
    loadPage(0);
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">IDS Security Alerts</h1>
      <p class="text-xs text-slate-400">
        Rule-based intrusion detection alerts with deduplication, correlation evidence, and lifecycle management
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $alertsStore.error}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {$alertsStore.error}
    </div>
  {/if}

  <!-- Alert Filters -->
  <div class="sec-card">
    <form on:submit|preventDefault={() => loadPage(0)} class="grid grid-cols-1 sm:grid-cols-4 gap-3">
      <select bind:value={severityFilter} aria-label="Filter by severity" class="sec-input">
        <option value="">All Severities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>

      <select bind:value={statusFilter} aria-label="Filter by status" class="sec-input">
        <option value="">All Statuses</option>
        <option value="open">Open</option>
        <option value="acknowledged">Acknowledged</option>
        <option value="resolved">Resolved</option>
      </select>

      <input
        type="text"
        bind:value={ruleIdFilter}
        placeholder="Rule ID (e.g. NET-001)"
        aria-label="Filter by Rule ID"
        class="sec-input font-mono"
      />

      <button type="submit" class="sec-btn-primary justify-center">Filter Alerts</button>
    </form>
  </div>

  <!-- Alerts Table -->
  <div class="sec-card space-y-4">
    {#if $alertsStore.loading}
      <div class="py-10 text-center text-xs text-slate-400">Loading security alerts...</div>
    {:else if $alertsStore.alerts.length === 0}
      <div class="py-10 text-center text-xs text-slate-500">No security alerts match the current filter.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Title & Description</th>
              <th>Severity</th>
              <th>Source IP</th>
              <th>Events</th>
              <th>First Seen</th>
              <th>Last Seen</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each $alertsStore.alerts as al (al.id)}
              <tr>
                <td class="font-mono font-semibold text-indigo-300">{al.ruleId}</td>
                <td class="max-w-sm">
                  <div class="font-semibold text-slate-100 truncate">{al.title}</div>
                  <div class="text-xs text-slate-400 truncate" title={al.description}>{al.description}</div>
                </td>
                <td><SeverityBadge level={al.severity} /></td>
                <td class="font-mono">{al.sourceIp || '-'}</td>
                <td class="font-mono font-semibold">{al.eventCount}</td>
                <td class="font-mono text-xs text-slate-400">{new Date(al.firstSeen).toLocaleString()}</td>
                <td class="font-mono text-xs text-slate-400">{new Date(al.lastSeen).toLocaleString()}</td>
                <td><SeverityBadge level={al.status} /></td>
                <td>
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      on:click={() => (selectedAlert = al)}
                      class="px-2 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      Evidence
                    </button>
                    {#if canMutateAlert && al.status === 'open'}
                      <button
                        type="button"
                        on:click={() => handleStatusChange(al.id, 'acknowledged')}
                        class="px-2 py-1 rounded text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 cursor-pointer"
                      >
                        Acknowledge
                      </button>
                    {/if}
                    {#if canMutateAlert && al.status !== 'resolved'}
                      <button
                        type="button"
                        on:click={() => handleStatusChange(al.id, 'resolved')}
                        class="px-2 py-1 rounded text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 cursor-pointer"
                      >
                        Resolve
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={$alertsStore.pagination} onPageChange={(off) => loadPage(off)} />
    {/if}
  </div>

  <!-- Evidence Modal -->
  {#if selectedAlert}
    <div class="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
      <div class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-mono text-xs text-indigo-400">{selectedAlert.ruleId}</span>
            <h3 class="text-sm font-bold text-white">{selectedAlert.title}</h3>
          </div>
          <button
            type="button"
            on:click={() => (selectedAlert = null)}
            class="text-slate-400 hover:text-white cursor-pointer"
            aria-label="Close modal"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>

        <p class="text-xs text-slate-300">{selectedAlert.description}</p>

        <div>
          <span class="text-xs text-slate-400 block mb-1">Preserved Detection Evidence</span>
          <pre class="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">{JSON.stringify(selectedAlert.evidence || {}, null, 2)}</pre>
        </div>
      </div>
    </div>
  {/if}
</div>

