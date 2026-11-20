<script lang="ts">
  import {
    buildPlottedSeries,
    type MetricChartGroup,
    type PlottedPoint,
  } from '../../lib/metrics-chart.ts';
  import SeverityBadge from '../common/SeverityBadge.svelte';

  export let group: MetricChartGroup;

  const width = 760;
  const height = 225;
  const padLeft = 64;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 30;

  $: plotW = width - padLeft - padRight;
  $: plotH = height - padTop - padBottom;

  $: plotted = buildPlottedSeries(group, {
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
  });

  $: axisMax = plotted.axisMax;
  $: plottedSeries = plotted.plottedSeries;

  let hoveredPoint: {
    processName: string;
    color: string;
    coord: PlottedPoint;
  } | null = null;

  function formatTimestampLabel(iso: string | null): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const earliestMs = group.earliestTimestamp ? Date.parse(group.earliestTimestamp) : 0;
    const latestMs = group.latestTimestamp ? Date.parse(group.latestTimestamp) : 0;
    const spanMs = latestMs - earliestMs;

    if (spanMs > 24 * 3600 * 1000) {
      return d.toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  $: midTimestamp = (() => {
    const primary = group.series[0];
    if (!primary || primary.points.length < 3) return null;
    const midIdx = Math.floor(primary.points.length / 2);
    return primary.points[midIdx]?.timestamp || null;
  })();
</script>

<div class="sec-card flex flex-col justify-between space-y-3.5" data-metric-chart={group.metricName}>
  <!-- Metric Chart Header & Summary Statistics -->
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex items-center gap-2">
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0"
          style="background-color: {group.strokeColor}"
        ></span>
        <h3 class="text-sm font-semibold text-white">{group.title}</h3>
        <span
          class="px-1.5 py-0.5 rounded bg-slate-800/90 border border-slate-700/70 font-mono text-[10px] text-slate-300"
        >
          {group.metricName}
        </span>
      </div>
      <p class="text-[11px] text-slate-400 mt-0.5">{group.description}</p>
    </div>

    {#if group.totalPoints > 0 && group.latestValue !== null}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <div class="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800">
          <span class="text-[10px] uppercase tracking-wider text-slate-400 block">Latest</span>
          <span class="font-mono font-bold text-white">
            {group.formatValue(group.latestValue)}
          </span>
        </div>
        <div class="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800">
          <span class="text-[10px] uppercase tracking-wider text-slate-400 block">Avg</span>
          <span class="font-mono font-semibold text-slate-200">
            {group.formatValue(group.avgValue ?? 0)}
          </span>
        </div>
        <div class="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800">
          <span class="text-[10px] uppercase tracking-wider text-slate-400 block">Min / Max</span>
          <span class="font-mono text-slate-300">
            {group.formatValue(group.minValue ?? 0)} / {group.formatValue(group.maxValue ?? 0)}
          </span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Process Series Legend & Hover Inspector -->
  {#if group.series.length > 0}
    <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-xs">
      <div class="flex flex-wrap items-center gap-3">
        {#each group.series as s (s.processKey)}
          <div class="inline-flex items-center gap-1.5 text-slate-300">
            <span class="w-2 h-2 rounded-full" style="background-color: {s.color}"></span>
            <span class="font-mono text-[11px] text-white font-medium">{s.processName}</span>
            <span class="font-mono text-[10px] text-slate-400">(PM2 #{s.pmId})</span>
            <span class="font-mono text-[11px] font-semibold text-slate-200">
              {group.formatValue(s.latestValue)}
            </span>
            <SeverityBadge level={s.status} />
          </div>
        {/each}
      </div>

      {#if hoveredPoint}
        <div class="inline-flex items-center gap-2 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono">
          <span class="w-2 h-2 rounded-full" style="background-color: {hoveredPoint.color}"></span>
          <span class="text-slate-200">{hoveredPoint.processName}</span>
          <span class="text-white font-bold">{group.formatValue(hoveredPoint.coord.point.value)}</span>
          <span class="text-slate-400">
            {new Date(hoveredPoint.coord.point.timestamp).toLocaleTimeString()}
          </span>
        </div>
      {:else}
        <span class="text-[11px] text-slate-500 font-mono">
          {group.totalPoints} {group.totalPoints === 1 ? 'sample' : 'samples'}
        </span>
      {/if}
    </div>
  {/if}

  <!-- SVG Time-Series Plot -->
  {#if group.totalPoints === 0}
    <div class="h-48 flex flex-col items-center justify-center rounded-lg bg-slate-950/40 border border-slate-800/60 text-xs text-slate-500">
      <span>No historical time-series samples recorded for {group.title}.</span>
    </div>
  {:else}
    <div class="w-full overflow-x-auto">
      <svg
        viewBox="0 0 {width} {height}"
        class="w-full h-52 select-none"
        role="img"
        aria-label="{group.title} time series chart"
      >
        <defs>
          {#each plottedSeries as s, idx (s.processKey)}
            <linearGradient id="{group.gradientId}-{idx}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={s.color} stop-opacity="0.28" />
              <stop offset="100%" stop-color={s.color} stop-opacity="0.0" />
            </linearGradient>
          {/each}
        </defs>

        <!-- Horizontal Y-Axis Grid Lines & Tick Labels -->
        {#each [0, 0.25, 0.5, 0.75, 1] as ratio}
          {@const y = padTop + plotH * (1 - ratio)}
          <line
            x1={padLeft}
            y1={y}
            x2={width - padRight}
            y2={y}
            stroke="#1e293b"
            stroke-width="1"
            stroke-dasharray={ratio === 0 ? undefined : '3 3'}
          />
          <text
            x={padLeft - 8}
            y={y + 3.5}
            text-anchor="end"
            fill="#64748b"
            font-size="10"
            font-family="monospace"
          >
            {group.formatAxisValue(axisMax * ratio)}
          </text>
        {/each}

        <!-- Area Fill & Series Polylines -->
        {#each plottedSeries as s, idx (s.processKey)}
          {#if s.areaPoints}
            <polygon fill="url(#{group.gradientId}-{idx})" points={s.areaPoints} />
          {/if}

          {#if s.coordinates.length === 1}
            <line
              x1={padLeft}
              y1={s.coordinates[0].y}
              x2={width - padRight}
              y2={s.coordinates[0].y}
              stroke={s.color}
              stroke-width="1.5"
              stroke-dasharray="4 4"
              opacity="0.7"
            />
          {:else if s.polylinePoints}
            <polyline
              fill="none"
              stroke={s.color}
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              points={s.polylinePoints}
            />
          {/if}

          <!-- Interactive Data Points -->
          {#each s.coordinates as coord (coord.point.id + '-' + coord.x)}
            {@const isHovered = hoveredPoint?.coord.point.id === coord.point.id}
            <circle
              cx={coord.x}
              cy={coord.y}
              r={isHovered ? 5 : s.coordinates.length <= 35 ? 3 : 2.2}
              fill={isHovered ? '#ffffff' : s.color}
              stroke="#0f172a"
              stroke-width="1.5"
              class="cursor-pointer transition-transform"
              role="presentation"
              on:mouseenter={() => {
                hoveredPoint = {
                  processName: s.processName,
                  color: s.color,
                  coord,
                };
              }}
              on:mouseleave={() => {
                if (hoveredPoint?.coord.point.id === coord.point.id) {
                  hoveredPoint = null;
                }
              }}
            >
              <title>
                {s.processName} (PM2 #{coord.point.pmId}) — {group.title}: {group.formatValue(
                  coord.point.value
                )} at {new Date(coord.point.timestamp).toLocaleString()}
              </title>
            </circle>
          {/each}
        {/each}

        <!-- Hover Vertical Guide Line -->
        {#if hoveredPoint}
          <line
            x1={hoveredPoint.coord.x}
            y1={padTop}
            x2={hoveredPoint.coord.x}
            y2={padTop + plotH}
            stroke={hoveredPoint.color}
            stroke-width="1"
            stroke-dasharray="2 2"
            opacity="0.6"
          />
        {/if}

        <!-- X-Axis Timestamps -->
        <text x={padLeft} y={height - 7} fill="#64748b" font-size="10" font-family="monospace">
          {formatTimestampLabel(group.earliestTimestamp)}
        </text>
        {#if midTimestamp}
          <text
            x={padLeft + plotW / 2}
            y={height - 7}
            text-anchor="middle"
            fill="#64748b"
            font-size="10"
            font-family="monospace"
          >
            {formatTimestampLabel(midTimestamp)}
          </text>
        {/if}
        <text
          x={width - padRight}
          y={height - 7}
          text-anchor="end"
          fill="#64748b"
          font-size="10"
          font-family="monospace"
        >
          {formatTimestampLabel(group.latestTimestamp)}
        </text>
      </svg>
    </div>
  {/if}
</div>
