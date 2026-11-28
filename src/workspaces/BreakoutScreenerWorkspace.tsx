import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Radar,
  Search,
  TrendingUp,
  Trophy,
  Waves,
  Zap,
} from 'lucide-react';
import { INDUSTRY_GROUPS } from '../shared/constants';
import { DateInput } from '../components/DateInput';
import { DynamicOhlcChart } from '../components/DynamicOhlcChart';
import { PlotlyChart } from '../components/PlotlyChart';
import { RadarEodPanel } from '../components/RadarEodPanel';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchOhlcBarsWithTick, patchStockRowsWithTicks } from '../utils/livePatch';
import {
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SectionCard,
  SubTabs,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from '../components/UiPrimitives';
import {
  addDaysIso,
  colorRsClass,
  colorSignedClass,
  colorStatusClass,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface Props {
  isActive?: boolean;
}

export const BreakoutScreenerWorkspace: React.FC<Props> = ({ isActive = true }) => {
  const { catalog, ticks, tickVersion, liveAuto } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'radar' | 'minervini' | 'gainers'>('radar');
  const industryOptions = useMemo(() => {
    const raw = catalog?.industries?.length ? catalog.industries : INDUSTRY_GROUPS;
    return raw.filter((g) => g !== 'Chỉ số');
  }, [catalog]);

  // --- 3.2 Minervini & VCP Pro ---
  const [minStart, setMinStart] = useState(() => addDaysIso(today, -365));
  const [minEnd, setMinEnd] = useState(today);
  const [minRs, setMinRs] = useState(70);
  const [minRes, setMinRes] = useState<any>(null);
  const [minLoading, setMinLoading] = useState(false);
  const [minSubTab, setMinSubTab] = useState<'stocks' | 'diag' | 'breadth'>('stocks');
  const [diagSym, setDiagSym] = useState<string>('');

  const runMinervini = async () => {
    setMinLoading(true);
    try {
      const resp = await fetch('/api/minervini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: minStart, endDate: minEnd, minRs }),
      });
      if (resp.ok) {
        const json = await resp.json();
        setMinRes(json);
        const def = json.screened?.[0]?.symbol || json.allSymbols?.[0] || '';
        setDiagSym(def);
      }
    } finally {
      setMinLoading(false);
    }
  };

  const activeDiag = useMemo(() => {
    if (!minRes?.diagnostics || !diagSym) return null;
    const base = minRes.diagnostics[diagSym];
    if (!base) return null;
    const tick = liveAuto ? ticks[base.symbol] : undefined;
    if (!tick || !base.chartBars?.length) return base;
    const patchedBars = patchOhlcBarsWithTick(base.chartBars, tick, false);
    if (patchedBars === base.chartBars) return base;
    return {
      ...base,
      close: tick.last,
      chartBars: patchedBars,
    };
  }, [minRes, diagSym, liveAuto, ticks]);

  const activeScreenerSymbols = useMemo(() => {
    if (subTab === 'minervini') {
      const syms: string[] = [];
      if (minRes?.screened?.length) {
        for (const s of minRes.screened) syms.push(String(s.symbol || ''));
      }
      if (diagSym) syms.push(diagSym);
      return syms.filter(Boolean);
    }
    return [];
  }, [subTab, minRes, diagSym]);

  useSubscribeSymbols(
    activeScreenerSymbols,
    isActive && liveAuto && activeScreenerSymbols.length > 0
  );

  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'minervini') return;
    setMinRes((prev: any) => {
      if (!prev?.screened?.length) return prev;
      const nextScreened = patchStockRowsWithTicks(prev.screened, ticks);
      return nextScreened === prev.screened ? prev : { ...prev, screened: nextScreened };
    });
  }, [tickVersion, ticks, liveAuto, isActive, subTab]);

  const breadthPlot = useMemo(() => {
    const br: any[] = minRes?.breadth || [];
    if (!br.length) return null;
    const x = br.map((b) => b.label);
    return {
      data: [
        {
          type: 'scatter',
          mode: 'lines',
          x,
          y: br.map((b) => b.avgPrice),
          name: 'Giá TB HOSE',
          line: { color: '#0284c7', width: 2 },
          yaxis: 'y',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x,
          y: br.map((b) => b.pctAboveMa200),
          name: '% > MA200',
          line: { color: '#f59e0b', width: 1.8 },
          yaxis: 'y2',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x,
          y: br.map((b) => b.pctBottoming),
          name: '% Dò đáy 52T',
          line: { color: '#8b5cf6', dash: 'dot' },
          yaxis: 'y2',
        },
      ],
      layout: {
        hovermode: 'x unified',
        margin: { l: 48, r: 48, t: 36, b: 30 },
        legend: { orientation: 'h', yanchor: 'bottom', y: 1.01, xanchor: 'left', x: 0 },
        xaxis: { type: 'category', nticks: 12, showgrid: true, gridcolor: '#f1f5f9' },
        yaxis: { showgrid: true, gridcolor: '#e2e8f0', title: { text: 'Giá TB' } },
        yaxis2: {
          overlaying: 'y',
          side: 'right',
          showgrid: false,
          title: { text: '%' },
        },
        shapes: [
          {
            type: 'line',
            xref: 'paper',
            x0: 0,
            x1: 1,
            yref: 'y2',
            y0: 20,
            y1: 20,
            line: { dash: 'dash', color: '#ef4444', width: 1.2 },
          },
          {
            type: 'line',
            xref: 'paper',
            x0: 0,
            x1: 1,
            yref: 'y2',
            y0: 50,
            y1: 50,
            line: { dash: 'dash', color: '#94a3b8', width: 1.2 },
          },
        ],
      },
    };
  }, [minRes]);

  // --- 3.3 Top Gainers ---
  const [gExchange, setGExchange] = useState<'HOSE' | 'HNX' | 'UPCOM' | 'ALL'>('HOSE');
  const [gStart, setGStart] = useState(() => addDaysIso(today, -30));
  const [gEnd, setGEnd] = useState(today);
  const [gInd, setGInd] = useState('Tất cả ngành');
  const [gTop, setGTop] = useState(10);
  const [gRank, setGRank] = useState<'combo' | 'change' | 'low'>('combo');
  const [gainersRaw, setGainersRaw] = useState<any[]>([]);
  const [gainersLoading, setGainersLoading] = useState(false);

  useEffect(() => {
    if (industryOptions.length && !industryOptions.includes(gInd)) {
      setGInd(industryOptions[0]);
    }
  }, [industryOptions, gInd]);

  const runGainers = async () => {
    setGainersLoading(true);
    try {
      const resp = await fetch('/api/gainers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: gExchange,
          startDate: gStart,
          endDate: gEnd,
          industry: gInd,
        }),
      });
      if (resp.ok) {
        const json = await resp.json();
        setGainersRaw(json.rows || []);
      }
    } finally {
      setGainersLoading(false);
    }
  };

  const gainersSorted = useMemo(() => {
    const arr = [...gainersRaw];
    if (gRank === 'change') arr.sort((a, b) => b.pctChange - a.pctChange);
    else if (gRank === 'low') arr.sort((a, b) => b.pctFromLow - a.pctFromLow);
    else arr.sort((a, b) => b.pctFromLow + b.pctFromHigh - (a.pctFromLow + a.pctFromHigh));
    return arr.slice(0, gTop);
  }, [gainersRaw, gRank, gTop]);

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          {
            id: 'radar',
            label: 'Radar Xếp Hạng EOD (FTD)',
            icon: <Radar className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'minervini',
            label: 'Minervini & VCP Pro',
            icon: <Zap className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'gainers',
            label: 'Lọc CP Tăng Mạnh',
            icon: <TrendingUp className="w-3.5 h-3.5" strokeWidth={2} />,
          },
        ]}
      />

      {/* 3.1 RADAR EOD */}
      {subTab === 'radar' && <RadarEodPanel isActive={isActive && subTab === 'radar'} />}

      {/* 3.2 MINERVINI & VCP PRO */}
      {subTab === 'minervini' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <FieldLabel label="Từ ngày">
                  <DateInput value={minStart} onChange={setMinStart} />
                </FieldLabel>
              </div>
              <div className="md:col-span-3">
                <FieldLabel label="Đến ngày">
                  <DateInput value={minEnd} onChange={setMinEnd} />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="RS Min">
                  <input
                    type="number"
                    min={50}
                    max={99}
                    value={minRs}
                    onChange={(e) => setMinRs(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-4">
                <PrimaryButton onClick={runMinervini} loading={minLoading} className="w-full">
                  {!minLoading && <Zap className="w-4 h-4" />}
                  Quét Siêu Cổ Phiếu Minervini
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          {minLoading && (
            <LoadingBar text="Đang tải dữ liệu và tính RS Rating toàn sàn HOSE..." />
          )}

          {minRes && (
            <div className="space-y-3.5">
              {minRes.breadth?.length > 0 && (() => {
                const lb = minRes.breadth[minRes.breadth.length - 1];
                const p200 = lb.pctAboveMa200;
                const pbot = lb.pctBottoming;
                if (p200 >= 50) {
                  return (
                    <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 text-[13px]">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        <strong>UPTREND XÁC NHẬN</strong> ({fmtNum(p200, 1)}% cổ phiếu &gt; MA200)
                      </span>
                    </div>
                  );
                }
                if (p200 <= 20) {
                  return (
                    <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50/90 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 text-red-900 dark:text-red-200 text-[13px]">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      <span>
                        <strong>VÙNG HOẢNG LOẠN / DÒ ĐÁY</strong> ({fmtNum(p200, 1)}% &gt; MA200 ·{' '}
                        {fmtNum(pbot, 1)}% sát đáy 52T)
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-[13px]">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      <strong>THỊ TRƯỜNG PHÂN HÓA</strong> ({fmtNum(p200, 1)}% &gt; MA200)
                    </span>
                  </div>
                );
              })()}

              <SubTabs
                active={minSubTab}
                onChange={(id) => setMinSubTab(id as any)}
                tabs={[
                  {
                    id: 'stocks',
                    label: `Siêu Cổ Phiếu (${minRes.screened.length})`,
                    icon: <Trophy className="w-3.5 h-3.5" strokeWidth={2} />,
                  },
                  {
                    id: 'diag',
                    label: 'Chẩn Đoán Chu Kỳ & VCP',
                    icon: <Search className="w-3.5 h-3.5" strokeWidth={2} />,
                  },
                  {
                    id: 'breadth',
                    label: 'Độ Rộng Thị Trường',
                    icon: <Waves className="w-3.5 h-3.5" strokeWidth={2} />,
                  },
                ]}
              />

              {minSubTab === 'stocks' && (
                <SectionCard className="p-2 overflow-x-auto">
                  {minRes.screened.length > 0 ? (
                    <table className="w-full text-[13px] border-collapse">
                      <thead className={tableHeadCls}>
                        <tr className="text-left">
                          <th className="py-2.5 px-3">Mã CP</th>
                          <th className="py-2.5 px-3">Ngành</th>
                          <th className="py-2.5 px-3 text-right">Giá</th>
                          <th className="py-2.5 px-3 text-right">RS Rating</th>
                          <th className="py-2.5 px-3">Chu Kỳ</th>
                          <th className="py-2.5 px-3 text-right">% Đỉnh 52T</th>
                          <th className="py-2.5 px-3">Mô Hình VCP</th>
                          <th className="py-2.5 px-3 text-right">Pivot</th>
                          <th className="py-2.5 px-3">Trạng Thái Pivot</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {minRes.screened.map((r: any) => (
                          <tr
                            key={r.symbol}
                            onClick={() => {
                              setDiagSym(r.symbol);
                              setMinSubTab('diag');
                            }}
                            className="hover:bg-sky-50/70 dark:hover:bg-sky-950/35 cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-3 font-bold font-mono text-sky-600 dark:text-sky-400">
                              {r.symbol}
                            </td>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                              {r.industry}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                              {fmtNum(r.price, 2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${colorRsClass(
                                r.rsRating
                              )}`}
                            >
                              {r.rsRating}
                            </td>
                            <td className={`py-2 px-3 ${colorStatusClass(r.phase)}`}>{r.phase}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                              {fmtSigned(r.pctFromPeak, 1, '%')}
                            </td>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                              {r.vcpPattern}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                              {r.pivot !== null ? fmtNum(r.pivot, 2) : '—'}
                            </td>
                            <td className={`py-2 px-3 ${colorStatusClass(r.pivotStatus)}`}>
                              {r.pivotStatus}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-5 text-center text-[13px] text-slate-500 dark:text-slate-400">
                      Không có mã nào thỏa mãn toàn bộ 8 tiêu chí Trend Template ở thời điểm này.
                    </div>
                  )}
                </SectionCard>
              )}

              {minSubTab === 'diag' && minRes.allSymbols?.length > 0 && (
                <div className="space-y-3.5">
                  <div className="max-w-xs">
                    <FieldLabel label="Chọn cổ phiếu kiểm tra">
                      <select
                        value={diagSym}
                        onChange={(e) => setDiagSym(e.target.value)}
                        className={inputCls}
                      >
                        {minRes.allSymbols.map((s: string) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </FieldLabel>
                  </div>

                  {activeDiag && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      <div className="lg:col-span-4 space-y-3">
                        <SectionCard className="p-3.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: activeDiag.phaseColor }}
                            />
                            <div
                              className="font-bold text-[14.5px]"
                              style={{ color: activeDiag.phaseColor }}
                            >
                              {activeDiag.phaseTitle}
                            </div>
                          </div>
                          <div className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
                            {activeDiag.phaseDesc}
                          </div>
                        </SectionCard>

                        {activeDiag.vcp && (
                          <div className="p-3.5 bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-[13px] text-emerald-950 dark:text-emerald-200 space-y-1.5">
                            <div>
                              <strong>VCP {activeDiag.vcp.num_contractions}T:</strong>{' '}
                              <span className="font-mono">
                                {activeDiag.vcp.ranges.map((x: number) => `${x}%`).join(' → ')}
                              </span>
                            </div>
                            <div>
                              <strong>Pivot:</strong>{' '}
                              <code className="bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded font-mono font-bold text-emerald-700 dark:text-emerald-300">
                                {fmtNum(activeDiag.vcp.buy_point, 2)}
                              </code>{' '}
                              ({activeDiag.vcp.status})
                            </div>
                          </div>
                        )}

                        <SectionCard className="p-3.5 text-[13px] space-y-2">
                          <div className="inline-flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100 mb-1">
                            <ClipboardCheck className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                            Minervini Trend Template
                          </div>
                          {[
                            { lbl: 'MA50', val: activeDiag.ma50 },
                            { lbl: 'MA150', val: activeDiag.ma150 },
                            { lbl: 'MA200', val: activeDiag.ma200 },
                          ].map((row) => {
                            const above = Boolean(row.val && activeDiag.close > row.val);
                            return (
                              <div
                                key={row.lbl}
                                className="flex items-center justify-between text-slate-600 dark:text-slate-300"
                              >
                                <span>
                                  Giá vs {row.lbl}{' '}
                                  <span className="font-mono text-slate-500 dark:text-slate-400">
                                    ({fmtNum(row.val, 2)})
                                  </span>
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1.5 font-semibold ${
                                    above
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      above ? 'bg-emerald-500' : 'bg-red-500'
                                    }`}
                                  />
                                  {above ? 'Trên' : 'Dưới'}
                                </span>
                              </div>
                            );
                          })}
                          <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Đỉnh 52T</span>
                            <span className="font-mono tabular-nums">
                              <strong className="text-slate-900 dark:text-slate-100">
                                {fmtNum(activeDiag.peak52w, 2)}
                              </strong>{' '}
                              ({fmtSigned(activeDiag.pctFromPeak, 1, '%')})
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Đáy 52T</span>
                            <span className="font-mono tabular-nums">
                              <strong className="text-slate-900 dark:text-slate-100">
                                {fmtNum(activeDiag.bottom52w, 2)}
                              </strong>{' '}
                              ({fmtSigned(activeDiag.pctFromBottom, 1, '%')})
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <strong>RS Rating</strong>
                            <span className={`font-mono ${colorRsClass(activeDiag.rsRating)}`}>
                              {activeDiag.rsRating} / 99
                            </span>
                          </div>
                        </SectionCard>
                      </div>

                      <div className="lg:col-span-8">
                        <DynamicOhlcChart
                          symbol={activeDiag.symbol}
                          bars={activeDiag.chartBars.map((b: any) => ({
                            dtDisplay: b.date.split('-').reverse().join('/'),
                            label: b.label,
                            open: b.open,
                            high: b.high,
                            low: b.low,
                            close: b.close,
                            volume: b.volume,
                            prevClose: b.prevClose,
                            mas: { MA50: b.ma50, MA150: b.ma150, MA200: b.ma200 },
                          }))}
                          maInfo={[
                            { key: 'MA50', label: 'MA50', color: '#f97316' },
                            { key: 'MA150', label: 'MA150', color: '#8b5cf6' },
                            { key: 'MA200', label: 'MA200', color: '#ef4444' },
                          ]}
                          showVolume={false}
                          hlines={
                            activeDiag.vcp
                              ? [
                                  {
                                    y: activeDiag.vcp.buy_point,
                                    color: '#7c3aed',
                                    dash: 'dot',
                                    label: `Pivot: ${fmtNum(activeDiag.vcp.buy_point, 2)}`,
                                  },
                                ]
                              : []
                          }
                          height={420}
                          uirevision={`vcp_${activeDiag.symbol}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {minSubTab === 'breadth' && minRes.breadth?.length > 0 && (() => {
                const lb = minRes.breadth[minRes.breadth.length - 1];
                return (
                  <div className="space-y-3.5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MetricCard label="Giá TB HOSE" value={fmtNum(lb.avgPrice, 1)} />
                      <MetricCard
                        label="Độ Rộng (> MA200)"
                        value={`${fmtNum(lb.pctAboveMa200, 1)}%`}
                      />
                      <MetricCard
                        label="% Sát Đáy 52T"
                        value={`${fmtNum(lb.pctBottoming, 1)}%`}
                      />
                      <MetricCard
                        label="Sụt Giảm Từ Đỉnh"
                        value={`-${fmtNum(minRes.stats.pctDrop, 1)}%`}
                      />
                    </div>
                    {breadthPlot && (
                      <SectionCard className="p-2.5">
                        <PlotlyChart
                          data={breadthPlot.data}
                          layout={breadthPlot.layout}
                          height={420}
                        />
                      </SectionCard>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* 3.3 TOP GAINERS */}
      {subTab === 'gainers' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <FieldLabel label="Sàn">
                  <select
                    value={gExchange}
                    onChange={(e) =>
                      setGExchange(e.target.value as 'HOSE' | 'HNX' | 'UPCOM' | 'ALL')
                    }
                    className={inputCls}
                  >
                    <option value="HOSE">HOSE</option>
                    <option value="HNX">HNX</option>
                    <option value="UPCOM">UPCOM</option>
                    <option value="ALL">Tất cả 3 sàn</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Từ ngày">
                  <DateInput value={gStart} onChange={setGStart} />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Đến ngày">
                  <DateInput value={gEnd} onChange={setGEnd} />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Nhóm ngành">
                  <select
                    value={gInd}
                    onChange={(e) => setGInd(e.target.value)}
                    className={inputCls}
                  >
                    {industryOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-1">
                <FieldLabel label="Top">
                  <select
                    value={gTop}
                    onChange={(e) => setGTop(Number(e.target.value))}
                    className={inputCls}
                  >
                    {[10, 15, 20, 30, 50].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-1">
                <FieldLabel label="Xếp hạng">
                  <select
                    value={gRank}
                    onChange={(e) => setGRank(e.target.value as any)}
                    className={inputCls}
                  >
                    <option value="combo">Kết hợp</option>
                    <option value="change">% Đổi</option>
                    <option value="low">% Hồi</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <PrimaryButton onClick={runGainers} loading={gainersLoading} className="w-full">
                  {!gainersLoading && <TrendingUp className="w-4 h-4" />}
                  Lọc Cổ Phiếu
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          {gainersLoading && <LoadingBar text="Đang tải dữ liệu lọc cổ phiếu tăng mạnh..." />}

          {gainersSorted.length > 0 && (
            <SectionCard className="p-2 overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead className={tableHeadCls}>
                  <tr className="text-left">
                    <th className="py-2.5 px-3">Mã CP</th>
                    <th className="py-2.5 px-3">Sàn</th>
                    <th className="py-2.5 px-3">Nhóm Ngành</th>
                    <th className="py-2.5 px-3 text-right">% Thay Đổi</th>
                    <th className="py-2.5 px-3 text-right">% Tăng từ Đáy</th>
                    <th className="py-2.5 px-3 text-right">% Giảm từ Đỉnh</th>
                    <th className="py-2.5 px-3 text-right">Biên Độ (H/L)</th>
                    <th className="py-2.5 px-3 text-right">Ngày đạt đỉnh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {gainersSorted.map((r) => (
                    <tr key={r.symbol} className={tableRowCls}>
                      <td className="py-2 px-3 font-bold font-mono text-slate-900 dark:text-slate-100">
                        {r.symbol}
                      </td>
                      <td className="py-2 px-3 text-[12px] font-semibold text-sky-600 dark:text-sky-400">
                        {r.exchange || 'HOSE'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{r.industry}</td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${colorSignedClass(
                          r.pctChange
                        )}`}
                      >
                        {fmtSigned(r.pctChange, 2, '%')}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${colorSignedClass(
                          r.pctFromLow
                        )}`}
                      >
                        {fmtSigned(r.pctFromLow, 2, '%')}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${colorSignedClass(
                          r.pctFromHigh
                        )}`}
                      >
                        {fmtSigned(r.pctFromHigh, 2, '%')}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-violet-600 dark:text-violet-400 font-semibold">
                        {fmtNum(r.amplitude, 2)}%
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {r.peakDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
};
