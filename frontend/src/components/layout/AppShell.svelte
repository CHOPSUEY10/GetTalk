<script>
    import { onMount } from "svelte";
    import { authStore } from "../../stores/auth.store.js";
    import { socketStore } from "../../stores/socket.store.js";
    import { friendsStore } from "../../stores/friends.store.js";
    import { conversationsStore } from "../../stores/conversations.store.js";
    import { uiStore, themeStore } from "../../stores/ui.store.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../../lib/errors/pageerror.js";
    import { replace } from "svelte-spa-router";
    import Icon from "../common/Icon.svelte";

    // Reactive safety check for authentication
    $: if (!$authStore.loading && !$authStore.authenticated) {
        replace("/login");
    }

    function resolveHashPath() {
        if (typeof window === "undefined") return "/";
        const raw = window.location.hash.replace(/^#/, "") || "/";
        const qIdx = raw.indexOf("?");
        return qIdx !== -1 ? raw.slice(0, qIdx) || "/" : raw;
    }

    let currentPath = resolveHashPath();
    const syncCurrentPath = () => {
        currentPath = resolveHashPath();
    };

    $: isSocketQuotaExceeded =
        $socketStore.error === PAGE_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED ||
        $socketStore.errorCode === PAGE_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED;

    $: isSocketDisconnected =
        !isSocketQuotaExceeded &&
        ($socketStore.status === "disconnected" || $socketStore.status === "error");

    $: conversations = $conversationsStore.conversations || [];

    onMount(() => {
        syncCurrentPath();
        if ($authStore.authenticated) {
            conversationsStore.loadConversations().catch(() => {});
            if (!$friendsStore.friends?.length && !$friendsStore.loading) {
                friendsStore.loadAll().catch(() => {});
                friendsStore.initSocketListeners?.();
            }
        }
    });
</script>

<svelte:window on:hashchange={syncCurrentPath} />

{#if $authStore.loading}
    <div class="loading-state">
        <div class="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
        <p class="text-sm font-medium text-slate-600">Memuat sesi aman...</p>
    </div>
{:else if $authStore.authenticated}
    <div class="app-shell">
        <!-- Mobile Top Header Bar (< 768px) -->
        <header class="md:hidden px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 z-20">
            <div class="flex items-center gap-2.5">
                <button
                    type="button"
                    class="p-2 -ml-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    aria-label="Buka menu navigasi"
                    aria-expanded={$uiStore.sidebarOpen}
                    on:click={() => uiStore.toggleSidebar()}
                >
                    <Icon name="menu" size="md" />
                </button>
                <a href="#/" class="flex items-center gap-2 no-underline">
                    <div class="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
                        G
                    </div>
                    <span class="font-bold text-base text-slate-900 tracking-tight">GetTalk</span>
                </a>
            </div>

            <div class="flex items-center gap-2">
                <!-- Socket Status Pill -->
                <div
                    class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border"
                    class:bg-emerald-50={$socketStore.connected}
                    class:border-emerald-200={$socketStore.connected}
                    class:text-emerald-700={$socketStore.connected}
                    class:bg-amber-50={$socketStore.status === "connecting"}
                    class:border-amber-200={$socketStore.status === "connecting"}
                    class:text-amber-700={$socketStore.status === "connecting"}
                    class:bg-rose-50={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                    class:border-rose-200={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                    class:text-rose-700={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                    title="Status Koneksi Realtime: {$socketStore.status}"
                >
                    <span
                        class="w-1.5 h-1.5 rounded-full"
                        class:bg-emerald-500={$socketStore.connected}
                        class:bg-amber-500={$socketStore.status === "connecting"}
                        class:animate-pulse={$socketStore.status === "connecting"}
                        class:bg-rose-500={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                    ></span>
                    <span class="capitalize">{$socketStore.connected ? "Online" : $socketStore.status === "connecting" ? "Menghubungkan" : "Offline"}</span>
                </div>

                <!-- Theme Toggle -->
                <button
                    type="button"
                    class="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    title={$themeStore === "dark" ? "Mode Terang" : "Mode Gelap"}
                    aria-label={$themeStore === "dark" ? "Aktifkan Mode Terang" : "Aktifkan Mode Gelap"}
                    on:click={() => themeStore.toggleTheme()}
                >
                    <Icon name={$themeStore === "dark" ? "sun" : "moon"} size="sm" />
                </button>
            </div>
        </header>

        <!-- Mobile Drawer Backdrop -->
        {#if $uiStore.sidebarOpen}
            <button
                type="button"
                class="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-xs md:hidden cursor-default"
                aria-label="Tutup menu navigasi"
                tabindex="-1"
                on:click={() => uiStore.setSidebarOpen(false)}
            ></button>
        {/if}

        <!-- Sidebar Navigation & Active Conversations -->
        <aside class="sidebar" class:sidebar-open={$uiStore.sidebarOpen} aria-label="Navigasi utama">
            <div class="flex flex-col flex-1 min-h-0">
                <!-- Brand Header -->
                <div class="px-4 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                    <a href="#/" class="flex items-center gap-2.5 no-underline" on:click={() => uiStore.setSidebarOpen(false)}>
                        <div class="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-base shadow-xs">
                            G
                        </div>
                        <div>
                            <span class="font-bold text-base text-slate-900 tracking-tight block leading-none">GetTalk</span>
                            <span class="text-[10px] font-medium text-emerald-600 flex items-center gap-1 mt-0.5">
                                <Icon name="lock" size="xs" />
                                <span>E2EE Messenger</span>
                            </span>
                        </div>
                    </a>

                    <div class="flex items-center gap-1.5">
                        <!-- Socket Status Pill -->
                        <div
                            class="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                            class:bg-emerald-50={$socketStore.connected}
                            class:border-emerald-200={$socketStore.connected}
                            class:text-emerald-700={$socketStore.connected}
                            class:bg-amber-50={$socketStore.status === "connecting"}
                            class:border-amber-200={$socketStore.status === "connecting"}
                            class:text-amber-700={$socketStore.status === "connecting"}
                            class:bg-rose-50={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                            class:border-rose-200={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                            class:text-rose-700={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                            title="Status WebSocket Client: {$socketStore.status}"
                        >
                            <span
                                class="w-1.5 h-1.5 rounded-full"
                                class:bg-emerald-500={$socketStore.connected}
                                class:bg-amber-500={$socketStore.status === "connecting"}
                                class:animate-pulse={$socketStore.status === "connecting"}
                                class:bg-rose-500={$socketStore.status === "error" || $socketStore.status === "disconnected"}
                            ></span>
                            <span class="capitalize">{$socketStore.connected ? "Online" : $socketStore.status}</span>
                        </div>

                        <!-- Desktop Theme Toggle -->
                        <button
                            type="button"
                            class="hidden md:inline-flex p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title={$themeStore === "dark" ? "Mode Terang" : "Mode Gelap"}
                            aria-label={$themeStore === "dark" ? "Aktifkan Mode Terang" : "Aktifkan Mode Gelap"}
                            on:click={() => themeStore.toggleTheme()}
                        >
                            <Icon name={$themeStore === "dark" ? "sun" : "moon"} size="sm" />
                        </button>

                        <!-- Mobile Close Drawer Button -->
                        <button
                            type="button"
                            class="md:hidden p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            aria-label="Tutup navigasi"
                            on:click={() => uiStore.setSidebarOpen(false)}
                        >
                            <Icon name="x" size="md" />
                        </button>
                    </div>
                </div>

                <!-- Primary Navigation Links -->
                <nav class="shrink-0" aria-label="Menu aplikasi">
                    <ul>
                        <li>
                            <a
                                href="#/"
                                class="group"
                                class:nav-active={currentPath === "/"}
                                aria-current={currentPath === "/" ? "page" : undefined}
                                on:click={() => uiStore.setSidebarOpen(false)}
                            >
                                <Icon
                                    name="home"
                                    size="md"
                                    className={currentPath === "/" ? "text-indigo-600" : "text-slate-400 group-hover:text-indigo-600 transition-colors"}
                                />
                                <span>Beranda & Obrolan</span>
                            </a>
                        </li>
                        <li>
                            <a
                                href="#/friends"
                                class="group flex items-center justify-between"
                                class:nav-active={currentPath.startsWith("/friends")}
                                aria-current={currentPath.startsWith("/friends") ? "page" : undefined}
                                on:click={() => uiStore.setSidebarOpen(false)}
                            >
                                <div class="flex items-center gap-3">
                                    <Icon
                                        name="users"
                                        size="md"
                                        className={currentPath.startsWith("/friends") ? "text-indigo-600" : "text-slate-400 group-hover:text-indigo-600 transition-colors"}
                                    />
                                    <span>Teman & Kontak</span>
                                </div>
                                {#if $friendsStore.requests && $friendsStore.requests.length > 0}
                                    <span
                                        class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white shadow-xs"
                                        title="{$friendsStore.requests.length} permintaan pertemanan menunggu"
                                    >
                                        {$friendsStore.requests.length}
                                    </span>
                                {/if}
                            </a>
                        </li>
                        <li>
                            <a
                                href="#/settings/security"
                                class="group"
                                class:nav-active={currentPath.startsWith("/settings")}
                                aria-current={currentPath.startsWith("/settings") ? "page" : undefined}
                                on:click={() => uiStore.setSidebarOpen(false)}
                            >
                                <Icon
                                    name="shield"
                                    size="md"
                                    className={currentPath.startsWith("/settings") ? "text-indigo-600" : "text-slate-400 group-hover:text-indigo-600 transition-colors"}
                                />
                                <span>Keamanan & MFA</span>
                            </a>
                        </li>
                    </ul>
                </nav>

                <!-- Active Conversations Panel in Sidebar -->
                <div class="flex-1 min-h-0 flex flex-col border-t border-slate-200 px-3 pt-3 pb-2">
                    <div class="px-2 mb-2 flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Percakapan Terkini
                        </span>
                        <a
                            href="#/friends"
                            class="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5"
                            title="Mulai obrolan baru"
                            on:click={() => uiStore.setSidebarOpen(false)}
                        >
                            <Icon name="plus" size="xs" />
                            <span>Baru</span>
                        </a>
                    </div>

                    <div class="flex-1 overflow-y-auto space-y-1 pr-0.5">
                        {#if $conversationsStore.loading && conversations.length === 0}
                            <div class="space-y-2 px-1 py-2">
                                {#each [1, 2, 3] as idx (idx)}
                                    <div class="flex items-center gap-2.5 p-2 rounded-xl">
                                        <div class="w-8 h-8 rounded-full gt-skeleton shrink-0"></div>
                                        <div class="space-y-1.5 flex-1">
                                            <div class="h-3 w-24 gt-skeleton"></div>
                                            <div class="h-2.5 w-16 gt-skeleton"></div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else if conversations.length === 0}
                            <div class="px-2.5 py-6 text-center">
                                <p class="text-xs text-slate-400 leading-relaxed">
                                    Belum ada obrolan aktif. Pilih teman untuk mulai berkirim pesan terenkripsi.
                                </p>
                            </div>
                        {:else}
                            {#each conversations as conv (conv.id)}
                                {@const isCurrentChat = currentPath === `/chat/${conv.id}`}
                                {@const peerName = conv.peer?.username || conv.name || "Ruang Obrolan"}
                                <a
                                    href="#/chat/{conv.id}"
                                    on:click={() => uiStore.setSidebarOpen(false)}
                                    class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs transition-all no-underline {isCurrentChat
                                        ? 'bg-indigo-50 text-indigo-900 font-semibold border border-indigo-200/70'
                                        : 'text-slate-700 hover:bg-slate-100'}"
                                    aria-current={isCurrentChat ? "page" : undefined}
                                >
                                    <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white font-bold flex items-center justify-center text-[11px] uppercase shrink-0 shadow-xs">
                                        {peerName.slice(0, 2)}
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="truncate font-semibold text-slate-900">{peerName}</span>
                                            <Icon name="lock" size="xs" className="text-emerald-600 shrink-0" />
                                        </div>
                                        <p class="text-[11px] text-slate-500 truncate mt-0.5">
                                            {conv.updated_at
                                                ? `Aktif ${new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                : "Terenkripsi E2EE"}
                                        </p>
                                    </div>
                                </a>
                            {/each}

                            {#if $conversationsStore.hasMore}
                                <button
                                    type="button"
                                    disabled={$conversationsStore.loadingMore}
                                    on:click={() => conversationsStore.loadMoreConversations()}
                                    class="w-full mt-1 py-1.5 text-center text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {$conversationsStore.loadingMore ? "Memuat..." : "Muat lebih banyak"}
                                </button>
                            {/if}
                        {/if}
                    </div>
                </div>
            </div>

            <!-- User Profile Footer & Logout -->
            <div class="user-info shrink-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs uppercase shrink-0">
                        {($authStore.user?.username || "U").slice(0, 2)}
                    </div>
                    <div class="min-w-0">
                        <span class="truncate text-sm font-semibold text-slate-900 block leading-tight">
                            {$authStore.user?.username || "User"}
                        </span>
                        <span class="truncate text-[11px] text-slate-500 block">
                            {$authStore.user?.email || "Sesi Terautentikasi"}
                        </span>
                    </div>
                </div>
                <button
                    type="button"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200 hover:border-rose-300 shrink-0 cursor-pointer"
                    title="Keluar dari akun"
                    on:click={() => authStore.logout()}
                >
                    <Icon name="log-out" size="xs" />
                    <span>Keluar</span>
                </button>
            </div>
        </aside>

        <!-- Main Workspace Content -->
        <main class="main-content">
            {#if isSocketQuotaExceeded}
                <div
                    role="alert"
                    class="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0"
                >
                    <div class="flex items-center gap-2.5">
                        <Icon name="alert-triangle" size="md" className="text-amber-600" />
                        <span>
                            {$socketStore.errorMessage || getPageErrorMessage(PAGE_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED)}
                        </span>
                    </div>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                        on:click={() => socketStore.reconnect()}
                    >
                        <Icon name="refresh" size="xs" />
                        <span>Hubungkan Ulang</span>
                    </button>
                </div>
            {:else if isSocketDisconnected}
                <div
                    role="status"
                    class="mb-4 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0"
                >
                    <div class="flex items-center gap-2">
                        <Icon name="wifi-off" size="sm" className="text-rose-600" />
                        <span>
                            Koneksi realtime terputus. Pesan baru mungkin tertunda hingga koneksi pulih.
                        </span>
                    </div>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                        on:click={() => socketStore.reconnect()}
                    >
                        <Icon name="refresh" size="xs" />
                        <span>Hubungkan Ulang</span>
                    </button>
                </div>
            {/if}

            <!-- Toast Notifications Stack -->
            {#if $uiStore.notifications.length > 0}
                <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
                    {#each $uiStore.notifications as n (n.id)}
                        <div
                            role="status"
                            class="pointer-events-auto px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center justify-between gap-3 animate-fadeIn {n.type === 'error'
                                ? 'bg-rose-50 border-rose-200 text-rose-800'
                                : n.type === 'success'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : n.type === 'warning'
                                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                                    : 'bg-indigo-50 border-indigo-200 text-indigo-800'}"
                        >
                            <div class="flex items-center gap-2.5 min-w-0">
                                <Icon
                                    name={n.type === "error" || n.type === "warning"
                                        ? "alert-triangle"
                                        : n.type === "success"
                                          ? "check"
                                          : "info"}
                                    size="sm"
                                />
                                <span class="leading-snug">{n.message}</span>
                            </div>
                            <button
                                type="button"
                                class="p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                                aria-label="Tutup notifikasi"
                                on:click={() => uiStore.dismissNotification(n.id)}
                            >
                                <Icon name="x" size="xs" />
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}

            <slot />
        </main>
    </div>
{/if}
