/**
 * ExploreChart: a line or stacked-bar chart you can zoom and pan (mouse
 * wheel / drag on the plot, or the slider under it), with "Reset zoom" and
 * "Download PNG" above it and a legend that names every series in words
 * (color is never the only carrier). PRD 5.8 charts, F-407.
 *
 * Loading, empty and error stay with the caller's DataState; this renders
 * only data it is given.
 */
import { BarChart as EBar, LineChart as ELine } from 'echarts/charts';
import { DataZoomInsideComponent, DataZoomSliderComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import type { ECharts } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { AsyncButton } from '../core/AsyncButton';
import { Button } from '../core/Button';
import { useEChart } from './Chart';
import { buildExploreOption, chartFileName } from './explore';
import type { ExploreSpec } from './explore';

use([ELine, EBar, GridComponent, TooltipComponent, DataZoomInsideComponent, DataZoomSliderComponent, SVGRenderer]);

export interface ExploreChartProps extends ExploreSpec {
  /** Text alternative for the whole chart; also names the PNG. */
  label: string;
  height?: number;
  style?: CSSProperties;
}

/** Rasterises the chart's own SVG at 2× and hands back a PNG. */
async function chartPng(chart: ECharts, el: HTMLElement): Promise<Blob> {
  const svg = el.querySelector('svg');
  if (svg === null) throw new Error('The chart is not drawn yet.');
  const width = chart.getWidth();
  const height = chart.getHeight();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('This browser cannot draw the image.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ExploreChart({ label, height = 280, style, ...spec }: ExploreChartProps) {
  const chart = useRef<ECharts | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const onInstance = useCallback((c: ECharts | null) => {
    chart.current = c;
    c?.on?.('datazoom', () => {
      const opt = c.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> };
      const z = opt.dataZoom?.[0];
      setZoomed(z !== undefined && ((z.start ?? 0) > 0 || (z.end ?? 100) < 100));
    });
  }, []);
  const ref = useEChart(
    (palette) => buildExploreOption(spec, palette),
    [spec.kind, JSON.stringify(spec.categories), JSON.stringify(spec.series)],
    onInstance,
  );

  const reset = (): void => {
    chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    setZoomed(false);
  };

  const download = async (): Promise<void> => {
    const c = chart.current;
    const el = ref.current;
    if (c === null || el === null) throw new Error('The chart is not drawn yet.');
    const blob = await chartPng(c, el);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = chartFileName(label);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <figure style={{ margin: 0, display: 'grid', gap: 8, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <ul aria-label={`${label}: series`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          {spec.series.map((s) => (
            <li key={s.name} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: `var(--chart-series-${((s.tone - 1) % 8) + 1})` }} />
              {s.name}
            </li>
          ))}
        </ul>
        <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="ghost"
            size="dense"
            icon="refresh-cw"
            onClick={zoomed ? reset : undefined}
            aria-disabled={!zoomed}
            title={zoomed ? 'Show the whole range again' : 'Not zoomed. Scroll or drag on the chart, or use the slider under it, to zoom.'}
          >
            Reset zoom
          </Button>
          <AsyncButton variant="secondary" size="dense" icon="download" label="Download PNG" pendingLabel="Preparing…" successLabel="Downloaded" onAction={download} />
        </div>
      </div>
      <div ref={ref} role="img" aria-label={label} style={{ width: '100%', height, minWidth: 0 }} />
    </figure>
  );
}
