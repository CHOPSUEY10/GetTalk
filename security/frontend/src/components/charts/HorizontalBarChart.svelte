<script lang="ts">
  export let title = '';
  export let items: Array<{ label: string; value: number; badge?: string }> = [];
  export let barColor = 'bg-indigo-500';

  $: maxVal = Math.max(1, ...items.map((i) => i.value));
</script>

<div class="sec-card">
  <h3 class="text-sm font-semibold text-slate-100 mb-3">{title}</h3>
  {#if items.length === 0}
    <p class="text-xs text-slate-500 py-6 text-center">No telemetry entries recorded.</p>
  {:else}
    <div class="space-y-2.5">
      {#each items as item}
        {@const pct = Math.min(100, Math.round((item.value / maxVal) * 100))}
        <div>
          <div class="flex items-center justify-between text-xs mb-1 gap-2">
            <span class="font-mono text-slate-200 truncate">{item.label}</span>
            <div class="flex items-center gap-2 shrink-0">
              {#if item.badge}
                <span class="text-[11px] text-slate-400">{item.badge}</span>
              {/if}
              <span class="font-semibold text-slate-100">{item.value.toLocaleString()}</span>
            </div>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full rounded-full {barColor}" style="width: {pct}%"></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

