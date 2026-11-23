import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_MAIN_INDICES,
  HARDCODED_HOSE_INDUSTRIES_MAPPING,
  INDUSTRY_GROUPS,
  MA_COLORS,
} from '../shared/constants';
import { DynamicOhlcChart } from '../components/DynamicOhlcChart';
import { SymbolSearchInput } from '../components/SymbolSearchInput';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchOhlcBarsWithTick } from '../utils/livePatch';
import {
  FieldLabel,
  LoadingBar,
  PrimaryButton,
  SecondaryButton,
  SubTabs,
  inputCls,
} from '../components/UiPrimitives';
import type { StockCatalogItem } from '../types/catalog';
import {
  addDaysIso,
  colorSignedClass,
  fmtInt,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface Props {
  isActive?: boolean;
}

const FALLBACK_MA_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

export const ChartAnalysisWorkspace: React.FC<Props> = ({ isActive = true }) => {
  const { catalog, liveAuto, ticks, tickVersion, syncVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'eod' | 'intraday'>('eod');

  const allCatalogItems = useMemo<StockCatalogItem[]>(() => {
    if (catalog?.list?.length) return catalog.list;
    const fallback: StockCatalogItem[] = ALL_MAIN_INDICES.map((s) => ({
      symbol: s,
      companyName: `Chỉ số ${s}`,
      industry: 'Chỉ số',
      exchange: 'INDEX',
      isIndex: true,
    }));
    for (const [sym, ind] of Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)) {
      if (ind === 'Chỉ số') continue;
      fallback.push({
        symbol: sym,
        companyName: sym,
        industry: ind,
        exchange: 'HOSE',
      });
    }
    return fallback;
  }, [catalog]);

  const industryOptions = useMemo(
    () => (catalog?.industries?.length ? catalog.industries : INDUSTRY_GROUPS),
    [catalog]
  );

  // --- 4.1 EOD Technical Chart ---
  const [exchangeSel, setExchangeSel] = useState<'ALL' | 'HOSE' | 'HNX' | 'UPCOM' | 'INDEX'>('ALL');
  const [indSel, setIndSel] = useState('Tất cả ngành');
  const [symSel, setSymSel] = useState('FPT');

  const filteredEodItems = useMemo(() => {
    return allCatalogItems.filter((item) => {
      if (exchangeSel !== 'ALL' && item.exchange !== exchangeSel) return false;
      if (indSel === 'Chỉ số') return item.exchange === 'INDEX';
      if (indSel !== 'Tất cả ngành') return item.industry === indSel;
      return true;
    });
  }, [allCatalogItems, exchangeSel, indSel]);

  const [hStart, setHStart] = useState(() => addDaysIso(today, -365));
  const [hEnd, setHEnd] = useState(today);
  const [hTf, setHTf] = useState<'D' | 'W' | 'M'>('D');
  const [maSel, setMaSel] = useState<number[]>([10, 20, 50]);
  const [customMaTxt, setCustomMaTxt] = useState('');
  const [showMaVol, setShowMaVol] = useState(true);
  const [showAth, setShowAth] = useState(true);

  const activeMas = useMemo(() => {
    const set = new Set<number>(maSel);
    if (customMaTxt.trim()) {
      for (const part of customMaTxt.split(/[,;\s]+/)) {
        const n = Number(part);
        if (Number.isInteger(n) && n > 1 && n < 500) set.add(n);
      }
    }
    return [...set].sort((a, b) => a - b);
  }, [maSel, customMaTxt]);

  const [eodData, setEodData] = useState<any>(null);
  const [eodLoading, setEodLoading] = useState(false);
  const [eodError, setEodError] = useState<string | null>(null);

  const loadEod = useCallback(
    async (silent = false) => {
      const sym = symSel.trim().toUpperCase();
      if (!sym) return;
      if (!silent) {
        setEodLoading(true);
        setEodError(null);
      }
      try {
        const q = new URLSearchParams({
          symbol: sym,
          start: hStart,
          end: hEnd,
          tf: hTf,
          mas: activeMas.join(','),
        });
        const resp = await fetch(`/api/chart/eod?${q.toString()}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        setEodData(await resp.json());
        setEodError(null);
      } catch (err: any) {
        if (!silent) {
          setEodError(err?.message || 'Không thể tải dữ liệu biểu đồ');
        }
      } finally {
        if (!silent) setEodLoading(false);
      }
    },
    [symSel, hStart, hEnd, hTf, activeMas]
  );

  const eodSubSyms = useMemo(() => {
    const sym = symSel.trim().toUpperCase();
    return sym ? [sym] : [];
  }, [symSel]);

  useSubscribeSymbols(
    eodSubSyms,
    isActive && subTab === 'eod' && hEnd >= today && liveAuto && eodSubSyms.length > 0
  );

  useEffect(() => {
    if (subTab !== 'eod') return;
    loadEod(false);
  }, [subTab, loadEod]);

  // Patch latest EOD candle in-place from WS ticks without disturbing Plotly zoom/hover
  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'eod' || hEnd < today) return;
    const sym = symSel.trim().toUpperCase();
    const tick = ticks[sym];
    if (!tick) return;
    setEodData((prev: any) => {
      if (!prev || prev.empty || prev.symbol !== sym || !prev.bars?.length) return prev;
      const nextBars = patchOhlcBarsWithTick(prev.bars, tick, false);
      if (nextBars === prev.bars) return prev;
      const nextAth = Math.max(prev.rawAth || 0, tick.last);
      return { ...prev, bars: nextBars, rawAth: nextAth };
    });
  }, [tickVersion, ticks, symSel, liveAuto, isActive, subTab, hEnd, today]);

  const eodMaInfo = useMemo(() => {
    const list = activeMas.map((p, idx) => ({
      key: `MA${p}`,
      label: `MA${p}`,
      color: MA_COLORS[p] || FALLBACK_MA_COLORS[idx % FALLBACK_MA_COLORS.length],
    }));
    if (showMaVol) {
      list.push({ key: 'MA20_Vol', label: 'MA20 Vol', color: '#d946ef' });
    }
    return list;
  }, [activeMas, showMaVol]);

  const eodHlines = useMemo(() => {
    if (!showAth || !eodData?.bars?.length) return [];
    const lastC = eodData.bars[eodData.bars.length - 1].close;
    return [
      {
        y: eodData.rawAth,
        color: '#9333ea',
        dash: 'dash',
        label: `ATH: ${fmtNum(eodData.rawAth, 2)}`,
      },
      {
        y: lastC,
        color: '#0284c7',
        dash: 'dot',
        label: `Giá: ${fmtNum(lastC, 2)}`,
      },
    ];
  }, [showAth, eodData]);

  const toggleMa = (w: number) => {
    setMaSel((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  };

  // --- 4.2 Intraday Chart ---
  const [inSym, setInSym] = useState('FPT');
  const [inDate, setInDate] = useState(today);
  const [inTf, setInTf] = useState('1');
  const [intraData, setIntraData] = useState<any>(null);
  const [intraLoading, setIntraLoading] = useState(false);
  const [intraError, setIntraError] = useState<string | null>(null);

  const loadIntraday = useCallback(
    async (forceRefresh = false, silent = false) => {
      const sym = inSym.trim().toUpperCase();
      if (!sym) return;
      if (!silent) {
        setIntraLoading(true);
        setIntraError(null);
      }
      try {
        const q = new URLSearchParams({
          symbol: sym,
          date: inDate,
          tf: inTf,
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/chart/intraday?${q.toString()}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        setIntraData(await resp.json());
        setIntraError(null);
      } catch (err: any) {
        if (!silent) {
          setIntraError(err?.message || 'Không thể tải dữ liệu khớp lệnh');
        }
      } finally {
        if (!silent) setIntraLoading(false);
      }
    },
    [inSym, inDate, inTf]
  );

  const intraSubSyms = useMemo(() => {
    const sym = inSym.trim().toUpperCase();
    return sym ? [sym] : [];
  }, [inSym]);

  useSubscribeSymbols(
    intraSubSyms,
    isActive && subTab === 'intraday' && inDate === today && liveAuto && intraSubSyms.length > 0
  );

  useEffect(() => {
    if (subTab !== 'intraday') return;
    loadIntraday(false, false);
  }, [subTab, loadIntraday]);

  // Patch latest intraday candle in-place from WS ticks with zero flicker
  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'intraday' || inDate !== today) return;
    const sym = inSym.trim().toUpperCase();
    const tick = ticks[sym];
    if (!tick) return;
    setIntraData((prev: any) => {
      if (!prev || prev.empty || prev.symbol !== sym || !prev.bars?.length) return prev;
      const nextBars = patchOhlcBarsWithTick(prev.bars, tick, !prev.fallbackToDaily);
      return nextBars === prev.bars ? prev : { ...prev, bars: nextBars };
    });
  }, [tickVersion, ticks, inSym, liveAuto, isActive, subTab, inDate, today]);

  // Silently reconcile new intraday minute bars on WS board sync events
  const lastIntraSyncRef = useRef(syncVersion.board);
  useEffect(() => {
    if (syncVersion.board === lastIntraSyncRef.current) return;
    lastIntraSyncRef.current = syncVersion.board;
    if (!liveAuto || !isActive || subTab !== 'intraday' || inDate !== today) return;
    loadIntraday(false, true);
  }, [syncVersion.board, liveAuto, isActive, subTab, inDate, today, loadIntraday]);

  const counts = catalog?.counts;

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          { id: 'eod', label: '📉 Biểu Đồ Kỹ Thuật (EOD)' },
          { id: 'intraday', label: '⚡ Khớp Lệnh Trong Phiên & Bảng Giá' },
        ]}
      />

      {subTab === 'eod' && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <FieldLabel label="Sàn giao dịch">
                  <select
                    value={exchangeSel}
                    onChange={(e) => {
                      const nextEx = e.target.value as 'ALL' | 'HOSE' | 'HNX' | 'UPCOM' | 'INDEX';
                      setExchangeSel(nextEx);
                      if (nextEx === 'INDEX') setIndSel('Chỉ số');
                      else if (indSel === 'Chỉ số') setIndSel('Tất cả ngành');
                    }}
                    className={inputCls}
                  >
                    <option value="ALL">
                      Tất cả ({counts ? counts.total + counts.INDEX : allCatalogItems.length})
                    </option>
                    <option value="HOSE">HOSE ({counts?.HOSE ?? '—'})</option>
                    <option value="HNX">HNX ({counts?.HNX ?? '—'})</option>
                    <option value="UPCOM">UPCOM ({counts?.UPCOM ?? '—'})</option>
                    <option value="INDEX">Chỉ số ({counts?.INDEX ?? ALL_MAIN_INDICES.length})</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Nhóm ngành">
                  <select
                    value={indSel}
                    onChange={(e) => {
                      const nextInd = e.target.value;
                      setIndSel(nextInd);
                      if (nextInd === 'Chỉ số') setExchangeSel('INDEX');
                      else if (exchangeSel === 'INDEX') setExchangeSel('ALL');
                    }}
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
              <div className="md:col-span-3">
                <FieldLabel label={`Mã CP / Chỉ số (${filteredEodItems.length} mã)`}>
                  <SymbolSearchInput
                    value={symSel}
                    onSelect={(s) => setSymSel(s)}
                    items={filteredEodItems}
                    placeholder="Gõ mã bất kỳ (FPT, CEO, BSR...)"
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Từ ngày">
                  <input
                    type="date"
                    value={hStart}
                    onChange={(e) => setHStart(e.target.value)}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Đến ngày">
                  <input
                    type="date"
                    value={hEnd}
                    onChange={(e) => setHEnd(e.target.value)}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-1">
                <FieldLabel label="Khung">
                  <select
                    value={hTf}
                    onChange={(e) => setHTf(e.target.value as 'D' | 'W' | 'M')}
                    className={inputCls}
                  >
                    <option value="D">Ngày</option>
                    <option value="W">Tuần</option>
                    <option value="M">Tháng</option>
                  </select>
                </FieldLabel>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-5">
                <div className="text-[12px] font-bold text-slate-600 mb-1">Đường MA</div>
                <div className="flex flex-wrap gap-1.5">
                  {[10, 20, 50, 100, 200].map((w) => {
                    const active = maSel.includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => toggleMa(w)}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-bold border cursor-pointer ${
                          active
                            ? 'text-white border-transparent'
                            : 'bg-slate-50 text-slate-600 border-slate-300'
                        }`}
                        style={active ? { backgroundColor: MA_COLORS[w] } : undefined}
                      >
                        MA{w}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-3">
                <FieldLabel label="Custom MA">
                  <input
                    type="text"
                    value={customMaTxt}
                    onChange={(e) => setCustomMaTxt(e.target.value)}
                    placeholder="vd: 5, 15"
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-2 flex items-center h-[36px]">
                <label className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMaVol}
                    onChange={(e) => setShowMaVol(e.target.checked)}
                    className="w-4 h-4 accent-[#0284c7]"
                  />
                  MA20 Vol
                </label>
              </div>
              <div className="md:col-span-2 flex items-center h-[36px]">
                <label className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAth}
                    onChange={(e) => setShowAth(e.target.checked)}
                    className="w-4 h-4 accent-[#0284c7]"
                  />
                  Đỉnh LS (ATH)
                </label>
              </div>
            </div>
          </div>

          {eodLoading && <LoadingBar text={`Đang tải dữ liệu biểu đồ ${symSel}...`} />}

          {eodError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px] flex flex-wrap items-center justify-between gap-2">
              <span>Lỗi tải dữ liệu biểu đồ {symSel}: {eodError}</span>
              <SecondaryButton onClick={() => loadEod(false)}>Thử lại</SecondaryButton>
            </div>
          )}

          {!eodLoading && !eodError && eodData?.empty && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm flex flex-wrap items-center justify-between gap-2">
              <span>
                Không có dữ liệu giao dịch cho mã <strong>{symSel}</strong> trong khoảng ngày đã chọn.
                Hãy kiểm tra lại mã hoặc nới rộng khoảng thời gian.
              </span>
              <SecondaryButton onClick={() => loadEod(false)}>Tải lại</SecondaryButton>
            </div>
          )}

          {eodData && !eodData.empty && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-slate-600 px-1">
                <strong className="text-slate-900">{eodData.symbol}</strong>
                {eodData.exchange && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-[#0284c7]">
                      {eodData.exchange === 'INDEX' ? 'Chỉ số' : eodData.exchange}
                    </span>
                  </>
                )}
                {eodData.companyName && eodData.companyName !== eodData.symbol && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-700">{eodData.companyName}</span>
                  </>
                )}
                {eodData.industry && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{eodData.industry}</span>
                  </>
                )}
                {eodData.resolvedDateDisplay && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="tabular-nums">Phiên gần nhất: {eodData.resolvedDateDisplay}</span>
                  </>
                )}
                {eodData.source && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Nguồn: {eodData.source}</span>
                  </>
                )}
              </div>

              <DynamicOhlcChart
                symbol={eodData.symbol}
                bars={eodData.bars}
                maInfo={eodMaInfo}
                showVolume
                showMaVol={showMaVol}
                hlines={eodHlines}
                height={560}
                uirevision={`eod_${eodData.symbol}_${hTf}`}
              />
            </div>
          )}
        </div>
      )}

      {subTab === 'intraday' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-4">
              <FieldLabel label="Mã CP / Chỉ số (3 sàn HOSE · HNX · UPCOM)">
                <SymbolSearchInput
                  value={inSym}
                  onSelect={(s) => setInSym(s)}
                  items={allCatalogItems}
                  placeholder="Tìm hoặc nhập mã (VD: FPT, CEO, BSR...)"
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <FieldLabel label="Ngày khớp lệnh">
                <input
                  type="date"
                  value={inDate}
                  onChange={(e) => setInDate(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Khung nến">
                <select value={inTf} onChange={(e) => setInTf(e.target.value)} className={inputCls}>
                  {['1', '5', '15', '30', '60'].map((m) => (
                    <option key={m} value={m}>
                      {m} phút
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <PrimaryButton
                onClick={() => loadIntraday(true, false)}
                loading={intraLoading}
                className="w-full"
              >
                🔄 Cập nhật
              </PrimaryButton>
            </div>
          </div>

          {intraLoading && <LoadingBar text={`Đang tải dữ liệu khớp lệnh ${inSym}...`} />}

          {intraError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px] flex flex-wrap items-center justify-between gap-2">
              <span>Lỗi tải dữ liệu khớp lệnh {inSym}: {intraError}</span>
              <SecondaryButton onClick={() => loadIntraday(true, false)}>Thử lại</SecondaryButton>
            </div>
          )}

          {!intraLoading && !intraError && intraData?.empty && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-sm">
              Không tìm thấy dữ liệu khớp lệnh hoặc dữ liệu EOD cho mã <strong>{inSym}</strong>.
            </div>
          )}

          {intraData && !intraData.empty && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-slate-600 px-1">
                <strong className="text-slate-900">{intraData.symbol}</strong>
                {intraData.exchange && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-[#0284c7]">
                      {intraData.exchange === 'INDEX' ? 'Chỉ số' : intraData.exchange}
                    </span>
                  </>
                )}
                {intraData.companyName && intraData.companyName !== intraData.symbol && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-700">{intraData.companyName}</span>
                  </>
                )}
                {intraData.resolvedDateDisplay && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="tabular-nums font-semibold text-slate-800">
                      {intraData.fallbackToDaily
                        ? `Dữ liệu EOD gần nhất đến ${intraData.resolvedDateDisplay}`
                        : `Phiên khớp lệnh: ${intraData.resolvedDateDisplay}`}
                    </span>
                  </>
                )}
                {intraData.source && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Nguồn: {intraData.source}</span>
                  </>
                )}
                {!intraData.fallbackToDaily &&
                  intraData.resolvedDate &&
                  intraData.requestedDate &&
                  intraData.resolvedDate !== intraData.requestedDate && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="text-amber-700">
                        Ngày {intraData.requestedDateDisplay} chưa có giao dịch, tự động hiển thị phiên gần nhất
                      </span>
                    </>
                  )}
                {intraData.fallbackToDaily && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-amber-700">
                      Chưa có nến theo phút, tự động hiển thị 30 phiên EOD gần nhất
                    </span>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-[10px] p-2 overflow-auto max-h-[545px]">
                  <table className="w-full text-[12.5px] border-collapse">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200 text-slate-600 text-right">
                        <th className="py-1.5 px-2 text-left">
                          {intraData.fallbackToDaily ? 'Ngày' : 'Giờ'}
                        </th>
                        <th className="py-1.5 px-1.5">Open</th>
                        <th className="py-1.5 px-1.5">High</th>
                        <th className="py-1.5 px-1.5">Low</th>
                        <th className="py-1.5 px-1.5">Close</th>
                        <th className="py-1.5 px-1.5">%</th>
                        <th className="py-1.5 px-2">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...intraData.bars].reverse().map((b: any, i: number) => (
                        <tr
                          key={`${b.time}_${i}`}
                          className="border-b border-slate-100 hover:bg-slate-50 text-right tabular-nums"
                        >
                          <td className="py-1.5 px-2 text-left font-semibold text-slate-700">
                            {b.time}
                          </td>
                          <td className="py-1.5 px-1.5">{fmtNum(b.open, 2)}</td>
                          <td className="py-1.5 px-1.5">{fmtNum(b.high, 2)}</td>
                          <td className="py-1.5 px-1.5">{fmtNum(b.low, 2)}</td>
                          <td className="py-1.5 px-1.5 font-semibold">{fmtNum(b.close, 2)}</td>
                          <td className={`py-1.5 px-1.5 ${colorSignedClass(b.pct)}`}>
                            {fmtSigned(b.pct, 2, '%')}
                          </td>
                          <td className="py-1.5 px-2">{fmtInt(b.volume)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="lg:col-span-8">
                  <DynamicOhlcChart
                    symbol={intraData.symbol}
                    bars={intraData.bars}
                    showVolume
                    height={460}
                    uirevision={`intra_${intraData.symbol}_${inTf}_${intraData.fallbackToDaily ? 'd' : 'm'}`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
