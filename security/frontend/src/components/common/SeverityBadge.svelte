<script lang="ts">
  export let level: string = 'info';

  $: normalized = (level || 'info').toLowerCase();

  $: badgeClass =
    normalized === 'critical'
      ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      : normalized === 'high' || normalized === 'unavailable' || normalized === 'errored'
        ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
        : normalized === 'medium' || normalized === 'warning' || normalized === 'degraded' || normalized === 'acknowledged'
          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          : normalized === 'healthy' || normalized === 'online' || normalized === 'resolved'
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : normalized === 'low' || normalized === 'open'
              ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
              : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
</script>

<span
  class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider border {badgeClass}"
>
  {normalized}
</span>

