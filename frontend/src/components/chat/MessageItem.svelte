<script>
    import { createEventDispatcher } from "svelte";

    /** @type {any} */
    export let msg;
    /** @type {boolean} */
    export let isSelf = false;
    /** @type {boolean} */
    export let e2eeReady = false;
    /** @type {boolean} */
    export let isBusy = false;

    const dispatch = createEventDispatcher();

    let isEditing = false;
    let editDraft = "";
    let confirmingDelete = false;
    /** @type {string | null} */
    let localError = null;

    $: canMutate =
        isSelf &&
        Boolean(msg?.id) &&
        !String(msg.id).startsWith("local-") &&
        msg.status !== "sending" &&
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
        const trimmed = editDraft.trim();
        if (!trimmed) {
            localError = "Isi pesan tidak boleh kosong.";
            return;
        }
        if (trimmed === (msg.plaintext || "").trim()) {
            cancelEdit();
            return;
        }
        localError = null;
        dispatch("edit", {
            messageId: msg.id,
            plaintext: trimmed,
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
        dispatch("download", { attachment });
    };
</script>

<div class="group flex flex-col {isSelf ? 'items-end' : 'items-start'}">
    <div
        class="max-w-md w-fit rounded-2xl px-4 py-2.5 text-sm shadow-xs transition-all {isSelf
            ? 'bg-indigo-600 text-white rounded-br-none'
            : 'bg-white text-slate-900 border border-slate-200 rounded-bl-none'}"
    >
        {#if isEditing}
            <form on:submit|preventDefault={submitEdit} class="space-y-2 min-w-[220px] sm:min-w-[280px]">
                <label class="sr-only" for="edit-msg-{msg.id}">Edit pesan</label>
                <input
                    id="edit-msg-{msg.id}"
                    type="text"
                    bind:value={editDraft}
                    on:keydown={handleEditKeydown}
                    disabled={isBusy}
                    maxlength="4000"
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
        {:else}
            <p class="leading-relaxed break-words">
                {#if msg.plaintext != null}
                    {msg.plaintext}
                {:else if msg.decryptError}
                    <span class="italic opacity-70">Tidak dapat didekripsi</span>
                {:else}
                    <span class="italic opacity-70">Mendekripsi...</span>
                {/if}
            </p>
        {/if}

        {#if msg.attachments?.length && !isEditing}
            <div class="mt-2 space-y-1">
                {#each msg.attachments as att (att.id)}
                    <button
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 cursor-pointer {isSelf
                            ? 'text-indigo-100 hover:text-white'
                            : 'text-indigo-600 hover:text-indigo-800'}"
                        on:click={() => triggerDownload(att)}
                    >
                        Download
                    </button>
                {/each}
            </div>
        {/if}

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

        <div class="flex items-center justify-end gap-1.5 mt-1 text-[10px] {isSelf ? 'text-indigo-200' : 'text-slate-400'}">
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
                    <div class="w-2.5 h-2.5 border border-indigo-200 border-t-transparent rounded-full animate-spin"></div>
                {:else if msg.status === "failed"}
                    <span class="text-rose-300 font-bold" title="Gagal terkirim">!</span>
                {:else if msg.status === "read"}
                    <span class="text-emerald-300 font-bold" title="Dibaca">✓✓</span>
                {:else}
                    <span title="Terkirim">✓</span>
                {/if}
            {/if}
        </div>
    </div>

    {#if canMutate && !isEditing && !confirmingDelete}
        <div class="flex items-center gap-2 mt-1 px-1 opacity-80 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {#if canEdit}
                <button
                    type="button"
                    on:click={startEdit}
                    disabled={isBusy}
                    aria-label="Edit pesan"
                    class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
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
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Hapus</span>
            </button>
        </div>
    {/if}
</div>

