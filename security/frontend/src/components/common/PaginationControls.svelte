<script lang="ts">
  import type { PaginationMeta } from '../../lib/types/telemetry.ts';

  export let pagination: PaginationMeta;
  export let onPageChange: (newOffset: number) => void;

  $: start = pagination.total === 0 ? 0 : pagination.offset + 1;
  $: end = Math.min(pagination.offset + pagination.limit, pagination.total);
  $: canPrev = pagination.offset > 0;
  $: canNext = pagination.hasMore;
</script>

<div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs text-slate-400">
  <div>
    Showing <span class="font-semibold text-slate-200">{start}</span>–<span class="font-semibold text-slate-200">{end}</span>
    of <span class="font-semibold text-slate-200">{pagination.total}</span> records
  </div>
  <div class="flex items-center gap-2">
    <button
      type="button"
      disabled={!canPrev}
      on:click={() => onPageChange(Math.max(0, pagination.offset - pagination.limit))}
      class="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
    >
      Previous
    </button>
    <button
      type="button"
      disabled={!canNext}
      on:click={() => onPageChange(pagination.offset + pagination.limit)}
      class="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
    >
      Next
    </button>
  </div>
</div>

