import React, { useEffect, useMemo, useState } from 'react';
import { PlotlyChart } from './PlotlyChart';
import { fmtInt, fmtNum } from '../utils/format';

export interface OhlcChartBar {
  dtDisplay: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  mas?: Record<string, number | null>;
}

interface DynamicOhlcChartProps {
  symbol: string;
  bars: OhlcChartBar[];
  maInfo?: { key: string; label: string; color: string }[];
  showVolume?: boolean;
  showMaVol?: boolean;
  hlines?: { y: number; color: string; dash: string; label: string }[];
  height?: number;
  uirevision?: string;
}

export const DynamicOhlcChart: React.FC<DynamicOhlcChartProps> = ({
  symbol,
  bars,
  maInfo = [],
  showVolume = true,
  showMaVol = false,
  hlines = [],
  height = 560,
  uirevision = 'v11_keep_view',
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    setHoverIdx(null);
  }, [symbol]);

  const activeBar = useMemo(() => {
    if (!bars.length) return null;
    const idx =
      hoverIdx !== null && hoverIdx >= 0 && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
    return bars[idx];
  }, [bars, hoverIdx]);

  const barStats = useMemo(() => {
    if (!activeBar) return null;
    const { close, prevClose } = activeBar;
    let clr = '#475569';
    let chg = '—';
    if (prevClose !== null && prevClose > 0) {
      const delta = close - prevClose;
      const pct = (delta / prevClose) * 100;
      clr = delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#d97706';
      chg = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    }
    return { clr, chg };
  }, [activeBar]);

  const { traces, layout } = useMemo(() => {
    const xLbls = bars.map((b) => b.label);
    const tracesList: any[] = [
      {
        type: 'candlestick',
        x: xLbls,
        open: bars.map((b) => b.open),
        high: bars.map((b) => b.high),
        low: bars.map((b) => b.low),
        close: bars.map((b) => b.close),
        name: symbol,
        increasing: { line: { color: '#10b981' } },
        decreasing: { line: { color: '#ef4444' } },
        hoverinfo: 'skip',
        xaxis: 'x',
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: xLbls,
        y: bars.map((b) => b.close),
        marker: { opacity: 0, size: 1 },
        hovertemplate: '<extra></extra>',
        showlegend: false,
        xaxis: 'x',
        yaxis: 'y',
      },
    ];

    for (const ma of maInfo) {
      if (ma.key === 'MA20_Vol') continue;
      tracesList.push({
        type: 'scatter',
        mode: 'lines',
        x: xLbls,
        y: bars.map((b) => b.mas?.[ma.key] ?? null),
        name: ma.label,
        line: { color: ma.color, width: 1.45 },
        hoverinfo: 'skip',
        xaxis: 'x',
        yaxis: 'y',
      });
    }

    if (showVolume) {
      tracesList.push({
        type: 'bar',
        x: xLbls,
        y: bars.map((b) => b.volume),
        marker: {
          color: bars.map((b) => (b.close >= b.open ? '#10b981' : '#ef4444')),
        },
        name: 'Volume',
        hoverinfo: 'skip',
        xaxis: 'x',
        yaxis: 'y2',
      });

      if (showMaVol) {
        tracesList.push({
          type: 'scatter',
          mode: 'lines',
          x: xLbls,
          y: bars.map((b) => b.mas?.MA20_Vol ?? null),
          name: 'MA20 Vol',
          line: { color: '#d946ef', width: 1.3 },
          hoverinfo: 'skip',
          xaxis: 'x',
          yaxis: 'y2',
        });
      }
    }

    const shapes: any[] = [];
    const annotations: any[] = [];
    for (const hl of hlines) {
      shapes.push({
        type: 'line',
        xref: 'paper',
        x0: 0,
        x1: 1,
        yref: 'y',
        y0: hl.y,
        y1: hl.y,
        line: { color: hl.color, width: 1.3, dash: hl.dash },
      });
      annotations.push({
        xref: 'paper',
        x: 1,
        xanchor: 'right',
        yref: 'y',
        y: hl.y,
        yanchor: 'bottom',
        text: hl.label,
        showarrow: false,
        font: { size: 11, color: hl.color, family: 'Segoe UI, Arial, sans-serif' },
        bgcolor: 'rgba(255,255,255,0.85)',
      });
    }

    const chartLayout: Record<string, any> = {
      uirevision,
      hovermode: 'x',
      hoverlabel: {
        bgcolor: 'rgba(0,0,0,0)',
        bordercolor: 'rgba(0,0,0,0)',
        font: { size: 1, color: 'rgba(0,0,0,0)' },
      },
      margin: { l: 48, r: 16, t: 34, b: 30 },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.01, xanchor: 'left', x: 0 },
      xaxis: {
        type: 'category',
        nticks: 12,
        tickangle: 0,
        showgrid: true,
        gridcolor: '#f1f5f9',
        zeroline: false,
        rangeslider: { visible: false },
        showspikes: true,
        spikemode: 'across',
        spikesnap: 'cursor',
        spikethickness: 1,
        spikecolor: '#94a3b8',
        spikedash: 'dot',
      },
      yaxis: {
        domain: showVolume ? [0.27, 1.0] : [0, 1],
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: false,
        showspikes: true,
        spikemode: 'across',
        spikesnap: 'cursor',
        spikethickness: 1,
        spikecolor: '#94a3b8',
        spikedash: 'dot',
      },
      shapes,
      annotations,
    };

    if (showVolume) {
      chartLayout.yaxis2 = {
        domain: [0, 0.23],
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: false,
      };
    }

    return { traces: tracesList, layout: chartLayout };
  }, [bars, symbol, maInfo, showVolume, showMaVol, hlines, uirevision]);

  const maReadouts = useMemo(() => {
    if (!activeBar?.mas) return [];
    const list: { label: string; val: string; color: string }[] = [];
    for (const ma of maInfo) {
      const v = activeBar.mas[ma.key];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        list.push({
          label: ma.label,
          val: ma.key.includes('Vol') ? fmtInt(v) : fmtNum(v, 2),
          color: ma.color,
        });
      }
    }
    return list;
  }, [activeBar, maInfo]);

  return (
    <div className="bg-white border border-slate-200 rounded-[10px] p-2.5 shadow-xs">
      {activeBar && barStats && (
        <div
          className="border-l-4 px-3 py-1 mb-1 text-[13px] text-slate-800 leading-relaxed"
          style={{ borderLeftColor: barStats.clr }}
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="font-bold text-slate-900">{symbol}</span>
            <span className="text-slate-500">({activeBar.dtDisplay})</span>
            <span className="text-slate-300">|</span>
            <span>
              O: <strong style={{ color: barStats.clr }}>{fmtNum(activeBar.open)}</strong>
            </span>
            <span>
              H: <strong style={{ color: barStats.clr }}>{fmtNum(activeBar.high)}</strong>
            </span>
            <span>
              L: <strong style={{ color: barStats.clr }}>{fmtNum(activeBar.low)}</strong>
            </span>
            <span>
              C: <strong style={{ color: barStats.clr }}>{fmtNum(activeBar.close)}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <strong style={{ color: barStats.clr }}>{barStats.chg}</strong>
            <span className="text-slate-300">|</span>
            <span>
              Vol: <strong>{fmtInt(activeBar.volume)}</strong>
            </span>
          </div>
          {maReadouts.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] mt-0.5">
              {maReadouts.map((m) => (
                <span key={m.label} style={{ color: m.color }} className="font-bold">
                  {m.label}: {m.val}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <PlotlyChart
        data={traces}
        layout={layout}
        height={height}
        onHover={(ev) => {
          const pt = ev?.points?.[0];
          if (pt && typeof pt.pointIndex === 'number') {
            setHoverIdx(pt.pointIndex);
          }
        }}
        onUnhover={() => setHoverIdx(null)}
      />
    </div>
  );
};
