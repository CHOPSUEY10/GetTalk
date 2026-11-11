<script>
    import { createEventDispatcher, tick } from "svelte";
    import AttachmentPicker from "../attachments/AttachmentPicker.svelte";
    import { authStore } from "../../stores/auth.store.js";
    import { messagesStore } from "../../stores/messages.store.js";
    import {
        validateMessageText,
        getUtf8ByteLength,
        MAX_MESSAGE_TEXT_BYTES
    } from "../../lib/validators.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../../lib/errors/pageerror.js";
    import Icon from "../common/Icon.svelte";

    export let conversationId = "";
    export let disabled = false;
    export let isKeyChange = false;
    /** @type {string | null} */
    export let externalError = null;

    const dispatch = createEventDispatcher();

    let messageText = "";
    let isSending = false;
    /** @type {string | null} */
    let inputError = null;
    /** @type {HTMLTextAreaElement | null} */
    let textareaEl = null;

    /**
     * Staged attachment waiting for user confirmation before client-side encryption & upload (Chat UX #8).
     * @type {{ file: File, fileName: string, fileSize: number, fileType: string } | null}
     */
    let stagedAttachment = null;

    $: displayedError = inputError || externalError;
    $: currentByteLength = messageText ? getUtf8ByteLength(messageText.trim()) : 0;
    $: isOverByteLimit = currentByteLength > MAX_MESSAGE_TEXT_BYTES;
    $: showByteCounter = currentByteLength >= 1024;
    $: canSubmit =
        !disabled &&
        !isSending &&
        !isOverByteLimit &&
        Boolean(messageText.trim() || (stagedAttachment && !isKeyChange));

    /** @param {number} bytes */
    const formatFileSize = (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const adjustTextareaHeight = () => {
        if (!textareaEl) return;
        textareaEl.style.height = "auto";
        const nextHeight = Math.min(textareaEl.scrollHeight, 128);
        textareaEl.style.height = `${Math.max(42, nextHeight)}px`;
    };

    const resetComposerHeight = async () => {
        await tick();
        if (textareaEl) {
            textareaEl.style.height = "42px";
        }
    };

    const clearStagedAttachment = () => {
        if (isSending) return;
        stagedAttachment = null;
    };

    /** @param {CustomEvent<{ file: File, fileName: string, fileSize: number, fileType: string }>} e */
    const handleAttached = (e) => {
        const detail = e.detail;
        if (!detail?.file || !conversationId || disabled || isSending) return;
        inputError = null;
        stagedAttachment = {
            file: detail.file,
            fileName: detail.fileName || detail.file.name,
            fileSize: detail.fileSize ?? detail.file.size,
            fileType: detail.fileType || detail.file.type || "application/octet-stream"
        };
        textareaEl?.focus();
    };

    const handleSendMessage = async () => {
        if (!conversationId || isSending || disabled) return;

        // If neither staged attachment nor text is present, validate text to surface empty error only if user typed whitespace
        if (!stagedAttachment && !messageText.trim()) {
            if (messageText.length > 0) {
                inputError = getPageErrorMessage(PAGE_ERROR_CODES.EMPTY_MESSAGE, "send-message");
            }
            return;
        }

        // Validate text if provided
        let textToSend = "";
        if (messageText.trim()) {
            const validation = validateMessageText(messageText);
            if (!validation.valid) {
                if (validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG) {
                    inputError = getPageErrorMessage(PAGE_ERROR_CODES.MESSAGE_TOO_LONG, "send-message");
                } else {
                    inputError = getPageErrorMessage(PAGE_ERROR_CODES.EMPTY_MESSAGE, "send-message");
                }
                return;
            }
            textToSend = validation.trimmed;
        }

        const attachmentToSend = stagedAttachment;
        messageText = "";
        stagedAttachment = null;
        inputError = null;
        resetComposerHeight();

        isSending = true;
        try {
            if (attachmentToSend && !isKeyChange) {
                await messagesStore.sendAttachmentMessage(conversationId, {
                    file: attachmentToSend.file,
                    senderId: $authStore.user?.id || "me",
                    senderUsername: $authStore.user?.username || "Me"
                });
            }

            if (textToSend) {
                await messagesStore.sendMessage(conversationId, {
                    plaintext: textToSend,
                    senderId: $authStore.user?.id || "me",
                    senderUsername: $authStore.user?.username || "Me"
                });
            }

            dispatch("sent");
        } catch (err) {
            inputError = getPageErrorMessage(err, {
                context: attachmentToSend ? "attachment" : "send-message",
                fallbackCode: attachmentToSend
                    ? PAGE_ERROR_CODES.FILE_ENCRYPTION_FAILED
                    : PAGE_ERROR_CODES.MESSAGE_SEND_FAILED
            });
        } finally {
            isSending = false;
        }
    };

    /** @param {KeyboardEvent} event */
    const handleKeydown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
        }
    };
</script>

<div class="px-3 sm:px-5 py-3 border-t border-slate-200 bg-white shrink-0 space-y-2.5">
    <!-- Error Banner -->
    {#if displayedError}
        <div
            role="alert"
            class="px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2 animate-fadeIn"
        >
            <div class="flex items-center gap-2 min-w-0">
                <Icon name="alert-triangle" size="xs" className="text-rose-600" />
                <span>{displayedError}</span>
            </div>
            {#if inputError}
                <button
                    type="button"
                    class="p-0.5 rounded hover:bg-rose-100 text-rose-700 cursor-pointer"
                    aria-label="Tutup pesan kesalahan"
                    on:click={() => (inputError = null)}
                >
                    <Icon name="x" size="xs" />
                </button>
            {/if}
        </div>
    {/if}

    <!-- Staged Attachment Preview Bar (Chat UX Requirement #8) -->
    {#if stagedAttachment}
        <div class="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200/80 flex items-center justify-between gap-3 animate-fadeIn">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Icon name="file-text" size="md" />
                </div>
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-slate-900 truncate">
                            {stagedAttachment.fileName}
                        </span>
                        <span class="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-mono font-semibold shrink-0">
                            {formatFileSize(stagedAttachment.fileSize)}
                        </span>
                    </div>
                    <p class="text-[11px] text-indigo-700 flex items-center gap-1 mt-0.5">
                        <Icon name="lock" size="xs" />
                        <span>Siap dienkripsi AES-256-GCM sebelum diunggah</span>
                    </p>
                </div>
            </div>
            <button
                type="button"
                disabled={isSending}
                on:click={clearStagedAttachment}
                class="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                title="Batalkan lampiran berkas"
                aria-label="Batalkan lampiran berkas"
            >
                <Icon name="x" size="sm" />
            </button>
        </div>
    {/if}

    <form on:submit|preventDefault={handleSendMessage} class="flex items-end gap-2">
        <AttachmentPicker
            {conversationId}
            disabled={disabled || isSending || isKeyChange}
            loading={isSending && Boolean(stagedAttachment)}
            on:attached={handleAttached}
        />

        <div class="flex-1 min-w-0 relative">
            <label for="chat-message-composer" class="sr-only">Tulis pesan terenkripsi</label>
            <textarea
                id="chat-message-composer"
                rows="1"
                bind:this={textareaEl}
                bind:value={messageText}
                on:input={() => {
                    if (inputError) inputError = null;
                    adjustTextareaHeight();
                }}
                on:keydown={handleKeydown}
                placeholder={isKeyChange
                    ? "Ketik pesan (akan ditahan hingga kunci baru diverifikasi)..."
                    : stagedAttachment
                      ? "Tambahkan pesan opsional atau tekan Enter untuk mengirim berkas..."
                      : !disabled
                        ? "Ketik pesan terenkripsi... (Enter kirim, Shift+Enter baris baru)"
                        : "Menunggu sesi E2EE siap..."}
                disabled={disabled || isSending}
                class="w-full px-4 py-2.5 bg-slate-50 border {isOverByteLimit
                    ? 'border-rose-400 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-indigo-500'} rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent focus:bg-white transition-all resize-none overflow-y-auto leading-relaxed disabled:opacity-60"
                style="min-height: 42px; max-height: 128px;"
            ></textarea>

            {#if showByteCounter}
                <div
                    class="mt-1 flex items-center justify-end text-[10px] font-mono {isOverByteLimit
                        ? 'text-rose-600 font-bold'
                        : 'text-slate-400'}"
                >
                    <span>{(currentByteLength / 1024).toFixed(1)} / 10.0 KB</span>
                </div>
            {/if}
        </div>

        <button
            type="submit"
            disabled={!canSubmit}
            class="h-[42px] px-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-sm shadow-indigo-500/20 flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            title="Kirim Pesan (Enter)"
            aria-label="Kirim Pesan"
        >
            {#if isSending}
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            {:else}
                <Icon name="send" size="sm" />
                <span class="hidden sm:inline text-xs font-semibold">Kirim</span>
            {/if}
        </button>
    </form>
</div>
