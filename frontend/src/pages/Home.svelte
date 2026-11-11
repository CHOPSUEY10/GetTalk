<script>
    import { onMount } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { userStore } from "../stores/user.store.js";
    import { socketStore } from "../stores/socket.store.js";
    import { conversationsStore } from "../stores/conversations.store.js";
    import { friendsStore } from "../stores/friends.store.js";
    import { uiStore } from "../stores/ui.store.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../lib/errors/pageerror.js";
    import { push } from "svelte-spa-router";
    import Icon from "../components/common/Icon.svelte";
    import Skeleton from "../components/common/Skeleton.svelte";
    import EmptyState from "../components/common/EmptyState.svelte";

    /** @type {string | null} */
    let startingChatId = null;
    /** @type {string | null} */
    let processingRequestId = null;

    $: conversations = $conversationsStore.conversations || [];
    $: convLoading = $conversationsStore.loading;
    $: convLoadingMore = $conversationsStore.loadingMore;
    $: convHasMore = $conversationsStore.hasMore;
    $: convError = $conversationsStore.error;

    $: friends = $friendsStore.friends || [];
    $: requests = $friendsStore.requests || [];
    $: friendsLoading = $friendsStore.loading;

    /** @param {any} friend */
    const startDirectChat = async (friend) => {
        const targetUserId = friend.userId || friend.id;
        if (friend.conversationId) {
            push(`/chat/${friend.conversationId}`);
            return;
        }
        if (!targetUserId || startingChatId) return;

        startingChatId = targetUserId;
        try {
            const convId = await conversationsStore.createOrOpenDirectChat(targetUserId);
            if (convId) {
                push(`/chat/${convId}`);
            }
        } catch (err) {
            uiStore.notify({
                type: "error",
                message: getPageErrorMessage(err, {
                    context: "chat",
                    fallbackCode: PAGE_ERROR_CODES.CONVERSATION_CREATE_FAILED
                })
            });
        } finally {
            startingChatId = null;
        }
    };

    /** @param {string} requestId */
    const quickAcceptRequest = async (requestId) => {
        if (!requestId || processingRequestId) return;
        processingRequestId = requestId;
        try {
            await friendsStore.accept(requestId);
            uiStore.notify({
                type: "success",
                message: "Permintaan pertemanan diterima."
            });
        } catch (err) {
            uiStore.notify({
                type: "error",
                message: getPageErrorMessage(err, {
                    context: "friends",
                    fallbackCode: PAGE_ERROR_CODES.FRIEND_ACCEPT_FAILED
                })
            });
        } finally {
            processingRequestId = null;
        }
    };

    onMount(() => {
        conversationsStore.loadConversations().catch(() => {});
        friendsStore.loadAll().catch(() => {});
        friendsStore.initSocketListeners?.();
    });
</script>

<ProtectedLayout>
    <div class="max-w-5xl w-full mx-auto space-y-6 pb-6">
        <!-- Welcome Hero Banner -->
        <div
            class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-6 sm:p-8 shadow-lg shadow-indigo-950/15"
        >
            <div class="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div class="max-w-xl">
                    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-medium text-indigo-100 mb-3">
                        <span
                            class="w-2 h-2 rounded-full {$socketStore.connected
                                ? 'bg-emerald-400'
                                : 'bg-amber-400 animate-pulse'}"
                        ></span>
                        <span>
                            {$socketStore.connected
                                ? "Koneksi Realtime Aktif"
                                : "Menghubungkan Jaringan..."}
                        </span>
                        <span class="opacity-40">•</span>
                        <span class="inline-flex items-center gap-1 text-emerald-300">
                            <Icon name="lock" size="xs" />
                            <span>E2EE Client-Side</span>
                        </span>
                    </div>

                    <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
                        Halo, {$userStore.nickname || $authStore.user?.nickname || $authStore.user?.username || "Pengguna"}!
                    </h1>
                    <p class="text-slate-300 text-sm sm:text-base leading-relaxed">
                        Kunci enkripsi disimpan secara eksklusif di perangkat Anda. Pilih percakapan aktif atau mulai obrolan baru yang aman.
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-2.5 shrink-0">
                    <a
                        href="#/friends"
                        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-xs sm:text-sm transition-all shadow-md shadow-indigo-950/40 no-underline"
                    >
                        <Icon name="users" size="sm" />
                        <span>Daftar Teman ({friends.length})</span>
                    </a>
                    <a
                        href="#/settings"
                        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs sm:text-sm transition-all no-underline"
                    >
                        <Icon name="settings" size="sm" />
                        <span>Pengaturan & Privasi</span>
                    </a>
                </div>
            </div>

            <div class="absolute -right-12 -bottom-12 w-56 h-56 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none"></div>
        </div>

        <!-- Pending Friend Requests Alert Bar (if any) -->
        {#if requests.length > 0}
            <div class="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 font-bold text-sm">
                        {requests.length}
                    </div>
                    <div>
                        <h2 class="text-sm font-bold text-slate-900">
                            {requests.length} Permintaan Pertemanan Menunggu
                        </h2>
                        <p class="text-xs text-slate-600">
                            Setujui permintaan untuk mulai bertukar pesan terenkripsi.
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    {#if requests[0]}
                        {@const firstReq = requests[0]}
                        {@const reqId = firstReq.id || firstReq.requestId}
                        <button
                            type="button"
                            disabled={processingRequestId === reqId}
                            on:click={() => quickAcceptRequest(reqId)}
                            class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Terima {firstReq.fromUser?.username || firstReq.username || "Permintaan"}
                        </button>
                    {/if}
                    <a
                        href="#/friends"
                        class="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors no-underline"
                    >
                        Lihat Semua
                    </a>
                </div>
            </div>
        {/if}

        <!-- Main Two-Column Dashboard Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Left/Main Column (2/3): Recent Conversations -->
            <section class="lg:col-span-2 space-y-3" aria-labelledby="recent-conversations-heading">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 id="recent-conversations-heading" class="text-base font-bold text-slate-900">
                            Percakapan Terenkripsi
                        </h2>
                        <p class="text-xs text-slate-500">
                            Lanjutkan obrolan terakhir Anda dengan perlindungan E2EE.
                        </p>
                    </div>
                    <button
                        type="button"
                        disabled={convLoading}
                        on:click={() => conversationsStore.loadConversations()}
                        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                        title="Muat ulang daftar percakapan"
                    >
                        <Icon name="refresh" size="xs" className={convLoading ? "animate-spin" : ""} />
                        <span>Segarkan</span>
                    </button>
                </div>

                {#if convLoading && conversations.length === 0}
                    <Skeleton variant="list-rows" count={3} label="Memuat daftar percakapan..." />
                {:else if convError && conversations.length === 0}
                    <EmptyState
                        icon="alert-triangle"
                        tone="danger"
                        title="Gagal Memuat Percakapan"
                        description={convError}
                    >
                        <button
                            type="button"
                            on:click={() => conversationsStore.loadConversations()}
                            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                        >
                            <Icon name="refresh" size="xs" />
                            <span>Coba Lagi</span>
                        </button>
                    </EmptyState>
                {:else if conversations.length === 0}
                    <EmptyState
                        icon="message-square"
                        tone="primary"
                        title="Belum Ada Percakapan Aktif"
                        description="Pilih teman dari daftar kontak Anda untuk menginisiasi pertukaran kunci E2EE dan memulai obrolan."
                    >
                        <a
                            href="#/friends"
                            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors shadow-xs no-underline"
                        >
                            <Icon name="users" size="sm" />
                            <span>Mulai Obrolan dari Daftar Teman</span>
                        </a>
                    </EmptyState>
                {:else}
                    <div class="space-y-2.5">
                        {#each conversations as conv (conv.id)}
                            {@const peerName = conv.peer?.nickname || conv.peer?.username || conv.name || "Lawan Bicara"}
                            <a
                                href="#/chat/{conv.id}"
                                class="bg-white p-4 rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-sm flex items-center justify-between gap-4 transition-all no-underline group"
                            >
                                <div class="flex items-center gap-3.5 min-w-0">
                                    <div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white font-bold flex items-center justify-center text-sm uppercase shrink-0 shadow-xs">
                                        {peerName.slice(0, 2)}
                                    </div>
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2">
                                            <h3 class="font-bold text-slate-900 text-sm truncate group-hover:text-indigo-600 transition-colors">
                                                {peerName}
                                            </h3>
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold">
                                                <Icon name="lock" size="xs" />
                                                <span>E2EE</span>
                                            </span>
                                        </div>
                                        <p class="text-xs text-slate-500 truncate mt-0.5">
                                            {#if conv.updated_at}
                                                Diperbarui {new Date(conv.updated_at).toLocaleString([], {
                                                    day: "2-digit",
                                                    month: "short",
                                                    hour: "2-digit",
                                                    minute: "2-digit"
                                                })}
                                            {:else}
                                                Klik untuk membuka ruang obrolan terenkripsi
                                            {/if}
                                        </p>
                                    </div>
                                </div>

                                <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 group-hover:bg-indigo-600 text-slate-700 group-hover:text-white text-xs font-semibold transition-colors shrink-0">
                                    <span>Buka Chat</span>
                                    <Icon name="arrow-right" size="xs" />
                                </div>
                            </a>
                        {/each}

                        {#if convHasMore}
                            <div class="pt-1 text-center">
                                <button
                                    type="button"
                                    disabled={convLoadingMore}
                                    on:click={() => conversationsStore.loadMoreConversations()}
                                    class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200 text-indigo-600 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {#if convLoadingMore}
                                        <span class="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                                        <span>Memuat...</span>
                                    {:else}
                                        <span>Muat Percakapan Lainnya</span>
                                    {/if}
                                </button>
                            </div>
                        {/if}
                    </div>
                {/if}
            </section>

            <!-- Right Column (1/3): Quick Contacts & Security Info -->
            <aside class="space-y-4">
                <!-- Quick Contacts Card -->
                <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-bold text-slate-900">Kontak Cepat</h3>
                        <a href="#/friends" class="text-xs font-semibold text-indigo-600 hover:underline">
                            Kelola
                        </a>
                    </div>

                    {#if friendsLoading && friends.length === 0}
                        <div class="space-y-2.5">
                            {#each [1, 2, 3] as idx (idx)}
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2.5">
                                        <div class="w-8 h-8 rounded-lg gt-skeleton"></div>
                                        <div class="h-3 w-24 gt-skeleton"></div>
                                    </div>
                                    <div class="h-6 w-12 rounded-md gt-skeleton"></div>
                                </div>
                            {/each}
                        </div>
                    {:else if friends.length === 0}
                        <div class="py-4 text-center space-y-2">
                            <p class="text-xs text-slate-500">
                                Belum ada teman di daftar kontak Anda.
                            </p>
                            <a
                                href="#/friends"
                                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors no-underline"
                            >
                                <Icon name="user-plus" size="xs" />
                                <span>Tambah Teman</span>
                            </a>
                        </div>
                    {:else}
                        <div class="space-y-2">
                            {#each friends.slice(0, 5) as friend (friend.userId || friend.id)}
                                {@const fId = friend.userId || friend.id}
                                <div class="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-slate-50 transition-colors">
                                    <div class="flex items-center gap-2.5 min-w-0">
                                        <div class="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs uppercase shrink-0">
                                            {(friend.nickname || friend.username || friend.name || "U").slice(0, 2)}
                                        </div>
                                        <span class="text-xs font-semibold text-slate-800 truncate">
                                            {friend.nickname || friend.username || friend.name || "User"}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={startingChatId === fId}
                                        on:click={() => startDirectChat(friend)}
                                        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                                    >
                                        {#if startingChatId === fId}
                                            <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        {:else}
                                            <Icon name="message-square" size="xs" />
                                            <span>Chat</span>
                                        {/if}
                                    </button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>

                <!-- Security Architecture Summary Card -->
                <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                    <div class="flex items-center gap-2.5">
                        <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                            <Icon name="shield-check" size="md" />
                        </div>
                        <div>
                            <h3 class="text-sm font-bold text-slate-900">Jaminan Privasi E2EE</h3>
                            <p class="text-[11px] text-slate-500">Web Crypto API • ECDH + AES-256-GCM</p>
                        </div>
                    </div>
                    <ul class="space-y-2 text-xs text-slate-600 leading-relaxed pl-1">
                        <li class="flex items-start gap-2">
                            <Icon name="check" size="xs" className="text-emerald-600 mt-1" />
                            <span>Kunci privat dibuat & disimpan di IndexedDB perangkat Anda, tidak pernah dikirim ke server.</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <Icon name="check" size="xs" className="text-emerald-600 mt-1" />
                            <span>Verifikasi Safety Number 60-digit & Kode QR tersedia di setiap ruang obrolan.</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <Icon name="check" size="xs" className="text-emerald-600 mt-1" />
                            <span>Pesan otomatis ditahan apabila perangkat lawan bicara berubah hingga Anda memverifikasinya.</span>
                        </li>
                    </ul>
                </div>
            </aside>
        </div>
    </div>
</ProtectedLayout>
