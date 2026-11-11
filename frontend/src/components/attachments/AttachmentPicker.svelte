<script>
    import { createEventDispatcher } from "svelte";
    import { validateAttachmentFile } from "../../lib/validators.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../../lib/errors/pageerror.js";
    import Icon from "../common/Icon.svelte";

    export let conversationId = "";
    export let disabled = false;
    export let loading = false;

    const dispatch = createEventDispatcher();

    /** @type {HTMLInputElement | null} */
    let fileInput = null;
    let errorMessage = "";

    const triggerFileInput = () => {
        if (disabled || loading) return;
        fileInput?.click();
    };

    /** @param {Event} e */
    const handleFileChange = (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const file = target.files?.[0];
        if (!file || !conversationId) return;

        // Reset input value for re-selection
        target.value = "";

        const validation = validateAttachmentFile(file);
        if (!validation.valid) {
            errorMessage = getPageErrorMessage(
                validation.code || PAGE_ERROR_CODES.FILE_TOO_LARGE,
                "attachment"
            );
            setTimeout(() => (errorMessage = ""), 4500);
            return;
        }

        errorMessage = "";
        dispatch("attached", {
            file,
            fileName: file.name,
            fileSize: file.size,
            fileType: validation.mimeType
        });
    };
</script>

<div class="relative inline-flex items-center">
    <input
        type="file"
        class="hidden"
        bind:this={fileInput}
        on:change={handleFileChange}
        disabled={disabled || loading}
        aria-label="Pilih berkas untuk dienkripsi dan dikirim"
    />

    <button
        type="button"
        class="p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title={loading ? "Mengenkripsi berkas..." : "Lampirkan berkas terenkripsi E2EE (Maks. 25 MB)"}
        aria-label={loading ? "Mengenkripsi berkas..." : "Lampirkan berkas terenkripsi E2EE"}
        on:click={triggerFileInput}
        disabled={disabled || loading}
    >
        {#if loading}
            <div class="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        {:else}
            <Icon name="paperclip" size="md" />
        {/if}
    </button>

    {#if errorMessage}
        <div
            role="alert"
            class="absolute bottom-full left-0 mb-2 px-3 py-2 bg-rose-600 text-white text-xs rounded-xl shadow-lg whitespace-nowrap z-50 flex items-center gap-1.5 animate-fade-in"
        >
            <Icon name="alert-triangle" size="xs" />
            <span>{errorMessage}</span>
        </div>
    {/if}
</div>
