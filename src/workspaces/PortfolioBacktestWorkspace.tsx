import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FlaskConical,
  LineChart,
  ListOrdered,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Target,
  Trash2,
  Upload,
} from 'lucide-react';
import { HARDCODED_HOSE_INDUSTRIES_MAPPING, INDUSTRY_GROUPS } from '../shared/constants';
import { DateInput } from '../components/DateInput';
import { PlotlyChart } from '../components/PlotlyChart';
import { SymbolSearchInput } from '../components/SymbolSearchInput';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchPortfolioWithTicks } from '../utils/livePatch';
import {
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  SubTabs,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from '../components/UiPrimitives';
import type { StockCatalogItem } from '../types/catalog';
import {
  colorSignedClass,
  colorStatusClass,
  fmtInt,
  fmtIsoToDdMmYyyy,
  fmtNum,
  fmtSigned,
  fmtSignedInt,
  vnTodayIso,
} from '../utils/format';

interface Props {
  isActive?: boolean;
}

interface HoldingItem {
  symbol: string;
  buy_date: string;
  buy_price: number;
  qty: number;
  note: string;
}

const STORAGE_KEY = 'v11_pro_portfolio_holdings';

function loadHoldings(): HoldingItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const PortfolioBacktestWorkspace: React.FC<Props> = ({ isActive = true }) => {
  const { catalog, liveAuto, ticks, tickVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'portfolio' | 'backtest'>('portfolio');

  const stockItems = useMemo<StockCatalogItem[]>(() => {
    if (catalog?.list?.length) {
      return catalog.list.filter((item) => item.exchange !== 'INDEX');
    }
    return Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)
      .filter(([, ind]) => ind !== 'Chỉ số')
      .map(([symbol, industry]) => ({
        symbol,
        companyName: symbol,
        industry,
        exchange: 'HOSE' as const,
      }));
  }, [catalog]);

  // --- 5.1 Portfolio ---
  const [holdings, setHoldings] = useState<HoldingItem[]>(() => loadHoldings());
  const [cashVnd, setCashVnd] = useState(0);
  const [portEval, setPortEval] = useState<any>(null);
  const [portLoading, setPortLoading] = useState(false);
  const [portMsg, setPortMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [newSym, setNewSym] = useState('');
  const [newBdate, setNewBdate] = useState(today);
  const [newBpx, setNewBpx] = useState(0);
  const [newQty, setNewQty] = useState(100);
  const [newNote, setNewNote] = useState('');
  const [delIdx, setDelIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    } catch {
      // ignore storage quota errors
    }
  }, [holdings]);

  const evaluatePortfolio = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!holdings.length) {
        setPortEval(null);
        return;
      }
      if (!silent) setPortLoading(true);
      try {
        const resp = await fetch('/api/portfolio/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ holdings, cashVnd, refresh: forceRefresh }),
        });
        if (resp.ok) setPortEval(await resp.json());
      } finally {
        if (!silent) setPortLoading(false);
      }
    },
    [holdings, cashVnd]
  );

  const holdingSymbols = useMemo(
    () => holdings.map((h) => h.symbol.trim().toUpperCase()).filter(Boolean),
    [holdings]
  );

  useSubscribeSymbols(
    holdingSymbols,
    isActive && subTab === 'portfolio' && liveAuto && holdingSymbols.length > 0
  );

  useEffect(() => {
    if (subTab !== 'portfolio') return;
    evaluatePortfolio(false, false);
  }, [subTab, evaluatePortfolio]);

  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'portfolio' || !holdings.length) return;
    setPortEval((prev: any) => patchPortfolioWithTicks(prev, ticks, cashVnd));
  }, [tickVersion, ticks, cashVnd, liveAuto, isActive, subTab, holdings.length]);

  const handleAddPosition = () => {
    const sym = newSym.trim().toUpperCase();
    if (!sym || newQty <= 0) return;
    setHoldings((prev) => [
      ...prev,
      {
        symbol: sym,
        buy_date: newBdate,
        buy_price: Number(newBpx),
        qty: Math.round(newQty),
        note: newNote,
      },
    ]);
    setNewSym('');
    setNewBpx(0);
    setNewQty(100);
    setNewNote('');
  };

  const handleDeletePosition = () => {
    if (delIdx < 0 || delIdx >= holdings.length) return;
    setHoldings((prev) => prev.filter((_, idx) => idx !== delIdx));
    setDelIdx(0);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(holdings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const loaded = JSON.parse(text);
      if (Array.isArray(loaded)) {
        setHoldings(loaded);
        setPortMsg({ type: 'ok', text: 'Đã nhập danh mục thành công!' });
      } else {
        setPortMsg({ type: 'err', text: 'File JSON phải là danh sách (array) các vị thế.' });
      }
    } catch (err: any) {
      setPortMsg({ type: 'err', text: `File JSON không hợp lệ: ${err?.message || ''}` });
    }
    e.target.value = '';
  };

  // --- 5.2 Hybrid Backtest ---
  const sectorOptions = useMemo(() => {
    const raw = catalog?.industries?.length ? catalog.industries : INDUSTRY_GROUPS;
    return raw.filter((g) => g !== 'Chỉ số');
  }, [catalog]);
  const [btInd, setBtInd] = useState('Tất cả ngành');

  useEffect(() => {
    if (sectorOptions.length && !sectorOptions.includes(btInd)) {
      setBtInd(sectorOptions[0]);
    }
  }, [sectorOptions, btInd]);

  const [btCap, setBtCap] = useState(1_000_000_000);
  const [btStart, setBtStart] = useState('2024-10-17');
  const [btEnd, setBtEnd] = useState(today);
  const [btMaxPos, setBtMaxPos] = useState(5);
  const [btMaxSec, setBtMaxSec] = useState(2);
  const [btSl, setBtSl] = useState(7.0);
  const [btMaExit, setBtMaExit] = useState(20);
  const [btFee, setBtFee] = useState(0.15);
  const [btTplus, setBtTplus] = useState(2.5);

  const [btMode, setBtMode] = useState(1);
  const [btRs, setBtRs] = useState(70);
  const [btPivot, setBtPivot] = useState(5.0);
  const [btVolMult, setBtVolMult] = useState(1.2);
  const [btMinVol, setBtMinVol] = useState(1_000_000);
  const [btFsec, setBtFsec] = useState(false);
  const [btTopSec, setBtTopSec] = useState(5);
  const [btUseTp, setBtUseTp] = useState(false);
  const [btTp, setBtTp] = useState(25.0);
  const [btPp, setBtPp] = useState(true);

  const [btDdShield, setBtDdShield] = useState(true);
  const [btWdd, setBtWdd] = useState(1.0);
  const [btWstall, setBtWstall] = useState(0.7);
  const [btDdCancel, setBtDdCancel] = useState(5.0);
  const [btClimax, setBtClimax] = useState(true);
  const [btClimaxTh, setBtClimaxTh] = useState(80.0);
  const [btBotFish, setBtBotFish] = useState(true);
  const [btP200, setBtP200] = useState(20.0);
  const [btP52, setBtP52] = useState(70.0);

  const [btOpenShield, setBtOpenShield] = useState(false);
  const [btRes, setBtRes] = useState<any>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btTableTab, setBtTableTab] = useState<'trades' | 'closed' | 'snapshots'>('trades');

  const runBacktest = async () => {
    setBtLoading(true);
    try {
      const resp = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: btInd,
          initialCapital: btCap,
          startDate: btStart,
          endDate: btEnd,
          maxPositions: btMaxPos,
          maxPerSector: btMaxSec,
          stopLossPct: btSl,
          maExit: btMaExit,
          feePct: btFee,
          tPlus: btTplus,
          entryMode: btMode,
          minRs: btRs,
          maxPivotPct: btPivot,
          volMult: btVolMult,
          minVol: btMinVol,
          filterTopSectors: btFsec,
          topSectors: btTopSec,
          useTakeProfit: btUseTp,
          takeProfitPct: btTp,
          usePowerPlay: btPp,
          useDdShield: btDdShield,
          wDd: btWdd,
          wStall: btWstall,
          ddCancelPct: btDdCancel,
          useTopClimax: btClimax,
          climaxBreadthThresh: btClimaxTh,
          useBottomFishing: btBotFish,
          panicMa200Thresh: btP200,
          panicBot52Thresh: btP52,
        }),
      });
      if (resp.ok) setBtRes(await resp.json());
    } finally {
      setBtLoading(false);
    }
  };

  const equityPlot = useMemo(() => {
    const eq: any[] = btRes?.equity || [];
    if (!eq.length) return null;
    const x = eq.map((e) => e.label);
    let peak = -Infinity;
    const peakNav = eq.map((e) => {
      if (e.nav > peak) peak = e.nav;
      return peak;
    });

    const traces: any[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: peakNav,
        name: 'Đỉnh NAV',
        line: { color: 'rgba(239,68,68,0.2)', width: 0.5 },
        showlegend: false,
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: eq.map((e) => e.nav),
        name: 'Tổng NAV',
        fill: 'tonexty',
        fillcolor: 'rgba(239,68,68,0.12)',
        line: { color: '#0284c7', width: 2.2 },
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: eq.map((e) => e.exposure),
        name: '% Tỷ trọng CP',
        fill: 'tozeroy',
        fillcolor: 'rgba(16,185,129,0.22)',
        line: { color: '#10b981', width: 1.2 },
        yaxis: 'y2',
      },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: eq.map((e) => e.breadth200),
        name: '% > MA200',
        line: { color: '#f59e0b', dash: 'dash', width: 1.4 },
        yaxis: 'y2',
      },
    ];

    const panicX = eq.filter((e) => e.isPanic).map((e) => e.label);
    if (panicX.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: panicX,
        y: panicX.map(() => 10),
        name: 'Đáy Hoảng Loạn',
        marker: { color: '#ef4444', size: 6 },
        yaxis: 'y2',
      });
    }

    const climaxX = eq.filter((e) => e.isClimax).map((e) => e.label);
    if (climaxX.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: climaxX,
        y: climaxX.map(() => 90),
        name: 'Đỉnh Hưng Phấn',
        marker: { color: '#8b5cf6', size: 6 },
        yaxis: 'y2',
      });
    }

    return {
      data: traces,
      layout: {
        hovermode: 'x unified',
        margin: { l: 56, r: 16, t: 34, b: 30 },
        legend: { orientation: 'h', yanchor: 'bottom', y: 1.01, xanchor: 'left', x: 0 },
        xaxis: { type: 'category', nticks: 12, showgrid: true, gridcolor: '#f1f5f9' },
        yaxis: { domain: [0.35, 1.0], showgrid: true, gridcolor: '#e2e8f0' },
        yaxis2: { domain: [0, 0.3], showgrid: true, gridcolor: '#e2e8f0' },
      },
    };
  }, [btRes]);

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          {
            id: 'portfolio',
            label: 'Danh Mục Nắm Giữ',
            icon: <Briefcase className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'backtest',
            label: 'Backtest Chiến Lược Hybrid',
            icon: <FlaskConical className="w-3.5 h-3.5" strokeWidth={2} />,
          },
        ]}
      />

      {/* 5.1 PORTFOLIO */}
      {subTab === 'portfolio' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <FieldLabel label="Tiền mặt khả dụng (VNĐ)">
                  <input
                    type="number"
                    min={0}
                    step={10_000_000}
                    value={cashVnd}
                    onChange={(e) => setCashVnd(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJson}
                  className="hidden"
                />
                <SecondaryButton onClick={() => fileRef.current?.click()} className="w-full">
                  <Upload className="w-3.5 h-3.5" />
                  Nhập portfolio.json
                </SecondaryButton>
              </div>
              <div className="md:col-span-2">
                <SecondaryButton onClick={handleExportJson} className="w-full">
                  <Download className="w-3.5 h-3.5" />
                  Xuất JSON
                </SecondaryButton>
              </div>
              <div className="md:col-span-3">
                <PrimaryButton
                  onClick={() => evaluatePortfolio(true, false)}
                  loading={portLoading}
                  className="w-full"
                >
                  {!portLoading && <RefreshCw className="w-3.5 h-3.5" />}
                  Làm mới giá
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          {portMsg && (
            <div
              className={`px-3.5 py-2.5 rounded-xl text-[13px] border ${
                portMsg.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/35 border-red-200 dark:border-red-900/60 text-red-900 dark:text-red-200'
              }`}
            >
              {portMsg.text}
            </div>
          )}

          <SectionCard>
            <button
              type="button"
              onClick={() => setShowEditor((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                Thêm / Xóa vị thế danh mục
              </span>
              {showEditor ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
            {showEditor && (
              <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-12 gap-2.5 items-end">
                  <div className="md:col-span-2">
                    <FieldLabel label="Mã CP (3 sàn)">
                      <SymbolSearchInput
                        value={newSym}
                        onSelect={(s) => setNewSym(s)}
                        onChangeQuery={(s) => setNewSym(s)}
                        items={stockItems}
                        placeholder="VD: FPT, CEO..."
                      />
                    </FieldLabel>
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel label="Ngày mua">
                      <DateInput value={newBdate} onChange={setNewBdate} />
                    </FieldLabel>
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel label="Giá mua (nghìn)">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={newBpx}
                        onChange={(e) => setNewBpx(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel label="Khối lượng">
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={newQty}
                        onChange={(e) => setNewQty(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel label="Ghi chú">
                      <input
                        type="text"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        className={inputCls}
                      />
                    </FieldLabel>
                  </div>
                  <div className="md:col-span-2">
                    <PrimaryButton onClick={handleAddPosition} className="w-full">
                      <Plus className="w-3.5 h-3.5" />
                      Thêm
                    </PrimaryButton>
                  </div>
                </div>

                {holdings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end pt-2.5 border-t border-slate-100 dark:border-slate-800">
                    <div className="md:col-span-9">
                      <FieldLabel label="Chọn vị thế cần xóa">
                        <select
                          value={delIdx}
                          onChange={(e) => setDelIdx(Number(e.target.value))}
                          className={inputCls}
                        >
                          {holdings.map((h, i) => (
                            <option key={`${h.symbol}_${i}`} value={i}>
                              #{i}: {h.symbol} ({fmtInt(h.qty)} CP @ {h.buy_price})
                            </option>
                          ))}
                        </select>
                      </FieldLabel>
                    </div>
                    <div className="md:col-span-3">
                      <SecondaryButton
                        onClick={handleDeletePosition}
                        className="w-full !text-red-600 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-950/35"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Xóa vị thế
                      </SecondaryButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {!holdings.length ? (
            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400 text-[13px] text-center">
              Danh mục đang trống. Nhấn{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                Thêm / Xóa vị thế danh mục
              </strong>{' '}
              hoặc nhập file{' '}
              <code className="font-mono text-sky-600 dark:text-sky-400">portfolio.json</code>.
            </div>
          ) : (
            portEval && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <MetricCard
                    label="Tổng Lãi / Lỗ"
                    value={`${fmtInt(portEval.kpis.totalPl)} đ`}
                    delta={fmtSigned(portEval.kpis.totalPlPct, 2, '%')}
                    deltaPositive={
                      portEval.kpis.totalPl > 0 ? true : portEval.kpis.totalPl < 0 ? false : null
                    }
                  />
                  <MetricCard
                    label="Biến Động Hôm Nay"
                    value={`${fmtSignedInt(portEval.kpis.todayPl)} đ`}
                    deltaPositive={
                      portEval.kpis.todayPl > 0 ? true : portEval.kpis.todayPl < 0 ? false : null
                    }
                  />
                  <MetricCard
                    label="Giá Trị Cổ Phiếu"
                    value={`${fmtInt(portEval.kpis.stockVal)} đ`}
                  />
                  <MetricCard
                    label="Tổng NAV (Gồm Tiền Mặt)"
                    value={`${fmtInt(portEval.kpis.nav)} đ`}
                  />
                </div>

                <SectionCard className="p-2 overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead className={tableHeadCls}>
                      <tr className="text-left">
                        <th className="py-2.5 px-2.5">Mã</th>
                        <th className="py-2.5 px-2.5">Ngày mua</th>
                        <th className="py-2.5 px-2.5 text-right">Giá mua</th>
                        <th className="py-2.5 px-2.5 text-right">KL</th>
                        <th className="py-2.5 px-2.5 text-right">Số phiên</th>
                        <th className="py-2.5 px-2.5 text-right">Giá hiện tại</th>
                        <th className="py-2.5 px-2.5 text-right">Lãi/Lỗ (VNĐ)</th>
                        <th className="py-2.5 px-2.5 text-right">% Lãi/Lỗ</th>
                        <th className="py-2.5 px-2.5 text-right">Hôm nay (VNĐ)</th>
                        <th className="py-2.5 px-2.5 text-right">Tỷ trọng (%)</th>
                        <th className="py-2.5 px-2.5">Khuyến nghị</th>
                        <th className="py-2.5 px-2.5">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {portEval.rows.map((r: any, idx: number) => (
                        <tr key={`${r.symbol}_${idx}`} className={tableRowCls}>
                          <td className="py-2 px-2.5 font-bold font-mono text-slate-900 dark:text-slate-100">
                            {r.symbol}
                          </td>
                          <td className="py-2 px-2.5 font-mono text-slate-500 dark:text-slate-400">
                            {fmtIsoToDdMmYyyy(r.buyDate)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {fmtNum(r.buyPrice, 2)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {fmtInt(r.qty)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {r.daysHeld}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {fmtNum(r.currentPrice, 2)}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                              r.plVnd
                            )}`}
                          >
                            {fmtSignedInt(r.plVnd)}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                              r.plPct
                            )}`}
                          >
                            {fmtSigned(r.plPct, 2, '%')}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                              r.todayPl
                            )}`}
                          >
                            {fmtSignedInt(r.todayPl)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {fmtNum(r.weightPct, 2)}%
                          </td>
                          <td className={`py-2 px-2.5 ${colorStatusClass(r.reco)}`}>{r.reco}</td>
                          <td className="py-2 px-2.5 text-slate-500 dark:text-slate-400">
                            {r.note}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              </div>
            )
          )}
        </div>
      )}

      {/* 5.2 HYBRID BACKTEST */}
      {subTab === 'backtest' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Config column */}
          <div className="lg:col-span-4 space-y-3">
            <SectionCard className="p-3.5 space-y-2.5">
              <div className="inline-flex items-center gap-2 font-bold text-[13.5px] text-slate-900 dark:text-slate-100">
                <Briefcase className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                1. Vốn &amp; Quản Trị Danh Mục
              </div>
              <FieldLabel label="Vũ trụ cổ phiếu">
                <select
                  value={btInd}
                  onChange={(e) => setBtInd(e.target.value)}
                  className={inputCls}
                >
                  {sectorOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Vốn ban đầu (VNĐ)">
                <input
                  type="number"
                  min={10_000_000}
                  step={100_000_000}
                  value={btCap}
                  onChange={(e) => setBtCap(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="Từ ngày">
                  <DateInput value={btStart} onChange={setBtStart} />
                </FieldLabel>
                <FieldLabel label="Đến ngày">
                  <DateInput value={btEnd} onChange={setBtEnd} />
                </FieldLabel>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="Số mã max">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={btMaxPos}
                    onChange={(e) => setBtMaxPos(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Max/Ngành">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={btMaxSec}
                    onChange={(e) => setBtMaxSec(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Cắt lỗ (%)">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={0.5}
                    value={btSl}
                    onChange={(e) => setBtSl(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="MA chặn">
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={btMaExit}
                    onChange={(e) => setBtMaExit(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Phí+Thuế (%)">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    value={btFee}
                    onChange={(e) => setBtFee(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Chu kỳ T+">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={btTplus}
                    onChange={(e) => setBtTplus(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
            </SectionCard>

            <SectionCard className="p-3.5 space-y-2.5">
              <div className="inline-flex items-center gap-2 font-bold text-[13.5px] text-slate-900 dark:text-slate-100">
                <Target className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                2. Điểm Mua Minervini &amp; VCP
              </div>
              <FieldLabel label="Chế độ điểm mua">
                <select
                  value={btMode}
                  onChange={(e) => setBtMode(Number(e.target.value))}
                  className={inputCls}
                >
                  <option value={0}>1. Chuẩn VCP Pivot (2T-4T)</option>
                  <option value={1}>2. VCP hoặc Breakout 20P</option>
                  <option value={2}>3. Mọi mã Stage 2 + Nổ Vol</option>
                </select>
              </FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="RS Min">
                  <input
                    type="number"
                    min={50}
                    max={99}
                    value={btRs}
                    onChange={(e) => setBtRs(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Biên Pivot (%)">
                  <input
                    type="number"
                    min={1}
                    max={15}
                    step={0.5}
                    value={btPivot}
                    onChange={(e) => setBtPivot(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Hệ số Vol">
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.1}
                    value={btVolMult}
                    onChange={(e) => setBtVolMult(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
                <FieldLabel label="Min Vol">
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    value={btMinVol}
                    onChange={(e) => setBtMinVol(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btFsec}
                  onChange={(e) => setBtFsec(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                Chỉ mua Top ngành
              </label>
              {btFsec && (
                <FieldLabel label="Số ngành Top">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={btTopSec}
                    onChange={(e) => setBtTopSec(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              )}
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btUseTp}
                  onChange={(e) => setBtUseTp(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                Chốt lời chủ động
              </label>
              {btUseTp && (
                <FieldLabel label="Mức chốt lời (%)">
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={btTp}
                    onChange={(e) => setBtTp(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              )}
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btPp}
                  onChange={(e) => setBtPp(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                Power Play (Giữ MA50 khi lãi ≥ 20%)
              </label>
            </SectionCard>

            <SectionCard>
              <button
                type="button"
                onClick={() => setBtOpenShield((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-3 font-bold text-[13.5px] text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <Shield className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  3. Lá Chắn Phân Phối &amp; Đỉnh/Đáy
                </span>
                {btOpenShield ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {btOpenShield && (
                <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={btDdShield}
                      onChange={(e) => setBtDdShield(e.target.checked)}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    Bật Lá chắn Phân phối
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldLabel label="Trọng số PP">
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.1}
                        value={btWdd}
                        onChange={(e) => setBtWdd(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                    <FieldLabel label="Stalling">
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.1}
                        value={btWstall}
                        onChange={(e) => setBtWstall(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                  </div>
                  <FieldLabel label="Xóa DD khi hồi (%)">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      step={0.5}
                      value={btDdCancel}
                      onChange={(e) => setBtDdCancel(Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldLabel>
                  <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={btClimax}
                      onChange={(e) => setBtClimax(e.target.checked)}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    Bán Đỉnh Hưng Phấn
                  </label>
                  <FieldLabel label="Ngưỡng >MA200 (%)">
                    <input
                      type="number"
                      min={50}
                      max={99}
                      value={btClimaxTh}
                      disabled={!btClimax}
                      onChange={(e) => setBtClimaxTh(Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldLabel>
                  <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={btBotFish}
                      onChange={(e) => setBtBotFish(e.target.checked)}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    Bắt Đáy Hoảng Loạn
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldLabel label="MA200 < (%)">
                      <input
                        type="number"
                        min={5}
                        max={40}
                        value={btP200}
                        disabled={!btBotFish}
                        onChange={(e) => setBtP200(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                    <FieldLabel label="Đáy 52T > (%)">
                      <input
                        type="number"
                        min={10}
                        max={90}
                        value={btP52}
                        disabled={!btBotFish}
                        onChange={(e) => setBtP52(Number(e.target.value))}
                        className={inputCls}
                      />
                    </FieldLabel>
                  </div>
                </div>
              )}
            </SectionCard>

            <PrimaryButton onClick={runBacktest} loading={btLoading} className="w-full !h-10 text-[13.5px]">
              {!btLoading && <Play className="w-4 h-4 fill-current" />}
              Chạy Backtest Hybrid
            </PrimaryButton>
          </div>

          {/* Result column */}
          <div className="lg:col-span-8 space-y-3.5">
            {btLoading && (
              <LoadingBar text="Đang tải dữ liệu lịch sử toàn sàn từ SSI và chạy mô phỏng chiến lược Hybrid..." />
            )}

            {btRes && !btRes.empty && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  <MetricCard
                    label="Lãi / Lỗ Ròng"
                    value={`${fmtSigned(btRes.stats.profit / 1e6, 1)} Tr`}
                    deltaPositive={btRes.stats.profit > 0 ? true : btRes.stats.profit < 0 ? false : null}
                  />
                  <MetricCard
                    label="% Tổng Lãi"
                    value={fmtSigned(btRes.stats.profitPct, 2, '%')}
                    deltaPositive={
                      btRes.stats.profitPct > 0 ? true : btRes.stats.profitPct < 0 ? false : null
                    }
                  />
                  <MetricCard
                    label="CAGR / Năm"
                    value={fmtSigned(btRes.stats.cagr, 2, '%')}
                  />
                  <MetricCard
                    label="Tỷ Lệ Thắng"
                    value={`${fmtNum(btRes.stats.winRate, 1)}%`}
                    delta={`${btRes.stats.totalTrades} lệnh`}
                  />
                  <MetricCard
                    label="Tài Sản Cuối"
                    value={`${fmtNum(btRes.stats.final / 1e9, 2)} Tỷ`}
                  />
                  <MetricCard
                    label="Max Drawdown"
                    value={`${fmtNum(btRes.stats.maxDd, 2)}%`}
                  />
                </div>

                {equityPlot && (
                  <SectionCard className="p-2.5">
                    <PlotlyChart data={equityPlot.data} layout={equityPlot.layout} height={470} />
                  </SectionCard>
                )}

                <div>
                  <SubTabs
                    active={btTableTab}
                    onChange={(id) => setBtTableTab(id as any)}
                    tabs={[
                      {
                        id: 'trades',
                        label: `Sổ Lệnh Chi Tiết (${btRes.trades.length})`,
                        icon: <ListOrdered className="w-3.5 h-3.5" strokeWidth={2} />,
                      },
                      {
                        id: 'closed',
                        label: `Deal Đã Đóng (${btRes.closed.length})`,
                        icon: <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />,
                      },
                      {
                        id: 'snapshots',
                        label: `Lịch Sử Tài Sản (${btRes.snapshots.length})`,
                        icon: <LineChart className="w-3.5 h-3.5" strokeWidth={2} />,
                      },
                    ]}
                  />

                  <SectionCard className="p-2 overflow-auto max-h-[520px]">
                    {btTableTab === 'trades' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className={tableHeadCls}>
                          <tr className="text-left">
                            <th className="py-2 px-2">Ngày</th>
                            <th className="py-2 px-2">Mã</th>
                            <th className="py-2 px-2">Lệnh</th>
                            <th className="py-2 px-2 text-right">Giá</th>
                            <th className="py-2 px-2 text-right">KL</th>
                            <th className="py-2 px-2 text-right">Lãi/Lỗ</th>
                            <th className="py-2 px-2">Ghi chú</th>
                            <th className="py-2 px-2">Lý do</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {btRes.trades.map((t: any, i: number) => (
                            <tr key={i} className={tableRowCls}>
                              <td className="py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400">
                                {t.date}
                              </td>
                              <td className="py-1.5 px-2 font-bold font-mono text-slate-900 dark:text-slate-100">
                                {t.symbol}
                              </td>
                              <td className={`py-1.5 px-2 ${colorStatusClass(t.side)}`}>
                                {t.side}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                {fmtNum(t.price, 2)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtInt(t.qty)}
                              </td>
                              <td
                                className={`py-1.5 px-2 text-right font-mono tabular-nums ${colorSignedClass(
                                  t.pnl
                                )}`}
                              >
                                {fmtSignedInt(t.pnl)}
                              </td>
                              <td className="py-1.5 px-2 text-slate-500 dark:text-slate-400">
                                {t.note}
                              </td>
                              <td className="py-1.5 px-2 text-slate-600 dark:text-slate-300">
                                {t.reason}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {btTableTab === 'closed' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className={tableHeadCls}>
                          <tr className="text-left">
                            <th className="py-2 px-2">Mã</th>
                            <th className="py-2 px-2">Ngày Mua</th>
                            <th className="py-2 px-2">Ngày Bán</th>
                            <th className="py-2 px-2 text-right">Giá Mua</th>
                            <th className="py-2 px-2 text-right">Giá Bán</th>
                            <th className="py-2 px-2 text-right">KL</th>
                            <th className="py-2 px-2 text-right">Lãi/Lỗ</th>
                            <th className="py-2 px-2 text-right">% Lãi/Lỗ</th>
                            <th className="py-2 px-2">Lý do</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {btRes.closed.map((c: any, i: number) => (
                            <tr key={i} className={tableRowCls}>
                              <td className="py-1.5 px-2 font-bold font-mono text-slate-900 dark:text-slate-100">
                                {c.symbol}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400">
                                {fmtIsoToDdMmYyyy(c.buyDate)}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400">
                                {fmtIsoToDdMmYyyy(c.sellDate)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                {fmtNum(c.buyPrice, 2)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                {fmtNum(c.sellPrice, 2)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtInt(c.qty)}
                              </td>
                              <td
                                className={`py-1.5 px-2 text-right font-mono tabular-nums ${colorSignedClass(
                                  c.pnl
                                )}`}
                              >
                                {fmtSignedInt(c.pnl)}
                              </td>
                              <td
                                className={`py-1.5 px-2 text-right font-mono tabular-nums ${colorSignedClass(
                                  c.pnlPct
                                )}`}
                              >
                                {fmtSigned(c.pnlPct, 2, '%')}
                              </td>
                              <td className="py-1.5 px-2 text-slate-600 dark:text-slate-300">
                                {c.reason}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {btTableTab === 'snapshots' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className={tableHeadCls}>
                          <tr className="text-left">
                            <th className="py-2 px-2">Ngày</th>
                            <th className="py-2 px-2 text-right">Tổng NAV</th>
                            <th className="py-2 px-2 text-right">Tiền Mặt</th>
                            <th className="py-2 px-2 text-right">Tiền Chờ Về</th>
                            <th className="py-2 px-2 text-right">Giá Trị CP</th>
                            <th className="py-2 px-2 text-right">Risk Score</th>
                            <th className="py-2 px-2 text-right">% &gt; MA200</th>
                            <th className="py-2 px-2">Danh Mục Nắm Giữ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {btRes.snapshots.map((s: any, i: number) => (
                            <tr key={i} className={tableRowCls}>
                              <td className="py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400">
                                {s.date}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                                {fmtInt(s.totalNav)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtInt(s.cash)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtInt(s.pendingCash)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtInt(s.stockVal)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtNum(s.riskScore, 1)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {fmtNum(s.pctAboveMa200, 1)}%
                              </td>
                              <td className="py-1.5 px-2 font-mono text-slate-600 dark:text-slate-300">
                                {s.holdings || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </SectionCard>
                </div>
              </>
            )}

            {!btRes && !btLoading && (
              <SectionCard className="p-8 text-center text-slate-500 dark:text-slate-400 text-[13.5px]">
                Cấu hình tham số ở cột bên trái và nhấn{' '}
                <strong className="text-slate-900 dark:text-slate-100">Chạy Backtest Hybrid</strong>{' '}
                để bắt đầu mô phỏng.
              </SectionCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
