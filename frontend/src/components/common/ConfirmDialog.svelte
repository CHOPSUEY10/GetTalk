<script>
    import { createEventDispatcher } from "svelte";
    import Icon from "./Icon.svelte";

    export let open = false;
    export let title = "Konfirmasi Tindakan";
    export let description = "";
    export let confirmLabel = "Lanjutkan";
    export let cancelLabel = "Batal";
    /** @type {'danger' | 'primary' | 'warning'} */
    export let variant = "danger";
    export let loading = false;

    const dispatch = createEventDispatcher();

    const handleCancel = () => {
        if (loading) return;
        dispatch("cancel");
    };

    const handleConfirm = () => {
        if (loading) return;
        dispatch("confirm");
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
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
    >
        <button
            type="button"
            class="fixed inset-0 w-full h-full cursor-default focus:outline-none"
            aria-label="Tutup dialog konfirmasi"
            tabindex="-1"
            on:click={handleCancel}
        ></button>

        <div class="relative z-10 w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-4">
            <div class="flex items-start gap-3.5">
                <div
                    class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 {variant === 'danger'
                        ? 'bg-rose-100 text-rose-600'
                        : variant === 'warning'
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-indigo-100 text-indigo-600'}"
                >
                    <Icon name={variant === "primary" ? "shield-check" : "alert-triangle"} size="md" />
                </div>
                <div class="min-w-0 flex-1">
                    <h3 id="confirm-dialog-title" class="text-base font-bold text-slate-900">
                        {title}
                    </h3>
                    <p id="confirm-dialog-desc" class="mt-1 text-sm text-slate-600 leading-relaxed">
                        {description}
                    </p>
                </div>
            </div>

            <div class="pt-2 flex items-center justify-end gap-2.5">
                <button
                    type="button"
                    disabled={loading}
                    on:click={handleCancel}
                    class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    disabled={loading}
                    on:click={handleConfirm}
                    class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50 {variant === 'danger'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : variant === 'warning'
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-indigo-600 hover:bg-indigo-700'}"
                >
                    {#if loading}
                        <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    {/if}
                    <span>{confirmLabel}</span>
                </button>
            </div>
        </div>
    </div>
{/if}

