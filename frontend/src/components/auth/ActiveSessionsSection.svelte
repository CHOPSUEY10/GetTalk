<script>
  import { onMount } from "svelte";
  import { authStore } from "../../stores/auth.store.js";
  import Icon from "../common/Icon.svelte";
  import Skeleton from "../common/Skeleton.svelte";
  import EmptyState from "../common/EmptyState.svelte";
  import ConfirmDialog from "../common/ConfirmDialog.svelte";
  import {
    PAGE_ERROR_CODES,
    getPageErrorMessage,
  } from "../../lib/errors/pageerror.js";

  const PAGE_SIZE = 10;

  let sessions = [];
  let loading = true;
  let loadingMore = false;
  let hasMore = false;
  let nextOffset = 0;
  let total = 0;
  let revokingId = null;
  let revokingAll = false;
  let showConfirmRevokeAll = false;
  let statusMessage = "";
  let errorMessage = "";

  $: otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  onMount(() => {
    loadInitialSessions();
  });

  async function loadInitialSessions() {
    loading = true;
    errorMessage = "";
    try {
      const res = await authStore.getSessions({ limit: PAGE_SIZE, offset: 0 });
      const items = res?.sessions || res?.items || res?.data || [];
      const pagination = res?.pagination || {};
      sessions = items;
      total = pagination.total ?? res?.total ?? items.length;
      nextOffset = items.length;
      hasMore = Boolean(pagination.hasMore ?? res?.hasMore ?? nextOffset < total);
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        context: "sessions",
        fallbackCode: PAGE_ERROR_CODES.SESSIONS_LOAD_FAILED,
      });
    } finally {
      loading = false;
    }
  }

  async function handleLoadMore() {
    if (loading || loadingMore || !hasMore) return;
    loadingMore = true;
    errorMessage = "";
    try {
      const res = await authStore.getSessions({ limit: PAGE_SIZE, offset: nextOffset });
      const items = res?.sessions || res?.items || res?.data || [];
      const pagination = res?.pagination || {};
      const existingIds = new Set(sessions.map((s) => s.sid || s.id));
      const deduped = items.filter((s) => !existingIds.has(s.sid || s.id));
      sessions = [...sessions, ...deduped];
      total = pagination.total ?? res?.total ?? total;
      nextOffset += items.length;
      hasMore = Boolean(pagination.hasMore ?? res?.hasMore ?? nextOffset < total);
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        context: "sessions",
        fallbackCode: PAGE_ERROR_CODES.SESSIONS_LOAD_FAILED,
      });
    } finally {
      loadingMore = false;
    }
  }

  async function handleRevokeSession(sessionId) {
    statusMessage = "";
    errorMessage = "";
    revokingId = sessionId;
    try {
      await authStore.revokeSession(sessionId);
      sessions = sessions.filter((s) => (s.sid || s.id) !== sessionId);
      total = Math.max(0, total - 1);
      statusMessage = "Sesi perangkat berhasil dicabut.";
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        context: "sessions",
        fallbackCode: PAGE_ERROR_CODES.SESSION_REVOKE_FAILED,
      });
    } finally {
      revokingId = null;
    }
  }

  async function handleRevokeAllOtherSessions() {
    showConfirmRevokeAll = false;
    statusMessage = "";
    errorMessage = "";
    revokingAll = true;
    try {
      const res = await authStore.revokeOtherSessions();
      sessions = sessions.filter((s) => s.isCurrent);
      total = sessions.length;
      hasMore = false;
      const count = res?.revokedCount ?? 0;
      statusMessage = `Berhasil keluar dari ${count} sesi perangkat lain.`;
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        context: "sessions",
        fallbackCode: PAGE_ERROR_CODES.SESSION_REVOKE_FAILED,
      });
    } finally {
      revokingAll = false;
    }
  }

  function formatDate(dateVal) {
    if (!dateVal) return "—";
    try {
      return new Date(dateVal).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return String(dateVal);
    }
  }
</script>

<section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
  <div class="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
        <Icon name="monitor" size="md" />
      </div>
      <div>
        <h2 class="text-base font-bold text-slate-900 dark:text-white">
          Sesi & Perangkat Aktif
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Kelola perangkat yang saat ini masuk ke akun GetTalk Anda. Maksimum 3 koneksi WebSocket aktif bersamaan.
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        on:click={loadInitialSessions}
        disabled={loading}
        class="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
      >
        <Icon name="refresh" size="xs" />
        Segarkan
      </button>

      {#if otherSessionsCount > 0}
        <button
          type="button"
          disabled={revokingAll}
          on:click={() => (showConfirmRevokeAll = true)}
          class="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          <Icon name="log-out" size="xs" />
          {revokingAll ? "Mengeluarkan..." : "Keluar dari Perangkat Lain"}
        </button>
      {/if}
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

  <div class="mt-5">
    {#if loading}
      <Skeleton variant="list-item" count={3} />
    {:else if sessions.length === 0}
      <EmptyState
        icon="monitor"
        title="Tidak Ada Sesi Terdaftar"
        description="Daftar sesi perangkat aktif Anda akan muncul di sini."
      />
    {:else}
      <div class="space-y-3">
        {#each sessions as sess (sess.sid || sess.id)}
          <div
            class="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition-colors {sess.isCurrent
              ? 'border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/25'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'}"
          >
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                <Icon name="monitor" size="sm" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {sess.deviceName || "Perangkat Web"}
                  </p>
                  {#if sess.isCurrent}
                    <span class="rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-[11px] font-bold">
                      Sesi Saat Ini
                    </span>
                  {/if}
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-lg">
                  IP: {sess.ipAddress || "Tidak diketahui"} • Aktif: {formatDate(sess.lastActiveAt)}
                </p>
                {#if sess.userAgent}
                  <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-xl">
                    {sess.userAgent}
                  </p>
                {/if}
              </div>
            </div>

            {#if !sess.isCurrent}
              <button
                type="button"
                disabled={revokingId === (sess.sid || sess.id)}
                on:click={() => handleRevokeSession(sess.sid || sess.id)}
                class="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 transition-colors cursor-pointer"
              >
                {revokingId === (sess.sid || sess.id) ? "Mencabut..." : "Cabut Sesi"}
              </button>
            {/if}
          </div>
        {/each}
      </div>

      {#if hasMore}
        <div class="mt-4 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            on:click={handleLoadMore}
            class="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {loadingMore ? "Memuat..." : "Muat Lebih Banyak Sesi"}
          </button>
        </div>
      {/if}
    {/if}
  </div>

  <ConfirmDialog
    open={showConfirmRevokeAll}
    title="Keluar dari Semua Perangkat Lain?"
    description="Seluruh sesi login aktif di browser atau perangkat lain akan segera dihentikan. Sesi Anda di perangkat ini tetap aktif."
    confirmLabel="Ya, Hentikan Semua Sesi Lain"
    cancelLabel="Batal"
    variant="danger"
    loading={revokingAll}
    on:confirm={handleRevokeAllOtherSessions}
    on:cancel={() => (showConfirmRevokeAll = false)}
  />
</section>

