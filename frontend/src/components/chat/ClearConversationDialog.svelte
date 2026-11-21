<script>
    import { createEventDispatcher } from "svelte";
    import Icon from "../common/Icon.svelte";

    export let open = false;
    export let peerName = "Lawan Bicara";
    export let loading = false;
    /** @type {string | null} */
    export let error = null;
    /** @type {'me' | 'everyone'} */
    export let defaultScope = "me";

    const dispatch = createEventDispatcher();

    /** @type {'me' | 'everyone'} */
    let selectedScope = defaultScope;
    let wasOpen = false;

    $: if (open && !wasOpen) {
        selectedScope = defaultScope;
        wasOpen = true;
    } else if (!open && wasOpen) {
        wasOpen = false;
    }

    const handleCancel = () => {
        if (loading) return;
        dispatch("cancel");
    };

    const handleConfirm = () => {
        if (loading) return;
        dispatch("confirm", { scope: selectedScope });
    };

    /** @param {KeyboardEvent} event */
    const handleKeydown = (event) => {
        if (!open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            handleCancel();
        }
    };
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-conv-dialog-title"
        aria-describedby="clear-conv-dialog-desc"
    >
        <button
            type="button"
            class="fixed inset-0 w-full h-full cursor-default focus:outline-none"
            aria-label="Tutup dialog hapus percakapan"
            tabindex="-1"
            on:click={handleCancel}
        ></button>

        <div class="relative z-10 w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-4">
            <div class="flex items-start gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                    <Icon name="trash" size="md" />
                </div>
                <div class="min-w-0 flex-1">
                    <h3 id="clear-conv-dialog-title" class="text-base font-bold text-slate-900">
                        Hapus Seluruh Pesan dengan {peerName}?
                    </h3>
                    <p id="clear-conv-dialog-desc" class="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                        Percakapan ini akan dibersihkan dan dikeluarkan dari daftar sidebar. Percakapan akan muncul kembali secara otomatis jika ada pesan baru atau Anda memulai obrolan lagi dari Daftar Teman.
                    </p>
                </div>
            </div>

            <fieldset class="space-y-2.5 border-0 p-0 m-0" disabled={loading}>
                <legend class="sr-only">Pilih cakupan penghapusan pesan</legend>

                <label
                    class="flex items-start gap-3 p-3.5 rounded-xl border bg-white cursor-pointer transition-all {selectedScope === 'me'
                        ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:border-slate-300'}"
                >
                    <input
                        type="radio"
                        name="clear-conversation-scope"
                        value="me"
                        bind:group={selectedScope}
                        class="mt-0.5 accent-indigo-600 cursor-pointer shrink-0"
                    />
                    <div class="min-w-0">
                        <span class="block text-sm font-semibold text-slate-900">
                            Hapus untuk saya
                        </span>
                        <span class="block mt-0.5 text-xs text-slate-500 leading-relaxed">
                            Seluruh riwayat pesan dan item percakapan dihapus dari akun Anda saja. {peerName} tetap dapat melihat riwayat pesannya.
                        </span>
                    </div>
                </label>

                <label
                    class="flex items-start gap-3 p-3.5 rounded-xl border bg-white cursor-pointer transition-all {selectedScope === 'everyone'
                        ? 'border-rose-500 ring-2 ring-rose-500/20'
                        : 'border-slate-200 hover:border-slate-300'}"
                >
                    <input
                        type="radio"
                        name="clear-conversation-scope"
                        value="everyone"
                        bind:group={selectedScope}
                        class="mt-0.5 accent-rose-600 cursor-pointer shrink-0"
                    />
                    <div class="min-w-0">
                        <span class="block text-sm font-semibold text-slate-900">
                            Hapus untuk semua
                        </span>
                        <span class="block mt-0.5 text-xs text-slate-500 leading-relaxed">
                            Seluruh pesan dan lampiran terenkripsi dihapus untuk Anda maupun {peerName}, lalu percakapan dikeluarkan dari sidebar kedua belah pihak.
                        </span>
                    </div>
                </label>
            </fieldset>

            {#if selectedScope === "everyone"}
                <div
                    role="note"
                    class="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 leading-relaxed"
                >
                    <Icon name="alert-triangle" size="sm" className="text-rose-600 mt-0.5" />
                    <span>
                        Tindakan ini tidak dapat dibatalkan. Seluruh riwayat pesan dan lampiran akan dihapus secara realtime di kedua perangkat.
                    </span>
                </div>
            {/if}

            {#if error}
                <div
                    role="alert"
                    class="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 leading-relaxed"
                >
                    <Icon name="alert-triangle" size="sm" className="text-rose-600 mt-0.5" />
                    <span>{error}</span>
                </div>
            {/if}

            <div class="pt-1 flex items-center justify-end gap-2.5">
                <button
                    type="button"
                    disabled={loading}
                    on:click={handleCancel}
                    class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                    Batal
                </button>
                <button
                    type="button"
                    disabled={loading}
                    on:click={handleConfirm}
                    class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50 {selectedScope === 'everyone'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-indigo-600 hover:bg-indigo-700'}"
                >
                    {#if loading}
                        <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        <span>Menghapus...</span>
                    {:else}
                        <Icon name="trash" size="xs" />
                        <span>{selectedScope === "everyone" ? "Hapus untuk Semua" : "Hapus untuk Saya"}</span>
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
