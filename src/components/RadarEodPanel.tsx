import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  Radar,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchStockRowsWithTicks } from '../utils/livePatch';
import {
  ErrorBanner,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  SegmentedControl,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from './UiPrimitives';
import {
  colorPctStrengthClass,
  colorSignedClass,
  colorStatusClass,
  colorVolScoreClass,
  downloadCsv,
  fmtInt,
  fmtNum,
  fmtSigned,
} from '../utils/format';

interface RadarRiskInfo {
  date: string;
  phase: string;
  target: number;
  dd: number;
  rally: number;
  isFtd: boolean;
  risk: number;
  distDays?: number;
  vnindexClose?: number;
  vnindexPct?: number;
  belowMa200?: boolean;
}

interface RadarSectorRow {
  industry: string;
  strength: number;
  upCount?: number;
  totalCount?: number;
  ratioText: string;
}

interface RadarStockRow {
  symbol: string;
  companyName?: string;
  industry: string;
  price: number;
  changePct?: number;
  volume: number;
  valueBil?: number;
  volRatio: number;
  pctAboveMaFast?: number;
  trendAligned?: boolean;
  signal: string;
}

interface RadarResponse {
  risk: RadarRiskInfo;
  sectors: RadarSectorRow[];
  stocks: RadarStockRow[];
  meta?: {
    totalScanned: number;
    qualifiedCount: number;
    fullCount: number;
    volBreakCount: number;
    waitVolCount: number;
    accumCount: number;
    maFast: number;
    maMid: number;
    minVol: number;
  };
}

type SignalFilter = 'all' | 'full' | 'vol' | 'wait' | 'accum';
type SortKey = 'default' | 'price' | 'changePct' | 'volume' | 'volRatio' | 'pctAboveMaFast';

interface Props {
  isActive?: boolean;
}

export const RadarEodPanel: React.FC<Props> = ({ isActive = true }) => {
  const { ticks, tickVersion, liveAuto } = useMarketStream();

  // Scan parameters
  const [maFast, setMaFast] = useState(20);
  const [maMid, setMaMid] = useState(50);
  const [minVol, setMinVol] = useState(100_000);
  const [useFtd, setUseFtd] = useState(true);
  const [ftdMode, setFtdMode] = useState(0);

  // Data & UI state
  const [radarRes, setRadarRes] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Interactive table filters & sort
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [searchTxt, setSearchTxt] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const hasAutoRunRef = useRef(false);

  const runRadar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/radar-eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maFast, maMid, minVol, useFtd, ftdMode }),
      });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => null);
        throw new Error(errJson?.error || 'Không thể tải dữ liệu Radar EOD.');
      }
      const json: RadarResponse = await resp.json();
      setRadarRes(json);
    } catch (e: any) {
      setError(e?.message || 'Lỗi kết nối khi quét Radar EOD.');
    } finally {
      setLoading(false);
    }
  }, [maFast, maMid, minVol, useFtd, ftdMode]);

  // Auto-run once when user enters the Radar EOD tab so data is immediately visible
  useEffect(() => {
    if (!isActive || hasAutoRunRef.current) return;
    hasAutoRunRef.current = true;
    runRadar();
  }, [isActive, runRadar]);

  // Live SSI WS subscription for ranked stocks
  const trackedSymbols = useMemo(() => {
    if (!radarRes?.stocks?.length) return [];
    return radarRes.stocks.map((s) => s.symbol).filter(Boolean);
  }, [radarRes?.stocks?.length]);

  useSubscribeSymbols(trackedSymbols, isActive && liveAuto && trackedSymbols.length > 0);

  useEffect(() => {
    if (!liveAuto || !isActive) return;
    setRadarRes((prev) => {
      if (!prev?.stocks?.length) return prev;
      const nextStocks = patchStockRowsWithTicks(prev.stocks, ticks);
      return nextStocks === prev.stocks ? prev : { ...prev, stocks: nextStocks };
    });
  }, [tickVersion, ticks, liveAuto, isActive]);

  // Signal counts for segmented filter
  const signalCounts = useMemo(() => {
    const stocks = radarRes?.stocks || [];
    const base = selectedSector
      ? stocks.filter((s) => s.industry === selectedSector)
      : stocks;
    return {
      all: base.length,
      full: base.filter((s) => s.signal === 'ĐẠT (Full)').length,
      vol: base.filter((s) => s.signal === 'Nổ Vol (Hồi)').length,
      wait: base.filter((s) => s.signal === 'Chờ Vol').length,
      accum: base.filter((s) => s.signal === 'Tích lũy').length,
    };
  }, [radarRes?.stocks, selectedSector]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filteredStocks = useMemo(() => {
    if (!radarRes?.stocks?.length) return [];
    const q = searchTxt.trim().toUpperCase();
    const list = radarRes.stocks.filter((s) => {
      if (selectedSector && s.industry !== selectedSector) return false;
      if (signalFilter === 'full' && s.signal !== 'ĐẠT (Full)') return false;
      if (signalFilter === 'vol' && s.signal !== 'Nổ Vol (Hồi)') return false;
      if (signalFilter === 'wait' && s.signal !== 'Chờ Vol') return false;
      if (signalFilter === 'accum' && s.signal !== 'Tích lũy') return false;
      if (
        q &&
        !s.symbol.includes(q) &&
        !(s.companyName || '').toUpperCase().includes(q) &&
        !s.industry.toUpperCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    if (sortKey === 'default') return list;
    const mul = sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = Number((a as any)[sortKey] ?? 0);
      const bv = Number((b as any)[sortKey] ?? 0);
      return (av - bv) * mul;
    });
  }, [radarRes?.stocks, selectedSector, signalFilter, searchTxt, sortKey, sortDir]);

  const handleExportCsv = () => {
    if (!filteredStocks.length) return;
    downloadCsv(
      `radar_eod_${radarRes?.risk.date.replace(/\//g, '-') || 'latest'}.csv`,
      [
        'Mã CP',
        'Ngành (SSI ICB)',
        'Giá',
        '% Đổi',
        'Khối lượng',
        'GTGD (Tỷ)',
        'Hệ số Vol',
        `Cách MA${radarRes?.meta?.maFast ?? maFast} (%)`,
        'Tín hiệu',
      ],
      filteredStocks.map((s) => [
        s.symbol,
        s.industry,
        s.price,
        s.changePct ?? '',
        s.volume,
        s.valueBil ?? '',
        s.volRatio,
        s.pctAboveMaFast ?? '',
        s.signal,
      ])
    );
  };

  // Regime styling helpers
  const regimeInfo = useMemo(() => {
    const r = radarRes?.risk;
    if (!r) return null;
    const phaseLower = r.phase.toLowerCase();
    const isUptrend = r.isFtd && phaseLower.includes('uptrend') && !r.belowMa200;
    const isCorrection = !r.isFtd || phaseLower.includes('correction') || phaseLower.includes('downtrend');
    return {
      tone: isUptrend ? 'emerald' : isCorrection ? 'red' : 'amber',
      label: r.phase,
      ftdLabel: r.isFtd
        ? 'Xác nhận FTD'
        : r.rally > 0
        ? `Nỗ lực hồi phục · Ngày ${r.rally}`
        : 'Chưa có phiên tạo đáy',
      targetPct: Math.max(0, Math.min(100, Math.round(r.target))),
      riskPct: Math.max(0, Math.min(100, (r.risk / 6) * 100)),
    };
  }, [radarRes?.risk]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) {
      return <ArrowUpDown className="w-3 h-3 opacity-40 inline ml-0.5" />;
    }
    return sortDir === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-sky-600 dark:text-sky-400 inline ml-0.5" />
    ) : (
      <ArrowUp className="w-3 h-3 text-sky-600 dark:text-sky-400 inline ml-0.5" />
    );
  };

  const activeMaFast = radarRes?.meta?.maFast ?? maFast;
  const activeMaMid = radarRes?.meta?.maMid ?? maMid;

  return (
    <div className="space-y-4">
      {/* Compact Command & Parameter Bar */}
      <SectionCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15.5px] font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                Radar Xếp Hạng EOD &amp; Theo Dõi FTD
              </h3>
              {radarRes && (
                <span className="text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
                  · Phiên {radarRes.risk.date}
                  {radarRes.meta ? ` · ${radarRes.meta.totalScanned} mã thanh khoản HOSE` : ''}
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
              Bộ lọc đa khung MA{maFast} / MA{maMid} / MA200 kết hợp dòng tiền đột biến (Vol &gt;{' '}
              <span className="font-mono">{fmtInt(minVol)}</span>) và trạng thái FTD VNINDEX.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SecondaryButton
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Tham số ({`MA${maFast}/${maMid}`})
            </SecondaryButton>

            {radarRes && filteredStocks.length > 0 && (
              <SecondaryButton onClick={handleExportCsv}>
                <Download className="w-3.5 h-3.5" />
                Xuất CSV
              </SecondaryButton>
            )}

            <PrimaryButton onClick={runRadar} loading={loading}>
              {!loading && <Radar className="w-4 h-4" />}
              Quét Radar EOD
            </PrimaryButton>
          </div>
        </div>

        {/* Collapsible Parameter Controls — clean 12-col alignment */}
        {showAdvanced && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-12 gap-3 items-end pt-3.5 mt-3.5 border-t border-slate-100 dark:border-slate-800">
            <div className="lg:col-span-2">
              <FieldLabel label="MA Nhanh">
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={maFast}
                  onChange={(e) => setMaFast(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="lg:col-span-2">
              <FieldLabel label="MA Trung hạn">
                <input
                  type="number"
                  min={20}
                  max={100}
                  value={maMid}
                  onChange={(e) => setMaMid(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="lg:col-span-3">
              <FieldLabel label="KL tối thiểu (CP)">
                <input
                  type="number"
                  min={0}
                  step={50000}
                  value={minVol}
                  onChange={(e) => setMinVol(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="lg:col-span-3">
              <FieldLabel label="Chuẩn xác nhận FTD">
                <select
                  value={ftdMode}
                  disabled={!useFtd}
                  onChange={(e) => setFtdMode(Number(e.target.value))}
                  className={inputCls}
                >
                  <option value={0}>Nâng cao (Vol &gt; MA20)</option>
                  <option value={1}>Tiêu chuẩn (Vol &gt; Hôm trước)</option>
                </select>
              </FieldLabel>
            </div>
            <div className="lg:col-span-2 flex items-center h-9">
              <label className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useFtd}
                  onChange={(e) => setUseFtd(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                Kích hoạt FTD
              </label>
            </div>
          </div>
        )}
      </SectionCard>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ErrorBanner message={error} className="flex-1" />
          <SecondaryButton onClick={runRadar}>Thử lại</SecondaryButton>
        </div>
      )}

      {/* Clean Skeleton State while loading first scan */}
      {loading && !radarRes && (
        <div className="space-y-4">
          <SectionCard className="p-4">
            <div className="flex items-center gap-3 text-[13px] text-slate-600 dark:text-slate-300">
              <span className="w-4 h-4 border-2 border-sky-600 dark:border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Đang đồng bộ dữ liệu EOD và chấm điểm sức mạnh ngành từ SSI...</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 animate-pulse">
                  <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-6 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                </div>
              ))}
            </div>
          </SectionCard>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <SectionCard className="lg:col-span-4 p-4 space-y-3 animate-pulse">
              <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 bg-slate-100 dark:bg-slate-800/70 rounded" />
              ))}
            </SectionCard>
            <SectionCard className="lg:col-span-8 p-4 space-y-3 animate-pulse">
              <div className="h-4 w-44 bg-slate-200 dark:bg-slate-800 rounded" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 bg-slate-100 dark:bg-slate-800/70 rounded" />
              ))}
            </SectionCard>
          </div>
        </div>
      )}

      {/* Main Content */}
      {radarRes && regimeInfo && (
        <div className="space-y-4">
          {/* Focal Anchor: Unified Market Regime & Risk Strip (Single Card, Hairline Dividers) */}
          <SectionCard className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              {/* Primary Regime Readout */}
              <div className="lg:col-span-4 flex items-start gap-3 lg:pr-4 lg:border-r lg:border-slate-200 dark:lg:border-slate-800">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    regimeInfo.tone === 'emerald'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      : regimeInfo.tone === 'red'
                      ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {regimeInfo.tone === 'emerald' ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : regimeInfo.tone === 'red' ? (
                    <ShieldAlert className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
                    Trạng thái thị trường (VNINDEX)
                  </div>
                  <div
                    className={`text-[18px] font-bold tracking-tight leading-snug mt-0.5 ${
                      regimeInfo.tone === 'emerald'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : regimeInfo.tone === 'red'
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {regimeInfo.label}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    {radarRes.risk.vnindexClose ? (
                      <>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {fmtNum(radarRes.risk.vnindexClose, 2)}
                        </span>
                        <span
                          className={`font-mono font-semibold ${colorSignedClass(
                            radarRes.risk.vnindexPct ?? 0
                          )}`}
                        >
                          ({fmtSigned(radarRes.risk.vnindexPct ?? 0, 2, '%')})
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                      </>
                    ) : null}
                    <span
                      className={
                        radarRes.risk.isFtd
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-slate-600 dark:text-slate-300'
                      }
                    >
                      {regimeInfo.ftdLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4 Key Risk & Exposure Gauges */}
              <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {/* Target Exposure with visual meter */}
                <div className="space-y-1.5">
                  <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
                    Tỷ trọng giải ngân KN
                  </div>
                  <div className="text-[20px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 leading-none">
                    {regimeInfo.targetPct}%
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        regimeInfo.targetPct >= 70
                          ? 'bg-emerald-500'
                          : regimeInfo.targetPct >= 40
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${regimeInfo.targetPct}%` }}
                    />
                  </div>
                </div>

                {/* Risk Score with 0..6 bar */}
                <div className="space-y-1.5">
                  <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
                    Điểm rủi ro (25 phiên)
                  </div>
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span
                      className={`text-[20px] font-bold font-mono tabular-nums ${
                        radarRes.risk.risk >= 4.5
                          ? 'text-red-600 dark:text-red-400'
                          : radarRes.risk.risk >= 2.5
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {fmtNum(radarRes.risk.risk, 1)}
                    </span>
                    <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                      {radarRes.risk.risk >= 4.5
                        ? 'Rủi ro cao'
                        : radarRes.risk.risk >= 2.5
                        ? 'Thận trọng'
                        : 'An toàn'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        radarRes.risk.risk >= 4.5
                          ? 'bg-red-500'
                          : radarRes.risk.risk >= 2.5
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${regimeInfo.riskPct}%` }}
                    />
                  </div>
                </div>

                {/* Drawdown from peak */}
                <div className="space-y-1">
                  <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
                    Độ sâu điều chỉnh
                  </div>
                  <div
                    className={`text-[20px] font-bold font-mono tabular-nums leading-none ${
                      radarRes.risk.dd <= -7
                        ? 'text-red-600 dark:text-red-400'
                        : radarRes.risk.dd <= -3
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-900 dark:text-slate-50'
                    }`}
                  >
                    {fmtNum(radarRes.risk.dd, 1)}%
                  </div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {typeof radarRes.risk.distDays === 'number'
                      ? `${radarRes.risk.distDays} phiên phân phối`
                      : 'Từ đỉnh tham chiếu'}
                  </div>
                </div>

                {/* Screener hit count */}
                <div className="space-y-1">
                  <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
                    Cổ phiếu đạt chuẩn
                  </div>
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span className="text-[20px] font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400">
                      {radarRes.meta?.fullCount ??
                        radarRes.stocks.filter((s) => s.signal === 'ĐẠT (Full)').length}
                    </span>
                    <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                      ĐẠT (Full)
                    </span>
                  </div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {radarRes.meta?.qualifiedCount ?? radarRes.stocks.length} mã &gt; MA
                    {activeMaFast}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Main 2-Column Analytical Grid: Sector Leadership (4) + Ranked Stocks (8) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left: Interactive Sector Strength Ranking */}
            <SectionCard className="lg:col-span-4 p-4 flex flex-col">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h4 className="inline-flex items-center gap-2 font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                    <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                    Top Ngành Dẫn Dắt
                  </h4>
                  <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                    % mã nằm trên MA{activeMaFast} · Nhấn ngành để lọc bảng
                  </p>
                </div>
                {selectedSector && (
                  <button
                    type="button"
                    onClick={() => setSelectedSector(null)}
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                    Bỏ lọc
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 overflow-y-auto max-h-[590px] -mx-4 px-2 mt-1">
                {radarRes.sectors.map((s, idx) => {
                  const isSelected = selectedSector === s.industry;
                  const barColor =
                    s.strength >= 70
                      ? 'bg-emerald-500'
                      : s.strength >= 50
                      ? 'bg-sky-500'
                      : s.strength >= 30
                      ? 'bg-amber-500'
                      : 'bg-slate-400 dark:bg-slate-600';
                  return (
                    <button
                      key={s.industry}
                      type="button"
                      onClick={() => setSelectedSector(isSelected ? null : s.industry)}
                      className={`w-full text-left px-2.5 py-2.5 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-sky-50 dark:bg-sky-950/50'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span
                            className={`text-[13px] font-semibold truncate ${
                              isSelected
                                ? 'text-sky-700 dark:text-sky-300'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {s.industry}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums">
                          <span className="text-[11.5px] text-slate-400 dark:text-slate-500">
                            {s.ratioText}
                          </span>
                          <span
                            className={`text-[12.5px] w-12 text-right ${colorPctStrengthClass(
                              s.strength
                            )}`}
                          >
                            {fmtNum(s.strength, 1)}%
                          </span>
                        </div>
                      </div>
                      <div className="pl-7">
                        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${Math.max(2, Math.min(100, s.strength))}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
                {radarRes.sectors.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
                    Chưa có dữ liệu nhóm ngành.
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Right: Filterable, Sortable Ranked Stock Screener Table */}
            <SectionCard className="lg:col-span-8 p-4 space-y-3">
              {/* Header + Filter Bar */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="inline-flex items-center gap-2 font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                      <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      Xếp Hạng Cổ Phiếu Nổi Bật
                    </h4>
                    <span className="text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
                      · {filteredStocks.length} mã
                      {selectedSector ? ` · Ngành ${selectedSector}` : ''}
                    </span>
                  </div>

                  <div className="relative w-full sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchTxt}
                      onChange={(e) => setSearchTxt(e.target.value)}
                      placeholder="Tìm mã, công ty, ngành..."
                      className={`${inputCls} pl-8 h-9 text-[12.5px]`}
                    />
                  </div>
                </div>

                {/* Interactive Signal Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SegmentedControl
                    value={signalFilter}
                    onChange={setSignalFilter}
                    options={[
                      { value: 'all', label: `Tất cả (${signalCounts.all})` },
                      { value: 'full', label: `ĐẠT Full (${signalCounts.full})` },
                      { value: 'vol', label: `Nổ Vol (${signalCounts.vol})` },
                      { value: 'wait', label: `Chờ Vol (${signalCounts.wait})` },
                      { value: 'accum', label: `Tích lũy (${signalCounts.accum})` },
                    ]}
                  />
                  <span className="text-[11.5px] text-slate-400 dark:text-slate-500 hidden xl:inline">
                    Chuẩn Full: Giá &gt; MA{activeMaFast} &gt; MA{activeMaMid} &gt; MA200 &amp; Vol
                    vượt TB
                  </span>
                </div>
              </div>

              {/* High-Density Data Grid */}
              <div className="overflow-x-auto overflow-y-auto max-h-[540px] border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-[13px] border-collapse">
                  <thead className={tableHeadCls}>
                    <tr className="text-left">
                      <th className="py-2.5 pl-3 pr-1.5 w-9">#</th>
                      <th className="py-2.5 px-2.5">Mã CP</th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('price')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          Giá <SortIcon col="price" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('changePct')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          % Đổi <SortIcon col="changePct" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('volume')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          Khối lượng <SortIcon col="volume" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('volRatio')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          Hệ số Vol <SortIcon col="volRatio" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('pctAboveMaFast')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          vs MA{activeMaFast} <SortIcon col="pctAboveMaFast" />
                        </button>
                      </th>
                      <th className="py-2.5 px-3">Tín hiệu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredStocks.map((st, idx) => {
                      const volBarPct = Math.min(100, (st.volRatio / 3.0) * 100);
                      return (
                        <tr
                          key={st.symbol}
                          className={tableRowCls}
                          title={st.companyName ? `${st.symbol} — ${st.companyName}` : st.symbol}
                        >
                          <td className="py-2 pl-3 pr-1.5 text-[11.5px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2.5">
                            <div className="font-bold font-mono text-slate-900 dark:text-slate-100 leading-tight">
                              {st.symbol}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[155px]">
                              {st.industry}
                            </div>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                            {fmtNum(st.price, 2)}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                              typeof st.changePct === 'number'
                                ? colorSignedClass(st.changePct)
                                : 'text-slate-400'
                            }`}
                          >
                            {typeof st.changePct === 'number'
                              ? fmtSigned(st.changePct, 2, '%')
                              : '—'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                            <div className="text-slate-700 dark:text-slate-200 leading-tight">
                              {fmtInt(st.volume)}
                            </div>
                            {typeof st.valueBil === 'number' && st.valueBil > 0 && (
                              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                {fmtNum(st.valueBil, 1)} Tỷ
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                            <div className={colorVolScoreClass(st.volRatio)}>
                              {fmtNum(st.volRatio, 2)}x
                            </div>
                            <div className="mt-1 h-1 w-14 ml-auto rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  st.volRatio >= 1.5
                                    ? 'bg-emerald-500'
                                    : st.volRatio >= 1.0
                                    ? 'bg-sky-500'
                                    : 'bg-slate-400 dark:bg-slate-600'
                                }`}
                                style={{ width: `${Math.max(8, volBarPct)}%` }}
                              />
                            </div>
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                              typeof st.pctAboveMaFast === 'number'
                                ? st.pctAboveMaFast > 12
                                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                  : 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {typeof st.pctAboveMaFast === 'number'
                              ? fmtSigned(st.pctAboveMaFast, 1, '%')
                              : '—'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className={`text-[12.5px] ${colorStatusClass(st.signal)}`}>
                              {st.signal}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredStocks.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="py-10 text-center text-[13px] text-slate-500 dark:text-slate-400"
                        >
                          Không có cổ phiếu nào khớp với bộ lọc hiện tại.
                          {(selectedSector || signalFilter !== 'all' || searchTxt) && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSector(null);
                                setSignalFilter('all');
                                setSearchTxt('');
                              }}
                              className="ml-2 text-sky-600 dark:text-sky-400 font-semibold hover:underline cursor-pointer"
                            >
                              Xóa bộ lọc
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
};
