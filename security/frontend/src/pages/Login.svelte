<script lang="ts">
  import Icon from '../components/common/Icon.svelte';
  import { authStore } from '../stores/auth.store.ts';

  let username = '';
  let password = '';
  let mfaCode = '';
  let submitting = false;

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    submitting = true;
    try {
      await authStore.login(username.trim(), password);
    } catch {
      // Handled in authStore
    } finally {
      submitting = false;
    }
  }

  async function handleMfaVerify(e: SubmitEvent) {
    e.preventDefault();
    if (!$authStore.challengeId || !mfaCode.trim()) return;
    submitting = true;
    try {
      await authStore.verifyMfa($authStore.challengeId, mfaCode.trim());
    } catch {
      // Handled in authStore
    } finally {
      submitting = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
  <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
        <Icon name="shield" size="md" />
      </div>
      <div>
        <h1 class="text-lg font-bold text-white leading-tight">GetTalk Security</h1>
        <p class="text-xs text-slate-400">Telemetry & Intrusion Detection Dashboard</p>
      </div>
    </div>

    {#if $authStore.error}
      <div role="alert" class="mb-4 px-3.5 py-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
        {$authStore.error}
      </div>
    {/if}

    {#if !$authStore.mfaRequired}
      <form on:submit={handleLogin} class="space-y-4">
        <div>
          <label for="sec-username" class="block text-xs font-medium text-slate-300 mb-1">
            Administrator Username or Email
          </label>
          <input
            id="sec-username"
            type="text"
            bind:value={username}
            required
            autocomplete="username"
            class="sec-input w-full"
            placeholder="secadmin"
          />
        </div>

        <div>
          <label for="sec-password" class="block text-xs font-medium text-slate-300 mb-1">
            Password
          </label>
          <input
            id="sec-password"
            type="password"
            bind:value={password}
            required
            autocomplete="current-password"
            class="sec-input w-full"
            placeholder="••••••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          class="sec-btn-primary w-full justify-center py-2.5"
        >
          {submitting ? 'Authenticating...' : 'Sign In to Security Console'}
        </button>
      </form>
    {:else}
      <form on:submit={handleMfaVerify} class="space-y-4">
        <div>
          <label for="sec-mfa-code" class="block text-xs font-medium text-slate-300 mb-1">
            6-Digit Authenticator (TOTP) Code
          </label>
          <input
            id="sec-mfa-code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            bind:value={mfaCode}
            required
            class="sec-input w-full font-mono text-center tracking-widest text-base"
            placeholder="000000"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          class="sec-btn-primary w-full justify-center py-2.5"
        >
          {submitting ? 'Verifying...' : 'Verify MFA & Continue'}
        </button>
      </form>
    {/if}
  </div>
</div>

