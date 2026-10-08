<script>
    import { onMount } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import {
        friendLists,
        friendRequestList,
        friendRequest,
        acceptFriendRequests,
        rejectFriendRequests,
        deleteFromFriendList
    } from "../services/api/friends.api.js";
    import { push } from "svelte-spa-router";
    import logger from "../lib/logger.js";

    let activeTab = "friends"; // 'friends' | 'requests' | 'add'
    let searchQuery = "";
    let addUsername = "";
    let loading = true;
    let actionLoading = false;
    /** @type {string | null} */
    let message = null;
    /** @type {'success' | 'error' | null} */
    let messageType = null;

    /** @type {any[]} */
    let friends = [];
    /** @type {any[]} */
    let requests = [];

    const loadData = async () => {
        loading = true;
        message = null;
        try {
            const [friendsRes, requestsRes] = await Promise.allSettled([
                friendLists(),
                friendRequestList()
            ]);

            if (friendsRes.status === "fulfilled") {
                const data = friendsRes.value;
                friends = Array.isArray(data) ? data : data?.friends || [];
            }
            if (requestsRes.status === "fulfilled") {
                const data = requestsRes.value;
                requests = Array.isArray(data) ? data : data?.requests || [];
            }
        } catch (err) {
            logger.error("Gagal memuat data teman", err);
        } finally {
            loading = false;
        }
    };

    const handleSendRequest = async () => {
        if (!addUsername.trim()) return;
        actionLoading = true;
        message = null;
        try {
            await friendRequest({ username: addUsername.trim() });
            message = `Permintaan pertemanan berhasil dikirim ke "${addUsername.trim()}".`;
            messageType = "success";
            addUsername = "";
            await loadData();
        } catch (err) {
            const e = /** @type {any} */ (err);
            message = e.message || "Gagal mengirim permintaan pertemanan.";
            messageType = "error";
        } finally {
            actionLoading = false;
        }
    };

    /** @param {string} requestId */
    const handleAccept = async (requestId) => {
        actionLoading = true;
        try {
            await acceptFriendRequests(requestId);
            message = "Permintaan pertemanan diterima.";
            messageType = "success";
            await loadData();
        } catch (err) {
            const e = /** @type {any} */ (err);
            message = e.message || "Gagal menerima permintaan.";
            messageType = "error";
        } finally {
            actionLoading = false;
        }
    };

    /** @param {string} requestId */
    const handleReject = async (requestId) => {
        actionLoading = true;
        try {
            await rejectFriendRequests(requestId);
            message = "Permintaan pertemanan ditolak.";
            messageType = "success";
            await loadData();
        } catch (err) {
            const e = /** @type {any} */ (err);
            message = e.message || "Gagal menolak permintaan.";
            messageType = "error";
        } finally {
            actionLoading = false;
        }
    };

    /** @param {string} friendId */
    const handleDeleteFriend = async (friendId) => {
        if (!confirm("Apakah Anda yakin ingin menghapus teman ini?")) return;
        actionLoading = true;
        try {
            await deleteFromFriendList(friendId);
            message = "Teman berhasil dihapus.";
            messageType = "success";
            await loadData();
        } catch (err) {
            const e = /** @type {any} */ (err);
            message = e.message || "Gagal menghapus teman.";
            messageType = "error";
        } finally {
            actionLoading = false;
        }
    };

    /** @param {any} friend */
    const startChat = (friend) => {
        const id = friend.conversationId || friend.id || friend.userId;
        if (id) {
            push(`/chat/${id}`);
        }
    };

    $: filteredFriends = friends.filter((f) => {
        const name = (f.username || f.name || "").toLowerCase();
        return name.includes(searchQuery.toLowerCase());
    });

    onMount(() => {
        loadData();
    });
</script>

<ProtectedLayout>
    <div class="max-w-4xl mx-auto space-y-6">
        <!-- Header & Tabs -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
                <h1 class="text-2xl font-bold text-slate-900 tracking-tight">Daftar Teman</h1>
                <p class="text-sm text-slate-500">Kelola kontak dan permintaan pertemanan Anda.</p>
            </div>

            <!-- Tab Buttons -->
            <div class="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-sm font-medium">
                <button
                    type="button"
                    class="px-4 py-2 rounded-lg transition-all {activeTab === 'friends' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = 'friends')}
                >
                    Teman ({friends.length})
                </button>
                <button
                    type="button"
                    class="px-4 py-2 rounded-lg transition-all relative {activeTab === 'requests' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = 'requests')}
                >
                    Permintaan
                    {#if requests.length > 0}
                        <span class="ml-1 px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded-full">{requests.length}</span>
                    {/if}
                </button>
                <button
                    type="button"
                    class="px-4 py-2 rounded-lg transition-all {activeTab === 'add' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = 'add')}
                >
                    + Tambah
                </button>
            </div>
        </div>

        <!-- Alert Notification -->
        {#if message}
            <div class="p-3.5 rounded-xl text-sm flex items-center justify-between gap-3 animate-fadeIn {messageType === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'}">
                <div class="flex items-center gap-2">
                    {#if messageType === 'success'}
                        <svg class="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    {:else}
                        <svg class="w-5 h-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    {/if}
                    <span>{message}</span>
                </div>
                <button type="button" class="text-xs font-semibold opacity-70 hover:opacity-100" on:click={() => (message = null)}>✕</button>
            </div>
        {/if}

        <!-- TAB 1: ALL FRIENDS -->
        {#if activeTab === "friends"}
            <div class="space-y-4">
                <!-- Search Box -->
                <div class="relative">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Cari teman..."
                        class="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                    />
                </div>

                {#if loading}
                    <div class="p-12 text-center text-slate-400 space-y-3">
                        <div class="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <p class="text-sm">Memuat daftar teman...</p>
                    </div>
                {:else if filteredFriends.length === 0}
                    <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                        <div class="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-4">
                            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>
                        <h3 class="font-bold text-slate-800 text-base mb-1">
                            {searchQuery ? 'Tidak ada teman yang cocok' : 'Belum Ada Teman'}
                        </h3>
                        <p class="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                            {searchQuery ? 'Coba cari dengan kata kunci lain.' : 'Mulai terhubung dengan menambahkan teman menggunakan username mereka.'}
                        </p>
                        {#if !searchQuery}
                            <button
                                type="button"
                                class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shadow-sm"
                                on:click={() => (activeTab = 'add')}
                            >
                                + Tambah Teman Baru
                            </button>
                        {/if}
                    </div>
                {:else}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {#each filteredFriends as friend}
                            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between hover:border-slate-300 transition-all">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white font-bold flex items-center justify-center text-sm uppercase shrink-0 shadow-sm">
                                        {(friend.username || friend.name || "U").slice(0, 2)}
                                    </div>
                                    <div class="min-w-0">
                                        <h4 class="font-semibold text-slate-900 text-sm truncate">
                                            {friend.username || friend.name || "User"}
                                        </h4>
                                        <p class="text-xs text-slate-500 truncate">
                                            {friend.email || "GetTalk User"}
                                        </p>
                                    </div>
                                </div>

                                <div class="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm flex items-center gap-1.5"
                                        on:click={() => startChat(friend)}
                                    >
                                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                        </svg>
                                        <span>Chat</span>
                                    </button>
                                    <button
                                        type="button"
                                        class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                        title="Hapus Teman"
                                        disabled={actionLoading}
                                        on:click={() => handleDeleteFriend(friend.id || friend.userId)}
                                    >
                                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

        <!-- TAB 2: PENDING REQUESTS -->
        {:else if activeTab === "requests"}
            <div class="space-y-4">
                {#if loading}
                    <div class="p-12 text-center text-slate-400 space-y-3">
                        <div class="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <p class="text-sm">Memuat permintaan pertemanan...</p>
                    </div>
                {:else if requests.length === 0}
                    <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                        <div class="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
                            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                        </div>
                        <h3 class="font-bold text-slate-800 text-base mb-1">Tidak Ada Permintaan Masuk</h3>
                        <p class="text-sm text-slate-500 max-w-sm mx-auto">
                            Saat seseorang mengirimkan permintaan pertemanan, Anda dapat menyetujui atau menolaknya di sini.
                        </p>
                    </div>
                {:else}
                    <div class="space-y-3">
                        {#each requests as req}
                            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm uppercase shrink-0">
                                        {(req.username || req.sender?.username || "U").slice(0, 2)}
                                    </div>
                                    <div class="min-w-0">
                                        <h4 class="font-semibold text-slate-900 text-sm truncate">
                                            {req.username || req.sender?.username || "User"}
                                        </h4>
                                        <p class="text-xs text-slate-500">Ingin berteman dengan Anda</p>
                                    </div>
                                </div>

                                <div class="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                                        disabled={actionLoading}
                                        on:click={() => handleAccept(req.id || req.requestId)}
                                    >
                                        Terima
                                    </button>
                                    <button
                                        type="button"
                                        class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                        disabled={actionLoading}
                                        on:click={() => handleReject(req.id || req.requestId)}
                                    >
                                        Tolak
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

        <!-- TAB 3: ADD FRIEND -->
        {:else if activeTab === "add"}
            <div class="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm max-w-lg mx-auto">
                <div class="text-center mb-6">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900">Tambah Teman Baru</h3>
                    <p class="text-sm text-slate-500 mt-1">Masukkan username teman yang ingin Anda tambahkan.</p>
                </div>

                <form on:submit|preventDefault={handleSendRequest} class="space-y-4">
                    <div>
                        <label for="addUsername" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                            Username Teman
                        </label>
                        <input
                            id="addUsername"
                            type="text"
                            bind:value={addUsername}
                            placeholder="Ketik username..."
                            required
                            disabled={actionLoading}
                            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={actionLoading || !addUsername.trim()}
                        class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {#if actionLoading}
                            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Mengirim Permintaan...</span>
                        {:else}
                            <span>Kirim Permintaan Pertemanan</span>
                        {/if}
                    </button>
                </form>
            </div>
        {/if}
    </div>
</ProtectedLayout>
