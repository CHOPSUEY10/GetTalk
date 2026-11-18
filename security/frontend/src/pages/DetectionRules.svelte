<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import type { DetectionRule, RuleType, SeverityLevel } from '../lib/types/telemetry.ts';
  import { validateRuleInput } from '../lib/validators.ts';
  import { authStore } from '../stores/auth.store.ts';
  import { rulesStore } from '../stores/rules.store.ts';
  import { uiStore } from '../stores/ui.store.ts';

  $: isAdmin = $authStore.user?.role === 'admin';

  let editingRule: DetectionRule | null = null;
  let editThreshold = 0;
  let editTimeWindow = 60;
  let editSeverity: SeverityLevel = 'medium';

  let showCreateModal = false;
  let newRuleId = '';
  let newRuleName = '';
  let newRuleType: RuleType = 'threshold';
  let newThreshold = 50;
  let newTimeWindow = 60;
  let newSeverity: SeverityLevel = 'medium';
  let newSource = 'firewalld';
  let formError = '';

  async function toggleRuleEnabled(rule: DetectionRule) {
    if (!isAdmin) return;
    try {
      await rulesStore.patch(rule.id, { enabled: !rule.enabled });
      uiStore.notify(
        `Rule ${rule.id} ${!rule.enabled ? 'enabled' : 'disabled'}.`,
        'success'
      );
    } catch (err: any) {
      uiStore.notify(err?.message || 'Failed to update rule', 'error');
    }
  }

  function openEditModal(rule: DetectionRule) {
    editingRule = rule;
    editThreshold = rule.threshold;
    editTimeWindow = rule.timeWindow;
    editSeverity = rule.severity;
    formError = '';
  }

  async function saveEditedRule(e: SubmitEvent) {
    e.preventDefault();
    if (!editingRule) return;
    const err = validateRuleInput({
      id: editingRule.id,
      ruleName: editingRule.ruleName,
      threshold: Number(editThreshold),
      timeWindow: Number(editTimeWindow),
    });
    if (err) {
      formError = err;
      return;
    }
    try {
      await rulesStore.patch(editingRule.id, {
        threshold: Number(editThreshold),
        timeWindow: Number(editTimeWindow),
        severity: editSeverity,
      });
      uiStore.notify(`Updated rule ${editingRule.id}.`, 'success');
      editingRule = null;
    } catch (err: any) {
      formError = err?.message || 'Failed to update rule';
    }
  }

  async function handleCreateRule(e: SubmitEvent) {
    e.preventDefault();
    formError = '';
    const err = validateRuleInput({
      id: newRuleId,
      ruleName: newRuleName,
      threshold: Number(newThreshold),
      timeWindow: Number(newTimeWindow),
    });
    if (err) {
      formError = err;
      return;
    }
    try {
      await rulesStore.create({
        id: newRuleId.trim().toUpperCase(),
        ruleName: newRuleName.trim(),
        ruleType: newRuleType,
        threshold: Number(newThreshold),
        timeWindow: Number(newTimeWindow),
        severity: newSeverity,
        enabled: true,
        configuration: { source: newSource },
      });
      uiStore.notify(`Created rule ${newRuleId.toUpperCase()}.`, 'success');
      showCreateModal = false;
      newRuleId = '';
      newRuleName = '';
    } catch (err: any) {
      formError = err?.message || 'Failed to create rule';
    }
  }

  onMount(() => {
    rulesStore.load();
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">IDS Detection Rules</h1>
      <p class="text-xs text-slate-400">
        Configure passive intrusion detection thresholds, evaluation windows, and rule status
      </p>
    </div>

    <div class="flex items-center gap-2">
      {#if isAdmin}
        <button
          type="button"
          on:click={() => {
            formError = '';
            showCreateModal = true;
          }}
          class="sec-btn-primary"
        >
          <Icon name="plus" size="xs" />
          <span>New Detection Rule</span>
        </button>
      {/if}
      <button type="button" on:click={() => rulesStore.load()} class="sec-btn-secondary">
        <Icon name="refresh" size="xs" />
        <span>Refresh</span>
      </button>
    </div>
  </div>

  {#if $rulesStore.error}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {$rulesStore.error}
    </div>
  {/if}

  <div class="sec-card">
    {#if $rulesStore.loading}
      <div class="py-10 text-center text-xs text-slate-400">Loading detection rules...</div>
    {:else if $rulesStore.rules.length === 0}
      <div class="py-10 text-center text-xs text-slate-500">No detection rules configured.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="sec-table">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Name</th>
              <th>Rule Type</th>
              <th>Threshold</th>
              <th>Time Window</th>
              <th>Severity</th>
              <th>Enabled</th>
              {#if isAdmin}
                <th>Configure</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each $rulesStore.rules as rule (rule.id)}
              <tr>
                <td class="font-mono font-bold text-indigo-300">{rule.id}</td>
                <td>
                  <div class="font-semibold text-white">{rule.ruleName}</div>
                  {#if rule.configuration?.description}
                    <div class="text-xs text-slate-400 max-w-md truncate">{rule.configuration.description}</div>
                  {/if}
                </td>
                <td class="font-mono text-xs">{rule.ruleType}</td>
                <td class="font-mono font-semibold">{rule.threshold}</td>
                <td class="font-mono">{rule.timeWindow}s</td>
                <td><SeverityBadge level={rule.severity} /></td>
                <td>
                  <button
                    type="button"
                    disabled={!isAdmin}
                    on:click={() => toggleRuleEnabled(rule)}
                    class="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer disabled:opacity-50 {rule.enabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'}"
                  >
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </td>
                {#if isAdmin}
                  <td>
                    <button
                      type="button"
                      on:click={() => openEditModal(rule)}
                      class="px-2.5 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      Edit Threshold
                    </button>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Edit Rule Modal -->
  {#if editingRule}
    <div class="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
      <form
        on:submit={saveEditedRule}
        class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white">Configure Rule {editingRule.id}</h3>
          <button
            type="button"
            on:click={() => (editingRule = null)}
            class="text-slate-400 hover:text-white cursor-pointer"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>

        {#if formError}
          <div class="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
            {formError}
          </div>
        {/if}

        <div>
          <label for="edit-threshold" class="block text-xs text-slate-300 mb-1">Threshold</label>
          <input id="edit-threshold" type="number" step="any" bind:value={editThreshold} class="sec-input w-full" />
        </div>

        <div>
          <label for="edit-window" class="block text-xs text-slate-300 mb-1">Time Window (seconds)</label>
          <input id="edit-window" type="number" bind:value={editTimeWindow} class="sec-input w-full" />
        </div>

        <div>
          <label for="edit-severity" class="block text-xs text-slate-300 mb-1">Severity</label>
          <select id="edit-severity" bind:value={editSeverity} class="sec-input w-full">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" on:click={() => (editingRule = null)} class="sec-btn-secondary">Cancel</button>
          <button type="submit" class="sec-btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Create Rule Modal -->
  {#if showCreateModal}
    <div class="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
      <form
        on:submit={handleCreateRule}
        class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white">Create Detection Rule</h3>
          <button
            type="button"
            on:click={() => (showCreateModal = false)}
            class="text-slate-400 hover:text-white cursor-pointer"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>

        {#if formError}
          <div class="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
            {formError}
          </div>
        {/if}

        <div>
          <label for="new-rule-id" class="block text-xs text-slate-300 mb-1">Rule ID (e.g. NET-003)</label>
          <input id="new-rule-id" type="text" bind:value={newRuleId} required class="sec-input w-full font-mono" />
        </div>

        <div>
          <label for="new-rule-name" class="block text-xs text-slate-300 mb-1">Rule Name</label>
          <input id="new-rule-name" type="text" bind:value={newRuleName} required class="sec-input w-full" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="new-rule-type" class="block text-xs text-slate-300 mb-1">Rule Type</label>
            <select id="new-rule-type" bind:value={newRuleType} class="sec-input w-full">
              <option value="threshold">Threshold</option>
              <option value="distinct_count">Distinct Count</option>
              <option value="signature">Signature</option>
              <option value="metric_sustained">Metric Sustained</option>
              <option value="metric_delta">Metric Delta</option>
            </select>
          </div>
          <div>
            <label for="new-rule-source" class="block text-xs text-slate-300 mb-1">Source Layer</label>
            <select id="new-rule-source" bind:value={newSource} class="sec-input w-full">
              <option value="firewalld">Firewalld</option>
              <option value="nginx">Nginx</option>
              <option value="pm2">PM2</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label for="new-threshold" class="block text-xs text-slate-300 mb-1">Threshold</label>
            <input id="new-threshold" type="number" bind:value={newThreshold} class="sec-input w-full" />
          </div>
          <div>
            <label for="new-window" class="block text-xs text-slate-300 mb-1">Window (s)</label>
            <input id="new-window" type="number" bind:value={newTimeWindow} class="sec-input w-full" />
          </div>
          <div>
            <label for="new-severity" class="block text-xs text-slate-300 mb-1">Severity</label>
            <select id="new-severity" bind:value={newSeverity} class="sec-input w-full">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" on:click={() => (showCreateModal = false)} class="sec-btn-secondary">Cancel</button>
          <button type="submit" class="sec-btn-primary">Create Rule</button>
        </div>
      </form>
    </div>
  {/if}
</div>

