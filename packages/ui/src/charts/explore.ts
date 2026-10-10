/**
 * Option builder for explorable charts (PRD 5.8 "Charts: … zoom/pan reset
 * button, tooltip on hover"; F-407 "Zoom/pan, reset zoom, download PNG"):
 * lines or stacked bars over a category axis, with inside (wheel / drag)
 * and slider zoom. Pure, like `options.ts`: colors come in resolved.
 */
import type { EChartsCoreOption } from 'echarts/core';

import type { ChartPalette } from './options';

export interface ExploreSeries {
  name: string;
  values: ReadonlyArray<number | null>;
  /** 1-based index into --chart-series-1..8. */
  tone: number;
}

export interface ExploreSpec {
  kind: 'line' | 'stacked-bar';
  categories: readonly string[];
  series: readonly ExploreSeries[];
  formatAxis?: (category: string) => string;
  formatValue?: (value: number) => string;
}

/** Up to this many points, every point gets a marker. */
const SYMBOL_MAX_POINTS = 62;

export const toneColor = (palette: ChartPalette, n: number): string => palette.series[(n - 1) % palette.series.length] ?? palette.text;

export function buildExploreOption(spec: ExploreSpec, palette: ChartPalette): EChartsCoreOption {
  const fmtValue = spec.formatValue ?? ((v: number) => String(v));
  const bar = spec.kind === 'stacked-bar';
  const series = spec.series.map((s) => {
    const color = toneColor(palette, s.tone);
    return bar
      ? { name: s.name, type: 'bar', stack: 'total', data: [...s.values], itemStyle: { color }, barMaxWidth: 28, emphasis: { focus: 'series' } }
      : {
          name: s.name,
          type: 'line',
          data: [...s.values],
          // Sparse series (gaps, single days) would draw nothing as a bare line: mark each point.
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: s.values.filter((v) => v !== null).length <= SYMBOL_MAX_POINTS,
          connectNulls: false,
          lineStyle: { color, width: 2 },
          itemStyle: { color },
        };
  });
  const axisLabel = { color: palette.muted, fontFamily: palette.fontMono, fontSize: 11 };
  return {
    animation: false,
    backgroundColor: palette.surface,
    grid: { left: 8, right: 12, top: 12, bottom: 40, containLabel: true },
    textStyle: { fontFamily: palette.fontSans, color: palette.text },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: bar ? 'shadow' : 'line' },
      backgroundColor: palette.surface,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontFamily: palette.fontMono, fontSize: 12 },
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtValue(v) : '—'),
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 18,
        bottom: 6,
        borderColor: palette.border,
        fillerColor: palette.grid,
        textStyle: { color: palette.muted, fontFamily: palette.fontMono, fontSize: 10 },
        labelFormatter: (_: number, value: string) => (spec.formatAxis ? spec.formatAxis(value) : value),
      },
    ],
    xAxis: {
      type: 'category',
      data: [...spec.categories],
      boundaryGap: bar,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...axisLabel, formatter: spec.formatAxis ?? ((c: string) => c), hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: !bar,
      splitLine: { lineStyle: { color: palette.grid } },
      axisLabel: { ...axisLabel, formatter: (v: number) => fmtValue(v) },
    },
    series,
  };
}

/** A file name that is safe on every OS: "Transactions made" → "transactions-made". */
export function chartFileName(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'chart'}.png`;
}
