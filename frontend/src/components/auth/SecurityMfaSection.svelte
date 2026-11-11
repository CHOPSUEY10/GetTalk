<script>
  import { onMount } from "svelte";
  import { authStore } from "../../stores/auth.store.js";
  import { userStore } from "../../stores/user.store.js";
  import Icon from "../common/Icon.svelte";
  import {
    validatePasswordChangeInput,
    validatePasscodeInput,
  } from "../../lib/validators.js";
  import {
    PAGE_ERROR_CODES,
    getPageErrorMessage,
    createValidationError,
  } from "../../lib/errors/pageerror.js";

  // ── Change Password State ───────────────────────────────────────
  let currentPassword = "";
  let newPassword = "";
  let confirmPassword = "";
  let passwordMfaCode = "";
  let changingPassword = false;
  let passwordMessage = "";
  let passwordError = "";

  // ── MFA & Recovery Codes State ──────────────────────────────────
  let mfaEnabled = Boolean($authStore.user?.mfaEnabled ?? $userStore?.mfaEnabled);
  let remainingRecoveryCodes = $userStore?.remainingRecoveryCodesCount ?? 0;
  let loadingMfa = false;
  let mfaPassword = "";
  let mfaCode = "";
  let setupSecret = "";
  let otpauthUri = "";
  let recoveryCodes = [];
  let showRegenerateForm = false;
  let regeneratePassword = "";
  let regenerateCode = "";
  let mfaMessage = "";
  let mfaError = "";

  // ── E2EE & Local App Lock State ─────────────────────────────────
  let copiedFingerprint = false;
  let passcodeInput = "";
  let autoLockMinutes = 5;
  let disablePasscodeInput = "";
  let appLockMessage = "";
  let appLockError = "";

  $: mfaEnabled = Boolean($authStore.user?.mfaEnabled ?? $userStore?.mfaEnabled);
  $: remainingRecoveryCodes =
    $userStore?.remainingRecoveryCodesCount ??
    $authStore.user?.remainingRecoveryCodesCount ??
    0;
  $: securityChangeNotifications =
    $userStore?.privacySettings?.securityChangeNotifications ?? true;

  onMount(async () => {
    try {
      const status = await authStore.getMfaStatus();
      mfaEnabled = Boolean(status?.enabled);
      if (typeof status?.remainingRecoveryCodesCount === "number") {
        remainingRecoveryCodes = status.remainingRecoveryCodesCount;
      }
    } catch {
      // Status already available from session/profile
    }

    const uid = $authStore.user?.id || $userStore?.id;
    if (uid) {
      userStore.loadOwnIdentityKey(uid);
    }
  });

  async function handleChangePassword() {
    passwordMessage = "";
    passwordError = "";

    const validation = validatePasswordChangeInput({
      currentPassword,
      newPassword,
      confirmPassword,
      mfaEnabled,
      mfaCode: passwordMfaCode,
    });
    if (!validation.valid) {
      passwordError = createValidationError(validation.code, "password").userMessage;
      return;
    }

    changingPassword = true;
    try {
      const res = await authStore.changePassword({
        currentPassword,
        newPassword,
        mfaCode: mfaEnabled ? passwordMfaCode.trim() : undefined,
      });
      currentPassword = "";
      newPassword = "";
      confirmPassword = "";
      passwordMfaCode = "";
      const revoked = res?.revokedSessionsCount ?? 0;
      passwordMessage =
        revoked > 0
          ? `Kata sandi berhasil diperbarui dan ${revoked} sesi perangkat lain telah dihentikan.`
          : "Kata sandi berhasil diperbarui.";
    } catch (err) {
      passwordError = getPageErrorMessage(err, {
        context: "password",
        fallbackCode: PAGE_ERROR_CODES.PASSWORD_CHANGE_FAILED,
      });
    } finally {
      changingPassword = false;
    }
  }

  async function handleStartMfaSetup() {
    mfaError = "";
    mfaMessage = "";
    recoveryCodes = [];
    if (!mfaPassword) {
      mfaError = createValidationError(PAGE_ERROR_CODES.REQUIRED_FIELDS, "security-settings").userMessage;
      return;
    }

    loadingMfa = true;
    try {
      const res = await authStore.setupMfa({ password: mfaPassword });
      setupSecret = res.secret;
      otpauthUri = res.otpauthUri;
      mfaPassword = "";
    } catch (err) {
      mfaError = getPageErrorMessage(err, {
        context: "security-settings",
        fallbackCode: PAGE_ERROR_CODES.MFA_SETUP_FAILED,
      });
    } finally {
      loadingMfa = false;
    }
  }

  async function handleConfirmEnableMfa() {
    mfaError = "";
    mfaMessage = "";
    if (!/^\d{6}$/.test(mfaCode.trim())) {
      mfaError = createValidationError(PAGE_ERROR_CODES.MFA_SETUP_CODE_INVALID, "security-settings").userMessage;
      return;
    }

    loadingMfa = true;
    try {
      const res = await authStore.enableMfa({ code: mfaCode.trim() });
      mfaEnabled = true;
      recoveryCodes = res.recoveryCodes || [];
      remainingRecoveryCodes = res.remainingRecoveryCodesCount ?? recoveryCodes.length;
      setupSecret = "";
      otpauthUri = "";
      mfaCode = "";
      mfaMessage = "MFA berhasil diaktifkan. Simpan kode pemulihan sekali pakai Anda di tempat aman.";
    } catch (err) {
      mfaError = getPageErrorMessage(err, {
        context: "security-settings",
        fallbackCode: PAGE_ERROR_CODES.INVALID_MFA_CODE,
      });
    } finally {
      loadingMfa = false;
    }
  }

  async function handleDisableMfa() {
    mfaError = "";
    mfaMessage = "";
    if (!mfaPassword || !mfaCode.trim()) {
      mfaError = createValidationError(PAGE_ERROR_CODES.REQUIRED_FIELDS, "security-settings").userMessage;
      return;
    }

    loadingMfa = true;
    try {
      await authStore.disableMfa({ password: mfaPassword, code: mfaCode.trim() });
      mfaEnabled = false;
      recoveryCodes = [];
      remainingRecoveryCodes = 0;
      mfaPassword = "";
      mfaCode = "";
      showRegenerateForm = false;
      mfaMessage = "Autentikasi dua faktor (MFA) telah dinonaktifkan.";
    } catch (err) {
      mfaError = getPageErrorMessage(err, {
        context: "security-settings",
        fallbackCode: PAGE_ERROR_CODES.MFA_DISABLE_FAILED,
      });
    } finally {
      loadingMfa = false;
    }
  }

  async function handleRegenerateRecoveryCodes() {
    mfaError = "";
    mfaMessage = "";
    if (!regeneratePassword || !/^\d{6}$/.test(regenerateCode.trim())) {
      mfaError = createValidationError(PAGE_ERROR_CODES.REQUIRED_FIELDS, "security-settings").userMessage;
      return;
    }

    loadingMfa = true;
    try {
      const res = await authStore.regenerateRecoveryCodes({
        password: regeneratePassword,
        code: regenerateCode.trim(),
      });
      recoveryCodes = res?.recoveryCodes || [];
      remainingRecoveryCodes = res?.remainingRecoveryCodesCount ?? recoveryCodes.length;
      regeneratePassword = "";
      regenerateCode = "";
      showRegenerateForm = false;
      mfaMessage = "10 kode pemulihan (Recovery Codes) baru berhasil dibuat. Kode lama tidak lagi berlaku.";
    } catch (err) {
      mfaError = getPageErrorMessage(err, {
        context: "security-settings",
        fallbackCode: PAGE_ERROR_CODES.MFA_RECOVERY_REGENERATE_FAILED,
      });
    } finally {
      loadingMfa = false;
    }
  }

  async function handleToggleSecurityNotifications() {
    try {
      await userStore.updatePrivacySettings({
        securityChangeNotifications: !securityChangeNotifications,
      });
    } catch {
      // Handled in store
    }
  }

  async function copyIdentityFingerprint() {
    const text =
      $userStore?.identityKey?.safetyNumber ||
      $userStore?.identityKey?.formattedFingerprint ||
      "";
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      copiedFingerprint = true;
      setTimeout(() => {
        copiedFingerprint = false;
      }, 2000);
    } catch {
      // Clipboard unavailable
    }
  }

  async function handleSetupAppLock() {
    appLockMessage = "";
    appLockError = "";
    const validation = validatePasscodeInput(passcodeInput);
    if (!validation.valid) {
      appLockError = createValidationError(validation.code).userMessage;
      return;
    }
    try {
      await userStore.setupAppLock(passcodeInput.trim(), Number(autoLockMinutes) || 5);
      passcodeInput = "";
      appLockMessage = "Kunci Aplikasi Lokal (PIN) berhasil diaktifkan.";
    } catch (err) {
      appLockError = getPageErrorMessage(err, {
        fallbackCode: PAGE_ERROR_CODES.PASSCODE_INVALID,
      });
    }
  }

  async function handleDisableAppLock() {
    appLockMessage = "";
    appLockError = "";
    try {
      await userStore.disableAppLock(disablePasscodeInput.trim());
      disablePasscodeInput = "";
      appLockMessage = "Kunci Aplikasi Lokal telah dinonaktifkan.";
    } catch (err) {
      appLockError = getPageErrorMessage(err, {
        fallbackCode: PAGE_ERROR_CODES.PASSCODE_INCORRECT,
      });
    }
  }
</script>

<div class="space-y-6">
  <!-- 1. Change Password Card -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
        <Icon name="key" size="md" />
      </div>
      <div>
        <h2 class="text-base font-bold text-slate-900 dark:text-white">
          Ubah Kata Sandi
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Mengubah kata sandi akan otomatis mencabut seluruh sesi login aktif di perangkat lain demi keamanan akun Anda.
        </p>
      </div>
    </div>

    {#if passwordError}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {passwordError}
      </div>
    {/if}

    {#if passwordMessage}
      <div
        role="status"
        class="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        {passwordMessage}
      </div>
    {/if}

    <form class="mt-5 space-y-4 max-w-md" on:submit|preventDefault={handleChangePassword}>
      <div>
        <label
          for="sec-current-password"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Kata Sandi Saat Ini
        </label>
        <input
          id="sec-current-password"
          type="password"
          required
          autocomplete="current-password"
          bind:value={currentPassword}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label
          for="sec-new-password"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Kata Sandi Baru (Minimal 8 Karakter)
        </label>
        <input
          id="sec-new-password"
          type="password"
          required
          minlength="8"
          autocomplete="new-password"
          bind:value={newPassword}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label
          for="sec-confirm-password"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Konfirmasi Kata Sandi Baru
        </label>
        <input
          id="sec-confirm-password"
          type="password"
          required
          minlength="8"
          autocomplete="new-password"
          bind:value={confirmPassword}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {#if mfaEnabled}
        <div>
          <label
            for="sec-password-mfa"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Kode Autentikator TOTP / Recovery Code
          </label>
          <input
            id="sec-password-mfa"
            type="text"
            required
            bind:value={passwordMfaCode}
            placeholder="123456"
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
      {/if}

      <div class="pt-1">
        <button
          type="submit"
          disabled={changingPassword}
          class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          <Icon name="shield-check" size="sm" />
          {changingPassword ? "Memperbarui Kata Sandi..." : "Perbarui Kata Sandi"}
        </button>
      </div>
    </form>
  </section>

  <!-- 2. MFA & Recovery Codes Card -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
          <Icon name="shield" size="md" />
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900 dark:text-white">
            Autentikasi Dua Faktor (TOTP MFA) & Recovery Codes
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tambahkan kode autentikator 6-digit saat masuk untuk melindungi akun dan kunci identitas Anda.
          </p>
        </div>
      </div>

      <span
        class="rounded-full px-3 py-1 text-xs font-semibold {mfaEnabled
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}"
      >
        {mfaEnabled ? "Aktif" : "Nonaktif"}
      </span>
    </div>

    {#if mfaError}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {mfaError}
      </div>
    {/if}

    {#if mfaMessage}
      <div
        role="status"
        class="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        {mfaMessage}
      </div>
    {/if}

    {#if recoveryCodes.length > 0}
      <div class="mt-5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-bold text-amber-900 dark:text-amber-200">
            Kode Pemulihan Sekali Pakai (Recovery Codes)
          </h3>
          <button
            type="button"
            on:click={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
            class="inline-flex items-center gap-1 rounded-lg bg-amber-100 dark:bg-amber-900/60 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
          >
            <Icon name="copy" size="xs" />
            Salin Semua
          </button>
        </div>
        <p class="mt-1 text-xs text-amber-800 dark:text-amber-300">
          Simpan kode ini di tempat aman. Setiap kode hanya dapat dipakai satu kali saat Anda kehilangan akses ke aplikasi autentikator.
        </p>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 font-mono text-xs text-slate-900 dark:text-slate-100">
          {#each recoveryCodes as recoveryCode}
            <div class="rounded-lg bg-white dark:bg-slate-900 px-3 py-2 border border-amber-200/80 dark:border-slate-800">
              {recoveryCode}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if !mfaEnabled && !setupSecret}
      <form class="mt-5 space-y-4 max-w-md" on:submit|preventDefault={handleStartMfaSetup}>
        <div>
          <label
            for="mfa-setup-password"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Konfirmasi Kata Sandi untuk Mengaktifkan MFA
          </label>
          <input
            id="mfa-setup-password"
            type="password"
            required
            autocomplete="current-password"
            bind:value={mfaPassword}
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loadingMfa}
          class="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          {loadingMfa ? "Menyiapkan..." : "Mulai Pengaturan MFA"}
        </button>
      </form>
    {:else if !mfaEnabled && setupSecret}
      <form class="mt-5 space-y-4 max-w-md" on:submit|preventDefault={handleConfirmEnableMfa}>
        <div class="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-4 border border-slate-200 dark:border-slate-700">
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Kunci Rahasia TOTP (Masukkan ke Google Authenticator / Authy / 1Password)
          </p>
          <p class="mt-2 select-all break-all font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
            {setupSecret}
          </p>
          <p class="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {otpauthUri}
          </p>
        </div>

        <div>
          <label
            for="mfa-enable-code"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Kode Verifikasi 6-Digit dari Aplikasi Autentikator
          </label>
          <input
            id="mfa-enable-code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            required
            bind:value={mfaCode}
            placeholder="123456"
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono tracking-widest text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div class="flex items-center gap-2.5">
          <button
            type="submit"
            disabled={loadingMfa}
            class="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            {loadingMfa ? "Memverifikasi..." : "Aktifkan MFA Sekarang"}
          </button>
          <button
            type="button"
            on:click={() => {
              setupSecret = "";
              otpauthUri = "";
              mfaCode = "";
            }}
            class="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            Batal
          </button>
        </div>
      </form>
    {:else}
      <!-- MFA is Active: Show Remaining Recovery Codes + Regenerate + Disable -->
      <div class="mt-5 space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200/80 dark:border-slate-800">
          <div>
            <p class="text-xs font-bold text-slate-800 dark:text-slate-200">
              Sisa Kode Pemulihan (Recovery Codes): <span class="text-indigo-600 dark:text-indigo-400">{remainingRecoveryCodes} kode belum terpakai</span>
            </p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Buat ulang kode pemulihan jika kode Anda hampir habis atau dicurigai bocor.
            </p>
          </div>
          <button
            type="button"
            on:click={() => {
              showRegenerateForm = !showRegenerateForm;
              mfaError = "";
            }}
            class="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-3.5 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300 transition-colors cursor-pointer"
          >
            <Icon name="refresh" size="xs" />
            Regenerate Recovery Codes
          </button>
        </div>

        {#if showRegenerateForm}
          <form
            class="space-y-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 max-w-md"
            on:submit|preventDefault={handleRegenerateRecoveryCodes}
          >
            <h3 class="text-xs font-bold text-slate-800 dark:text-slate-200">
              Buat Ulang 10 Kode Pemulihan Baru
            </h3>
            <div>
              <label
                for="regen-password"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Kata Sandi Saat Ini
              </label>
              <input
                id="regen-password"
                type="password"
                required
                bind:value={regeneratePassword}
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label
                for="regen-totp"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Kode TOTP 6-Digit
              </label>
              <input
                id="regen-totp"
                type="text"
                inputmode="numeric"
                maxlength="6"
                required
                bind:value={regenerateCode}
                placeholder="123456"
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                disabled={loadingMfa}
                class="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                {loadingMfa ? "Membuat Ulang..." : "Konfirmasi Buat Ulang"}
              </button>
              <button
                type="button"
                on:click={() => (showRegenerateForm = false)}
                class="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </form>
        {/if}

        <form class="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800 max-w-md" on:submit|preventDefault={handleDisableMfa}>
          <h3 class="text-xs font-bold text-slate-800 dark:text-slate-200">
            Nonaktifkan MFA
          </h3>
          <div>
            <label
              for="mfa-disable-password"
              class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Kata Sandi Saat Ini
            </label>
            <input
              id="mfa-disable-password"
              type="password"
              required
              bind:value={mfaPassword}
              class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label
              for="mfa-disable-code"
              class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Kode Autentikator atau Recovery Code
            </label>
            <input
              id="mfa-disable-code"
              type="text"
              required
              bind:value={mfaCode}
              class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loadingMfa}
            class="rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            {loadingMfa ? "Memproses..." : "Nonaktifkan MFA"}
          </button>
        </form>
      </div>
    {/if}
  </section>

  <!-- 3. E2EE Identity Key & Local App Passcode Lock -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
        <Icon name="shield-check" size="md" />
      </div>
      <div>
        <h2 class="text-base font-bold text-slate-900 dark:text-white">
          Keamanan End-to-End Encryption (E2EE) & Kunci Lokal
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Kunci privat identitas E2EE disimpan secara eksklusif di perangkat ini dan tidak pernah dikirim ke server.
        </p>
      </div>
    </div>

    <div class="mt-5 space-y-5">
      <!-- Device Identity Key Fingerprint / Safety Number -->
      <div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200/80 dark:border-slate-800">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-bold text-slate-800 dark:text-slate-200">
            Sidik Jari Kunci Identitas Perangkat (Safety Number)
          </p>
          <button
            type="button"
            on:click={copyIdentityFingerprint}
            class="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Icon name="copy" size="xs" />
            {copiedFingerprint ? "Tersalin!" : "Salin Sidik Jari"}
          </button>
        </div>

        {#if $userStore?.identityKey}
          <div class="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2 font-mono text-xs text-indigo-700 dark:text-indigo-300">
            {#each $userStore.identityKey.safetyNumberBlocks || [] as block}
              <div class="rounded-lg bg-white dark:bg-slate-900 px-2.5 py-1.5 text-center border border-slate-200 dark:border-slate-700 font-semibold">
                {block}
              </div>
            {/each}
          </div>
          <p class="mt-2.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
            SHA-256: {$userStore.identityKey.formattedFingerprint}
          </p>
        {:else}
          <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Memuat sidik jari kunci identitas perangkat...
          </p>
        {/if}
      </div>

      <!-- Security Change Notification Toggle -->
      <div class="flex items-center justify-between gap-4 pt-2">
        <div>
          <p class="text-sm font-semibold text-slate-900 dark:text-white">
            Tampilkan Notifikasi Keamanan di Ruang Obrolan
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tampilkan peringatan otomatis di dalam ruang chat saat kunci identitas E2EE lawan bicara berubah (misal karena ganti perangkat).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={securityChangeNotifications}
          aria-label="Tampilkan Notifikasi Keamanan"
          on:click={handleToggleSecurityNotifications}
          class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer {securityChangeNotifications ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}"
        >
          <span
            class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 {securityChangeNotifications ? 'translate-x-5' : 'translate-x-0'}"
          ></span>
        </button>
      </div>

      <!-- Local App Passcode Lock -->
      <div class="pt-4 border-t border-slate-100 dark:border-slate-800">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">
              Kunci Aplikasi Lokal (App Passcode Lock)
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Lindungi tampilan pesan dan akses kunci lokal di browser ini dengan PIN 4–8 digit.
            </p>
          </div>
          <span
            class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold {$userStore.appLock?.enabled
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}"
          >
            {$userStore.appLock?.enabled ? "PIN Aktif" : "PIN Nonaktif"}
          </span>
        </div>

        {#if appLockError}
          <div
            role="alert"
            class="mt-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
          >
            {appLockError}
          </div>
        {/if}

        {#if appLockMessage}
          <div
            role="status"
            class="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
          >
            {appLockMessage}
          </div>
        {/if}

        {#if !$userStore.appLock?.enabled}
          <form class="mt-4 flex flex-wrap items-end gap-3" on:submit|preventDefault={handleSetupAppLock}>
            <div>
              <label
                for="app-lock-pin"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                PIN Baru (4–8 Digit Angka)
              </label>
              <input
                id="app-lock-pin"
                type="password"
                inputmode="numeric"
                maxlength="8"
                required
                bind:value={passcodeInput}
                placeholder="••••"
                class="w-40 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label
                for="app-lock-timer"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Kunci Otomatis
              </label>
              <select
                id="app-lock-timer"
                bind:value={autoLockMinutes}
                class="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                <option value={1}>1 Menit</option>
                <option value={5}>5 Menit</option>
                <option value={15}>15 Menit</option>
                <option value={30}>30 Menit</option>
              </select>
            </div>

            <button
              type="submit"
              class="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              Aktifkan PIN Lokal
            </button>
          </form>
        {:else}
          <form class="mt-4 flex flex-wrap items-end gap-3" on:submit|preventDefault={handleDisableAppLock}>
            <div>
              <label
                for="app-lock-disable-pin"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Masukkan PIN Saat Ini untuk Menonaktifkan
              </label>
              <input
                id="app-lock-disable-pin"
                type="password"
                inputmode="numeric"
                maxlength="8"
                required
                bind:value={disablePasscodeInput}
                placeholder="••••"
                class="w-48 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              class="rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              Nonaktifkan PIN
            </button>
          </form>
        {/if}
      </div>
    </div>
  </section>
</div>

