import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlotlyChart } from '../components/PlotlyChart';
import {
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SecondaryButton,
  inputCls,
} from '../components/UiPrimitives';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchForeignTradingWithTicks } from '../utils/livePatch';
import {
  colorSignedClass,
  downloadCsv,
  fmtInt,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface ForeignStockRow {
  symbol: string;
  companyName: string;
  exchange: 'HOSE' | 'HNX' | 'UPCOM';
  industry: string;
  price: number;
  pct: number;
  buyValBil: number;
  sellValBil: number;
  netValBil: number;
  buyVol: number;
  sellVol: number;
  netVol: number;
  totalRoom: number;
  currentRoom: number;
  roomPct: number | null;
}

interface ForeignSectorRow {
  industry: string;
  buyValBil: number;
  sellValBil: number;
  netValBil: number;
  buyVol: number;
  sellVol: number;
  netVol: number;
  stockCount: number;
  topSymbol: string;
}

interface ForeignHistoryPoint {
  date: string;
  dateShort: string;
  buyValBil: number;
  sellValBil: number;
  netValBil: number;
  cumNetBil: number;
  buyVolMil: number;
  sellVolMil: number;
  netVolMil: number;
}

interface ForeignExchangeSummary {
  buyValBil: number;
  sellValBil: number;
  netValBil: number;
  buyVolMil: number;
  sellVolMil: number;
  netVolMil: number;
}

interface ForeignTradingResp {
  exchange: 'ALL' | 'HOSE' | 'HNX' | 'UPCOM';
  requestedDate: string;
  resolvedDate: string;
  resolvedDateDisplay: string;
  resolvedDateShort: string;
  source: string;
  isLiveWs: boolean;
  liveWsCount: number;
  syncTime: string;
  summary: {
    buyValBil: number;
    sellValBil: number;
    netValBil: number;
    buyVolMil: number;
    sellVolMil: number;
    netVolMil: number;
    cumNet5Bil: number;
    cumNet10Bil: number;
    cumNet20Bil: number;
    buyStocksCount: number;
    sellStocksCount: number;
    activeStocksCount: number;
    perExchange: Record<'HOSE' | 'HNX' | 'UPCOM', ForeignExchangeSummary>;
  };
  history: ForeignHistoryPoint[];
  sectors: ForeignSectorRow[];
  topBuy: ForeignStockRow[];
  topSell: ForeignStockRow[];
  stocks: ForeignStockRow[];
}

const EXCHANGE_OPTIONS: Array<{ id: 'ALL' | 'HOSE' | 'HNX' | 'UPCOM'; label: string }> = [
  { id: 'HOSE', label: 'HOSE' },
  { id: 'HNX', label: 'HNX' },
  { id: 'UPCOM', label: 'UPCOM' },
  { id: 'ALL', label: 'Toàn TT (3 sàn)' },
];

const WILDCARD_SUB = ['*'];

interface Props {
  isActive: boolean;
}

export const ForeignTradingPanel: React.FC<Props> = ({ isActive }) => {
  const { liveAuto, ticks, tickVersion, syncVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);

  const [exchange, setExchange] = useState<'ALL' | 'HOSE' | 'HNX' | 'UPCOM'>('HOSE');
  const [targetDate, setTargetDate] = useState(today);
  const [sessions, setSessions] = useState<number>(20);
  const [metric, setMetric] = useState<'val' | 'vol'>('val');
  const [data, setData] = useState<ForeignTradingResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table filters
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [industryFilter, setIndustryFilter] = useState<string>('ALL');
  const [searchTxt, setSearchTxt] = useState<string>('');
  const [sortBy, setSortBy] = useState<'netDesc' | 'netAsc' | 'buyDesc' | 'sellDesc'>('netDesc');

  const loadForeign = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const q = new URLSearchParams({
          exchange,
          date: targetDate,
          sessions: String(sessions),
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/foreign-trading?${q.toString()}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json: ForeignTradingResp = await resp.json();
        setData(json);
        setError(null);
      } catch (err: any) {
        if (!silent) {
          setError(err?.message || 'Không thể tải dữ liệu giao dịch khối ngoại.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [exchange, targetDate, sessions]
  );

  // Subscribe live SSI WS ticks while active and viewing today
  useSubscribeSymbols(WILDCARD_SUB, isActive && targetDate >= today && liveAuto);

  useEffect(() => {
    if (!isActive) return;
    loadForeign(false, false);
  }, [isActive, loadForeign]);

  // Patch foreign flow & stock prices in-place from SSI WebSocket ticks without flicker
  useEffect(() => {
    if (!liveAuto || !isActive || targetDate < today) return;
    setData((prev) => patchForeignTradingWithTicks(prev, ticks));
  }, [tickVersion, ticks, liveAuto, isActive, targetDate, today]);

  // Silently reconcile official exchange-level foreign figures on WS board sync events
  const lastSyncRef = useRef(syncVersion.board);
  useEffect(() => {
    if (syncVersion.board === lastSyncRef.current) return;
    lastSyncRef.current = syncVersion.board;
    if (!liveAuto || !isActive || targetDate < today) return;
    loadForeign(false, true);
  }, [syncVersion.board, liveAuto, isActive, targetDate, today, loadForeign]);

  // Reset industry filter if it disappears on exchange change
  useEffect(() => {
    if (industryFilter === 'ALL' || !data?.sectors?.length) return;
    if (!data.sectors.some((s) => s.industry === industryFilter)) {
      setIndustryFilter('ALL');
    }
  }, [data, industryFilter]);

  // Chart 1: Multi-session foreign trading bar + cumulative net line
  const historyChart = useMemo(() => {
    if (!data?.history?.length) return null;
    const isVal = metric === 'val';
    const unit = isVal ? 'Tỷ' : 'Tr CP';
    const xDates = data.history.map((h) => h.dateShort);
    const netArr = data.history.map((h) => (isVal ? h.netValBil : h.netVolMil));
    const buyArr = data.history.map((h) => (isVal ? h.buyValBil : h.buyVolMil));
    const sellArr = data.history.map((h) => (isVal ? h.sellValBil : h.sellVolMil));

    // Cumulative net across the displayed window
    const cumArr: number[] = [];
    let acc = 0;
    for (const v of netArr) {
      acc += v;
      cumArr.push(Number(acc.toFixed(2)));
    }

    const barColors = netArr.map((v) => (v >= 0 ? '#10b981' : '#ef4444'));
    const hoverTexts = data.history.map((h, i) => {
      const n = netArr[i];
      const b = buyArr[i];
      const s = sellArr[i];
      return `<b>Phiên ${h.dateShort}</b><br>Mua: <b>${fmtNum(b, 2)} ${unit}</b><br>Bán: <b>${fmtNum(
        s,
        2
      )} ${unit}</b><br>Ròng: <b>${fmtSigned(n, 2)} ${unit}</b><br>Lũy kế: <b>${fmtSigned(
        cumArr[i],
        2
      )} ${unit}</b>`;
    });

    const traces: any[] = [
      {
        type: 'bar',
        name: `Mua/Bán ròng (${unit})`,
        x: xDates,
        y: netArr,
        text: hoverTexts,
        hovertemplate: '%{text}<extra></extra>',
        marker: { color: barColors, line: { width: 0 } },
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: `Lũy kế ${data.history.length} phiên (${unit})`,
        x: xDates,
        y: cumArr,
        line: { color: '#0284c7', width: 2.2 },
        marker: { size: 5, color: '#0284c7' },
        hovertemplate: `Lũy kế: <b>%{y:+,.2f} ${unit}</b><extra></extra>`,
        yaxis: 'y2',
      },
    ];

    const layout: Record<string, any> = {
      uirevision: `foreign_hist_${exchange}_${metric}_${sessions}_${targetDate}`,
      hovermode: 'x unified',
      margin: { l: 58, r: 58, t: 38, b: 36 },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.13,
        font: { size: 12, color: '#334155' },
      },
      xaxis: {
        type: 'category',
        showgrid: false,
        tickangle: data.history.length > 20 ? -35 : 0,
      },
      yaxis: {
        title: { text: `Ròng theo phiên (${unit})`, font: { size: 11.5, color: '#64748b' } },
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: true,
        zerolinecolor: '#94a3b8',
        zerolinewidth: 1.2,
      },
      yaxis2: {
        title: { text: `Lũy kế (${unit})`, font: { size: 11.5, color: '#0284c7' } },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        zeroline: false,
      },
    };

    return { traces, layout };
  }, [data, metric, exchange, sessions, targetDate]);

  // Chart 2: Top 10 Net Buy & Top 10 Net Sell Diverging Horizontal Bar Chart
  const topMoversChart = useMemo(() => {
    if (!data) return null;
    const isVal = metric === 'val';
    const unit = isVal ? 'Tỷ' : 'Tr CP';

    const buyList = [...(data.stocks || [])]
      .filter((s) => (isVal ? s.netValBil > 0 : s.netVol > 0))
      .sort((a, b) => (isVal ? b.netValBil - a.netValBil : b.netVol - a.netVol))
      .slice(0, 10);

    const sellList = [...(data.stocks || [])]
      .filter((s) => (isVal ? s.netValBil < 0 : s.netVol < 0))
      .sort((a, b) => (isVal ? a.netValBil - b.netValBil : a.netVol - b.netVol))
      .slice(0, 10);

    // Combine: top sellers at bottom (most negative first) -> top buyers at top (largest positive last)
    const combined = [...sellList, ...buyList.reverse()];
    if (!combined.length) return null;

    const vals = combined.map((s) =>
      isVal ? Number(s.netValBil.toFixed(2)) : Number((s.netVol / 1e6).toFixed(2))
    );
    const labels = combined.map((s) => s.symbol);
    const colors = vals.map((v) => (v >= 0 ? '#10b981' : '#ef4444'));
    const texts = vals.map((v) => `${v >= 0 ? '+' : ''}${fmtNum(v, 1)}`);
    const hovers = combined.map(
      (s, i) =>
        `<b>${s.symbol}</b> (${s.exchange} · ${s.industry})<br>Giá: <b>${fmtNum(
          s.price,
          2
        )}</b> (${fmtSigned(s.pct, 2, '%')})<br>Mua: <b>${fmtNum(
          isVal ? s.buyValBil : s.buyVol / 1e6,
          2
        )} ${unit}</b><br>Bán: <b>${fmtNum(
          isVal ? s.sellValBil : s.sellVol / 1e6,
          2
        )} ${unit}</b><br>Ròng: <b>${fmtSigned(vals[i], 2)} ${unit}</b>`
    );

    return {
      traces: [
        {
          type: 'bar',
          orientation: 'h',
          x: vals,
          y: labels,
          text: texts,
          textposition: 'outside',
          textfont: { size: 11, color: '#334155' },
          hovertext: hovers,
          hoverinfo: 'text',
          marker: { color: colors, line: { width: 0 } },
        },
      ],
      layout: {
        uirevision: `foreign_top_${exchange}_${metric}_${targetDate}`,
        margin: { l: 54, r: 52, t: 10, b: 32 },
        showlegend: false,
        xaxis: {
          title: { text: `Giá trị ròng (${unit})`, font: { size: 11, color: '#64748b' } },
          showgrid: true,
          gridcolor: '#f1f5f9',
          zeroline: true,
          zerolinecolor: '#64748b',
          zerolinewidth: 1.2,
        },
        yaxis: {
          type: 'category',
          automargin: true,
          tickfont: { size: 11.5, color: '#0f172a' },
        },
      },
      height: Math.max(380, combined.length * 23 + 60),
    };
  }, [data, metric, exchange, targetDate]);

  // Filtered & sorted stock rows for detail table
  const filteredStocks = useMemo(() => {
    if (!data?.stocks?.length) return [];
    const q = searchTxt.trim().toUpperCase();
    const list = data.stocks.filter((s) => {
      if (sideFilter === 'buy' && s.netValBil <= 0) return false;
      if (sideFilter === 'sell' && s.netValBil >= 0) return false;
      if (industryFilter !== 'ALL' && s.industry !== industryFilter) return false;
      if (
        q &&
        !s.symbol.includes(q) &&
        !s.companyName.toUpperCase().includes(q) &&
        !s.industry.toUpperCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'netDesc') return b.netValBil - a.netValBil;
      if (sortBy === 'netAsc') return a.netValBil - b.netValBil;
      if (sortBy === 'buyDesc') return b.buyValBil - a.buyValBil;
      return b.sellValBil - a.sellValBil;
    });
  }, [data, sideFilter, industryFilter, searchTxt, sortBy]);

  const exportCsv = () => {
    if (!filteredStocks.length || !data) return;
    downloadCsv(
      `khoi_ngoai_${data.exchange}_${data.resolvedDate}.csv`,
      [
        'Mã',
        'Sàn',
        'Ngành (SSI ICB)',
        'Giá',
        '% Thay đổi',
        'KL Mua',
        'KL Bán',
        'KL Ròng',
        'GT Mua (Tỷ)',
        'GT Bán (Tỷ)',
        'GT Ròng (Tỷ)',
        'Room còn lại',
      ],
      filteredStocks.map((s) => [
        s.symbol,
        s.exchange,
        s.industry,
        s.price,
        s.pct,
        s.buyVol,
        s.sellVol,
        s.netVol,
        s.buyValBil,
        s.sellValBil,
        s.netValBil,
        s.currentRoom,
      ])
    );
  };

  const s = data?.summary;
  const isVal = metric === 'val';

  return (
    <div className="space-y-3">
      {/* Control Bar */}
      <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-2.5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-4">
            <div className="text-[12px] font-bold text-slate-600 mb-1">Sàn giao dịch</div>
            <div className="flex flex-wrap gap-1.5">
              {EXCHANGE_OPTIONS.map((opt) => {
                const active = exchange === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setExchange(opt.id)}
                    className={`px-3 py-1 rounded-md text-[12.5px] font-bold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0284c7] text-white border-[#0284c7]'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="text-[12px] font-bold text-slate-600 mb-1">Hiển thị theo</div>
            <div className="grid grid-cols-2 rounded-md overflow-hidden border border-slate-300">
              <button
                type="button"
                onClick={() => setMetric('val')}
                className={`py-1.5 px-2 text-[12px] font-bold transition-colors cursor-pointer ${
                  metric === 'val'
                    ? 'bg-[#0284c7] text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Giá trị (Tỷ)
              </button>
              <button
                type="button"
                onClick={() => setMetric('vol')}
                className={`py-1.5 px-2 text-[12px] font-bold border-l border-slate-300 transition-colors cursor-pointer ${
                  metric === 'vol'
                    ? 'bg-[#0284c7] text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                KL (Triệu CP)
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            <FieldLabel label="Lịch sử">
              <select
                value={sessions}
                onChange={(e) => setSessions(Number(e.target.value))}
                className={inputCls}
              >
                <option value={10}>10 phiên</option>
                <option value={20}>20 phiên</option>
                <option value={30}>30 phiên</option>
              </select>
            </FieldLabel>
          </div>

          <div className="lg:col-span-2">
            <FieldLabel label="Ngày giao dịch">
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={inputCls}
              />
            </FieldLabel>
          </div>

          <div className="lg:col-span-1">
            <PrimaryButton
              onClick={() => loadForeign(true, false)}
              loading={loading}
              className="w-full"
            >
              🔄
            </PrimaryButton>
          </div>
        </div>

        {/* Inline status & 3-exchange quick strip */}
        {data && s && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[12.5px] text-slate-600 tabular-nums">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <strong className="text-slate-900">
                {exchange === 'ALL' ? 'Toàn thị trường (3 sàn)' : `Sàn ${exchange}`}
              </strong>
              <span className="text-slate-300">·</span>
              <span>Phiên: {data.resolvedDateDisplay}</span>
              <span className="text-slate-300">·</span>
              <span>Nguồn: {data.source}</span>
              {data.isLiveWs && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#059669]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    SSI WS ({data.syncTime})
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px]">
              {(['HOSE', 'HNX', 'UPCOM'] as const).map((fl) => {
                const exStat = s.perExchange[fl];
                const net = isVal ? exStat.netValBil : exStat.netVolMil;
                return (
                  <span key={fl}>
                    {fl}:{' '}
                    <strong className={colorSignedClass(net)}>
                      {fmtSigned(net, isVal ? 1 : 2)} {isVal ? 'Tỷ' : 'Tr'}
                    </strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {loading && !data && (
        <LoadingBar text="Đang tải dữ liệu giao dịch khối ngoại toàn thị trường..." />
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px] flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <SecondaryButton onClick={() => loadForeign(true, false)}>Thử lại</SecondaryButton>
        </div>
      )}

      {data && s && (
        <>
          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <MetricCard
              label={`Mua / Bán Ròng (${data.resolvedDateShort})`}
              value={
                isVal
                  ? `${fmtSigned(s.netValBil, 2)} Tỷ`
                  : `${fmtSigned(s.netVolMil, 2)} Tr CP`
              }
              delta={
                isVal
                  ? `KL ròng: ${fmtSigned(s.netVolMil, 2)} Tr CP · ${s.buyStocksCount} mua / ${s.sellStocksCount} bán`
                  : `GT ròng: ${fmtSigned(s.netValBil, 2)} Tỷ · ${s.buyStocksCount} mua / ${s.sellStocksCount} bán`
              }
              deltaPositive={s.netValBil > 0 ? true : s.netValBil < 0 ? false : null}
            />
            <MetricCard
              label={`Tổng Mua Khối Ngoại (${data.resolvedDateShort})`}
              value={isVal ? `${fmtNum(s.buyValBil, 2)} Tỷ` : `${fmtNum(s.buyVolMil, 2)} Tr CP`}
              delta={
                isVal
                  ? `KL mua: ${fmtNum(s.buyVolMil, 2)} Tr CP`
                  : `GT mua: ${fmtNum(s.buyValBil, 2)} Tỷ`
              }
              deltaPositive={true}
            />
            <MetricCard
              label={`Tổng Bán Khối Ngoại (${data.resolvedDateShort})`}
              value={isVal ? `${fmtNum(s.sellValBil, 2)} Tỷ` : `${fmtNum(s.sellVolMil, 2)} Tr CP`}
              delta={
                isVal
                  ? `KL bán: ${fmtNum(s.sellVolMil, 2)} Tr CP`
                  : `GT bán: ${fmtNum(s.sellValBil, 2)} Tỷ`
              }
              deltaPositive={false}
            />
            <MetricCard
              label="Lũy Kế 10 Phiên Gần Nhất"
              value={`${fmtSigned(s.cumNet10Bil, 1)} Tỷ`}
              delta={`5 phiên: ${fmtSigned(s.cumNet5Bil, 1)} Tỷ · 20 phiên: ${fmtSigned(
                s.cumNet20Bil,
                1
              )} Tỷ`}
              deltaPositive={s.cumNet10Bil > 0 ? true : s.cumNet10Bil < 0 ? false : null}
            />
          </div>

          {/* Chart 1: Multi-Session History */}
          {historyChart && (
            <div className="bg-white border border-slate-200 rounded-[10px] p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
                <h4 className="font-bold text-[14.5px] text-slate-900">
                  Diễn biến Mua/Bán ròng khối ngoại {data.history.length} phiên gần nhất —{' '}
                  {exchange === 'ALL' ? 'Toàn thị trường (3 sàn)' : exchange}
                </h4>
                <span className="text-[11.5px] text-slate-500">
                  Cột xanh: mua ròng · Cột đỏ: bán ròng · Đường xanh dương: lũy kế
                </span>
              </div>
              <PlotlyChart
                data={historyChart.traces}
                layout={historyChart.layout}
                height={340}
              />
            </div>
          )}

          {/* Row 2: Top 10 Net Buy/Sell Chart + SSI ICB Sector Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-[10px] p-2.5">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <h4 className="font-bold text-[14.5px] text-slate-900">
                  Top 10 Mua Ròng &amp; Top 10 Bán Ròng ({data.resolvedDateShort})
                </h4>
                <span className="text-[11.5px] text-slate-500">
                  Đơn vị: {isVal ? 'Tỷ VNĐ' : 'Triệu CP'}
                </span>
              </div>
              {topMoversChart ? (
                <PlotlyChart
                  data={topMoversChart.traces}
                  layout={topMoversChart.layout}
                  height={topMoversChart.height}
                />
              ) : (
                <p className="text-sm text-slate-500 p-4">Chưa có giao dịch khối ngoại trong phiên.</p>
              )}
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-[10px] p-2.5 flex flex-col">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <h4 className="font-bold text-[14.5px] text-slate-900">
                  Phân bổ Khối Ngoại Theo Ngành (SSI ICB)
                </h4>
                <span className="text-[11.5px] text-slate-500">
                  Bấm vào ngành để lọc bảng bên dưới
                </span>
              </div>
              <div className="overflow-auto max-h-[480px] flex-1">
                <table className="w-full text-[12.5px] border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr className="border-b border-slate-200 text-slate-600 text-left">
                      <th className="py-2 px-2">Ngành (SSI ICB)</th>
                      <th className="py-2 px-2 text-right">Mua (Tỷ)</th>
                      <th className="py-2 px-2 text-right">Bán (Tỷ)</th>
                      <th className="py-2 px-2 text-right">Ròng (Tỷ)</th>
                      <th className="py-2 px-2">Mã nổi bật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sectors.map((sec) => {
                      const selected = industryFilter === sec.industry;
                      return (
                        <tr
                          key={sec.industry}
                          onClick={() =>
                            setIndustryFilter(selected ? 'ALL' : sec.industry)
                          }
                          className={`border-b border-slate-100 cursor-pointer transition-colors ${
                            selected ? 'bg-sky-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-1.5 px-2 font-semibold text-slate-800">
                            {sec.industry}{' '}
                            <span className="text-[11px] font-normal text-slate-400">
                              ({sec.stockCount})
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">
                            {fmtNum(sec.buyValBil, 2)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">
                            {fmtNum(sec.sellValBil, 2)}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right tabular-nums ${colorSignedClass(
                              sec.netValBil
                            )}`}
                          >
                            {fmtSigned(sec.netValBil, 2)}
                          </td>
                          <td className="py-1.5 px-2 font-bold text-slate-900">
                            {sec.topSymbol}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Row 3: Searchable Detail Table */}
          <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-[14.5px] text-slate-900">
                  Chi Tiết Giao Dịch Khối Ngoại Theo Mã ({filteredStocks.length} mã)
                </h4>
                <div className="inline-flex rounded-md overflow-hidden border border-slate-300 text-[12px]">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['buy', 'Mua ròng'],
                      ['sell', 'Bán ròng'],
                    ] as const
                  ).map(([id, lbl], idx) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSideFilter(id)}
                      className={`px-2.5 py-1 font-bold cursor-pointer ${
                        idx > 0 ? 'border-l border-slate-300' : ''
                      } ${
                        sideFilter === id
                          ? 'bg-[#0284c7] text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={searchTxt}
                  onChange={(e) => setSearchTxt(e.target.value)}
                  placeholder="Tìm mã CP / ngành..."
                  className="h-[32px] px-2.5 text-[12.5px] border border-slate-300 rounded-md focus:outline-none focus:border-[#0284c7] w-44"
                />
                <select
                  value={industryFilter}
                  onChange={(e) => setIndustryFilter(e.target.value)}
                  className="h-[32px] px-2 text-[12.5px] border border-slate-300 rounded-md bg-white"
                >
                  <option value="ALL">Tất cả ngành</option>
                  {data.sectors.map((sec) => (
                    <option key={sec.industry} value={sec.industry}>
                      {sec.industry}
                    </option>
                  ))}
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="h-[32px] px-2 text-[12.5px] border border-slate-300 rounded-md bg-white"
                >
                  <option value="netDesc">Mua ròng mạnh nhất</option>
                  <option value="netAsc">Bán ròng mạnh nhất</option>
                  <option value="buyDesc">GT Mua lớn nhất</option>
                  <option value="sellDesc">GT Bán lớn nhất</option>
                </select>
                <SecondaryButton onClick={exportCsv} className="!py-1 !px-2.5 !text-[12px]">
                  💾 CSV
                </SecondaryButton>
              </div>
            </div>

            <div className="overflow-auto max-h-[460px]">
              <table className="w-full text-[12.5px] border-collapse">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-200 text-slate-600 text-right">
                    <th className="py-2 px-2 text-left">Mã</th>
                    <th className="py-2 px-2 text-left">Sàn</th>
                    <th className="py-2 px-2 text-left">Ngành (SSI ICB)</th>
                    <th className="py-2 px-2">Giá</th>
                    <th className="py-2 px-2">%</th>
                    <th className="py-2 px-2">KL Mua</th>
                    <th className="py-2 px-2">KL Bán</th>
                    <th className="py-2 px-2">GT Mua (Tỷ)</th>
                    <th className="py-2 px-2">GT Bán (Tỷ)</th>
                    <th className="py-2 px-2">GT Ròng (Tỷ)</th>
                    <th className="py-2 px-2">Room còn lại</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStocks.slice(0, 150).map((row) => (
                    <tr
                      key={row.symbol}
                      className="border-b border-slate-100 hover:bg-slate-50 tabular-nums text-right"
                    >
                      <td
                        className="py-1.5 px-2 text-left font-bold text-slate-900"
                        title={row.companyName}
                      >
                        {row.symbol}
                      </td>
                      <td className="py-1.5 px-2 text-left text-[11.5px] font-semibold text-[#0284c7]">
                        {row.exchange}
                      </td>
                      <td className="py-1.5 px-2 text-left text-slate-600 max-w-[180px] truncate">
                        {row.industry}
                      </td>
                      <td className="py-1.5 px-2 font-semibold text-slate-800">
                        {row.price > 0 ? fmtNum(row.price, 2) : '—'}
                      </td>
                      <td className={`py-1.5 px-2 ${colorSignedClass(row.pct)}`}>
                        {row.price > 0 ? fmtSigned(row.pct, 2, '%') : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-slate-700">{fmtInt(row.buyVol)}</td>
                      <td className="py-1.5 px-2 text-slate-700">{fmtInt(row.sellVol)}</td>
                      <td className="py-1.5 px-2 text-[#059669] font-medium">
                        {fmtNum(row.buyValBil, 2)}
                      </td>
                      <td className="py-1.5 px-2 text-[#dc2626] font-medium">
                        {fmtNum(row.sellValBil, 2)}
                      </td>
                      <td className={`py-1.5 px-2 ${colorSignedClass(row.netValBil)}`}>
                        {fmtSigned(row.netValBil, 2)}
                      </td>
                      <td className="py-1.5 px-2 text-slate-600">
                        {row.currentRoom > 0 ? fmtInt(row.currentRoom) : '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredStocks.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-6 text-center text-slate-500">
                        Không tìm thấy mã cổ phiếu phù hợp với bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
