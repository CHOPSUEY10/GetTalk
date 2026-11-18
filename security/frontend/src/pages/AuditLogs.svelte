<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import PaginationControls from '../components/common/PaginationControls.svelte';
  import { auditStore } from '../stores/audit.store.ts';

  let actorFilter = '';
  let actionFilter = '';

  function loadPage(offset = 0) {
    auditStore.load({
      limit: 25,
      offset,
      actorId: actorFilter.trim() || undefined,
      eventType: actionFilter || undefined,
    });
  }

  onMount(() => {
    loadPage(0);
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Security Administrator Audit Logs</h1>
      <p class="text-xs text-slate-400">
        Immutable trail of authentication activity, alert status acknowledgements, and rule modifications
      </p>
    </div>
    <button type="button" on:click={() => loadPage(0)} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $auditStore.error}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {$auditStore.error}
    </div>
  {/if}

  <div class="sec-card">
    <form on:submit|preventDefault={() => loadPage(0)} class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <input
        type="text"
        bind:value={actorFilter}
        placeholder="Filter by Actor ID..."
        aria-label="Filter by Actor ID"
        class="sec-input font-mono"
      />
      <select bind:value={actionFilter} aria-label="Filter by audit action" class="sec-input">
        <option value="">All Audit Actions</option>
        <option value="auth.login_success">auth.login_success</option>
        <option value="auth.login_failed">auth.login_failed</option>
        <option value="auth.login_locked">auth.login_locked</option>
        <option value="alert.status_updated">alert.status_updated</option>
        <option value="rule.created">rule.created</option>
        <option value="rule.updated">rule.updated</option>
        <option value="settings.retention_updated">settings.retention_updated</option>
      </select>
      <button type="submit" class="sec-btn-primary justify-center">Filter Audit Logs</button>
    </form>
  </div>

  <div class="sec-card space-y-4">
    {#if $auditStore.loading}
      <div class="py-10 text-center text-xs text-slate-400">Loading audit logs...</div>
    {:else if $auditStore.logs.length === 0}
      <div class="py-10 text-center text-xs text-slate-500">No audit records match the current filter.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor ID</th>
              <th>Action</th>
              <th>Resource Type</th>
              <th>Resource ID</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {#each $auditStore.logs as item (item.id)}
              <tr>
                <td class="font-mono text-slate-400">{new Date(item.createdAt).toLocaleString()}</td>
                <td class="font-mono text-xs">{item.actorId}</td>
                <td class="font-mono font-semibold text-indigo-300">{item.action}</td>
                <td class="font-mono text-xs">{item.resourceType}</td>
                <td class="font-mono text-xs">{item.resourceId || '-'}</td>
                <td class="font-mono text-xs text-slate-400 max-w-md truncate">
                  {JSON.stringify(item.metadata || {})}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={$auditStore.pagination} onPageChange={(off) => loadPage(off)} />
    {/if}
  </div>
</div>

