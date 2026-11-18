<script lang="ts">
  import type { TrafficBucket } from '../../lib/types/telemetry.ts';

  export let series: TrafficBucket[] = [];
  export let title = 'Infrastructure Traffic & Security Events';

  const width = 760;
  const height = 220;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 28;

  $: plotW = width - padLeft - padRight;
  $: plotH = height - padTop - padBottom;

  $: maxVal = Math.max(
    10,
    ...series.map((b) => Math.max(b.httpRequests || 0, b.firewallBlocked || 0, b.http4xx || 0, b.http5xx || 0))
  );

  function buildPolyline(getter: (b: TrafficBucket) => number): string {
    if (!series.length) return '';
    return series
      .map((b, idx) => {
        const x =
          series.length === 1
            ? padLeft + plotW / 2
            : padLeft + (idx / (series.length - 1)) * plotW;
        const val = getter(b);
        const y = padTop + plotH - (val / maxVal) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  $: httpPoints = buildPolyline((b) => b.httpRequests || 0);
  $: fwPoints = buildPolyline((b) => b.firewallBlocked || 0);
  $: errPoints = buildPolyline((b) => (b.http4xx || 0) + (b.http5xx || 0));
</script>

<div class="sec-card">
  <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
    <h3 class="text-sm font-semibold text-slate-100">{title}</h3>
    <div class="flex items-center gap-4 text-xs text-slate-400">
      <span class="inline-flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> HTTP Requests
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Firewall Blocked
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span> HTTP 4xx/5xx
      </span>
    </div>
  </div>

  {#if series.length === 0}
    <div class="h-48 flex items-center justify-center text-xs text-slate-500">
      No telemetry time-series data recorded in the selected window.
    </div>
  {:else}
    <div class="w-full overflow-x-auto">
      <svg viewBox="0 0 {width} {height}" class="w-full h-52 select-none" role="img" aria-label={title}>
        <!-- Grid lines -->
        {#each [0, 0.25, 0.5, 0.75, 1] as ratio}
          {@const y = padTop + plotH * (1 - ratio)}
          <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#1e293b" stroke-width="1" />
          <text x={padLeft - 6} y={y + 4} text-anchor="end" fill="#64748b" font-size="10">
            {Math.round(maxVal * ratio)}
          </text>
        {/each}

        <!-- Series lines -->
        {#if httpPoints}
          <polyline fill="none" stroke="#6366f1" stroke-width="2.2" points={httpPoints} />
        {/if}
        {#if fwPoints}
          <polyline fill="none" stroke="#f43f5e" stroke-width="2" points={fwPoints} />
        {/if}
        {#if errPoints}
          <polyline fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-dasharray="4 3" points={errPoints} />
        {/if}

        <!-- X-axis start and end timestamps -->
        <text x={padLeft} y={height - 6} fill="#64748b" font-size="10">
          {new Date(series[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </text>
        <text x={width - padRight} y={height - 6} text-anchor="end" fill="#64748b" font-size="10">
          {new Date(series[series.length - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </text>
      </svg>
    </div>
  {/if}
</div>

