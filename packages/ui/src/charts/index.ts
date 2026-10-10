'use client';

/**
 * @embers/ui/charts: ECharts-backed figures, kept out of the main entry so
 * pages without a chart never ship ECharts.
 */
export * from './Chart';
export * from './Explore';
export type { ChartPalette, TimeSeriesBand, TimeSeriesLine, TimeSeriesSpec } from './options';
export type { ExploreSeries, ExploreSpec } from './explore';
