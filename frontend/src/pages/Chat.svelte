<script>
    import { onMount, onDestroy, tick } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { socketStore } from "../stores/socket.store.js";
    import { conversationsStore } from "../stores/conversations.store.js";
    import { messagesStore, MESSAGES_PAGE_LIMIT } from "../stores/messages.store.js";
    import MessageItem from "../components/chat/MessageItem.svelte";
    import MessageInput from "../components/chat/MessageInput.svelte";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../lib/errors/pageerror.js";
    import { push } from "svelte-spa-router";

    /** @type {{ conversationId?: string, [key: string]: any }} */
    export let params = {};

    let conversationId = "";
    /** @type {string | null} */
    let mutatingMessageId = null;
    let roomStatus = "connecting";
    /** @type {string | null} */
    let attachmentError = null;
    /** @type {HTMLElement | null} */
    let messagesContainer = null;

    $: e2eeStatus = $conversationsStore.e2eeStatus;
    $: e2eeError = $conversationsStore.e2eeError;
    $: keyChange = $conversationsStore.keyChange;
    $: isE2EEError = e2eeStatus === "error" || e2eeStatus === "keyChange";

    $: if (params.conversationId && params.conversationId !== conversationId) {
        if (conversationId) {
            socketStore.leaveRoom(conversationId);
        }
        conversationId = params.conversationId;
        initConversation(conversationId);
    }

    /** @param {string} convId */
    const initConversation = async (convId) => {
        if (!convId) return;
        roomStatus = "connecting";
        attachmentError = null;

        // Establish the E2EE session via store before joining the room or loading history,
        // so no message is displayed or sent without a verified key.
        await conversationsStore.initE2EESession(convId, $authStore.user?.id);

        // Join WebSocket Room
        const joinRes = await socketStore.joinRoom(convId);
        roomStatus = joinRes?.success ? "connected" : "error";

        // Fetch message history from REST API (decryption is per-message, max 50 per page)
        await messagesStore.loadMessages(convId, { limit: MESSAGES_PAGE_LIMIT });

        scrollToBottom();
    };

    /**
     * Load older messages (up to 50) using cursor pagination (`nextCursor`)
     * while preserving the user's current scroll position.
     */
    const loadOlderMessages = async () => {
        if (!conversationId || !hasMoreMessages || isLoadingMore || isLoadingHistory) {
            return;
        }

        const container = messagesContainer || document.getElementById("chat-messages");
        const prevScrollHeight = container ? container.scrollHeight : 0;
        const prevScrollTop = container ? container.scrollTop : 0;

        const added = await messagesStore.loadMoreMessages(conversationId, {
            limit: MESSAGES_PAGE_LIMIT
        });

        if (added.length > 0 && container) {
            await tick();
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = Math.max(0, newScrollHeight - prevScrollHeight + prevScrollTop);
        }
    };

    /**
     * Scroll-to-top detector to trigger loading the previous 50 messages smoothly.
     * @param {UIEvent} e
     */
    const handleMessagesScroll = (e) => {
        const target = /** @type {HTMLElement | null} */ (e.currentTarget);
        if (
            target &&
            target.scrollTop <= 40 &&
            hasMoreMessages &&
            !isLoadingMore &&
            !isLoadingHistory
        ) {
            loadOlderMessages();
        }
    };

    /**
     * Handle message edit (FR-11, AC-07, AC-09).
     * @param {CustomEvent<{ messageId: string, plaintext: string, done: (err: string | null) => void }>} e
     */
    const handleEditMessage = async (e) => {
        const { messageId, plaintext, done } = e.detail;
        if (!conversationId || e2eeStatus !== "ready" || mutatingMessageId) {
            done?.(getPageErrorMessage(PAGE_ERROR_CODES.E2EE_NOT_READY, "edit-message"));
            return;
        }

        mutatingMessageId = messageId;
        try {
            await messagesStore.editMessage(conversationId, messageId, { plaintext });
            done?.(null);
        } catch (err) {
            done?.(
                getPageErrorMessage(err, {
                    context: "edit-message",
                    fallbackCode: PAGE_ERROR_CODES.MESSAGE_EDIT_FAILED
                })
            );
        } finally {
            mutatingMessageId = null;
        }
    };

    /**
     * Handle message soft-delete (FR-12, RB-05, AC-08, AC-09).
     * @param {CustomEvent<{ messageId: string, done: (err: string | null) => void }>} e
     */
    const handleDeleteMessage = async (e) => {
        const { messageId, done } = e.detail;
        if (!conversationId || mutatingMessageId) {
            done?.(getPageErrorMessage(PAGE_ERROR_CODES.OPERATION_BUSY, "delete-message"));
            return;
        }

        mutatingMessageId = messageId;
        try {
            await messagesStore.deleteMessage(conversationId, messageId);
            done?.(null);
        } catch (err) {
            done?.(
                getPageErrorMessage(err, {
                    context: "delete-message",
                    fallbackCode: PAGE_ERROR_CODES.MESSAGE_DELETE_FAILED
                })
            );
        } finally {
            mutatingMessageId = null;
        }
    };

    const handleAcceptNewKey = async () => {
        if (!keyChange) return;

        const confirmed = confirm(
            "Pastikan fingerprint baru cocok dengan yang diberikan lawan bicara lewat kanal lain (tatap muka/telepon). Lanjutkan?"
        );
        if (!confirmed) return;

        try {
            await conversationsStore.acceptPeerKeyChange(
                conversationId,
                $authStore.user?.id,
                keyChange.userId
            );
            await messagesStore.loadMessages(conversationId, { limit: MESSAGES_PAGE_LIMIT });
            scrollToBottom();
        } catch {
            // Error is already normalized and stored in conversationsStore.e2eeError
        }
    };

    /** @param {any} attachment */
    const handleDownloadAttachment = async (attachment) => {
        try {
            attachmentError = null;
            await messagesStore.downloadAttachment(conversationId, attachment);
        } catch (err) {
            attachmentError = getPageErrorMessage(err, {
                context: "attachment",
                fallbackCode: PAGE_ERROR_CODES.FILE_DECRYPTION_FAILED
            });
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            const container = messagesContainer || document.getElementById("chat-messages");
            if (container) container.scrollTop = container.scrollHeight;
        }, 60);
    };

    $: currentMessages = $messagesStore.messagesByConversation[conversationId] || [];
    $: isLoadingHistory = $messagesStore.loadingByConversation[conversationId] || false;
    $: isLoadingMore = $messagesStore.loadingMoreByConversation?.[conversationId] || false;
    $: hasMoreMessages = $messagesStore.hasMoreByConversation?.[conversationId] || false;
    $: activeConv = $conversationsStore.activeConversation;

    onMount(() => {
        if (params.conversationId) {
            conversationId = params.conversationId;
            initConversation(conversationId);
        }
    });

    onDestroy(() => {
        if (conversationId) {
            socketStore.leaveRoom(conversationId);
        }
    });
</script>

<ProtectedLayout>
    <div class="h-[calc(100vh-6rem)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <!-- Chat Room Header -->
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
            <div class="flex items-center gap-3">
                <button
                    type="button"
                    class="p-2 -ml-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    title="Kembali ke Daftar Teman"
                    on:click={() => push('/friends')}
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>

                <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-700 text-white font-bold flex items-center justify-center text-sm uppercase shadow-sm">
                        {(activeConv?.peer?.username || conversationId || "C").slice(0, 2)}
                    </div>
                    <span
                        class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white {$socketStore.connected ? 'bg-emerald-500' : 'bg-slate-400'}"
                        title={$socketStore.connected ? 'WebSocket Terhubung' : 'WebSocket Terputus'}
                    ></span>
                </div>

                <div>
                    <h3 class="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>{activeConv?.peer?.username || "Ruang Obrolan"}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono">
                            room:{conversationId}
                        </span>
                    </h3>
                    <p class="text-xs text-slate-500">
                        Status: <span class="text-indigo-600 font-medium capitalize">{roomStatus}</span>
                    </p>
                </div>
            </div>

            <!-- E2EE & Socket Status Badge -->
            <div class="flex items-center gap-2">
                {#if e2eeStatus === 'ready'}
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                        <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span class="hidden sm:inline">E2EE Terproteksi</span>
                    </div>
                {:else if isE2EEError}
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium" title={e2eeError || 'Sesi E2EE gagal'}>
                        <svg class="w-3.5 h-3.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <span class="hidden sm:inline">E2EE Gagal</span>
                    </div>
                {:else}
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                        <div class="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                        <span class="hidden sm:inline">Menyiapkan Kunci</span>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Messages Feed Container -->
        <div
            id="chat-messages"
            bind:this={messagesContainer}
            on:scroll={handleMessagesScroll}
            class="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50"
        >
            <!-- E2EE Info Banner -->
            <div class="max-w-md mx-auto p-3.5 rounded-2xl {isE2EEError ? 'bg-rose-50/70 border-rose-100 text-rose-800' : 'bg-indigo-50/70 border-indigo-100 text-indigo-800'} border text-center text-xs leading-relaxed shadow-xs">
                <div class="flex items-center justify-center gap-1.5 font-semibold mb-1 {isE2EEError ? 'text-rose-900' : 'text-indigo-900'}">
                    <svg class="w-4 h-4 {isE2EEError ? 'text-rose-600' : 'text-indigo-600'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>
                        {#if e2eeStatus === 'ready'}Enkripsi End-to-End Aktif
                        {:else if isE2EEError}Sesi E2EE Tidak Aman
                        {:else}Menyiapkan Sesi E2EE...{/if}
                    </span>
                </div>
                {#if e2eeStatus === 'ready'}
                    Pesan dan data hanya dapat dibaca oleh Anda dan lawan bicara.
                {:else if isE2EEError}
                    <p>{e2eeError || getPageErrorMessage(PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED, "e2ee")} Pengiriman pesan diblokir.</p>
                    {#if keyChange}
                        <div class="mt-2 p-2.5 rounded-lg bg-white/70 border border-rose-100 text-left font-mono text-[10px] leading-relaxed break-all text-slate-700">
                            <div>
                                <span class="font-sans font-semibold">Fingerprint lama</span><br>
                                {keyChange.previousFingerprint}
                            </div>
                            <div class="mt-1.5">
                                <span class="font-sans font-semibold">Fingerprint baru</span><br>
                                {keyChange.fingerprint}
                            </div>
                        </div>
                        <button
                            type="button"
                            class="mt-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors"
                            on:click={handleAcceptNewKey}
                        >
                            Verifikasi dan terima kunci baru
                        </button>
                    {/if}
                {:else}
                    Menghitung kunci bersama. Pengiriman pesan belum diaktifkan.
                {/if}
            </div>

            {#if isLoadingHistory}
                <div class="p-6 text-center text-slate-400">
                    <div class="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p class="text-xs">Memuat riwayat pesan...</p>
                </div>
            {:else if currentMessages.length === 0}
                <div class="p-8 text-center text-slate-400">
                    <p class="text-sm">Belum ada pesan dalam obrolan ini.</p>
                    <p class="text-xs mt-1">Kirim pesan pertama Anda di bawah ini!</p>
                </div>
            {:else}
                {#if isLoadingMore}
                    <div class="py-2 text-center text-slate-400 flex items-center justify-center gap-2 text-xs" role="status">
                        <div class="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Memuat pesan sebelumnya...</span>
                    </div>
                {:else if hasMoreMessages}
                    <div class="py-1 text-center">
                        <button
                            type="button"
                            class="px-3 py-1 rounded-full bg-white border border-slate-200 hover:border-indigo-300 text-xs font-medium text-indigo-600 hover:text-indigo-700 shadow-xs transition-colors cursor-pointer"
                            on:click={loadOlderMessages}
                        >
                            Muat pesan sebelumnya
                        </button>
                    </div>
                {/if}

                {#each currentMessages as msg (msg.id || msg.client_message_id)}
                    {@const isSelf = msg.sender_id === $authStore.user?.id || msg.sender_username === $authStore.user?.username || msg.sender_id === 'me'}
                    <MessageItem
                        {msg}
                        {isSelf}
                        e2eeReady={e2eeStatus === 'ready'}
                        isBusy={mutatingMessageId === msg.id}
                        on:edit={handleEditMessage}
                        on:delete={handleDeleteMessage}
                        on:download={(e) => handleDownloadAttachment(e.detail.attachment)}
                    />
                {/each}
            {/if}
        </div>

        <!-- Chat Input Bar -->
        <MessageInput
            {conversationId}
            disabled={e2eeStatus !== 'ready'}
            externalError={attachmentError}
            on:sent={scrollToBottom}
        />
    </div>
</ProtectedLayout>
