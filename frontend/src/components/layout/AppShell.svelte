<script>
    import { authStore } from "../../stores/auth.store.js";
    import { socketStore } from "../../stores/socket.store.js";
    import { friendsStore } from "../../stores/friends.store.js";
    import { uiStore } from "../../stores/ui.store.js";
    import { replace } from "svelte-spa-router";

    // Reactive safety check for authentication
    $: if (!$authStore.loading && !$authStore.authenticated) {
        replace("/login");
    }
</script>

{#if $authStore.loading}
    <div class="loading-state">
        <div class="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
        <p class="text-sm font-medium text-slate-600">Loading session...</p>
    </div>
{:else if $authStore.authenticated}
    <div class="app-shell">
        <aside class="sidebar" class:sidebar-open={$uiStore.sidebarOpen}>
            <div>
                <!-- Brand Header -->
                <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
                            G
                        </div>
                        <span class="font-bold text-lg text-slate-900 tracking-tight">GetTalk</span>
                    </div>

                    <div class="flex items-center gap-2">
                        <!-- Socket Status Pill in Header -->
                        <div
                            class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border"
                            class:bg-emerald-50={$socketStore.connected}
                            class:border-emerald-200={$socketStore.connected}
                            class:text-emerald-700={$socketStore.connected}
                            class:bg-amber-50={$socketStore.status === 'connecting'}
                            class:border-amber-200={$socketStore.status === 'connecting'}
                            class:text-amber-700={$socketStore.status === 'connecting'}
                            class:bg-rose-50={$socketStore.status === 'error' || $socketStore.status === 'disconnected'}
                            class:border-rose-200={$socketStore.status === 'error' || $socketStore.status === 'disconnected'}
                            class:text-rose-700={$socketStore.status === 'error' || $socketStore.status === 'disconnected'}
                            title="Status WebSocket Client: {$socketStore.status}"
                        >
                            <span
                                class="w-1.5 h-1.5 rounded-full"
                                class:bg-emerald-500={$socketStore.connected}
                                class:bg-amber-500={$socketStore.status === 'connecting'}
                                class:animate-pulse={$socketStore.status === 'connecting'}
                                class:bg-rose-500={$socketStore.status === 'error' || $socketStore.status === 'disconnected'}
                            ></span>
                            <span class="capitalize">{$socketStore.connected ? 'Online' : $socketStore.status}</span>
                        </div>

                        <!-- Mobile Sidebar Toggle Button -->
                        <button
                            type="button"
                            class="md:hidden p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                            aria-label="Toggle navigasi"
                            on:click={() => uiStore.toggleSidebar()}
                        >
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Navigation List -->
                <nav class="mt-2" class:hidden={!$uiStore.sidebarOpen} class:md:block={true}>
                    <ul>
                        <li>
                            <a href="#/" class="group" on:click={() => uiStore.setSidebarOpen(false)}>
                                <svg class="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                </svg>
                                <span>Home</span>
                            </a>
                        </li>
                        <li>
                            <a href="#/settings/security" class="group" on:click={() => uiStore.setSidebarOpen(false)}>
                                <svg class="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <span>Keamanan</span>
                            </a>
                        </li>
                        <li>
                            <a href="#/friends" class="group flex items-center justify-between" on:click={() => uiStore.setSidebarOpen(false)}>
                                <div class="flex items-center gap-3">
                                    <svg class="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                    </svg>
                                    <span>Friends</span>
                                </div>
                                {#if $friendsStore.requests && $friendsStore.requests.length > 0}
                                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-xs">
                                        {$friendsStore.requests.length}
                                    </span>
                                {/if}
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>

            <!-- User Info & Logout -->
            <div class="user-info">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-semibold flex items-center justify-center text-xs uppercase shrink-0">
                        {($authStore.user?.username || "U").slice(0, 2)}
                    </div>
                    <span class="truncate text-sm font-semibold text-slate-800">
                        {$authStore.user?.username || "User"}
                    </span>
                </div>
                <button
                    type="button"
                    class="px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200 hover:border-rose-300 shrink-0 cursor-pointer"
                    on:click={() => authStore.logout()}
                >
                    Logout
                </button>
            </div>
        </aside>
        <main class="main-content">
            {#if $uiStore.notifications.length > 0}
                <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
                    {#each $uiStore.notifications as n (n.id)}
                        <div
                            role="status"
                            class="pointer-events-auto px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center justify-between gap-3 {n.type === 'error'
                                ? 'bg-rose-50 border-rose-200 text-rose-800'
                                : n.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : n.type === 'warning'
                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-800'}"
                        >
                            <span>{n.message}</span>
                            <button
                                type="button"
                                class="text-xs font-semibold opacity-70 hover:opacity-100"
                                aria-label="Tutup notifikasi"
                                on:click={() => uiStore.dismissNotification(n.id)}
                            >
                                ✕
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}
            <slot />
        </main>
    </div>
{/if}
