<script>
    import { onMount, onDestroy, tick } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { userStore } from "../stores/user.store.js";
    import { uiStore } from "../stores/ui.store.js";
    import { socketStore } from "../stores/socket.store.js";
    import { conversationsStore } from "../stores/conversations.store.js";
    import { messagesStore, MESSAGES_PAGE_LIMIT } from "../stores/messages.store.js";
    import MessageItem from "../components/chat/MessageItem.svelte";
    import MessageInput from "../components/chat/MessageInput.svelte";
    import SafetyNumberModal from "../components/chat/SafetyNumberModal.svelte";
    import Icon from "../components/common/Icon.svelte";
    import Skeleton from "../components/common/Skeleton.svelte";
    import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
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
    let showSafetyNumberModal = false;
    let showConfirmAcceptKey = false;
    let isAcceptingKey = false;
    let showConfirmBlockPeer = false;
    let isTogglingBlock = false;
    let previousMessageCount = 0;
    /** @type {Set<string>} */
    const markedReadIds = new Set();

    $: e2eeStatus = $conversationsStore.e2eeStatus;
    $: e2eeError = $conversationsStore.e2eeError;
    $: keyChange = $conversationsStore.keyChange;
    $: peerVerified = $conversationsStore.peerVerified;
    $: peerVerifiedAt = $conversationsStore.peerVerifiedAt;
    $: safetyNumber = $conversationsStore.safetyNumber;
    $: safetyNumberLoading = $conversationsStore.safetyNumberLoading;
    $: isE2EEError = e2eeStatus === "error" || e2eeStatus === "keyChange";

    $: if (params.conversationId && params.conversationId !== conversationId) {
        if (conversationId) {
            socketStore.leaveRoom(conversationId);
        }
        conversationId = params.conversationId;
        previousMessageCount = 0;
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

    const retryRoomConnection = async () => {
        if (!conversationId) return;
        roomStatus = "connecting";
        if (!$socketStore.connected) {
            socketStore.reconnect();
        }
        const joinRes = await socketStore.joinRoom(conversationId);
        roomStatus = joinRes?.success ? "connected" : "error";
    };

    const retryLoadHistory = async () => {
        if (!conversationId) return;
        await conversationsStore.initE2EESession(conversationId, $authStore.user?.id);
        await messagesStore.loadMessages(conversationId, { limit: MESSAGES_PAGE_LIMIT });
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

    const openSafetyNumberModal = async () => {
        showSafetyNumberModal = true;
        await conversationsStore.loadSafetyNumber(
            conversationId,
            $authStore.user?.id,
            activeConv?.peer?.id || keyChange?.userId
        );
    };

    const closeSafetyNumberModal = () => {
        showSafetyNumberModal = false;
    };

    /** @param {CustomEvent<{ verified: boolean, done?: () => void }>} e */
    const handleToggleVerified = async (e) => {
        const { verified, done } = e.detail || {};
        try {
            await conversationsStore.togglePeerVerification(
                conversationId,
                Boolean(verified),
                activeConv?.peer?.id
            );
        } finally {
            done?.();
        }
    };

    /** @param {{ verified?: boolean }} [options] */
    const approvePeerKeyChange = async (options = {}) => {
        if (!keyChange) return;
        isAcceptingKey = true;
        try {
            await conversationsStore.acceptPeerKeyChange(
                conversationId,
                $authStore.user?.id,
                keyChange.userId,
                options
            );
            await messagesStore.flushPendingMessages(conversationId);
            await messagesStore.loadMessages(conversationId, { limit: MESSAGES_PAGE_LIMIT });
            showSafetyNumberModal = false;
            showConfirmAcceptKey = false;
            scrollToBottom();
        } catch {
            // Error is already normalized and stored in conversationsStore.e2eeError
        } finally {
            isAcceptingKey = false;
        }
    };

    const handleAcceptNewKey = () => {
        if (!keyChange) return;
        showConfirmAcceptKey = true;
    };

    const confirmAcceptNewKey = async () => {
        await approvePeerKeyChange({ verified: false });
    };

    /** @param {CustomEvent<{ verified?: boolean }>} e */
    const handleModalAcceptKeyChange = async (e) => {
        await approvePeerKeyChange({ verified: Boolean(e.detail?.verified) });
    };

    const handleDiscardPendingMessages = () => {
        if (!conversationId) return;
        messagesStore.discardPendingMessages(conversationId);
    };

    /**
     * @param {any} attachment
     * @param {(() => void)} [done]
     */
    const handleDownloadAttachment = async (attachment, done) => {
        try {
            attachmentError = null;
            await messagesStore.downloadAttachment(conversationId, attachment);
        } catch (err) {
            attachmentError = getPageErrorMessage(err, {
                context: "attachment",
                fallbackCode: PAGE_ERROR_CODES.FILE_DECRYPTION_FAILED
            });
        } finally {
            done?.();
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            const container = messagesContainer || document.getElementById("chat-messages");
            if (container) container.scrollTop = container.scrollHeight;
        }, 60);
    };

    $: currentMessages = $messagesStore.messagesByConversation[conversationId] || [];
    $: pendingQueue = $messagesStore.pendingQueueByConversation?.[conversationId] || [];
    $: pendingCount = pendingQueue.length;
    $: isLoadingHistory = $messagesStore.loadingByConversation[conversationId] || false;
    $: isLoadingMore = $messagesStore.loadingMoreByConversation?.[conversationId] || false;
    $: hasMoreMessages = $messagesStore.hasMoreByConversation?.[conversationId] || false;
    $: historyError = $messagesStore.errorByConversation?.[conversationId] || null;
    $: activeConv = $conversationsStore.activeConversation;
    $: peerId = activeConv?.peer?.id || null;
    $: peerUsername = activeConv?.peer?.username || "Ruang Obrolan";
    $: peerDisplayName = activeConv?.peer?.nickname || activeConv?.peer?.username || "Ruang Obrolan";
    $: peerLastSeenAt = activeConv?.peer?.lastSeenAt || activeConv?.peer?.last_seen_at || null;
    $: peerTypingState = $messagesStore.typingByConversation?.[conversationId];
    $: isPeerTyping = Boolean(
        peerTypingState?.isTyping &&
            peerTypingState.userId &&
            peerTypingState.userId !== $authStore.user?.id
    );
    $: readReceiptsEnabled = $userStore.privacySettings?.readReceiptsEnabled !== false;
    $: securityChangeNotifications =
        $userStore.privacySettings?.securityChangeNotifications !== false;
    $: isPeerBlocked = Boolean(
        peerId &&
            ($userStore.blockedUsers || []).some(
                (b) => (b.user?.id || b.blockedUserId || b.id) === peerId
            )
    );

    $: if (
        conversationId &&
        e2eeStatus === "ready" &&
        readReceiptsEnabled &&
        currentMessages.length > 0
    ) {
        const myId = $authStore.user?.id;
        for (const m of currentMessages) {
            if (
                m?.id &&
                !String(m.id).startsWith("local-") &&
                !String(m.id).startsWith("queue-") &&
                m.sender_id &&
                m.sender_id !== myId &&
                m.sender_id !== "me" &&
                m.status !== "read" &&
                !markedReadIds.has(m.id)
            ) {
                markedReadIds.add(m.id);
                messagesStore.markMessageRead(conversationId, m.id);
            }
        }
    }

    const handleToggleBlockPeer = async () => {
        if (!peerId || isTogglingBlock) return;
        isTogglingBlock = true;
        try {
            if (isPeerBlocked) {
                await userStore.unblockUser(peerId);
                uiStore.notify({
                    type: "success",
                    message: `Blokir terhadap @${peerUsername} telah dibuka.`
                });
            } else {
                await userStore.blockUser(peerId);
                uiStore.notify({
                    type: "warning",
                    message: `@${peerUsername} telah diblokir.`
                });
            }
            showConfirmBlockPeer = false;
        } catch (err) {
            uiStore.notify({
                type: "error",
                message: getPageErrorMessage(err, "settings")
            });
        } finally {
            isTogglingBlock = false;
        }
    };

    // Auto-scroll when a new message arrives and user is near the bottom
    $: if (currentMessages.length > previousMessageCount) {
        const container = messagesContainer;
        const isNearBottom =
            !container ||
            container.scrollHeight - container.scrollTop - container.clientHeight < 180;
        if (isNearBottom && !isLoadingMore) {
            scrollToBottom();
        }
        previousMessageCount = currentMessages.length;
    }

    onMount(() => {
        userStore.loadPrivacySettings().catch(() => {});
        userStore.loadBlockedUsers({ limit: 50, offset: 0 }).catch(() => {});
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
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <!-- Chat Room Header -->
        <div class="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white shrink-0">
            <div class="flex items-center gap-3 min-w-0">
                <button
                    type="button"
                    class="p-2 -ml-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
                    title="Kembali ke Daftar Teman"
                    aria-label="Kembali ke Daftar Teman"
                    on:click={() => push("/friends")}
                >
                    <Icon name="arrow-left" size="md" />
                </button>

                <div class="relative shrink-0">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white font-bold flex items-center justify-center text-sm uppercase shadow-xs">
                        {(peerDisplayName || conversationId || "C").slice(0, 2)}
                    </div>
                    <span
                        class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white {$socketStore.connected && roomStatus === 'connected' ? 'bg-emerald-500' : roomStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'}"
                        title={$socketStore.connected && roomStatus === "connected"
                            ? "Terhubung ke Ruang Obrolan"
                            : roomStatus === "connecting"
                              ? "Menghubungkan ke Ruang Obrolan..."
                              : "Koneksi Ruang Obrolan Terputus"}
                    ></span>
                </div>

                <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <h2
                            class="font-bold text-slate-900 text-sm sm:text-base truncate"
                            title="ID Ruang: {conversationId}"
                        >
                            {peerDisplayName}
                        </h2>
                        {#if activeConv?.peer?.nickname && activeConv?.peer?.username}
                            <span class="text-xs text-slate-400 font-normal truncate hidden sm:inline">
                                @{activeConv.peer.username}
                            </span>
                        {/if}
                    </div>
                    <div class="flex items-center gap-2 text-xs">
                        {#if isPeerTyping}
                            <span class="text-indigo-600 font-semibold italic animate-pulse" role="status">
                                sedang mengetik...
                            </span>
                        {:else if roomStatus === "connected" && $socketStore.connected}
                            <span class="text-emerald-600 font-medium flex items-center gap-1">
                                <span>Terhubung Realtime</span>
                                {#if peerLastSeenAt}
                                    <span class="text-slate-400 font-normal">
                                        • Aktif {new Date(peerLastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                {/if}
                            </span>
                        {:else if roomStatus === "connecting"}
                            <span class="text-amber-600 font-medium">Menghubungkan...</span>
                        {:else}
                            <span class="text-rose-600 font-medium">Koneksi Terputus</span>
                            <button
                                type="button"
                                on:click={retryRoomConnection}
                                class="text-indigo-600 hover:underline font-semibold cursor-pointer"
                            >
                                Sambungkan
                            </button>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- E2EE & Safety Number Trigger Badge (Rule #17) + Block Action -->
            <div class="flex items-center gap-2 shrink-0">
                {#if peerId}
                    <button
                        type="button"
                        on:click={() => {
                            if (isPeerBlocked) {
                                handleToggleBlockPeer();
                            } else {
                                showConfirmBlockPeer = true;
                            }
                        }}
                        disabled={isTogglingBlock}
                        title={isPeerBlocked ? `Buka blokir @${peerUsername}` : `Blokir @${peerUsername}`}
                        class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer {isPeerBlocked
                            ? 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800'
                            : 'bg-slate-50 hover:bg-rose-50 border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-700'}"
                    >
                        <Icon name="ban" size="xs" />
                        <span class="hidden md:inline">{isPeerBlocked ? "Buka Blokir" : "Blokir"}</span>
                    </button>
                {/if}
                {#if e2eeStatus === "ready"}
                    <button
                        type="button"
                        on:click={openSafetyNumberModal}
                        title={peerVerified
                            ? "Identitas lawan bicara telah terverifikasi secara out-of-band. Klik untuk melihat Nomor Keamanan & Kode QR."
                            : "Klik untuk membuka Nomor Keamanan (Safety Number) & memverifikasi identitas lawan bicara."}
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full {peerVerified
                            ? 'bg-emerald-100 hover:bg-emerald-200/80 border-emerald-300 text-emerald-800'
                            : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700'} border text-xs font-medium transition-colors cursor-pointer"
                    >
                        {#if peerVerified}
                            <Icon name="shield-check" size="xs" className="text-emerald-700" />
                            <span class="hidden sm:inline font-semibold">E2EE Terverifikasi</span>
                        {:else}
                            <Icon name="lock" size="xs" className="text-emerald-600" />
                            <span class="hidden sm:inline">E2EE Terproteksi</span>
                        {/if}
                    </button>
                {:else if isE2EEError}
                    <button
                        type="button"
                        on:click={openSafetyNumberModal}
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
                        title={e2eeError || "Sesi E2EE memerlukan tindakan — Klik untuk memeriksa Nomor Keamanan"}
                    >
                        <Icon name="alert-triangle" size="xs" className="text-rose-600" />
                        <span class="hidden sm:inline">{keyChange ? "Verifikasi Kunci Baru" : "E2EE Gagal"}</span>
                    </button>
                {:else}
                    <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
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
            class="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4 bg-slate-50/60"
        >
            <!-- E2EE Security Status & Device Change Warning Banner -->
            <div class="max-w-lg mx-auto p-3.5 rounded-2xl {isE2EEError ? 'bg-rose-50/90 border-rose-200 text-rose-800' : 'bg-indigo-50/70 border-indigo-100 text-indigo-800'} border text-center text-xs leading-relaxed shadow-xs">
                <div class="flex items-center justify-center gap-1.5 font-semibold mb-1 {isE2EEError ? 'text-rose-900' : 'text-indigo-900'}">
                    <Icon
                        name={isE2EEError ? "alert-triangle" : peerVerified ? "shield-check" : "lock"}
                        size="sm"
                        className={isE2EEError ? "text-rose-600" : "text-indigo-600"}
                    />
                    <span>
                        {#if e2eeStatus === "ready"}Enkripsi End-to-End Aktif
                        {:else if isE2EEError}Sesi E2EE Memerlukan Verifikasi
                        {:else}Menyiapkan Sesi E2EE...{/if}
                    </span>
                </div>

                {#if e2eeStatus === "ready"}
                    <p>Pesan dan lampiran dienkripsi di perangkat Anda sebelum dikirim.</p>
                    <div class="mt-1.5 flex items-center justify-center gap-2">
                        <button
                            type="button"
                            on:click={openSafetyNumberModal}
                            class="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline underline-offset-2 cursor-pointer"
                        >
                            <span>{peerVerified ? "Kontak Terverifikasi — Lihat Nomor Keamanan" : "Verifikasi Nomor Keamanan / Kode QR"}</span>
                        </button>
                    </div>
                {:else if isE2EEError}
                    {#if keyChange}
                        <p>
                            Lawan bicara mengganti perangkat atau kunci identitas. Terdapat <strong>{pendingCount}</strong> pesan keluar yang sedang ditahan. Verifikasi nomor keamanan sebelum melanjutkan pengiriman.
                        </p>
                        <div class="mt-2.5 p-2.5 rounded-xl bg-white/80 border border-rose-200/80 text-left font-mono text-[10px] leading-relaxed break-all text-slate-700">
                            <div>
                                <span class="font-sans font-semibold text-slate-800">Fingerprint lama</span><br>
                                {keyChange.previousFingerprint}
                            </div>
                            <div class="mt-1.5">
                                <span class="font-sans font-semibold text-rose-800">Fingerprint baru</span><br>
                                {keyChange.fingerprint}
                            </div>
                        </div>
                        <div class="mt-2.5 flex flex-wrap items-center justify-center gap-2">
                            <button
                                type="button"
                                class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                                on:click={openSafetyNumberModal}
                            >
                                Bandingkan di Modal Safety Number
                            </button>
                            <button
                                type="button"
                                class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                                on:click={handleAcceptNewKey}
                            >
                                Verifikasi dan terima kunci baru
                            </button>
                            {#if pendingCount > 0}
                                <button
                                    type="button"
                                    class="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-rose-200 text-rose-700 text-xs font-medium transition-colors cursor-pointer"
                                    on:click={handleDiscardPendingMessages}
                                >
                                    Batalkan pesan tertahan ({pendingCount})
                                </button>
                            {/if}
                        </div>
                    {:else}
                        <p>{e2eeError || getPageErrorMessage(PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED, "e2ee")} Pengiriman pesan diblokir demi keamanan.</p>
                        <div class="mt-2">
                            <button
                                type="button"
                                on:click={retryLoadHistory}
                                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                            >
                                <Icon name="refresh" size="xs" />
                                <span>Coba Muat Ulang Kunci</span>
                            </button>
                        </div>
                    {/if}
                {:else}
                    Menghitung kunci bersama secara lokal. Pengiriman pesan akan aktif setelah sesi siap.
                {/if}
            </div>

            {#if isLoadingHistory}
                <Skeleton variant="chat-feed" count={4} label="Memuat riwayat pesan terenkripsi..." />
            {:else if historyError && currentMessages.length === 0}
                <div class="max-w-md mx-auto bg-white rounded-2xl border border-rose-200 p-6 text-center space-y-3 animate-fadeIn">
                    <div class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                        <Icon name="alert-triangle" size="lg" />
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-slate-900">Gagal Memuat Riwayat Pesan</h3>
                        <p class="text-xs text-slate-500 mt-1">{historyError}</p>
                    </div>
                    <button
                        type="button"
                        on:click={retryLoadHistory}
                        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                        <Icon name="refresh" size="xs" />
                        <span>Coba Lagi</span>
                    </button>
                </div>
            {:else if currentMessages.length === 0}
                <div class="max-w-sm mx-auto py-10 text-center space-y-2 animate-fadeIn">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100">
                        <Icon name="message-square" size="md" />
                    </div>
                    <h3 class="text-sm font-bold text-slate-800">Belum Ada Pesan</h3>
                    <p class="text-xs text-slate-500 leading-relaxed">
                        Kirim pesan pertama Anda kepada <strong>{peerUsername}</strong>. Seluruh pesan diamankan dengan enkripsi end-to-end.
                    </p>
                </div>
            {:else}
                {#if isLoadingMore}
                    <div class="py-2 text-center text-slate-500 flex items-center justify-center gap-2 text-xs" role="status">
                        <div class="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Memuat pesan sebelumnya...</span>
                    </div>
                {:else if hasMoreMessages}
                    <div class="py-1 text-center">
                        <button
                            type="button"
                            class="px-3.5 py-1.5 rounded-full bg-white border border-slate-200 hover:border-indigo-300 text-xs font-semibold text-indigo-600 hover:text-indigo-700 shadow-xs transition-colors cursor-pointer"
                            on:click={loadOlderMessages}
                        >
                            Muat pesan sebelumnya
                        </button>
                    </div>
                {/if}

                {#each currentMessages as msg (msg.id || msg.client_message_id)}
                    {@const isSelf = msg.sender_id === $authStore.user?.id || msg.sender_username === $authStore.user?.username || msg.sender_id === "me"}
                    <MessageItem
                        {msg}
                        {isSelf}
                        peerUsername={peerDisplayName}
                        {readReceiptsEnabled}
                        e2eeReady={e2eeStatus === "ready"}
                        isBusy={mutatingMessageId === msg.id}
                        on:edit={handleEditMessage}
                        on:delete={handleDeleteMessage}
                        on:download={(e) => handleDownloadAttachment(e.detail.attachment, e.detail.done)}
                    />
                {/each}
            {/if}

            {#if keyChange && securityChangeNotifications}
                <div
                    role="status"
                    class="max-w-md mx-auto px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] text-center font-medium shadow-xs"
                >
                    Kode keamanan E2EE dengan <strong>{peerDisplayName}</strong> telah berubah. Ketuk untuk memverifikasi.
                </div>
            {/if}
        </div>

        <!-- Chat Input Bar -->
        <MessageInput
            {conversationId}
            disabled={e2eeStatus !== "ready" && e2eeStatus !== "keyChange"}
            isKeyChange={e2eeStatus === "keyChange"}
            externalError={attachmentError}
            on:sent={scrollToBottom}
        />
    </div>

    <SafetyNumberModal
        open={showSafetyNumberModal}
        peerUsername={activeConv?.peer?.username || "Lawan Bicara"}
        currentUsername={$authStore.user?.username || "Anda"}
        {safetyNumber}
        loading={safetyNumberLoading}
        {peerVerified}
        {peerVerifiedAt}
        {keyChange}
        {pendingCount}
        on:close={closeSafetyNumberModal}
        on:toggleVerified={handleToggleVerified}
        on:acceptKeyChange={handleModalAcceptKeyChange}
    />

    <ConfirmDialog
        open={showConfirmAcceptKey}
        title="Setujui Kunci Perangkat Baru?"
        description="Pastikan fingerprint kunci baru cocok dengan yang diberikan oleh {peerDisplayName} melalui kanal komunikasi lain (tatap muka atau telepon). Setelah disetujui, {pendingCount} pesan yang ditahan akan dienkripsi ulang dan dikirim."
        confirmLabel="Ya, Terima Kunci Baru"
        cancelLabel="Batal"
        variant="warning"
        loading={isAcceptingKey}
        on:cancel={() => (showConfirmAcceptKey = false)}
        on:confirm={confirmAcceptNewKey}
    />

    <ConfirmDialog
        open={showConfirmBlockPeer}
        title="Blokir @{peerUsername}?"
        description="Pengguna yang diblokir tidak dapat mengirim pesan, melihat status Terakhir Dilihat & Online Anda, atau mengirim permintaan pertemanan."
        confirmLabel="Ya, Blokir Pengguna"
        cancelLabel="Batal"
        variant="danger"
        loading={isTogglingBlock}
        on:cancel={() => (showConfirmBlockPeer = false)}
        on:confirm={handleToggleBlockPeer}
    />
</ProtectedLayout>
