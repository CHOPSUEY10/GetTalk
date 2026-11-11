<script>
    /**
     * Reusable Skeleton loader component for asynchronous data states (Section 2.3).
     * @type {'chat-feed' | 'card-grid' | 'list-rows' | 'security-card'}
     */
    export let variant = "list-rows";
    export let count = 3;
    export let label = "Memuat data...";

    $: items = Array.from({ length: count }, (_, i) => i);
</script>

<div role="status" aria-label={label} class="w-full animate-fadeIn">
    {#if variant === "chat-feed"}
        <div class="space-y-4 py-2">
            {#each items as idx (idx)}
                <div class="flex flex-col {idx % 2 === 0 ? 'items-start' : 'items-end'}">
                    <div
                        class="rounded-2xl p-3.5 border border-slate-200/70 bg-white space-y-2 {idx % 2 === 0
                            ? 'w-64 sm:w-80 rounded-bl-xs'
                            : 'w-56 sm:w-72 rounded-br-xs'}"
                    >
                        <div class="h-3.5 w-3/4 gt-skeleton"></div>
                        <div class="h-3 w-1/2 gt-skeleton"></div>
                        <div class="flex justify-end pt-1">
                            <div class="h-2.5 w-12 gt-skeleton"></div>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {:else if variant === "card-grid"}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#each items as idx (idx)}
                <div class="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-11 h-11 rounded-xl gt-skeleton shrink-0"></div>
                        <div class="space-y-2 flex-1">
                            <div class="h-3.5 w-28 gt-skeleton"></div>
                            <div class="h-3 w-40 gt-skeleton"></div>
                        </div>
                    </div>
                    <div class="h-8 w-16 rounded-lg gt-skeleton shrink-0"></div>
                </div>
            {/each}
        </div>
    {:else if variant === "security-card"}
        <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl gt-skeleton shrink-0"></div>
                <div class="space-y-2 flex-1">
                    <div class="h-4 w-44 gt-skeleton"></div>
                    <div class="h-3 w-64 gt-skeleton"></div>
                </div>
            </div>
            <div class="h-10 w-full rounded-xl gt-skeleton"></div>
            <div class="h-10 w-36 rounded-xl gt-skeleton"></div>
        </div>
    {:else}
        <div class="space-y-3">
            {#each items as idx (idx)}
                <div class="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-10 h-10 rounded-xl gt-skeleton shrink-0"></div>
                        <div class="space-y-2 flex-1">
                            <div class="h-3.5 w-32 gt-skeleton"></div>
                            <div class="h-3 w-48 gt-skeleton"></div>
                        </div>
                    </div>
                    <div class="h-7 w-20 rounded-lg gt-skeleton shrink-0"></div>
                </div>
            {/each}
        </div>
    {/if}
    <span class="sr-only">{label}</span>
</div>

