import type { PM2ProcessSummary, SystemMetric } from './types/telemetry.ts';

export type ApplicationMetricName =
  | 'cpu_percent'
  | 'memory_bytes'
  | 'memory_percent'
  | 'restart_count'
  | 'uptime_seconds';

export interface MetricDefinition {
  metricName: string;
  title: string;
  description: string;
  unit: string;
  strokeColor: string;
  gradientId: string;
  minAxisCeiling: number;
  integerAxis?: boolean;
  formatValue: (val: number) => string;
  formatAxisValue: (val: number) => string;
}

export interface MetricDataPoint {
  id: string;
  timestamp: string;
  timeMs: number;
  value: number;
  processName: string;
  pmId: number;
  status: string;
}

export interface MetricProcessSeries {
  processKey: string;
  processName: string;
  pmId: number;
  status: string;
  color: string;
  points: MetricDataPoint[];
  latestValue: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
}

export interface MetricChartGroup {
  metricName: string;
  title: string;
  description: string;
  unit: string;
  strokeColor: string;
  gradientId: string;
  minAxisCeiling: number;
  integerAxis: boolean;
  formatValue: (val: number) => string;
  formatAxisValue: (val: number) => string;
  totalPoints: number;
  latestValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  series: MetricProcessSeries[];
}

export interface PlottedPoint {
  x: number;
  y: number;
  point: MetricDataPoint;
}

export interface PlottedSeries {
  processKey: string;
  processName: string;
  color: string;
  status: string;
  latestValue: number;
  polylinePoints: string;
  areaPoints: string;
  coordinates: PlottedPoint[];
}

export const PROCESS_SERIES_PALETTE = [
  '#6366f1', // indigo-500
  '#0ea5e9', // sky-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#a855f7', // purple-500
  '#14b8a6', // teal-500
  '#f43f5e', // rose-500
];

export function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 10) {
    return `${mb.toFixed(1)} MB`;
  }
  if (mb >= 0.1) {
    return `${mb.toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatUptimeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const totalSec = Math.floor(seconds);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    return `${days}d ${hrs}h`;
  }
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export const APPLICATION_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    metricName: 'cpu_percent',
    title: 'CPU Usage (%)',
    description: 'Process CPU utilization percentage over time',
    unit: '%',
    strokeColor: '#6366f1',
    gradientId: 'grad-cpu-percent',
    minAxisCeiling: 10,
    formatValue: (val: number) => `${Number(val || 0).toFixed(1)}%`,
    formatAxisValue: (val: number) => `${val >= 10 ? Math.round(val) : Number(val.toFixed(1))}%`,
  },
  {
    metricName: 'memory_bytes',
    title: 'Memory Usage (RSS)',
    description: 'Process resident memory allocation over time',
    unit: 'MB',
    strokeColor: '#0ea5e9',
    gradientId: 'grad-memory-bytes',
    minAxisCeiling: 16 * 1024 * 1024,
    formatValue: (val: number) => formatMemoryBytes(val),
    formatAxisValue: (val: number) => formatMemoryBytes(val),
  },
  {
    metricName: 'memory_percent',
    title: 'Memory Utilization (%)',
    description: 'Memory usage relative to configured process threshold',
    unit: '%',
    strokeColor: '#10b981',
    gradientId: 'grad-memory-percent',
    minAxisCeiling: 10,
    formatValue: (val: number) => `${Number(val || 0).toFixed(1)}%`,
    formatAxisValue: (val: number) => `${val >= 10 ? Math.round(val) : Number(val.toFixed(1))}%`,
  },
  {
    metricName: 'restart_count',
    title: 'Process Restart Count',
    description: 'Cumulative PM2 restart frequency timeline',
    unit: 'restarts',
    strokeColor: '#f59e0b',
    gradientId: 'grad-restart-count',
    minAxisCeiling: 4,
    integerAxis: true,
    formatValue: (val: number) => `${Math.round(Number(val || 0))}`,
    formatAxisValue: (val: number) => `${Math.round(val)}`,
  },
  {
    metricName: 'uptime_seconds',
    title: 'Process Uptime',
    description: 'Continuous online runtime duration per process',
    unit: 'duration',
    strokeColor: '#a855f7',
    gradientId: 'grad-uptime-seconds',
    minAxisCeiling: 60,
    formatValue: (val: number) => formatUptimeDuration(val),
    formatAxisValue: (val: number) => formatUptimeDuration(val),
  },
];

export const APPLICATION_METRIC_NAMES: ApplicationMetricName[] = [
  'cpu_percent',
  'memory_bytes',
  'memory_percent',
  'restart_count',
  'uptime_seconds',
];

export function getMetricDefinition(metricName: string): MetricDefinition {
  const found = APPLICATION_METRIC_DEFINITIONS.find((d) => d.metricName === metricName);
  if (found) return found;
  const safeId = metricName.replace(/[^a-zA-Z0-9_-]/g, '-');
  return {
    metricName,
    title: metricName,
    description: `Recorded time-series telemetry for ${metricName}`,
    unit: '',
    strokeColor: '#6366f1',
    gradientId: `grad-${safeId}`,
    minAxisCeiling: 10,
    formatValue: (val: number) => Number(val || 0).toFixed(2),
    formatAxisValue: (val: number) => Number(val || 0).toFixed(1),
  };
}

export function extractProcessNames(
  metrics: SystemMetric[],
  processes: PM2ProcessSummary[] = []
): string[] {
  const names = new Set<string>();
  for (const proc of processes) {
    if (proc.name) names.add(proc.name);
  }
  for (const met of metrics) {
    const pName = met.labels?.process_name;
    if (typeof pName === 'string' && pName.trim()) {
      names.add(pName.trim());
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function computeAxisMax(
  maxDataValue: number,
  minCeiling: number,
  integerAxis = false
): number {
  const rawMax = Math.max(minCeiling, Number.isFinite(maxDataValue) ? maxDataValue * 1.12 : minCeiling);
  if (integerAxis) {
    // Round up to a multiple of 4 so 0, 0.25, 0.5, 0.75, 1 ratios are exact integers
    return Math.max(4, Math.ceil(rawMax / 4) * 4);
  }
  return rawMax;
}

export function buildMetricChartGroups(
  metrics: SystemMetric[],
  options: {
    metricNameFilter?: string;
    processNameFilter?: string;
  } = {}
): MetricChartGroup[] {
  const metricFilter = (options.metricNameFilter || '').trim();
  const processFilter = (options.processNameFilter || '').trim();

  // Determine ordered list of metric names to build chart groups for
  const targetMetricNames: string[] = [];
  if (metricFilter) {
    targetMetricNames.push(metricFilter);
  } else {
    for (const def of APPLICATION_METRIC_DEFINITIONS) {
      targetMetricNames.push(def.metricName);
    }
    for (const m of metrics) {
      if (m.metricName && !targetMetricNames.includes(m.metricName)) {
        targetMetricNames.push(m.metricName);
      }
    }
  }

  return targetMetricNames.map((metricName) => {
    const def = getMetricDefinition(metricName);

    const matching = metrics.filter((m) => {
      if (m.metricName !== metricName) return false;
      if (processFilter) {
        const procName = String(m.labels?.process_name || '').trim();
        if (procName !== processFilter) return false;
      }
      return true;
    });

    // Group points by process
    const byProcess = new Map<string, MetricDataPoint[]>();
    for (const m of matching) {
      const processName = String(m.labels?.process_name || 'pm2-process').trim() || 'pm2-process';
      const pmId = Number(m.labels?.pm_id ?? 0);
      const status = String(m.labels?.status || 'online');
      const processKey = `${processName}:${pmId}`;
      const parsedMs = Date.parse(m.recordedAt);
      const timeMs = Number.isFinite(parsedMs) ? parsedMs : 0;
      const value = Number(m.metricValue ?? 0);

      const list = byProcess.get(processKey) || [];
      list.push({
        id: m.id,
        timestamp: m.recordedAt,
        timeMs,
        value: Number.isFinite(value) ? value : 0,
        processName,
        pmId,
        status,
      });
      byProcess.set(processKey, list);
    }

    const sortedProcessKeys = Array.from(byProcess.keys()).sort((a, b) => a.localeCompare(b));
    const series: MetricProcessSeries[] = sortedProcessKeys.map((pKey, idx) => {
      const pts = (byProcess.get(pKey) || []).sort((a, b) => a.timeMs - b.timeMs);
      const values = pts.map((p) => p.value);
      const latest = pts[pts.length - 1];
      const minValue = values.length ? Math.min(...values) : 0;
      const maxValue = values.length ? Math.max(...values) : 0;
      const avgValue = values.length
        ? values.reduce((acc, cur) => acc + cur, 0) / values.length
        : 0;

      // Primary series uses the metric's own accent color; additional processes use palette colors
      const color =
        idx === 0
          ? def.strokeColor
          : PROCESS_SERIES_PALETTE[(idx + 1) % PROCESS_SERIES_PALETTE.length];

      return {
        processKey: pKey,
        processName: latest?.processName || pKey,
        pmId: latest?.pmId ?? 0,
        status: latest?.status || 'online',
        color,
        points: pts,
        latestValue: latest?.value ?? 0,
        minValue,
        maxValue,
        avgValue,
      };
    });

    const allPoints = series.flatMap((s) => s.points).sort((a, b) => a.timeMs - b.timeMs);
    const allValues = allPoints.map((p) => p.value);

    const totalPoints = allPoints.length;
    const latestValue = totalPoints > 0 ? allPoints[totalPoints - 1].value : null;
    const minValue = totalPoints > 0 ? Math.min(...allValues) : null;
    const maxValue = totalPoints > 0 ? Math.max(...allValues) : null;
    const avgValue =
      totalPoints > 0 ? allValues.reduce((acc, cur) => acc + cur, 0) / totalPoints : null;

    return {
      metricName: def.metricName,
      title: def.title,
      description: def.description,
      unit: def.unit,
      strokeColor: def.strokeColor,
      gradientId: def.gradientId,
      minAxisCeiling: def.minAxisCeiling,
      integerAxis: Boolean(def.integerAxis),
      formatValue: def.formatValue,
      formatAxisValue: def.formatAxisValue,
      totalPoints,
      latestValue,
      minValue,
      maxValue,
      avgValue,
      earliestTimestamp: totalPoints > 0 ? allPoints[0].timestamp : null,
      latestTimestamp: totalPoints > 0 ? allPoints[totalPoints - 1].timestamp : null,
      series,
    };
  });
}

export function buildPlottedSeries(
  group: MetricChartGroup,
  dimensions: {
    width: number;
    height: number;
    padLeft: number;
    padRight: number;
    padTop: number;
    padBottom: number;
  }
): {
  axisMax: number;
  plottedSeries: PlottedSeries[];
} {
  const plotW = dimensions.width - dimensions.padLeft - dimensions.padRight;
  const plotH = dimensions.height - dimensions.padTop - dimensions.padBottom;
  const baselineY = dimensions.padTop + plotH;

  const axisMax = computeAxisMax(
    group.maxValue ?? 0,
    group.minAxisCeiling,
    group.integerAxis
  );

  const plottedSeries: PlottedSeries[] = group.series.map((s) => {
    const count = s.points.length;
    const coordinates: PlottedPoint[] = s.points.map((pt, idx) => {
      const x =
        count === 1
          ? dimensions.padLeft + plotW / 2
          : dimensions.padLeft + (idx / (count - 1)) * plotW;
      const clampedRatio = Math.max(0, Math.min(1, pt.value / axisMax));
      const y = dimensions.padTop + plotH - clampedRatio * plotH;
      return {
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        point: pt,
      };
    });

    const polylinePoints = coordinates.map((c) => `${c.x},${c.y}`).join(' ');
    let areaPoints = '';
    if (coordinates.length > 1) {
      const firstX = coordinates[0].x;
      const lastX = coordinates[coordinates.length - 1].x;
      areaPoints = `${firstX},${baselineY.toFixed(1)} ${polylinePoints} ${lastX},${baselineY.toFixed(1)}`;
    } else if (coordinates.length === 1) {
      const cx = coordinates[0].x;
      const cy = coordinates[0].y;
      areaPoints = `${dimensions.padLeft},${baselineY.toFixed(1)} ${cx},${cy} ${dimensions.width - dimensions.padRight},${baselineY.toFixed(1)}`;
    }

    return {
      processKey: s.processKey,
      processName: s.processName,
      color: s.color,
      status: s.status,
      latestValue: s.latestValue,
      polylinePoints,
      areaPoints,
      coordinates,
    };
  });

  return {
    axisMax,
    plottedSeries,
  };
}
