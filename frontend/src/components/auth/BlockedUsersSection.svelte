<script>
  import { onMount } from "svelte";
  import { userStore } from "../../stores/user.store.js";
  import { authStore } from "../../stores/auth.store.js";
  import Icon from "../common/Icon.svelte";
  import Skeleton from "../common/Skeleton.svelte";
  import EmptyState from "../common/EmptyState.svelte";
  import {
    PAGE_ERROR_CODES,
    getPageErrorMessage,
  } from "../../lib/errors/pageerror.js";

  let searchQuery = "";
  let searchResults = [];
  let searching = false;
  let unblockingId = null;
  let blockingId = null;
  let statusMessage = "";
  let errorMessage = "";

  $: currentUserId = $userStore?.id || $authStore?.user?.id || null;
  $: blockedIds = new Set(($userStore?.blockedUsers || []).map((u) => u.userId || u.id));

  onMount(() => {
    userStore.loadBlockedUsers({ limit: 20, offset: 0 }).catch(() => {});
  });

  async function handleSearch() {
    errorMessage = "";
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      searchResults = [];
      return;
    }

    searching = true;
    try {
      const res = await userStore.searchUsers(trimmed, { limit: 10, offset: 0 });
      const list = res?.users || res?.data || [];
      searchResults = list.filter((u) => u.id !== currentUserId);
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        fallbackCode: PAGE_ERROR_CODES.USER_NOT_FOUND,
      });
    } finally {
      searching = false;
    }
  }

  async function handleBlockUser(user) {
    statusMessage = "";
    errorMessage = "";
    blockingId = user.id;
    try {
      await userStore.blockUser(user.id);
      statusMessage = `@${user.username} berhasil diblokir.`;
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        fallbackCode: PAGE_ERROR_CODES.USER_BLOCK_FAILED,
      });
    } finally {
      blockingId = null;
    }
  }

  async function handleUnblockUser(user) {
    const targetId = user.userId || user.id;
    statusMessage = "";
    errorMessage = "";
    unblockingId = targetId;
    try {
      await userStore.unblockUser(targetId);
      statusMessage = `Blokir untuk @${user.username} telah dibuka.`;
    } catch (err) {
      errorMessage = getPageErrorMessage(err, {
        fallbackCode: PAGE_ERROR_CODES.USER_UNBLOCK_FAILED,
      });
    } finally {
      unblockingId = null;
    }
  }

  function formatDate(dateVal) {
    if (!dateVal) return "";
    try {
      return new Date(dateVal).toLocaleDateString("id-ID", {
        dateStyle: "medium",
      });
    } catch {
      return "";
    }
  }
</script>

<div class="space-y-6">
  <section class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
    <div class="flex items-start gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
      <div class="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
        <Icon name="ban" size="md" />
      </div>
      <div>
        <h2 class="text-base font-bold text-slate-900 dark:text-white">
          Daftar Pengguna Diblokir
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Pengguna yang diblokir tidak dapat mengirim pesan, melihat status Online/Last Seen, atau mengirim permintaan pertemanan kepada Anda.
        </p>
      </div>
    </div>

    {#if errorMessage || $userStore.error}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
      >
        {errorMessage || $userStore.error}
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

    <!-- Search & Block User Form -->
    <form class="mt-5 flex items-center gap-2.5" on:submit|preventDefault={handleSearch}>
      <div class="relative flex-1">
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
          <Icon name="search" size="sm" />
        </span>
        <input
          type="search"
          bind:value={searchQuery}
          placeholder="Cari username untuk diblokir..."
          aria-label="Cari username untuk diblokir"
          class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={searching}
        class="rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
      >
        {searching ? "Mencari..." : "Cari"}
      </button>
    </form>

    {#if searchResults.length > 0}
      <div class="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
          Hasil Pencarian
        </p>
        {#each searchResults as candidate (candidate.id)}
          <div class="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 border border-slate-200/80 dark:border-slate-800">
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-900 dark:text-white truncate">
                {candidate.nickname || candidate.username}
              </p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                @{candidate.username}
              </p>
            </div>
            {#if blockedIds.has(candidate.id)}
              <span class="text-[11px] font-semibold text-slate-400">Sudah Diblokir</span>
            {:else}
              <button
                type="button"
                disabled={blockingId === candidate.id}
                on:click={() => handleBlockUser(candidate)}
                class="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
              >
                {blockingId === candidate.id ? "Memblokir..." : "Blokir"}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Blocked Users List -->
    <div class="mt-6">
      {#if $userStore.loadingBlocked}
        <Skeleton variant="list-item" count={3} />
      {:else if ($userStore.blockedUsers || []).length === 0}
        <EmptyState
          icon="shield-check"
          title="Belum Ada Pengguna Diblokir"
          description="Anda belum memblokir pengguna mana pun."
        />
      {:else}
        <div class="space-y-2.5">
          {#each $userStore.blockedUsers as blocked (blocked.userId || blocked.id)}
            <div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 px-4 py-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs shrink-0">
                  {(blocked.nickname || blocked.username || "U").slice(0, 2).toUpperCase()}
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {blocked.nickname || blocked.username}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
                    @{blocked.username}
                    {#if blocked.blockedAt}
                      • Diblokir {formatDate(blocked.blockedAt)}
                    {/if}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={unblockingId === (blocked.userId || blocked.id)}
                on:click={() => handleUnblockUser(blocked)}
                class="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                {unblockingId === (blocked.userId || blocked.id) ? "Membuka..." : "Buka Blokir"}
              </button>
            </div>
          {/each}
        </div>

        {#if $userStore.blockedHasMore}
          <div class="mt-4 flex justify-center">
            <button
              type="button"
              disabled={$userStore.loadingMoreBlocked}
              on:click={() => userStore.loadMoreBlockedUsers()}
              class="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {$userStore.loadingMoreBlocked ? "Memuat..." : "Muat Lebih Banyak"}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </section>
</div>
