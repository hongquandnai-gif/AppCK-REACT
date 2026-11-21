import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HARDCODED_HOSE_INDUSTRIES_MAPPING, INDUSTRY_GROUPS } from '../shared/constants';
import { PlotlyChart } from '../components/PlotlyChart';
import { SymbolSearchInput } from '../components/SymbolSearchInput';
import {
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SecondaryButton,
  SubTabs,
  inputCls,
} from '../components/UiPrimitives';
import type { StockCatalogItem, StockCatalogResponse } from '../types/catalog';
import {
  colorSignedClass,
  colorStatusClass,
  fmtInt,
  fmtNum,
  fmtSigned,
  fmtSignedInt,
  vnTodayIso,
} from '../utils/format';

interface Props {
  liveAuto: boolean;
  catalog: StockCatalogResponse | null;
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

export const PortfolioBacktestWorkspace: React.FC<Props> = ({ liveAuto, catalog }) => {
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

  useEffect(() => {
    if (subTab !== 'portfolio') return;
    evaluatePortfolio(false, false);
    if (liveAuto && holdings.length > 0) {
      const id = setInterval(() => evaluatePortfolio(false, true), 5000);
      return () => clearInterval(id);
    }
  }, [subTab, liveAuto, holdings.length, evaluatePortfolio]);

  const handleAddPosition = () => {
    const sym = newSym.trim().toUpperCase();
    if (!sym || newQty <= 0) return;
    setHoldings((prev) => [
      ...prev,
      { symbol: sym, buy_date: newBdate, buy_price: Number(newBpx), qty: Math.round(newQty), note: newNote },
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
  const sectorOptions = useMemo(() => INDUSTRY_GROUPS.filter((g) => g !== 'Chỉ số'), []);
  const [btInd, setBtInd] = useState(sectorOptions[0]);
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
          { id: 'portfolio', label: '📘 Danh Mục Nắm Giữ' },
          { id: 'backtest', label: '🧪 Backtest Chiến Lược Hybrid' },
        ]}
      />

      {/* 5.1 PORTFOLIO */}
      {subTab === 'portfolio' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
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
                📂 Nhập portfolio.json
              </SecondaryButton>
            </div>
            <div className="md:col-span-2">
              <SecondaryButton onClick={handleExportJson} className="w-full">
                💾 Xuất JSON
              </SecondaryButton>
            </div>
            <div className="md:col-span-3">
              <PrimaryButton
                onClick={() => evaluatePortfolio(true, false)}
                loading={portLoading}
                className="w-full"
              >
                🔄 Làm mới giá
              </PrimaryButton>
            </div>
          </div>

          {portMsg && (
            <div
              className={`px-3.5 py-2 rounded-lg text-[13px] border ${
                portMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {portMsg.text}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-[10px]">
            <button
              type="button"
              onClick={() => setShowEditor((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left text-[13.5px] font-bold text-slate-800 hover:bg-slate-50 rounded-[10px] cursor-pointer"
            >
              <span>➕ Thêm / Xóa vị thế danh mục</span>
              <span className="text-slate-400">{showEditor ? '▲' : '▼'}</span>
            </button>
            {showEditor && (
              <div className="p-3 border-t border-slate-200 space-y-3">
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
                      <input
                        type="date"
                        value={newBdate}
                        onChange={(e) => setNewBdate(e.target.value)}
                        className={inputCls}
                      />
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
                      ➕ Thêm
                    </PrimaryButton>
                  </div>
                </div>

                {holdings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end pt-2 border-t border-slate-100">
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
                      <SecondaryButton onClick={handleDeletePosition} className="w-full text-red-700">
                        🗑️ Xóa vị thế
                      </SecondaryButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {!holdings.length ? (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-sm">
              Danh mục đang trống. Nhấn &apos;➕ Thêm / Xóa vị thế danh mục&apos; hoặc nhập file{' '}
              <code>portfolio.json</code>.
            </div>
          ) : (
            portEval && (
              <div className="space-y-3">
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

                <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                        <th className="py-2 px-2.5">Mã</th>
                        <th className="py-2 px-2.5">Ngày mua</th>
                        <th className="py-2 px-2.5 text-right">Giá mua</th>
                        <th className="py-2 px-2.5 text-right">KL</th>
                        <th className="py-2 px-2.5 text-right">Số phiên</th>
                        <th className="py-2 px-2.5 text-right">Giá hiện tại</th>
                        <th className="py-2 px-2.5 text-right">Lãi/Lỗ (VNĐ)</th>
                        <th className="py-2 px-2.5 text-right">% Lãi/Lỗ</th>
                        <th className="py-2 px-2.5 text-right">Hôm nay (VNĐ)</th>
                        <th className="py-2 px-2.5 text-right">Tỷ trọng (%)</th>
                        <th className="py-2 px-2.5">Khuyến nghị tự động</th>
                        <th className="py-2 px-2.5">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portEval.rows.map((r: any, idx: number) => (
                        <tr key={`${r.symbol}_${idx}`} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-bold text-slate-900">{r.symbol}</td>
                          <td className="py-2 px-2.5 text-slate-600">{r.buyDate}</td>
                          <td className="py-2 px-2.5 text-right tabular-nums">{fmtNum(r.buyPrice, 2)}</td>
                          <td className="py-2 px-2.5 text-right tabular-nums">{fmtInt(r.qty)}</td>
                          <td className="py-2 px-2.5 text-right tabular-nums">{r.daysHeld}</td>
                          <td className="py-2 px-2.5 text-right tabular-nums font-semibold">
                            {fmtNum(r.currentPrice, 2)}
                          </td>
                          <td className={`py-2 px-2.5 text-right tabular-nums ${colorSignedClass(r.plVnd)}`}>
                            {fmtSignedInt(r.plVnd)}
                          </td>
                          <td className={`py-2 px-2.5 text-right tabular-nums ${colorSignedClass(r.plPct)}`}>
                            {fmtSigned(r.plPct, 2, '%')}
                          </td>
                          <td className={`py-2 px-2.5 text-right tabular-nums ${colorSignedClass(r.todayPl)}`}>
                            {fmtSignedInt(r.todayPl)}
                          </td>
                          <td className="py-2 px-2.5 text-right tabular-nums">{fmtNum(r.weightPct, 2)}%</td>
                          <td className={`py-2 px-2.5 ${colorStatusClass(r.reco)}`}>{r.reco}</td>
                          <td className="py-2 px-2.5 text-slate-600">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
            <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-2.5">
              <div className="font-bold text-[13.5px] text-slate-900">💼 1. Vốn &amp; Quản Trị Danh Mục</div>
              <FieldLabel label="Vũ trụ cổ phiếu">
                <select value={btInd} onChange={(e) => setBtInd(e.target.value)} className={inputCls}>
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
                  <input type="date" value={btStart} onChange={(e) => setBtStart(e.target.value)} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Đến ngày">
                  <input type="date" value={btEnd} onChange={(e) => setBtEnd(e.target.value)} className={inputCls} />
                </FieldLabel>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="Số mã max">
                  <input type="number" min={1} max={20} value={btMaxPos} onChange={(e) => setBtMaxPos(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Max/Ngành">
                  <input type="number" min={1} max={10} value={btMaxSec} onChange={(e) => setBtMaxSec(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Cắt lỗ (%)">
                  <input type="number" min={1} max={30} step={0.5} value={btSl} onChange={(e) => setBtSl(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="MA chặn">
                  <input type="number" min={5} max={200} value={btMaExit} onChange={(e) => setBtMaExit(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Phí+Thuế (%)">
                  <input type="number" min={0} max={5} step={0.05} value={btFee} onChange={(e) => setBtFee(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Chu kỳ T+">
                  <input type="number" min={0} max={5} step={0.5} value={btTplus} onChange={(e) => setBtTplus(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-2.5">
              <div className="font-bold text-[13.5px] text-slate-900">🎯 2. Điểm Mua Minervini &amp; VCP</div>
              <FieldLabel label="Chế độ điểm mua">
                <select value={btMode} onChange={(e) => setBtMode(Number(e.target.value))} className={inputCls}>
                  <option value={0}>1. Chuẩn VCP Pivot (2T-4T)</option>
                  <option value={1}>2. VCP hoặc Breakout 20P</option>
                  <option value={2}>3. Mọi mã Stage 2 + Nổ Vol</option>
                </select>
              </FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="RS Min">
                  <input type="number" min={50} max={99} value={btRs} onChange={(e) => setBtRs(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Biên Pivot (%)">
                  <input type="number" min={1} max={15} step={0.5} value={btPivot} onChange={(e) => setBtPivot(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Hệ số Vol">
                  <input type="number" min={0.5} max={5} step={0.1} value={btVolMult} onChange={(e) => setBtVolMult(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="Min Vol">
                  <input type="number" min={0} step={100000} value={btMinVol} onChange={(e) => setBtMinVol(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={btFsec} onChange={(e) => setBtFsec(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                Chỉ mua Top ngành
              </label>
              {btFsec && (
                <FieldLabel label="Số ngành Top">
                  <input type="number" min={1} max={20} value={btTopSec} onChange={(e) => setBtTopSec(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
              )}
              <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={btUseTp} onChange={(e) => setBtUseTp(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                Chốt lời chủ động
              </label>
              {btUseTp && (
                <FieldLabel label="Mức chốt lời (%)">
                  <input type="number" min={5} max={200} value={btTp} onChange={(e) => setBtTp(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
              )}
              <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={btPp} onChange={(e) => setBtPp(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                Power Play (Giữ MA50 khi lãi ≥ 20%)
              </label>
            </div>

            <div className="bg-white border border-slate-200 rounded-[10px]">
              <button
                type="button"
                onClick={() => setBtOpenShield((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 font-bold text-[13.5px] text-slate-900 cursor-pointer"
              >
                <span>🛡️ 3. Lá Chắn Phân Phối &amp; Đỉnh/Đáy</span>
                <span className="text-slate-400">{btOpenShield ? '▲' : '▼'}</span>
              </button>
              {btOpenShield && (
                <div className="p-3 border-t border-slate-200 space-y-2.5">
                  <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={btDdShield} onChange={(e) => setBtDdShield(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                    Bật Lá chắn Phân phối
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldLabel label="Trọng số PP">
                      <input type="number" min={0.1} max={5} step={0.1} value={btWdd} onChange={(e) => setBtWdd(Number(e.target.value))} className={inputCls} />
                    </FieldLabel>
                    <FieldLabel label="Stalling">
                      <input type="number" min={0.1} max={5} step={0.1} value={btWstall} onChange={(e) => setBtWstall(Number(e.target.value))} className={inputCls} />
                    </FieldLabel>
                  </div>
                  <FieldLabel label="Xóa DD khi hồi (%)">
                    <input type="number" min={1} max={20} step={0.5} value={btDdCancel} onChange={(e) => setBtDdCancel(Number(e.target.value))} className={inputCls} />
                  </FieldLabel>
                  <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={btClimax} onChange={(e) => setBtClimax(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                    Bán Đỉnh Hưng Phấn
                  </label>
                  <FieldLabel label="Ngưỡng >MA200 (%)">
                    <input type="number" min={50} max={99} value={btClimaxTh} disabled={!btClimax} onChange={(e) => setBtClimaxTh(Number(e.target.value))} className={inputCls} />
                  </FieldLabel>
                  <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={btBotFish} onChange={(e) => setBtBotFish(e.target.checked)} className="w-4 h-4 accent-[#0284c7]" />
                    Bắt Đáy Hoảng Loạn
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <FieldLabel label="MA200 < (%)">
                      <input type="number" min={5} max={40} value={btP200} disabled={!btBotFish} onChange={(e) => setBtP200(Number(e.target.value))} className={inputCls} />
                    </FieldLabel>
                    <FieldLabel label="Đáy 52T > (%)">
                      <input type="number" min={10} max={90} value={btP52} disabled={!btBotFish} onChange={(e) => setBtP52(Number(e.target.value))} className={inputCls} />
                    </FieldLabel>
                  </div>
                </div>
              )}
            </div>

            <PrimaryButton onClick={runBacktest} loading={btLoading} className="w-full py-2.5 text-[14px]">
              🚀 CHẠY BACKTEST HYBRID
            </PrimaryButton>
          </div>

          {/* Result column */}
          <div className="lg:col-span-8 space-y-3">
            {btLoading && (
              <LoadingBar text="Đang tải dữ liệu lịch sử toàn sàn từ SSI và chạy mô phỏng chiến lược Hybrid..." />
            )}

            {btRes && !btRes.empty && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  <MetricCard
                    label="Lãi / Lỗ Ròng"
                    value={`${fmtSigned(btRes.stats.profit / 1e6, 1)} Tr`}
                  />
                  <MetricCard
                    label="% Tổng Lãi"
                    value={fmtSigned(btRes.stats.profitPct, 2, '%')}
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
                  <div className="bg-white border border-slate-200 rounded-[10px] p-2">
                    <PlotlyChart data={equityPlot.data} layout={equityPlot.layout} height={470} />
                  </div>
                )}

                <div>
                  <SubTabs
                    active={btTableTab}
                    onChange={(id) => setBtTableTab(id as any)}
                    tabs={[
                      { id: 'trades', label: `📝 Sổ Lệnh Chi Tiết (${btRes.trades.length})` },
                      { id: 'closed', label: `✅ Deal Đã Đóng (${btRes.closed.length})` },
                      { id: 'snapshots', label: `📊 Lịch Sử Tài Sản (${btRes.snapshots.length})` },
                    ]}
                  />

                  <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-auto max-h-[520px]">
                    {btTableTab === 'trades' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="border-b border-slate-200 text-left text-slate-600">
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
                        <tbody>
                          {btRes.trades.map((t: any, i: number) => (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-1.5 px-2">{t.date}</td>
                              <td className="py-1.5 px-2 font-bold">{t.symbol}</td>
                              <td className={`py-1.5 px-2 ${colorStatusClass(t.side)}`}>{t.side}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(t.price, 2)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(t.qty)}</td>
                              <td className={`py-1.5 px-2 text-right tabular-nums ${colorSignedClass(t.pnl)}`}>
                                {fmtSignedInt(t.pnl)}
                              </td>
                              <td className="py-1.5 px-2 text-slate-600">{t.note}</td>
                              <td className="py-1.5 px-2 text-slate-700">{t.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {btTableTab === 'closed' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="border-b border-slate-200 text-left text-slate-600">
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
                        <tbody>
                          {btRes.closed.map((c: any, i: number) => (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-1.5 px-2 font-bold">{c.symbol}</td>
                              <td className="py-1.5 px-2">{c.buyDate}</td>
                              <td className="py-1.5 px-2">{c.sellDate}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(c.buyPrice, 2)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(c.sellPrice, 2)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(c.qty)}</td>
                              <td className={`py-1.5 px-2 text-right tabular-nums ${colorSignedClass(c.pnl)}`}>
                                {fmtSignedInt(c.pnl)}
                              </td>
                              <td className={`py-1.5 px-2 text-right tabular-nums ${colorSignedClass(c.pnlPct)}`}>
                                {fmtSigned(c.pnlPct, 2, '%')}
                              </td>
                              <td className="py-1.5 px-2 text-slate-700">{c.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {btTableTab === 'snapshots' && (
                      <table className="w-full text-[12.5px] border-collapse">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="border-b border-slate-200 text-left text-slate-600">
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
                        <tbody>
                          {btRes.snapshots.map((s: any, i: number) => (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-1.5 px-2">{s.date}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                                {fmtInt(s.totalNav)}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(s.cash)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(s.pendingCash)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(s.stockVal)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(s.riskScore, 1)}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                {fmtNum(s.pctAboveMa200, 1)}%
                              </td>
                              <td className="py-1.5 px-2 text-slate-700">{s.holdings || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}

            {!btRes && !btLoading && (
              <div className="bg-white border border-slate-200 rounded-[10px] p-8 text-center text-slate-500 text-sm">
                Cấu hình tham số ở cột bên trái và nhấn <strong>🚀 CHẠY BACKTEST HYBRID</strong> để bắt đầu mô phỏng.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
