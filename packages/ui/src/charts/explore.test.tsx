import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildExploreOption, chartFileName, toneColor } from './explore';
import type { ChartPalette } from './options';

const handlers: Record<string, () => void> = {};
let zoom: { start?: number; end?: number } = { start: 0, end: 100 };
const chart = {
  setOption: vi.fn(),
  dispose: vi.fn(),
  resize: vi.fn(),
  dispatchAction: vi.fn(),
  on: vi.fn((name: string, fn: () => void) => {
    handlers[name] = fn;
  }),
  getOption: vi.fn(() => ({ dataZoom: [zoom] })),
  getWidth: vi.fn(() => 300),
  getHeight: vi.fn(() => 200),
};
vi.mock('echarts/core', () => ({ init: vi.fn(() => chart), use: vi.fn() }));

const palette: ChartPalette = { series: ['s1', 's2', 's3'], grid: 'grid', text: 'text', muted: 'muted', surface: 'surface', border: 'border', fontSans: 'sans', fontMono: 'mono' };

type Opt = {
  animation: boolean;
  series: Array<Record<string, unknown>>;
  dataZoom: Array<{ type: string; labelFormatter?: (i: number, v: string) => string }>;
  tooltip: { valueFormatter: (v: unknown) => string };
  xAxis: { boundaryGap: boolean; axisLabel: { formatter: (c: string) => string } };
  yAxis: { scale: boolean; axisLabel: { formatter: (v: number) => string } };
};

describe('buildExploreOption', () => {
  it('stacks bars per series with token colors and zoom on both axes inputs', () => {
    const opt = buildExploreOption(
      { kind: 'stacked-bar', categories: ['d1', 'd2'], series: [{ name: 'Sales', values: [1, 2], tone: 1 }, { name: 'Mints', values: [0, null], tone: 4 }], formatValue: (v) => `${v} x`, formatAxis: (c) => c.toUpperCase() },
      palette,
    ) as unknown as Opt;
    expect(opt.animation).toBe(false);
    expect(opt.series.map((s) => [s.type, s.stack, s.name])).toEqual([
      ['bar', 'total', 'Sales'],
      ['bar', 'total', 'Mints'],
    ]);
    expect((opt.series[1]!.itemStyle as { color: string }).color).toBe('s1');
    expect(opt.dataZoom.map((z) => z.type)).toEqual(['inside', 'slider']);
    expect(opt.dataZoom[1]!.labelFormatter!(0, 'd1')).toBe('D1');
    expect(opt.xAxis.boundaryGap).toBe(true);
    expect(opt.yAxis.scale).toBe(false);
    expect(opt.tooltip.valueFormatter(3)).toBe('3 x');
    expect(opt.tooltip.valueFormatter(null)).toBe('—');
    expect(opt.xAxis.axisLabel.formatter('a')).toBe('A');
    expect(opt.yAxis.axisLabel.formatter(2)).toBe('2 x');
  });

  it('draws lines with defaults', () => {
    const opt = buildExploreOption({ kind: 'line', categories: ['a'], series: [{ name: 'L', values: [1], tone: 2 }] }, palette) as unknown as Opt;
    expect(opt.series[0]).toMatchObject({ type: 'line', name: 'L', connectNulls: false, showSymbol: true });
    const long = buildExploreOption({ kind: 'line', categories: [], series: [{ name: 'L', values: Array.from({ length: 90 }, () => 1), tone: 1 }] }, palette) as unknown as Opt;
    expect(long.series[0]!.showSymbol).toBe(false);
    expect(opt.dataZoom[1]!.labelFormatter!(0, 'a')).toBe('a');
    expect(opt.yAxis.axisLabel.formatter(5)).toBe('5');
    expect(opt.xAxis.axisLabel.formatter('a')).toBe('a');
    expect(toneColor({ ...palette, series: [] }, 1)).toBe('text');
  });

  it('names the PNG after the chart', () => {
    expect(chartFileName('Transactions made, all cities')).toBe('transactions-made-all-cities.png');
    expect(chartFileName('—')).toBe('chart.png');
  });
});

describe('ExploreChart', () => {
  beforeEach(() => {
    zoom = { start: 0, end: 100 };
    chart.dispatchAction.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('labels the chart and names every series; Reset zoom works only once zoomed', async () => {
    const { ExploreChart } = await import('./Explore');
    render(<ExploreChart kind="line" label="Prices" categories={['a', 'b']} series={[{ name: 'Median sale', values: [1, 2], tone: 1 }]} />);
    expect(screen.getByRole('img', { name: 'Prices' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Prices: series' }).textContent).toContain('Median sale');
    const reset = screen.getByRole('button', { name: 'Reset zoom' });
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(reset);
    expect(chart.dispatchAction).not.toHaveBeenCalled();
    zoom = { start: 20, end: 100 };
    act(() => handlers.datazoom!());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset zoom' }).getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'dataZoom', start: 0, end: 100 });
  });

  it('Download PNG rasterises the drawn SVG and saves it', async () => {
    const { ExploreChart } = await import('./Explore');
    const { container } = render(<ExploreChart kind="stacked-bar" label="Transactions made" categories={['a']} series={[{ name: 'Sales', values: [1], tone: 1 }]} />);
    const figure = container.querySelector('[role="img"]')!;
    figure.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode() {
          return Promise.resolve();
        }
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(drawImage).toHaveBeenCalled();
  });

  it('Download PNG reports a chart with nothing drawn', async () => {
    const { ExploreChart } = await import('./Explore');
    render(<ExploreChart kind="line" label="Empty" categories={[]} series={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));
    await waitFor(() => expect(screen.getByText('The chart is not drawn yet.')).toBeTruthy());
  });
});
