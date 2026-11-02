<script>
    import { createEventDispatcher } from 'svelte';
    import { validateAttachmentFile } from '../../lib/validators.js';
    import { PAGE_ERROR_CODES, getPageErrorMessage } from '../../lib/errors/pageerror.js';

    export let conversationId = '';
    export let disabled = false;
    export let loading = false;

    const dispatch = createEventDispatcher();

    /** @type {HTMLInputElement | null} */
    let fileInput = null;
    let errorMessage = '';

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
        target.value = '';

        const validation = validateAttachmentFile(file);
        if (!validation.valid) {
            errorMessage = getPageErrorMessage(
                validation.code || PAGE_ERROR_CODES.FILE_TOO_LARGE,
                'attachment'
            );
            setTimeout(() => (errorMessage = ''), 4000);
            return;
        }

        errorMessage = '';
        dispatch('attached', {
            file,
            fileName: file.name,
            fileSize: file.size,
            fileType: validation.mimeType,
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
    />

    <button
        type="button"
        class="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
        title={loading ? 'Mengenkripsi file...' : 'Lampirkan file (Terenkripsi E2EE)'}
        on:click={triggerFileInput}
        disabled={disabled || loading}
    >
        {#if loading}
            <div class="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        {:else}
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
        {/if}
    </button>

    {#if errorMessage}
        <div class="absolute bottom-full left-0 mb-2 px-3 py-1.5 bg-rose-600 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-fade-in">
            {errorMessage}
        </div>
    {/if}
</div>
