<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/common/Icon.svelte';
  import SeverityBadge from '../components/common/SeverityBadge.svelte';
  import { generateQrCodeSvg } from '../lib/qrcode.ts';
  import { validateRetentionInput } from '../lib/validators.ts';
  import { authStore } from '../stores/auth.store.ts';
  import { settingsStore } from '../stores/settings.store.ts';
  import { uiStore } from '../stores/ui.store.ts';

  let eventsDays = 30;
  let metricsDays = 90;
  let alertsDays = 180;
  let cleanupHours = 6;
  let retentionError = '';

  let mfaSecret = '';
  let mfaOtpUri = '';
  let mfaQrSvg = '';
  let mfaCode = '';
  let copiedMfaSecret = false;

  $: isAdmin = $authStore.user?.role === 'admin';

  $: if (mfaOtpUri) {
    try {
      mfaQrSvg = generateQrCodeSvg(mfaOtpUri, {
        size: 196,
        title: 'GetTalk Security TOTP MFA QR Code',
      });
    } catch {
      mfaQrSvg = '';
    }
  } else {
    mfaQrSvg = '';
  }

  $: if ($settingsStore.settings) {
    eventsDays = $settingsStore.settings.retention.telemetryEventsDays;
    metricsDays = $settingsStore.settings.retention.systemMetricsDays;
    alertsDays = $settingsStore.settings.retention.securityAlertsDays;
    cleanupHours = $settingsStore.settings.retention.cleanupIntervalHours;
  }

  async function handleSaveRetention(e: SubmitEvent) {
    e.preventDefault();
    retentionError = '';
    const err = validateRetentionInput({
      telemetryEventsDays: Number(eventsDays),
      systemMetricsDays: Number(metricsDays),
      securityAlertsDays: Number(alertsDays),
    });
    if (err) {
      retentionError = err;
      return;
    }
    try {
      await settingsStore.saveRetention({
        cleanupIntervalHours: Number(cleanupHours) || 6,
        telemetryEventsDays: Number(eventsDays),
        systemMetricsDays: Number(metricsDays),
        securityAlertsDays: Number(alertsDays),
      });
      uiStore.notify('Retention policy updated successfully.', 'success');
    } catch (err: any) {
      retentionError = err?.message || 'Failed to update retention policy';
    }
  }

  async function handleStartMfaSetup() {
    try {
      const res = await authStore.setupMfa();
      mfaSecret = res.secret;
      mfaOtpUri = res.otpauthUri;
    } catch (err: any) {
      uiStore.notify(err?.message || 'Failed to initialize MFA setup', 'error');
    }
  }

  async function handleCopyMfaSecret() {
    if (!mfaSecret) return;
    try {
      await navigator.clipboard?.writeText(mfaSecret);
      copiedMfaSecret = true;
      setTimeout(() => {
        copiedMfaSecret = false;
      }, 2000);
    } catch {
      copiedMfaSecret = false;
    }
  }

  async function handleEnableMfa(e: SubmitEvent) {
    e.preventDefault();
    try {
      await authStore.enableMfa(mfaCode.trim());
      mfaSecret = '';
      mfaOtpUri = '';
      mfaQrSvg = '';
      mfaCode = '';
      uiStore.notify('Two-Factor Authentication (TOTP) enabled.', 'success');
    } catch (err: any) {
      uiStore.notify(err?.message || 'Invalid MFA verification code', 'error');
    }
  }

  onMount(() => {
    settingsStore.load();
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-white">Telemetry Collector Health & System Settings</h1>
      <p class="text-xs text-slate-400">
        Collector runtime diagnostics, collection intervals, data retention policies, and administrator MFA
      </p>
    </div>
    <button type="button" on:click={() => settingsStore.load()} class="sec-btn-secondary">
      <Icon name="refresh" size="xs" />
      <span>Refresh</span>
    </button>
  </div>

  {#if $settingsStore.error || retentionError}
    <div role="alert" class="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
      {retentionError || $settingsStore.error}
    </div>
  {/if}

  {#if $settingsStore.settings}
    {@const cfg = $settingsStore.settings}
    <!-- Collector Health Cards -->
    <div class="sec-card space-y-4">
      <h2 class="text-sm font-semibold text-white">Independent Telemetry Collectors</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {#each cfg.collectors as col (col.name)}
          <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs font-bold text-slate-200">{col.name}</span>
              <SeverityBadge level={col.status} />
            </div>
            <div class="text-xs text-slate-400 space-y-1">
              <div>Layer: <span class="font-mono text-slate-200 uppercase">{col.source}</span></div>
              <div>Events Collected: <span class="font-mono text-slate-200">{col.eventsCollected.toLocaleString()}</span></div>
              <div>Collection Errors: <span class="font-mono text-slate-200">{col.errorsCount}</span></div>
              <div>
                Last Activity:
                <span class="font-mono text-slate-300">
                  {col.lastCollection ? new Date(col.lastCollection).toLocaleTimeString() : 'Waiting'}
                </span>
              </div>
              {#if col.lastError}
                <div class="text-[11px] text-amber-400 truncate" title={col.lastError}>
                  Note: {col.lastError}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Collection Intervals & Engine Mode -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="sec-card space-y-3">
        <h2 class="text-sm font-semibold text-white">Collection & Detection Engine Configuration</h2>
        <div class="space-y-2 text-xs">
          <div class="flex justify-between py-2 border-b border-slate-800">
            <span class="text-slate-400">IDS Execution Mode</span>
            <span class="font-mono text-emerald-400 font-semibold">
              {cfg.passiveModeOnly ? 'Passive Detection Only (Enforced)' : 'Active'}
            </span>
          </div>
          <div class="flex justify-between py-2 border-b border-slate-800">
            <span class="text-slate-400">Firewalld Source</span>
            <span class="font-mono text-slate-200">Journald Streaming (Event-Driven)</span>
          </div>
          <div class="flex justify-between py-2 border-b border-slate-800">
            <span class="text-slate-400">Nginx Log Poll Interval</span>
            <span class="font-mono text-slate-200">{cfg.nginxPollIntervalMs} ms (Incremental)</span>
          </div>
          <div class="flex justify-between py-2 border-b border-slate-800">
            <span class="text-slate-400">PM2 Collection Interval</span>
            <span class="font-mono text-slate-200">{cfg.pm2CollectionIntervalSec} seconds</span>
          </div>
          <div class="flex justify-between py-2">
            <span class="text-slate-400">IDS Rule Evaluation Interval</span>
            <span class="font-mono text-slate-200">{cfg.idsEvaluationIntervalSec} seconds</span>
          </div>
        </div>
      </div>

      <!-- Configurable Retention Policy -->
      <div class="sec-card space-y-4">
        <h2 class="text-sm font-semibold text-white">Configurable Data Retention Policy</h2>
        <form on:submit={handleSaveRetention} class="space-y-3">
          <div>
            <label for="ret-events" class="block text-xs text-slate-300 mb-1">
              Raw Telemetry Events Retention (Days)
            </label>
            <input
              id="ret-events"
              type="number"
              disabled={!isAdmin}
              bind:value={eventsDays}
              class="sec-input w-full"
            />
          </div>

          <div>
            <label for="ret-metrics" class="block text-xs text-slate-300 mb-1">
              System Metrics Retention (Days)
            </label>
            <input
              id="ret-metrics"
              type="number"
              disabled={!isAdmin}
              bind:value={metricsDays}
              class="sec-input w-full"
            />
          </div>

          <div>
            <label for="ret-alerts" class="block text-xs text-slate-300 mb-1">
              Security Alerts Retention (Days)
            </label>
            <input
              id="ret-alerts"
              type="number"
              disabled={!isAdmin}
              bind:value={alertsDays}
              class="sec-input w-full"
            />
          </div>

          {#if isAdmin}
            <button
              type="submit"
              disabled={$settingsStore.saving}
              class="sec-btn-primary"
            >
              {$settingsStore.saving ? 'Saving...' : 'Update Retention Policy'}
            </button>
          {/if}
        </form>
      </div>
    </div>

    <!-- Administrator TOTP MFA Configuration -->
    <div class="sec-card space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-white">Administrator Multi-Factor Authentication (TOTP)</h2>
          <p class="text-xs text-slate-400">
            Protect administrator console access with RFC 6238 6-digit authenticator verification
          </p>
        </div>
        <SeverityBadge level={$authStore.user?.mfaEnabled ? 'healthy' : 'low'} />
      </div>

      {#if !$authStore.user?.mfaEnabled}
        {#if !mfaSecret}
          <button type="button" on:click={handleStartMfaSetup} class="sec-btn-secondary">
            Generate TOTP MFA Secret
          </button>
        {:else}
          <form on:submit={handleEnableMfa} class="space-y-4 max-w-xl pt-2">
            <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5 p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div
                class="w-[212px] h-[212px] p-2 rounded-xl bg-white border border-slate-700 flex items-center justify-center shrink-0"
                data-testid="sec-mfa-qr-container"
              >
                {#if mfaQrSvg}
                  {@html mfaQrSvg}
                {:else}
                  <span class="text-xs text-slate-400">QR Code Unavailable</span>
                {/if}
              </div>

              <div class="flex-1 min-w-0 space-y-3 text-xs">
                <div>
                  <p class="font-semibold text-white">1. Scan QR Code with Authenticator App</p>
                  <p class="text-slate-400 mt-0.5">
                    Open Google Authenticator, Authy, 1Password, or Microsoft Authenticator and scan this QR code.
                  </p>
                </div>

                <div class="space-y-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-slate-300 font-medium">Manual Setup Secret Key:</span>
                    <button
                      type="button"
                      on:click={handleCopyMfaSecret}
                      class="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      {copiedMfaSecret ? '✓ Copied' : 'Copy Secret'}
                    </button>
                  </div>
                  <code class="block select-all break-all font-mono text-indigo-300 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-lg">
                    {mfaSecret}
                  </code>
                </div>

                <details class="text-[11px] text-slate-500">
                  <summary class="cursor-pointer hover:text-slate-400 select-none">
                    Show raw otpauth:// URI
                  </summary>
                  <div class="mt-1.5 p-2 rounded-lg bg-slate-900/80 border border-slate-800 break-all font-mono text-slate-400 select-all">
                    {mfaOtpUri}
                  </div>
                </details>
              </div>
            </div>

            <div class="space-y-1.5">
              <label for="sec-mfa-verify-code" class="block text-xs text-slate-300 font-medium">
                2. Enter 6-Digit Authenticator Verification Code
              </label>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  id="sec-mfa-verify-code"
                  type="text"
                  inputmode="numeric"
                  bind:value={mfaCode}
                  maxlength="6"
                  placeholder="123456"
                  required
                  class="sec-input font-mono tracking-widest w-40"
                />
                <button type="submit" class="sec-btn-primary">Verify & Enable MFA</button>
                <button
                  type="button"
                  on:click={() => {
                    mfaSecret = '';
                    mfaOtpUri = '';
                    mfaQrSvg = '';
                    mfaCode = '';
                  }}
                  class="sec-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        {/if}
      {:else}
        <p class="text-xs text-emerald-400">TOTP Multi-Factor Authentication is active for your account.</p>
      {/if}
    </div>
  {/if}
</div>

