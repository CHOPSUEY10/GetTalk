<script>
    import { createEventDispatcher } from "svelte";
    import { validateMessageText } from "../../lib/validators.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../../lib/errors/pageerror.js";
    import Icon from "../common/Icon.svelte";

    /** @type {any} */
    export let msg;
    /** @type {boolean} */
    export let isSelf = false;
    /** @type {boolean} */
    export let e2eeReady = false;
    /** @type {boolean} */
    export let isBusy = false;
    /** @type {string} */
    export let peerUsername = "Lawan Bicara";
    /** @type {boolean} */
    export let readReceiptsEnabled = true;

    const dispatch = createEventDispatcher();

    let isEditing = false;
    let editDraft = "";
    let confirmingDelete = false;
    /** @type {string | null} */
    let localError = null;
    /** @type {string | null} */
    let downloadingAttachmentId = null;

    $: canMutate =
        isSelf &&
        Boolean(msg?.id) &&
        !String(msg.id).startsWith("local-") &&
        !String(msg.id).startsWith("queue-") &&
        msg.status !== "sending" &&
        msg.status !== "queued" &&
        msg.status !== "failed";

    $: canEdit =
        canMutate &&
        e2eeReady &&
        msg?.plaintext != null &&
        !msg?.decryptError;

    $: isEdited = Boolean(msg?.edited_at || msg?.updated_at);

    const startEdit = () => {
        if (!canEdit || isBusy) return;
        localError = null;
        confirmingDelete = false;
        editDraft = msg.plaintext || "";
        isEditing = true;
    };

    const cancelEdit = () => {
        isEditing = false;
        editDraft = "";
        localError = null;
    };

    const submitEdit = () => {
        const validation = validateMessageText(editDraft);
        if (!validation.valid) {
            localError = getPageErrorMessage(
                validation.code || PAGE_ERROR_CODES.EMPTY_MESSAGE,
                "edit-message"
            );
            return;
        }
        if (validation.trimmed === (msg.plaintext || "").trim()) {
            cancelEdit();
            return;
        }
        localError = null;
        dispatch("edit", {
            messageId: msg.id,
            plaintext: validation.trimmed,
            done: (/** @type {string | null} */ errMessage) => {
                if (errMessage) {
                    localError = errMessage;
                } else {
                    isEditing = false;
                    editDraft = "";
                }
            }
        });
    };

    /** @param {KeyboardEvent} event */
    const handleEditKeydown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitEdit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit();
        }
    };

    const requestDelete = () => {
        if (!canMutate || isBusy) return;
        localError = null;
        isEditing = false;
        confirmingDelete = true;
    };

    const cancelDelete = () => {
        confirmingDelete = false;
        localError = null;
    };

    const confirmDelete = () => {
        if (!canMutate || isBusy) return;
        localError = null;
        dispatch("delete", {
            messageId: msg.id,
            done: (/** @type {string | null} */ errMessage) => {
                if (errMessage) {
                    localError = errMessage;
                } else {
                    confirmingDelete = false;
                }
            }
        });
    };

    /** @param {any} attachment */
    const triggerDownload = (attachment) => {
        if (!attachment?.id || downloadingAttachmentId === attachment.id) return;
        downloadingAttachmentId = attachment.id;
        dispatch("download", {
            attachment,
            done: () => {
                downloadingAttachmentId = null;
            }
        });
        setTimeout(() => {
            if (downloadingAttachmentId === attachment.id) {
                downloadingAttachmentId = null;
            }
        }, 4000);
    };
</script>

<div class="group flex flex-col {isSelf ? 'items-end' : 'items-start'}">
    <div class="flex items-end gap-2 max-w-[88%] sm:max-w-lg {isSelf ? 'flex-row-reverse' : 'flex-row'}">
        {#if !isSelf}
            <div
                class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px] uppercase shrink-0 mb-0.5 select-none"
                title={msg.sender_username || peerUsername}
            >
                {(msg.sender_username || peerUsername || "U").slice(0, 2)}
            </div>
        {/if}

        <div
            class="w-fit rounded-2xl px-4 py-2.5 shadow-xs transition-all {isSelf
                ? 'bg-indigo-600 text-white rounded-br-xs'
                : 'bg-white text-slate-900 border border-slate-200 rounded-bl-xs'}"
        >
            {#if isEditing}
                <form on:submit|preventDefault={submitEdit} class="space-y-2 min-w-[230px] sm:min-w-[300px]">
                    <label class="sr-only" for="edit-msg-{msg.id}">Edit pesan</label>
                    <input
                        id="edit-msg-{msg.id}"
                        type="text"
                        bind:value={editDraft}
                        on:keydown={handleEditKeydown}
                        disabled={isBusy}
                        class="w-full px-3 py-1.5 rounded-lg bg-white text-slate-900 text-sm border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                        placeholder="Tulis perubahan pesan..."
                    />
                    {#if localError}
                        <p class="text-[11px] text-rose-200" role="alert">{localError}</p>
                    {/if}
                    <div class="flex items-center justify-end gap-1.5">
                        <button
                            type="button"
                            on:click={cancelEdit}
                            disabled={isBusy}
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-700/70 hover:bg-indigo-700 text-indigo-100 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            disabled={isBusy || !editDraft.trim()}
                            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-indigo-700 hover:bg-indigo-50 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {#if isBusy}
                                <span class="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                            {/if}
                            <span>Simpan</span>
                        </button>
                    </div>
                </form>
            {:else if msg.plaintext != null}
                <p class="gt-chat-text whitespace-pre-wrap">{msg.plaintext}</p>
            {:else if msg.decryptError}
                <div
                    class="flex items-center gap-2 py-0.5 text-xs italic {isSelf
                        ? 'text-indigo-100'
                        : 'text-rose-700'}"
                    title={getPageErrorMessage(msg.errorCode || PAGE_ERROR_CODES.DECRYPTION_FAILED, "chat")}
                >
                    <Icon name="alert-triangle" size="xs" />
                    <span>
                        {getPageErrorMessage(msg.errorCode || PAGE_ERROR_CODES.DECRYPTION_FAILED, "chat")}
                    </span>
                </div>
            {:else}
                <div class="flex items-center gap-2 py-0.5 text-xs italic opacity-75">
                    <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                    <span>Mendekripsi pesan...</span>
                </div>
            {/if}

            <!-- Encrypted Attachment Card -->
            {#if msg.attachments?.length && !isEditing}
                <div class="mt-2.5 space-y-1.5">
                    {#each msg.attachments as att (att.id)}
                        {@const isDownloading = downloadingAttachmentId === att.id}
                        <div
                            class="p-2.5 rounded-xl flex items-center justify-between gap-3 border {isSelf
                                ? 'bg-indigo-700/60 border-indigo-500/60 text-white'
                                : 'bg-slate-50 border-slate-200 text-slate-800'}"
                        >
                            <div class="flex items-center gap-2 min-w-0">
                                <div
                                    class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 {isSelf
                                        ? 'bg-indigo-500/50 text-white'
                                        : 'bg-indigo-100 text-indigo-600'}"
                                >
                                    <Icon name="file-text" size="sm" />
                                </div>
                                <div class="min-w-0">
                                    <span class="text-xs font-semibold block truncate">
                                        Lampiran Terenkripsi
                                    </span>
                                    <span class="text-[10px] opacity-80 flex items-center gap-1">
                                        <Icon name="lock" size="xs" />
                                        <span>AES-256-GCM</span>
                                    </span>
                                </div>
                            </div>

                            <button
                                type="button"
                                disabled={isDownloading}
                                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 disabled:opacity-60 {isSelf
                                    ? 'bg-white text-indigo-700 hover:bg-indigo-50'
                                    : 'bg-indigo-600 text-white hover:bg-indigo-700'}"
                                on:click={() => triggerDownload(att)}
                                title="Unduh dan dekripsi berkas di perangkat ini"
                            >
                                {#if isDownloading}
                                    <span class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                                    <span>Membuka...</span>
                                {:else}
                                    <Icon name="download" size="xs" />
                                    <span>Unduh</span>
                                {/if}
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}

            <!-- Inline Delete Confirmation -->
            {#if confirmingDelete && !isEditing}
                <div class="mt-2 pt-2 border-t border-indigo-500/60 flex items-center justify-between gap-2 text-xs">
                    <span class="text-indigo-100">Hapus pesan ini?</span>
                    <div class="flex items-center gap-1.5">
                        <button
                            type="button"
                            on:click={cancelDelete}
                            disabled={isBusy}
                            class="px-2 py-0.5 rounded bg-indigo-700/70 hover:bg-indigo-700 text-indigo-100 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Batal
                        </button>
                        <button
                            type="button"
                            on:click={confirmDelete}
                            disabled={isBusy}
                            class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {#if isBusy}
                                <span class="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            {/if}
                            <span>Hapus</span>
                        </button>
                    </div>
                </div>
            {/if}

            {#if localError && !isEditing}
                <p class="mt-1.5 text-[11px] {isSelf ? 'text-rose-200' : 'text-rose-600'}" role="alert">
                    {localError}
                </p>
            {/if}

            <!-- Timestamp & Delivery/Read/Queue Receipt Footer -->
            <div class="flex items-center justify-end gap-1.5 mt-1.5 text-[10px] {isSelf ? 'text-indigo-200' : 'text-slate-400'}">
                {#if isEdited}
                    <span class="italic" title="Pesan telah diedit">(diedit)</span>
                {/if}
                <span>
                    {new Date(msg.created_at || Date.now()).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                    })}
                </span>
                {#if isSelf}
                    {#if msg.status === "sending"}
                        <span class="inline-flex items-center gap-1" title="Mengirim pesan terenkripsi...">
                            <span class="w-2.5 h-2.5 border border-indigo-200 border-t-transparent rounded-full animate-spin"></span>
                        </span>
                    {:else if msg.status === "queued"}
                        <span
                            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/25 text-amber-100 font-semibold"
                            title="Pesan ditahan sampai Anda memverifikasi kunci perangkat baru lawan bicara"
                            role="status"
                        >
                            <Icon name="clock" size="xs" />
                            <span>Ditahan (verifikasi kunci)</span>
                        </span>
                    {:else if msg.status === "failed"}
                        <span
                            class="inline-flex items-center gap-0.5 text-rose-200 font-bold"
                            title="Gagal terkirim"
                        >
                            <Icon name="alert-triangle" size="xs" />
                            <span>Gagal</span>
                        </span>
                    {:else if msg.status === "read" && readReceiptsEnabled}
                        <span class="text-emerald-300 font-bold tracking-tighter" title="Dibaca oleh penerima">
                            ✓✓
                        </span>
                    {:else if msg.status === "delivered" || (msg.status === "read" && !readReceiptsEnabled)}
                        <span class="text-indigo-100 font-semibold tracking-tighter" title="Tersampaikan ke perangkat penerima">
                            ✓✓
                        </span>
                    {:else}
                        <span title="Terkirim ke server">✓</span>
                    {/if}
                {/if}
            </div>
        </div>
    </div>

    {#if canMutate && !isEditing && !confirmingDelete}
        <div class="flex items-center gap-2.5 mt-1 px-1 opacity-75 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {#if canEdit}
                <button
                    type="button"
                    on:click={startEdit}
                    disabled={isBusy}
                    aria-label="Edit pesan"
                    class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                    <Icon name="edit" size="xs" />
                    <span>Edit</span>
                </button>
            {/if}
            <button
                type="button"
                on:click={requestDelete}
                disabled={isBusy}
                aria-label="Hapus pesan"
                class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-600 font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
                <Icon name="trash" size="xs" />
                <span>Hapus</span>
            </button>
        </div>
    {/if}
</div>
