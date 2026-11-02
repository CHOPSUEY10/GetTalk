<script>
    import { createEventDispatcher } from "svelte";
    import AttachmentPicker from "../attachments/AttachmentPicker.svelte";
    import { authStore } from "../../stores/auth.store.js";
    import { messagesStore } from "../../stores/messages.store.js";
    import { validateMessageText } from "../../lib/validators.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../../lib/errors/pageerror.js";

    export let conversationId = "";
    export let disabled = false;
    /** @type {string | null} */
    export let externalError = null;

    const dispatch = createEventDispatcher();

    let messageText = "";
    let isSending = false;
    /** @type {string | null} */
    let inputError = null;

    $: displayedError = inputError || externalError;

    const handleSendMessage = async () => {
        if (!conversationId || isSending || disabled) return;

        const validation = validateMessageText(messageText);
        if (!validation.valid) {
            if (validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG) {
                inputError = getPageErrorMessage(PAGE_ERROR_CODES.MESSAGE_TOO_LONG, "send-message");
            } else if (messageText.length > 0) {
                inputError = getPageErrorMessage(PAGE_ERROR_CODES.EMPTY_MESSAGE, "send-message");
            }
            return;
        }

        const textToSend = validation.trimmed;
        messageText = "";
        inputError = null;

        try {
            isSending = true;
            await messagesStore.sendMessage(conversationId, {
                plaintext: textToSend,
                senderId: $authStore.user?.id || "me",
                senderUsername: $authStore.user?.username || "Me",
            });
            dispatch("sent");
        } catch (err) {
            inputError = getPageErrorMessage(err, {
                context: "send-message",
                fallbackCode: PAGE_ERROR_CODES.MESSAGE_SEND_FAILED,
            });
        } finally {
            isSending = false;
        }
    };

    /** @param {CustomEvent<{ file: File, fileName: string, fileSize: number, fileType: string }>} e */
    const handleAttached = async (e) => {
        const { file } = e.detail || {};
        if (!file || !conversationId || disabled || isSending) return;

        isSending = true;
        inputError = null;
        try {
            await messagesStore.sendAttachmentMessage(conversationId, {
                file,
                senderId: $authStore.user?.id || "me",
                senderUsername: $authStore.user?.username || "Me",
            });
            dispatch("sent");
        } catch (err) {
            inputError = getPageErrorMessage(err, {
                context: "attachment",
                fallbackCode: PAGE_ERROR_CODES.FILE_ENCRYPTION_FAILED,
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

<div class="p-4 border-t border-slate-200 bg-white shrink-0">
    {#if displayedError}
        <p class="mb-2 text-xs text-rose-600" role="alert">{displayedError}</p>
    {/if}
    <form on:submit|preventDefault={handleSendMessage} class="flex items-center gap-2">
        <AttachmentPicker
            {conversationId}
            disabled={disabled || isSending}
            loading={isSending}
            on:attached={handleAttached}
        />

        <input
            type="text"
            bind:value={messageText}
            on:input={() => {
                if (inputError) inputError = null;
            }}
            on:keydown={handleKeydown}
            placeholder={!disabled ? "Ketik pesan terenkripsi..." : "Menunggu sesi E2EE siap..."}
            disabled={disabled || isSending}
            class="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all shadow-inner disabled:opacity-60"
        />

        <button
            type="submit"
            disabled={!messageText.trim() || isSending || disabled}
            class="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shadow-md shadow-indigo-200 flex items-center justify-center cursor-pointer"
            title="Kirim Pesan"
        >
            {#if isSending}
                <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            {:else}
                <svg class="w-5 h-5 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
            {/if}
        </button>
    </form>
</div>

