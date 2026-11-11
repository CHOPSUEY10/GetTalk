<script>
    import { onMount } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { friendsStore } from "../stores/friends.store.js";
    import { conversationsStore } from "../stores/conversations.store.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../lib/errors/pageerror.js";
    import { push } from "svelte-spa-router";
    import Icon from "../components/common/Icon.svelte";
    import Skeleton from "../components/common/Skeleton.svelte";
    import EmptyState from "../components/common/EmptyState.svelte";
    import ConfirmDialog from "../components/common/ConfirmDialog.svelte";

    let activeTab = "friends"; // 'friends' | 'requests' | 'add'
    let searchQuery = "";
    let addUsername = "";
    let actionLoading = false;
    /** @type {string | null} */
    let busyItemId = null;
    /** @type {string | null} */
    let startingChatId = null;
    /** @type {{ id: string, username: string } | null} */
    let friendToDelete = null;

    /** @type {string | null} */
    let message = null;
    /** @type {'success' | 'error' | null} */
    let messageType = null;
    let storeErrorDismissed = false;

    // Subscribe to the store reactively
    $: friends = $friendsStore.friends;
    $: requests = $friendsStore.requests;
    $: loading = $friendsStore.loading;
    $: loadingMoreFriends = $friendsStore.loadingMoreFriends || false;
    $: loadingMoreRequests = $friendsStore.loadingMoreRequests || false;
    $: friendsPagination = $friendsStore.friendsPagination || {
        limit: 20,
        offset: 0,
        total: friends.length,
        hasMore: false
    };
    $: requestsPagination = $friendsStore.requestsPagination || {
        limit: 20,
        nextCursor: null,
        hasMore: false
    };

    $: if ($friendsStore.error) {
        storeErrorDismissed = false;
    }

    $: activeAlert = message || (!storeErrorDismissed ? $friendsStore.error : null);

    const dismissAlert = () => {
        message = null;
        storeErrorDismissed = true;
    };

    const handleSendRequest = async () => {
        if (!addUsername.trim()) return;
        actionLoading = true;
        message = null;
        try {
            const targetName = addUsername.trim();
            await friendsStore.sendRequest({ username: targetName });
            message = `Permintaan pertemanan berhasil dikirim ke "${targetName}".`;
            messageType = "success";
            addUsername = "";
            await friendsStore.loadAll();
        } catch (err) {
            message = getPageErrorMessage(err, {
                context: "friends",
                fallbackCode: PAGE_ERROR_CODES.FRIEND_REQUEST_FAILED
            });
            messageType = "error";
        } finally {
            actionLoading = false;
        }
    };

    /** @param {string} requestId */
    const handleAccept = async (requestId) => {
        actionLoading = true;
        busyItemId = requestId;
        message = null;
        try {
            await friendsStore.accept(requestId);
            message = "Permintaan pertemanan diterima.";
            messageType = "success";
        } catch (err) {
            message = getPageErrorMessage(err, {
                context: "friends",
                fallbackCode: PAGE_ERROR_CODES.FRIEND_ACCEPT_FAILED
            });
            messageType = "error";
        } finally {
            actionLoading = false;
            busyItemId = null;
        }
    };

    /** @param {string} requestId */
    const handleReject = async (requestId) => {
        actionLoading = true;
        busyItemId = requestId;
        message = null;
        try {
            await friendsStore.reject(requestId);
            message = "Permintaan pertemanan ditolak.";
            messageType = "success";
        } catch (err) {
            message = getPageErrorMessage(err, {
                context: "friends",
                fallbackCode: PAGE_ERROR_CODES.FRIEND_REJECT_FAILED
            });
            messageType = "error";
        } finally {
            actionLoading = false;
            busyItemId = null;
        }
    };

    /** @param {any} friend */
    const promptDeleteFriend = (friend) => {
        const id = friend.id || friend.userId;
        if (!id) return;
        friendToDelete = {
            id,
            username: friend.username || friend.name || "teman ini"
        };
    };

    const confirmDeleteFriend = async () => {
        if (!friendToDelete) return;
        const friendId = friendToDelete.id;
        actionLoading = true;
        busyItemId = friendId;
        message = null;
        try {
            await friendsStore.remove(friendId);
            message = `Kontak "${friendToDelete.username}" berhasil dihapus dari daftar teman.`;
            messageType = "success";
            friendToDelete = null;
        } catch (err) {
            message = getPageErrorMessage(err, {
                context: "friends",
                fallbackCode: PAGE_ERROR_CODES.FRIEND_REMOVE_FAILED
            });
            messageType = "error";
        } finally {
            actionLoading = false;
            busyItemId = null;
        }
    };

    const handleLoadMoreFriends = async () => {
        await friendsStore.loadMoreFriends();
    };

    const handleLoadMoreRequests = async () => {
        await friendsStore.loadMoreRequests();
    };

    /** @param {any} friend */
    const startChat = async (friend) => {
        const targetUserId = friend.userId || friend.id;
        if (friend.conversationId) {
            push(`/chat/${friend.conversationId}`);
            return;
        }

        if (!targetUserId || startingChatId) return;

        startingChatId = targetUserId;
        try {
            const conversationId = await conversationsStore.createOrOpenDirectChat(targetUserId);
            if (conversationId) {
                push(`/chat/${conversationId}`);
            }
        } catch (err) {
            message = getPageErrorMessage(err, {
                context: "chat",
                fallbackCode: PAGE_ERROR_CODES.CONVERSATION_CREATE_FAILED
            });
            messageType = "error";
        } finally {
            startingChatId = null;
        }
    };

    $: filteredFriends = friends.filter((f) => {
        const name = (f.nickname || f.username || f.name || "").toLowerCase();
        const uname = (f.username || "").toLowerCase();
        const q = searchQuery.toLowerCase();
        return name.includes(q) || uname.includes(q);
    });

    onMount(() => {
        friendsStore.loadAll();
        friendsStore.initSocketListeners();
    });
</script>

<ProtectedLayout>
    <div class="max-w-4xl w-full mx-auto space-y-6 pb-6">
        <!-- Header & Responsive Tabs -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
                <h1 class="text-2xl font-bold text-slate-900 tracking-tight">Teman & Kontak</h1>
                <p class="text-sm text-slate-500 mt-0.5">Kelola jaringan kontak terenkripsi dan permintaan pertemanan Anda.</p>
            </div>

            <!-- Tab Buttons -->
            <div
                class="flex flex-wrap sm:inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold gap-1"
                role="tablist"
                aria-label="Manajemen pertemanan"
            >
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "friends"}
                    class="flex-1 sm:flex-initial px-3.5 py-2 rounded-lg transition-all cursor-pointer {activeTab === 'friends' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = "friends")}
                >
                    Teman ({friendsPagination.total || friends.length})
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "requests"}
                    class="flex-1 sm:flex-initial px-3.5 py-2 rounded-lg transition-all relative inline-flex items-center justify-center gap-1.5 cursor-pointer {activeTab === 'requests' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = "requests")}
                >
                    <span>Permintaan</span>
                    {#if requests.length > 0}
                        <span class="px-1.5 py-0.5 text-[11px] bg-indigo-600 text-white rounded-full font-bold leading-none">
                            {requests.length}
                        </span>
                    {/if}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "add"}
                    class="flex-1 sm:flex-initial px-3.5 py-2 rounded-lg transition-all inline-flex items-center justify-center gap-1 cursor-pointer {activeTab === 'add' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
                    on:click={() => (activeTab = "add")}
                >
                    <Icon name="user-plus" size="xs" />
                    <span>Tambah</span>
                </button>
            </div>
        </div>

        <!-- Alert Notification -->
        {#if activeAlert}
            <div
                role="alert"
                class="p-3.5 rounded-xl text-sm flex items-center justify-between gap-3 animate-fadeIn {messageType === 'success' && message ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'}"
            >
                <div class="flex items-center gap-2.5">
                    <Icon
                        name={messageType === "success" && message ? "check" : "alert-triangle"}
                        size="md"
                        className={messageType === "success" && message ? "text-emerald-600" : "text-rose-600"}
                    />
                    <span>{activeAlert}</span>
                </div>
                <button
                    type="button"
                    class="p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                    aria-label="Tutup pesan"
                    on:click={dismissAlert}
                >
                    <Icon name="x" size="xs" />
                </button>
            </div>
        {/if}

        <!-- TAB 1: ALL FRIENDS -->
        {#if activeTab === "friends"}
            <div class="space-y-4">
                <!-- Search Box -->
                <div class="relative">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Icon name="search" size="md" />
                    </div>
                    <input
                        type="search"
                        bind:value={searchQuery}
                        placeholder="Cari teman berdasarkan username..."
                        aria-label="Cari teman"
                        class="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-xs"
                    />
                </div>

                {#if loading && friends.length === 0}
                    <Skeleton variant="card-grid" count={4} label="Memuat daftar teman..." />
                {:else if filteredFriends.length === 0}
                    <EmptyState
                        icon="users"
                        tone="primary"
                        title={searchQuery ? "Tidak ada teman yang cocok" : "Belum Ada Teman"}
                        description={searchQuery
                            ? `Tidak ditemukan kontak dengan kata kunci "${searchQuery}".`
                            : "Mulai terhubung secara aman dengan menambahkan teman menggunakan username mereka."}
                    >
                        {#if searchQuery}
                            <button
                                type="button"
                                class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                                on:click={() => (searchQuery = "")}
                            >
                                Reset Pencarian
                            </button>
                        {:else}
                            <button
                                type="button"
                                class="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer"
                                on:click={() => (activeTab = "add")}
                            >
                                <Icon name="user-plus" size="sm" />
                                <span>Tambah Teman Baru</span>
                            </button>
                        {/if}
                    </EmptyState>
                {:else}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {#each filteredFriends as friend (friend.userId || friend.id)}
                            {@const fId = friend.userId || friend.id}
                            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-3 hover:border-indigo-200 transition-all">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white font-bold flex items-center justify-center text-sm uppercase shrink-0 shadow-xs">
                                        {(friend.nickname || friend.username || friend.name || "U").slice(0, 2)}
                                    </div>
                                    <div class="min-w-0">
                                        <h4 class="font-bold text-slate-900 text-sm truncate">
                                            {friend.nickname || friend.username || friend.name || "User"}
                                        </h4>
                                        <p class="text-xs text-slate-500 truncate">
                                            {friend.bio || `@${friend.username || "user"}`}
                                        </p>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        disabled={startingChatId === fId}
                                        class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                                        on:click={() => startChat(friend)}
                                    >
                                        {#if startingChatId === fId}
                                            <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        {:else}
                                            <Icon name="message-square" size="xs" />
                                        {/if}
                                        <span>Chat</span>
                                    </button>
                                    <button
                                        type="button"
                                        class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                                        title="Hapus Teman"
                                        aria-label="Hapus {friend.username || 'teman'}"
                                        disabled={actionLoading && busyItemId === fId}
                                        on:click={() => promptDeleteFriend(friend)}
                                    >
                                        <Icon name="trash" size="sm" />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Pagination Bar for Friends List -->
                    {#if friendsPagination.hasMore}
                        <div class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-xs">
                            <span class="text-xs text-slate-500">
                                Menampilkan <strong class="text-slate-700">{friends.length}</strong> dari <strong class="text-slate-700">{friendsPagination.total || friends.length}</strong> teman
                            </span>
                            <button
                                type="button"
                                disabled={loadingMoreFriends}
                                on:click={handleLoadMoreFriends}
                                class="px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                            >
                                {#if loadingMoreFriends}
                                    <div class="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Memuat...</span>
                                {:else}
                                    <span>Muat lebih banyak</span>
                                {/if}
                            </button>
                        </div>
                    {/if}
                {/if}
            </div>

        <!-- TAB 2: PENDING REQUESTS -->
        {:else if activeTab === "requests"}
            <div class="space-y-4">
                {#if loading && requests.length === 0}
                    <Skeleton variant="list-rows" count={3} label="Memuat permintaan pertemanan..." />
                {:else if requests.length === 0}
                    <EmptyState
                        icon="inbox"
                        tone="neutral"
                        title="Tidak Ada Permintaan Masuk"
                        description="Saat seseorang mengirimkan permintaan pertemanan kepada Anda, Anda dapat menyetujui atau menolaknya di sini."
                    />
                {:else}
                    <div class="space-y-3">
                        {#each requests as req (req.id || req.requestId)}
                            {@const reqId = req.id || req.requestId}
                            {@const isBusy = actionLoading && busyItemId === reqId}
                            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm uppercase shrink-0">
                                        {(req.fromUser?.username || req.username || req.sender?.username || "U").slice(0, 2)}
                                    </div>
                                    <div class="min-w-0">
                                        <h4 class="font-bold text-slate-900 text-sm truncate">
                                            {req.fromUser?.username || req.username || req.sender?.username || "User"}
                                        </h4>
                                        <p class="text-xs text-slate-500">Mengirim permintaan untuk terhubung di GetTalk</p>
                                    </div>
                                </div>

                                <div class="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                                        disabled={actionLoading}
                                        on:click={() => handleAccept(reqId)}
                                    >
                                        {#if isBusy}
                                            <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        {:else}
                                            <Icon name="check" size="xs" />
                                        {/if}
                                        <span>Terima</span>
                                    </button>
                                    <button
                                        type="button"
                                        class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                                        disabled={actionLoading}
                                        on:click={() => handleReject(reqId)}
                                    >
                                        Tolak
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Pagination Bar for Pending Requests -->
                    {#if requestsPagination.hasMore}
                        <div class="pt-2 flex justify-center">
                            <button
                                type="button"
                                disabled={loadingMoreRequests}
                                on:click={handleLoadMoreRequests}
                                class="px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                            >
                                {#if loadingMoreRequests}
                                    <div class="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Memuat...</span>
                                {:else}
                                    <span>Muat lebih banyak</span>
                                {/if}
                            </button>
                        </div>
                    {/if}
                {/if}
            </div>

        <!-- TAB 3: ADD FRIEND -->
        {:else if activeTab === "add"}
            <div class="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs max-w-lg mx-auto animate-fadeIn">
                <div class="text-center mb-6">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3 border border-indigo-100">
                        <Icon name="user-plus" size="lg" />
                    </div>
                    <h3 class="text-lg font-bold text-slate-900">Tambah Teman Baru</h3>
                    <p class="text-sm text-slate-500 mt-1">Masukkan username akun GetTalk teman yang ingin Anda tambahkan.</p>
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
                            placeholder="Ketik username tepat (mis. alice)..."
                            required
                            disabled={actionLoading}
                            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={actionLoading || !addUsername.trim()}
                        class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {#if actionLoading}
                            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Mengirim Permintaan...</span>
                        {:else}
                            <Icon name="user-plus" size="sm" />
                            <span>Kirim Permintaan Pertemanan</span>
                        {/if}
                    </button>
                </form>
            </div>
        {/if}
    </div>

    <ConfirmDialog
        open={Boolean(friendToDelete)}
        title="Hapus Kontak Teman?"
        description="Apakah Anda yakin ingin menghapus {friendToDelete?.username || 'teman ini'} dari daftar kontak Anda?"
        confirmLabel="Ya, Hapus Teman"
        cancelLabel="Batal"
        variant="danger"
        loading={actionLoading}
        on:cancel={() => (friendToDelete = null)}
        on:confirm={confirmDeleteFriend}
    />
</ProtectedLayout>
