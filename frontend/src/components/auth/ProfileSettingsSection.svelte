<script>
  import { authStore } from "../../stores/auth.store.js";
  import { userStore } from "../../stores/user.store.js";
  import Icon from "../common/Icon.svelte";
  import {
    MAX_NICKNAME_LENGTH,
    MAX_BIO_LENGTH,
    validateEmailChangeRequestInput,
    validateEmailChangeVerifyInput,
  } from "../../lib/validators.js";
  import {
    PAGE_ERROR_CODES,
    getPageErrorMessage,
    createValidationError,
  } from "../../lib/errors/pageerror.js";

  let username = "";
  let nickname = "";
  let bio = "";
  let initializedForUserId = null;

  let profileMessage = "";
  let profileError = "";

  // Email change state
  let showEmailChangeForm = false;
  let newEmail = "";
  let emailCurrentPassword = "";
  let emailOtpSent = false;
  let pendingEmailTarget = "";
  let emailOtpCode = "";
  let emailSubmitting = false;
  let emailMessage = "";
  let emailError = "";

  $: currentUser = $userStore?.profile || $authStore?.user || null;

  $: if (currentUser && currentUser.id !== initializedForUserId) {
    initializedForUserId = currentUser.id;
    username = currentUser.username || "";
    nickname = currentUser.nickname || "";
    bio = currentUser.bio || "";
    if (currentUser.pendingEmail && !pendingEmailTarget) {
      pendingEmailTarget = currentUser.pendingEmail;
    }
  }

  $: nicknameLength = (nickname || "").trim().length;
  $: bioLength = (bio || "").trim().length;

  async function handleSaveProfile() {
    profileMessage = "";
    profileError = "";
    userStore.clearError();

    try {
      const updated = await userStore.updateProfile({
        username: username.trim(),
        nickname: nickname.trim() || null,
        bio: bio.trim() || null,
      });
      authStore.updateUser({
        ...($authStore.user || {}),
        ...updated,
      });
      profileMessage = "Profil berhasil diperbarui.";
    } catch (err) {
      profileError = getPageErrorMessage(err, {
        context: "profile",
        fallbackCode: PAGE_ERROR_CODES.PROFILE_UPDATE_FAILED,
      });
    }
  }

  async function handleRequestEmailChange() {
    emailMessage = "";
    emailError = "";

    const validation = validateEmailChangeRequestInput({
      newEmail,
      currentPassword: emailCurrentPassword,
    });
    if (!validation.valid) {
      emailError = createValidationError(validation.code, "email").userMessage;
      return;
    }

    emailSubmitting = true;
    try {
      const res = await authStore.requestEmailChange({
        newEmail: newEmail.trim(),
        currentPassword: emailCurrentPassword,
      });
      pendingEmailTarget = res?.pendingEmail || newEmail.trim().toLowerCase();
      emailOtpSent = true;
      emailCurrentPassword = "";
      emailMessage = `Kode verifikasi OTP 6-digit telah dikirim ke ${pendingEmailTarget}.`;
    } catch (err) {
      emailError = getPageErrorMessage(err, {
        context: "email",
        fallbackCode: PAGE_ERROR_CODES.EMAIL_CHANGE_REQUEST_FAILED,
      });
    } finally {
      emailSubmitting = false;
    }
  }

  async function handleVerifyEmailChange() {
    emailMessage = "";
    emailError = "";

    const validation = validateEmailChangeVerifyInput({ otp: emailOtpCode });
    if (!validation.valid) {
      emailError = createValidationError(validation.code, "email").userMessage;
      return;
    }

    emailSubmitting = true;
    try {
      const res = await authStore.verifyEmailChange({
        otp: emailOtpCode.trim(),
        newEmail: pendingEmailTarget || newEmail.trim() || undefined,
      });
      if (res?.user) {
        userStore.set(res.user);
      }
      emailOtpSent = false;
      showEmailChangeForm = false;
      emailOtpCode = "";
      newEmail = "";
      pendingEmailTarget = "";
      emailMessage = "Alamat email berhasil diverifikasi dan diperbarui.";
    } catch (err) {
      emailError = getPageErrorMessage(err, {
        context: "email",
        fallbackCode: PAGE_ERROR_CODES.EMAIL_VERIFY_FAILED,
      });
    } finally {
      emailSubmitting = false;
    }
  }

  function cancelEmailChange() {
    showEmailChangeForm = false;
    emailOtpSent = false;
    newEmail = "";
    emailCurrentPassword = "";
    emailOtpCode = "";
    emailError = "";
  }
</script>

<div class="space-y-6">
  <!-- Profile Card -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="flex items-center gap-3.5">
        <div class="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-xs">
          {(nickname || username || "U").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900 dark:text-white">
            Profil & Identitas Tampilan
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Atur nama tampilan (nickname), username unik, dan bio singkat Anda di ruang obrolan.
          </p>
        </div>
      </div>
    </div>

    {#if profileError}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {profileError}
      </div>
    {/if}

    {#if profileMessage}
      <div
        role="status"
        class="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        {profileMessage}
      </div>
    {/if}

    <form class="mt-5 space-y-4" on:submit|preventDefault={handleSaveProfile}>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label
            for="settings-nickname"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Nama Tampilan (Nickname)
          </label>
          <span class="text-[11px] {nicknameLength > MAX_NICKNAME_LENGTH ? 'text-red-600 font-semibold' : 'text-slate-400'}">
            {nicknameLength}/{MAX_NICKNAME_LENGTH}
          </span>
        </div>
        <input
          id="settings-nickname"
          type="text"
          maxlength={MAX_NICKNAME_LENGTH}
          bind:value={nickname}
          placeholder="Contoh: Budi Santoso (opsional)"
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        />
        <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Ditampilkan pada daftar percakapan dan header ruang obrolan tanpa mengubah username unik Anda.
        </p>
      </div>

      <div>
        <label
          for="settings-username"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Username Unik
        </label>
        <div class="relative">
          <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm text-slate-400">
            @
          </span>
          <input
            id="settings-username"
            type="text"
            required
            minlength="3"
            maxlength="50"
            bind:value={username}
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Hanya huruf, angka, garis bawah (_), atau tanda hubung (-), 3–50 karakter.
        </p>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label
            for="settings-bio"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Bio / Status Singkat
          </label>
          <span class="text-[11px] {bioLength > MAX_BIO_LENGTH ? 'text-red-600 font-semibold' : 'text-slate-400'}">
            {bioLength}/{MAX_BIO_LENGTH}
          </span>
        </div>
        <textarea
          id="settings-bio"
          rows="3"
          maxlength={MAX_BIO_LENGTH}
          bind:value={bio}
          placeholder="Tulis bio atau status singkat Anda..."
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none resize-none"
        ></textarea>
      </div>

      <div class="pt-2 flex justify-end">
        <button
          type="submit"
          disabled={$userStore.savingProfile}
          class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          <Icon name="check" size="sm" />
          {$userStore.savingProfile ? "Menyimpan..." : "Simpan Perubahan Profil"}
        </button>
      </div>
    </form>
  </section>

  <!-- Email Account Card -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
          <Icon name="mail" size="md" />
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900 dark:text-white">
            Alamat Email Akun
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Email saat ini: <span class="font-semibold text-slate-800 dark:text-slate-200">{currentUser?.email || "—"}</span>
          </p>
          <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Perubahan email membutuhkan verifikasi kata sandi saat ini dan kode OTP 6-digit yang dikirim ke email baru.
          </p>
        </div>
      </div>

      {#if !showEmailChangeForm}
        <button
          type="button"
          on:click={() => {
            showEmailChangeForm = true;
            emailError = "";
            emailMessage = "";
          }}
          class="rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
        >
          Ubah Alamat Email
        </button>
      {/if}
    </div>

    {#if emailError}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {emailError}
      </div>
    {/if}

    {#if emailMessage}
      <div
        role="status"
        class="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        {emailMessage}
      </div>
    {/if}

    {#if showEmailChangeForm}
      <div class="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
        {#if !emailOtpSent}
          <form class="space-y-4 max-w-md" on:submit|preventDefault={handleRequestEmailChange}>
            <div>
              <label
                for="settings-new-email"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Alamat Email Baru
              </label>
              <input
                id="settings-new-email"
                type="email"
                required
                autocomplete="email"
                bind:value={newEmail}
                placeholder="nama@domain.com"
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                for="settings-email-password"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Konfirmasi Kata Sandi Saat Ini
              </label>
              <input
                id="settings-email-password"
                type="password"
                required
                autocomplete="current-password"
                bind:value={emailCurrentPassword}
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div class="flex items-center gap-2.5">
              <button
                type="submit"
                disabled={emailSubmitting}
                class="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                {emailSubmitting ? "Mengirim OTP..." : "Kirim Kode Verifikasi OTP"}
              </button>
              <button
                type="button"
                on:click={cancelEmailChange}
                class="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </form>
        {:else}
          <form class="space-y-4 max-w-md" on:submit|preventDefault={handleVerifyEmailChange}>
            <div>
              <label
                for="settings-email-otp"
                class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Kode OTP 6-Digit ({pendingEmailTarget})
              </label>
              <input
                id="settings-email-otp"
                type="text"
                inputmode="numeric"
                maxlength="6"
                required
                bind:value={emailOtpCode}
                placeholder="123456"
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono tracking-widest text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div class="flex items-center gap-2.5">
              <button
                type="submit"
                disabled={emailSubmitting}
                class="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                {emailSubmitting ? "Memverifikasi..." : "Verifikasi & Terapkan Email"}
              </button>
              <button
                type="button"
                on:click={cancelEmailChange}
                class="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
  </section>
</div>

