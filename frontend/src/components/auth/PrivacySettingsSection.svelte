<script>
  import { userStore, DEFAULT_PRIVACY_SETTINGS } from "../../stores/user.store.js";
  import Icon from "../common/Icon.svelte";
  import {
    PAGE_ERROR_CODES,
    getPageErrorMessage,
  } from "../../lib/errors/pageerror.js";

  let form = { ...DEFAULT_PRIVACY_SETTINGS };
  let synced = false;
  let statusMessage = "";
  let errorMessage = "";

  $: privacy = $userStore?.privacySettings || DEFAULT_PRIVACY_SETTINGS;

  $: if (privacy && !synced && !$userStore.savingPrivacy) {
    form = { ...DEFAULT_PRIVACY_SETTINGS, ...privacy };
    synced = true;
  }

  async function savePatch(patch, customSuccessMsg = "Pengaturan privasi diperbarui.") {
    statusMessage = "";
    errorMessage = "";
    form = { ...form, ...patch };
    try {
      const updated = await userStore.updatePrivacySettings(patch);
      form = { ...DEFAULT_PRIVACY_SETTINGS, ...updated };
      statusMessage = customSuccessMsg;
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        context: "privacy",
        fallbackCode: PAGE_ERROR_CODES.PRIVACY_UPDATE_FAILED,
      });
    }
  }

  async function handleSaveAll() {
    await savePatch(form, "Seluruh pengaturan privasi chat berhasil disimpan.");
  }
</script>

<div class="space-y-6">
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
          <Icon name="eye" size="md" />
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900 dark:text-white">
            Privasi Kehadiran & Visibilitas
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Atur siapa yang dapat melihat waktu terakhir aktif (Last Seen) dan status Online Anda.
          </p>
        </div>
      </div>
    </div>

    {#if errorMessage}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {errorMessage}
      </div>
    {/if}

    {#if statusMessage}
      <div
        role="status"
        class="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        {statusMessage}
      </div>
    {/if}

    <div class="mt-5 space-y-5">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            for="privacy-last-seen"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Terakhir Dilihat (Last Seen)
          </label>
          <select
            id="privacy-last-seen"
            bind:value={form.lastSeenVisibility}
            on:change={() => savePatch({ lastSeenVisibility: form.lastSeenVisibility })}
            disabled={$userStore.savingPrivacy}
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="everyone">Semua Orang (Everyone)</option>
            <option value="friends">Hanya Teman (Friends)</option>
            <option value="nobody">Tidak Ada (Nobody)</option>
          </select>
          <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            Aturan resiprokal: jika Anda memilih <strong>Tidak Ada</strong>, Anda juga tidak dapat melihat Last Seen pengguna lain.
          </p>
        </div>

        <div>
          <label
            for="privacy-online"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Status Online
          </label>
          <select
            id="privacy-online"
            bind:value={form.onlineVisibility}
            on:change={() => savePatch({ onlineVisibility: form.onlineVisibility })}
            disabled={$userStore.savingPrivacy}
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="everyone">Semua Orang (Everyone)</option>
            <option value="friends">Hanya Teman (Friends)</option>
            <option value="nobody">Tidak Ada (Nobody)</option>
          </select>
          <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            Menentukan siapa yang dapat melihat indikator titik hijau saat Anda sedang aktif.
          </p>
        </div>
      </div>

      <!-- Read Receipts & Typing Indicator -->
      <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">
              Laporan Dibaca (Read Receipts)
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Jika dimatikan, Anda tidak akan mengirim maupun melihat tanda pesan sudah dibaca (centang biru) pada chat personal.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.readReceiptsEnabled}
            aria-label="Laporan Dibaca"
            disabled={$userStore.savingPrivacy}
            on:click={() => savePatch({ readReceiptsEnabled: !form.readReceiptsEnabled })}
            class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer {form.readReceiptsEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}"
          >
            <span
              class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 {form.readReceiptsEnabled ? 'translate-x-5' : 'translate-x-0'}"
            ></span>
          </button>
        </div>

        <div class="flex items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">
              Indikator Sedang Mengetik (Typing Indicator)
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Sembunyikan status "sedang mengetik..." ke lawan bicara saat Anda menyusun pesan.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.typingIndicatorEnabled}
            aria-label="Indikator Sedang Mengetik"
            disabled={$userStore.savingPrivacy}
            on:click={() => savePatch({ typingIndicatorEnabled: !form.typingIndicatorEnabled })}
            class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer {form.typingIndicatorEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}"
          >
            <span
              class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 {form.typingIndicatorEnabled ? 'translate-x-5' : 'translate-x-0'}"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </section>

  <!-- Permissions & Auto-Delete Timer -->
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
        <Icon name="shield-check" size="md" />
      </div>
      <div>
        <h2 class="text-base font-bold text-slate-900 dark:text-white">
          Izin Interaksi & Timer Pesan Otomatis
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Batasi siapa yang dapat memulai obrolan baru dengan Anda dan atur durasi pesan menghilang default.
        </p>
      </div>
    </div>

    <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label
          for="privacy-who-can-message"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Siapa yang Dapat Mengirimi Saya Pesan
        </label>
        <select
          id="privacy-who-can-message"
          bind:value={form.whoCanMessage}
          on:change={() => savePatch({ whoCanMessage: form.whoCanMessage })}
          disabled={$userStore.savingPrivacy}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="everyone">Semua Orang (Everyone)</option>
          <option value="friends">Hanya Teman (Friends Only)</option>
        </select>
      </div>

      <div>
        <label
          for="privacy-who-can-add-group"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Siapa yang Dapat Menambahkan ke Grup
        </label>
        <select
          id="privacy-who-can-add-group"
          bind:value={form.whoCanAddToGroups}
          on:change={() => savePatch({ whoCanAddToGroups: form.whoCanAddToGroups })}
          disabled={$userStore.savingPrivacy}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="everyone">Semua Orang (Everyone)</option>
          <option value="friends">Hanya Teman (Friends Only)</option>
        </select>
      </div>

      <div class="md:col-span-2 pt-2">
        <label
          for="privacy-disappearing-timer"
          class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Timer Pesan Menghilang Default (Disappearing Messages)
        </label>
        <select
          id="privacy-disappearing-timer"
          bind:value={form.defaultDisappearingTimer}
          on:change={() => savePatch({ defaultDisappearingTimer: Number(form.defaultDisappearingTimer) })}
          disabled={$userStore.savingPrivacy}
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value={0}>Nonaktif (Off)</option>
          <option value={86400}>24 Jam (86.400 detik)</option>
          <option value={604800}>7 Hari (604.800 detik)</option>
          <option value={7776000}>90 Hari (7.776.000 detik)</option>
        </select>
        <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Berlaku otomatis untuk percakapan baru yang Anda mulai.
        </p>
      </div>
    </div>

    <div class="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
      <button
        type="button"
        disabled={$userStore.savingPrivacy}
        on:click={handleSaveAll}
        class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
      >
        <Icon name="check" size="sm" />
        {$userStore.savingPrivacy ? "Menyimpan..." : "Simpan Pengaturan Privasi"}
      </button>
    </div>
  </section>
</div>

