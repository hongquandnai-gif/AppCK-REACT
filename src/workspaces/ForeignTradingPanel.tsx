import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { DateInput } from '../components/DateInput';
import { PlotlyChart } from '../components/PlotlyChart';
import {
  ErrorBanner,
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  SegmentedControl,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from '../components/UiPrimitives';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { useTheme } from '../context/ThemeContext';
import { patchForeignTradingWithTicks } from '../utils/livePatch';
import {
  colorSignedClass,
  downloadCsv,
  fmtDisplayDateOrTime,
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
  stockDate?: string;
  stockDateDisplay?: string;
  stockDateShort?: string;
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

const EXCHANGE_OPTIONS: Array<{ value: 'ALL' | 'HOSE' | 'HNX' | 'UPCOM'; label: string }> = [
  { value: 'HOSE', label: 'HOSE' },
  { value: 'HNX', label: 'HNX' },
  { value: 'UPCOM', label: 'UPCOM' },
  { value: 'ALL', label: '3 sàn' },
];

const WILDCARD_SUB = ['*'];

interface Props {
  isActive: boolean;
}

export const ForeignTradingPanel: React.FC<Props> = ({ isActive }) => {
  const { isDark } = useTheme();
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

  useSubscribeSymbols(WILDCARD_SUB, isActive && targetDate >= today && liveAuto);

  useEffect(() => {
    if (!isActive) return;
    loadForeign(false, false);
  }, [isActive, loadForeign]);

  useEffect(() => {
    if (!liveAuto || !isActive || targetDate < today) return;
    setData((prev) => patchForeignTradingWithTicks(prev, ticks));
  }, [tickVersion, ticks, liveAuto, isActive, targetDate, today]);

  const lastSyncRef = useRef(syncVersion.board);
  useEffect(() => {
    if (syncVersion.board === lastSyncRef.current) return;
    lastSyncRef.current = syncVersion.board;
    if (!liveAuto || !isActive || targetDate < today) return;
    loadForeign(false, true);
  }, [syncVersion.board, liveAuto, isActive, targetDate, today, loadForeign]);

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

    const lineAccent = isDark ? '#38bdf8' : '#0284c7';

    const traces: any[] = [
      {
        type: 'bar',
        name: `Mua/Bán ròng (${unit})`,
        x: xDates,
        y: netArr,
        hovertext: hoverTexts,
        hovertemplate: '%{hovertext}<extra></extra>',
        marker: { color: barColors, line: { width: 0 } },
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: `Lũy kế ${data.history.length} phiên (${unit})`,
        x: xDates,
        y: cumArr,
        line: { color: lineAccent, width: 2.2 },
        marker: { size: 5, color: lineAccent },
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
        font: { size: 12 },
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
        title: { text: `Lũy kế (${unit})`, font: { size: 11.5, color: lineAccent } },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        zeroline: false,
      },
    };

    return { traces, layout };
  }, [data, metric, exchange, sessions, targetDate, isDark]);

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

    const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
    const xPad = Number((maxAbs * 1.26).toFixed(2));

    return {
      traces: [
        {
          type: 'bar',
          orientation: 'h',
          x: vals,
          y: labels,
          text: texts,
          textposition: 'outside',
          cliponaxis: false,
          textfont: { size: 11, color: isDark ? '#cbd5e1' : '#334155' },
          hovertext: hovers,
          hoverinfo: 'text',
          marker: { color: colors, line: { width: 0 } },
        },
      ],
      layout: {
        uirevision: `foreign_top_${exchange}_${metric}_${targetDate}`,
        margin: { l: 58, r: 36, t: 10, b: 32 },
        showlegend: false,
        xaxis: {
          title: { text: `Giá trị ròng (${unit})`, font: { size: 11, color: '#64748b' } },
          range: [-xPad, xPad],
          showgrid: true,
          gridcolor: '#f1f5f9',
          zeroline: true,
          zerolinecolor: '#64748b',
          zerolinewidth: 1.2,
        },
        yaxis: {
          type: 'category',
          automargin: true,
          tickfont: { size: 11.5, color: isDark ? '#e2e8f0' : '#0f172a' },
        },
      },
      height: Math.max(380, combined.length * 23 + 60),
    };
  }, [data, metric, exchange, targetDate, isDark]);

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
    <div className="space-y-3.5">
      {/* Control Bar */}
      <SectionCard className="p-3.5 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-4">
            <div className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Sàn giao dịch
            </div>
            <SegmentedControl
              value={exchange}
              onChange={setExchange}
              options={EXCHANGE_OPTIONS}
            />
          </div>

          <div className="lg:col-span-3">
            <div className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Hiển thị theo
            </div>
            <SegmentedControl
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'val', label: 'Giá trị (Tỷ)' },
                { value: 'vol', label: 'KL (Triệu CP)' },
              ]}
            />
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
              <DateInput value={targetDate} onChange={setTargetDate} />
            </FieldLabel>
          </div>

          <div className="lg:col-span-1">
            <PrimaryButton
              onClick={() => loadForeign(true, false)}
              loading={loading}
              aria-label="Làm mới giao dịch nước ngoài"
              className="w-full"
            >
              {!loading && <RefreshCw className="w-4 h-4" />}
            </PrimaryButton>
          </div>
        </div>

        {/* Inline status & 3-exchange quick strip */}
        {data && s && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <strong className="text-slate-800 dark:text-slate-200">
                {exchange === 'ALL' ? 'Toàn thị trường (3 sàn)' : `Sàn ${exchange}`}
              </strong>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span>Phiên: {data.resolvedDateDisplay}</span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span>Nguồn: {data.source}</span>
              {data.isLiveWs && (
                <>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    SSI WS ({fmtDisplayDateOrTime(data.syncTime)})
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12px]">
              {(['HOSE', 'HNX', 'UPCOM'] as const).map((fl) => {
                const exStat = s.perExchange[fl];
                const net = isVal ? exStat.netValBil : exStat.netVolMil;
                return (
                  <span key={fl}>
                    <span className="font-sans text-slate-500 dark:text-slate-400">{fl}:</span>{' '}
                    <strong className={colorSignedClass(net)}>
                      {fmtSigned(net, isVal ? 1 : 2)} {isVal ? 'Tỷ' : 'Tr'}
                    </strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      {loading && !data && (
        <LoadingBar text="Đang tải dữ liệu giao dịch khối ngoại toàn thị trường..." />
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ErrorBanner message={error} className="flex-1" />
          <SecondaryButton onClick={() => loadForeign(true, false)}>Thử lại</SecondaryButton>
        </div>
      )}

      {data && s && (
        <>
          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label={`Mua / Bán Ròng (${data.resolvedDateShort})`}
              value={
                isVal
                  ? `${fmtSigned(s.netValBil, 2)} Tỷ`
                  : `${fmtSigned(s.netVolMil, 2)} Tr CP`
              }
              delta={
                isVal
                  ? `KL: ${fmtSigned(s.netVolMil, 2)} Tr CP · ${s.buyStocksCount} mua / ${s.sellStocksCount} bán`
                  : `GT: ${fmtSigned(s.netValBil, 2)} Tỷ · ${s.buyStocksCount} mua / ${s.sellStocksCount} bán`
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
              delta={`5P: ${fmtSigned(s.cumNet5Bil, 1)} Tỷ · 20P: ${fmtSigned(
                s.cumNet20Bil,
                1
              )} Tỷ`}
              deltaPositive={s.cumNet10Bil > 0 ? true : s.cumNet10Bil < 0 ? false : null}
            />
          </div>

          {/* Chart 1: Multi-Session History */}
          {historyChart && (
            <SectionCard className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                  Diễn biến Mua/Bán ròng khối ngoại {data.history.length} phiên gần nhất —{' '}
                  {exchange === 'ALL' ? 'Toàn thị trường (3 sàn)' : exchange}
                </h4>
                <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Cột xanh: mua ròng · Cột đỏ: bán ròng · Đường xanh: lũy kế
                </span>
              </div>
              <PlotlyChart
                data={historyChart.traces}
                layout={historyChart.layout}
                height={340}
              />
            </SectionCard>
          )}

          {/* Row 2: Top 10 Net Buy/Sell Chart + SSI ICB Sector Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            <SectionCard className="lg:col-span-6 p-3">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                  Top 10 Mua Ròng &amp; Top 10 Bán Ròng ({data.stockDateShort || data.resolvedDateShort})
                </h4>
                <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
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
                <p className="text-[13px] text-slate-500 dark:text-slate-400 p-4">
                  Chưa có giao dịch khối ngoại trong phiên.
                </p>
              )}
            </SectionCard>

            <SectionCard className="lg:col-span-6 p-3 flex flex-col">
              <div className="flex items-center justify-between gap-2 px-1 pb-2.5">
                <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                  Phân bổ Khối Ngoại Theo Ngành (SSI ICB)
                  {data.stockDate && data.stockDate !== data.resolvedDate && data.stockDateShort
                    ? ` (${data.stockDateShort})`
                    : ''}
                </h4>
                <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Chọn ngành để lọc bảng bên dưới
                </span>
              </div>
              <div className="overflow-auto max-h-[480px] flex-1">
                <table className="w-full text-[12.5px] border-collapse">
                  <thead className={tableHeadCls}>
                    <tr className="text-left">
                      <th className="py-2 px-2.5">Ngành (SSI ICB)</th>
                      <th className="py-2 px-2.5 text-right">Mua (Tỷ)</th>
                      <th className="py-2 px-2.5 text-right">Bán (Tỷ)</th>
                      <th className="py-2 px-2.5 text-right">Ròng (Tỷ)</th>
                      <th className="py-2 px-2.5">Mã nổi bật</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.sectors.map((sec) => {
                      const selected = industryFilter === sec.industry;
                      return (
                        <tr
                          key={sec.industry}
                          onClick={() =>
                            setIndustryFilter(selected ? 'ALL' : sec.industry)
                          }
                          className={`cursor-pointer transition-colors ${
                            selected
                              ? 'bg-sky-50 dark:bg-sky-950/50'
                              : tableRowCls
                          }`}
                        >
                          <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            {sec.industry}{' '}
                            <span className="text-[11px] font-mono font-normal text-slate-400 dark:text-slate-500">
                              ({sec.stockCount})
                            </span>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {fmtNum(sec.buyValBil, 2)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {fmtNum(sec.sellValBil, 2)}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                              sec.netValBil
                            )}`}
                          >
                            {fmtSigned(sec.netValBil, 2)}
                          </td>
                          <td className="py-2 px-2.5 font-bold font-mono text-slate-900 dark:text-slate-100">
                            {sec.topSymbol}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          {/* Row 3: Searchable Detail Table */}
          <SectionCard className="p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                  Chi Tiết Giao Dịch Khối Ngoại Theo Mã{' '}
                  <span className="font-mono font-medium text-slate-500 dark:text-slate-400 text-[13px]">
                    ({filteredStocks.length})
                  </span>
                </h4>
                <SegmentedControl
                  size="sm"
                  value={sideFilter}
                  onChange={setSideFilter}
                  options={[
                    { value: 'all', label: 'Tất cả' },
                    { value: 'buy', label: 'Mua ròng' },
                    { value: 'sell', label: 'Bán ròng' },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={searchTxt}
                    onChange={(e) => setSearchTxt(e.target.value)}
                    placeholder="Tìm mã CP / ngành..."
                    className={`${inputCls} !w-44 pl-8`}
                  />
                </div>
                <select
                  value={industryFilter}
                  onChange={(e) => setIndustryFilter(e.target.value)}
                  className={`${inputCls} !w-auto max-w-[200px]`}
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
                  className={`${inputCls} !w-auto`}
                >
                  <option value="netDesc">Mua ròng mạnh nhất</option>
                  <option value="netAsc">Bán ròng mạnh nhất</option>
                  <option value="buyDesc">GT Mua lớn nhất</option>
                  <option value="sellDesc">GT Bán lớn nhất</option>
                </select>
                <SecondaryButton onClick={exportCsv}>
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </SecondaryButton>
              </div>
            </div>

            <div className="overflow-auto max-h-[460px]">
              <table className="w-full text-[12.5px] border-collapse">
                <thead className={tableHeadCls}>
                  <tr className="text-right">
                    <th className="py-2.5 px-2.5 text-left">Mã</th>
                    <th className="py-2.5 px-2.5 text-left">Sàn</th>
                    <th className="py-2.5 px-2.5 text-left">Ngành (SSI ICB)</th>
                    <th className="py-2.5 px-2.5">Giá</th>
                    <th className="py-2.5 px-2.5">%</th>
                    <th className="py-2.5 px-2.5">KL Mua</th>
                    <th className="py-2.5 px-2.5">KL Bán</th>
                    <th className="py-2.5 px-2.5">GT Mua (Tỷ)</th>
                    <th className="py-2.5 px-2.5">GT Bán (Tỷ)</th>
                    <th className="py-2.5 px-2.5">GT Ròng (Tỷ)</th>
                    <th className="py-2.5 px-2.5">Room còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredStocks.slice(0, 150).map((row) => (
                    <tr
                      key={row.symbol}
                      className={`${tableRowCls} text-right font-mono tabular-nums`}
                    >
                      <td
                        className="py-2 px-2.5 text-left font-bold text-slate-900 dark:text-slate-100"
                        title={row.companyName}
                      >
                        {row.symbol}
                      </td>
                      <td className="py-2 px-2.5 text-left font-sans text-[11.5px] font-semibold text-sky-600 dark:text-sky-400">
                        {row.exchange}
                      </td>
                      <td className="py-2 px-2.5 text-left font-sans text-slate-600 dark:text-slate-400 max-w-[180px] truncate">
                        {row.industry}
                      </td>
                      <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                        {row.price > 0 ? fmtNum(row.price, 2) : '—'}
                      </td>
                      <td className={`py-2 px-2.5 ${colorSignedClass(row.pct)}`}>
                        {row.price > 0 ? fmtSigned(row.pct, 2, '%') : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300">
                        {fmtInt(row.buyVol)}
                      </td>
                      <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300">
                        {fmtInt(row.sellVol)}
                      </td>
                      <td className="py-2 px-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        {fmtNum(row.buyValBil, 2)}
                      </td>
                      <td className="py-2 px-2.5 text-red-600 dark:text-red-400 font-medium">
                        {fmtNum(row.sellValBil, 2)}
                      </td>
                      <td className={`py-2 px-2.5 ${colorSignedClass(row.netValBil)}`}>
                        {fmtSigned(row.netValBil, 2)}
                      </td>
                      <td className="py-2 px-2.5 text-slate-500 dark:text-slate-400">
                        {row.currentRoom > 0 ? fmtInt(row.currentRoom) : '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredStocks.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        className="py-6 text-center font-sans text-slate-500 dark:text-slate-400"
                      >
                        Không tìm thấy mã cổ phiếu phù hợp với bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};
