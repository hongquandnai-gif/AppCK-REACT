import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  HeartPulse,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import { DateInput } from './DateInput';
import { PlotlyChart } from './PlotlyChart';
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
import { useTheme } from '../context/ThemeContext';
import {
  colorPctStrengthClass,
  colorPctWeakClass,
  colorSignedClass,
  downloadCsv,
  fmtInt,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface DistributionEvent {
  date: string;
  dateDisplay: string;
  type: 'DD' | 'STALL' | 'CHURN';
  close: number;
  changePct: number;
  volume: number;
  volChangePct: number;
  sessionsAgo: number;
  sessionsLeft: number;
}

interface SeriesPoint {
  date: string;
  label: string;
  dateDisplay: string;
  close: number;
  ma20: number | null;
  ma50: number | null;
  changePct: number;
  volume: number;
  eventType: 'DD' | 'STALL' | 'CHURN' | null;
  inWindow: boolean;
}

interface IndexHealthSummary {
  index: string;
  close: number;
  prevClose: number;
  changePct: number;
  dateDisplay: string;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  aboveMa20: boolean | null;
  aboveMa50: boolean | null;
  aboveMa200: boolean | null;
  dd: number;
  ddDates: string;
  stall: number;
  churn: number;
  riskScore: number;
  targetExposure: number;
  allocReason: string;
  events: DistributionEvent[];
  series: SeriesPoint[];
  extra: { riskScore?: number; allocTxt?: string; reason?: string } | null;
}

interface SectorBreadthRow {
  industry: string;
  pctAboveMa20: number;
  prevPct: number;
  change: number;
  pctBelowMa50: number;
  pctAboveMa50: number;
  isWarning: boolean;
  warning: string;
  count: number;
  aboveMa20Count: number;
  belowMa50Count: number;
  status: 'leader' | 'weak' | 'neutral';
}

interface BreadthMeta {
  resolvedDateDisplay: string;
  totalStocks: number;
  aboveMa20Count: number;
  aboveMa20Pct: number;
  aboveMa50Count: number;
  aboveMa50Pct: number;
  totalSectors: number;
  leaderSectorsCount: number;
  weakSectorsCount: number;
  warningSectorsCount: number;
  ddWin: number;
  cancelReb: number;
  ma20Lag: number;
}

interface MarketHealthResponse {
  summaries: IndexHealthSummary[];
  leaders: SectorBreadthRow[];
  weak: SectorBreadthRow[];
  allSectors: SectorBreadthRow[];
  breadth: BreadthMeta;
}

type SectorFilter = 'all' | 'leader' | 'weak' | 'warning';
type SortKey = 'pctAboveMa20' | 'prevPct' | 'change' | 'pctBelowMa50' | 'count';

interface Props {
  isActive?: boolean;
}

function getRiskTone(riskScore: number, aboveMa50: boolean | null): 'emerald' | 'amber' | 'red' {
  if (aboveMa50 === false || riskScore >= 6.0) return 'red';
  if (riskScore >= 3.0) return 'amber';
  return 'emerald';
}

function getRegimeLabel(vni: IndexHealthSummary): {
  title: string;
  subtitle: string;
  tone: 'emerald' | 'amber' | 'red';
} {
  if (vni.aboveMa50 === false) {
    return {
      title: 'Phòng thủ · Gãy hỗ trợ MA50',
      subtitle: 'VNINDEX giao dịch dưới đường MA50 — ưu tiên bảo toàn vốn và hạ tỷ trọng.',
      tone: 'red',
    };
  }
  if (vni.dd >= 5 && vni.aboveMa20 === false) {
    return {
      title: 'Cảnh báo cao · Áp lực phân phối mạnh',
      subtitle: 'Xuất hiện từ 5 phiên phân phối trở lên kết hợp mất mốc MA20 ngắn hạn.',
      tone: 'red',
    };
  }
  if (vni.riskScore >= 5.0 || vni.dd >= 4) {
    return {
      title: 'Thận trọng · Phân phối gia tăng',
      subtitle: 'Tăng cường quản trị vị thế, hạn chế mua đuổi và ưu tiên nhóm ngành dẫn dắt.',
      tone: 'amber',
    };
  }
  if (vni.riskScore >= 3.0) {
    return {
      title: 'Tích cực có chọn lọc',
      subtitle: 'Xu hướng chính vẫn giữ vững nhưng cần theo dõi thêm áp lực cung ở vùng cao.',
      tone: 'amber',
    };
  }
  return {
    title: 'Xu hướng tăng khỏe · Rủi ro thấp',
    subtitle: 'Áp lực bán tổ chức thấp, chỉ số giữ vững các đường trung bình chủ chốt.',
    tone: 'emerald',
  };
}

const EVENT_META: Record<
  DistributionEvent['type'],
  { label: string; short: string; textCls: string; color: string; symbol: string }
> = {
  DD: {
    label: 'Phân phối (DD)',
    short: 'DD',
    textCls: 'text-red-600 dark:text-red-400 font-semibold',
    color: '#dc2626',
    symbol: 'triangle-down',
  },
  STALL: {
    label: 'Chững lại (Stalling)',
    short: 'Stalling',
    textCls: 'text-amber-600 dark:text-amber-400 font-semibold',
    color: '#d97706',
    symbol: 'diamond',
  },
  CHURN: {
    label: 'Xả hàng đỉnh (Churn)',
    short: 'Churn',
    textCls: 'text-violet-600 dark:text-violet-400 font-semibold',
    color: '#7c3aed',
    symbol: 'circle',
  },
};

export const MarketHealthPanel: React.FC<Props> = ({ isActive = true }) => {
  const { isDark } = useTheme();
  const today = useMemo(() => vnTodayIso(), []);

  // Analysis parameters
  const [maDate, setMaDate] = useState(today);
  const [ddWin, setDdWin] = useState(25);
  const [cancelReb, setCancelReb] = useState(6.0);
  const [ma20Lag, setMa20Lag] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Data & UI state
  const [data, setData] = useState<MarketHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<string>('VNINDEX');

  // Sector explorer filter & sort
  const [sectorFilter, setSectorFilter] = useState<SectorFilter>('all');
  const [searchTxt, setSearchTxt] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('pctAboveMa20');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const initializedRef = useRef(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/market-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: maDate, ddWin, cancelReb, ma20Lag }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Không thể tải dữ liệu sức khỏe thị trường');
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Lỗi kết nối máy chủ phân tích sức khỏe thị trường');
    } finally {
      setLoading(false);
    }
  }, [maDate, ddWin, cancelReb, ma20Lag]);

  // Auto-run once on first visit
  useEffect(() => {
    if (isActive && !initializedRef.current) {
      initializedRef.current = true;
      runAnalysis();
    }
  }, [isActive, runAnalysis]);

  const vniSummary = useMemo(
    () => data?.summaries.find((s) => s.index === 'VNINDEX') || data?.summaries[0] || null,
    [data]
  );

  const activeIndexSummary = useMemo(
    () =>
      data?.summaries.find((s) => s.index === selectedIndex) ||
      vniSummary ||
      null,
    [data, selectedIndex, vniSummary]
  );

  // Plotly chart for selected index with MA20, MA50 & Distribution markers
  const distChart = useMemo(() => {
    const s = activeIndexSummary;
    if (!s || !s.series?.length) return null;

    const x = s.series.map((p) => p.label);
    const closes = s.series.map((p) => p.close);
    const ma20s = s.series.map((p) => p.ma20);
    const ma50s = s.series.map((p) => p.ma50);

    const ddPts = s.series.filter((p) => p.eventType === 'DD');
    const stallPts = s.series.filter((p) => p.eventType === 'STALL');
    const churnPts = s.series.filter((p) => p.eventType === 'CHURN');

    const traces: any[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: closes,
        name: s.index,
        line: { color: isDark ? '#38bdf8' : '#0284c7', width: 2.2 },
        customdata: s.series.map((p) => [
          p.dateDisplay,
          fmtSigned(p.changePct, 2, '%'),
          fmtInt(p.volume),
        ]),
        hovertemplate:
          `<b>${s.index}</b> · %{customdata[0]}<br>` +
          `Đóng cửa: <b>%{y:,.2f}</b> (%{customdata[1]})<br>` +
          `KL: %{customdata[2]}<extra></extra>`,
      },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: ma20s,
        name: 'MA20',
        line: { color: '#10b981', width: 1.35, dash: 'dot' },
        hovertemplate: 'MA20: %{y:,.2f}<extra></extra>',
      },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: ma50s,
        name: 'MA50',
        line: { color: '#f59e0b', width: 1.45, dash: 'dash' },
        hovertemplate: 'MA50: %{y:,.2f}<extra></extra>',
      },
    ];

    const addMarkerTrace = (
      pts: SeriesPoint[],
      type: DistributionEvent['type']
    ) => {
      if (!pts.length) return;
      const meta = EVENT_META[type];
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: pts.map((p) => p.label),
        y: pts.map((p) => p.close),
        name: meta.label,
        marker: {
          color: meta.color,
          size: type === 'DD' ? 11 : 9,
          symbol: meta.symbol,
          line: { color: isDark ? '#0f172a' : '#ffffff', width: 1.5 },
        },
        customdata: pts.map((p) => [
          p.dateDisplay,
          fmtSigned(p.changePct, 2, '%'),
          fmtInt(p.volume),
        ]),
        hovertemplate:
          `<b>${meta.label}</b> · %{customdata[0]}<br>` +
          `Giá: <b>%{y:,.2f}</b> (%{customdata[1]})<br>` +
          `KL: %{customdata[2]}<extra></extra>`,
      });
    };

    addMarkerTrace(ddPts, 'DD');
    addMarkerTrace(stallPts, 'STALL');
    addMarkerTrace(churnPts, 'CHURN');

    // Subtle shaded band marking the active DD lookback window
    const winStartIdx = s.series.findIndex((p) => p.inWindow);
    const shapes: any[] = [];
    if (winStartIdx >= 0 && winStartIdx < s.series.length - 1) {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: s.series[winStartIdx].label,
        x1: s.series[s.series.length - 1].label,
        y0: 0,
        y1: 1,
        fillcolor: isDark ? 'rgba(56, 189, 248, 0.05)' : 'rgba(2, 132, 199, 0.045)',
        line: {
          color: isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(2, 132, 199, 0.16)',
          width: 1,
          dash: 'dot',
        },
        layer: 'below',
      });
    }

    return {
      data: traces,
      layout: {
        hovermode: 'closest',
        margin: { l: 52, r: 16, t: 34, b: 36 },
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'left',
          x: 0,
          font: { size: 11.5 },
        },
        xaxis: {
          type: 'category',
          nticks: 10,
          showgrid: false,
          tickfont: { size: 11 },
        },
        yaxis: {
          showgrid: true,
          tickfont: { size: 11 },
          zeroline: false,
        },
        shapes,
      },
    };
  }, [activeIndexSummary, isDark]);

  // Filtered & sorted sectors
  const filteredSectors = useMemo(() => {
    const base = data?.allSectors || [];
    const q = searchTxt.trim().toLowerCase();
    const list = base.filter((row) => {
      if (sectorFilter === 'leader' && row.pctAboveMa20 <= 50) return false;
      if (sectorFilter === 'weak' && row.pctBelowMa50 <= 50) return false;
      if (sectorFilter === 'warning' && !row.isWarning) return false;
      if (q && !row.industry.toLowerCase().includes(q)) return false;
      return true;
    });

    const mult = sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => (a[sortKey] - b[sortKey]) * mult);
  }, [data?.allSectors, sectorFilter, searchTxt, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-40 inline ml-0.5" />;
    return sortDir === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-sky-600 dark:text-sky-400 inline ml-0.5" />
    ) : (
      <ArrowUp className="w-3 h-3 text-sky-600 dark:text-sky-400 inline ml-0.5" />
    );
  };

  const handleExportCsv = () => {
    if (!filteredSectors.length) return;
    downloadCsv(
      `suc_khoe_nganh_${(data?.breadth.resolvedDateDisplay || 'latest').replace(/\//g, '-')}.csv`,
      [
        'Nhóm Ngành',
        '% > MA20',
        `Trước đó (Lag ${data?.breadth.ma20Lag ?? ma20Lag})`,
        'Thay đổi (đpt)',
        '% < MA50',
        'Số mã > MA20',
        'Số mã < MA50',
        'Tổng số mã',
        'Cảnh báo',
      ],
      filteredSectors.map((r) => [
        r.industry,
        r.pctAboveMa20,
        r.prevPct,
        r.change,
        r.pctBelowMa50,
        r.aboveMa20Count,
        r.belowMa50Count,
        r.count,
        r.warning,
      ])
    );
  };

  const regime = useMemo(() => (vniSummary ? getRegimeLabel(vniSummary) : null), [vniSummary]);

  const activeWin = data?.breadth.ddWin ?? ddWin;
  const activeLag = data?.breadth.ma20Lag ?? ma20Lag;

  return (
    <div className="space-y-4">
      {/* 1. Compact Command & Parameter Bar */}
      <SectionCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15.5px] font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                Sức Khỏe Thị Trường &amp; Ngày Phân Phối
              </h3>
              {data?.breadth && (
                <span className="text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
                  · Phiên {data.breadth.resolvedDateDisplay} · Cửa sổ {data.breadth.ddWin} phiên ·{' '}
                  {data.breadth.totalStocks} mã thanh khoản HOSE
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
              Theo dõi áp lực phân phối tổ chức (DD / Stalling / Churning) trên 4 chỉ số và độ rộng
              luân chuyển các nhóm ngành.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-[148px]">
              <DateInput value={maDate} onChange={setMaDate} ariaLabel="Ngày phân tích" />
            </div>

            <SecondaryButton
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Tham số ({`W${ddWin} / +${cancelReb}%`})
            </SecondaryButton>

            {data && filteredSectors.length > 0 && (
              <SecondaryButton onClick={handleExportCsv}>
                <Download className="w-3.5 h-3.5" />
                Xuất CSV
              </SecondaryButton>
            )}

            <PrimaryButton onClick={runAnalysis} loading={loading}>
              {!loading && <HeartPulse className="w-4 h-4" />}
              Phân Tích
            </PrimaryButton>
          </div>
        </div>

        {/* Collapsible Parameter Controls */}
        {showAdvanced && (
          <div className="pt-3.5 mt-3.5 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <FieldLabel label="Cửa sổ đếm DD (phiên)">
                <input
                  type="number"
                  min={10}
                  max={60}
                  value={ddWin}
                  onChange={(e) => setDdWin(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
              <FieldLabel label="Ngưỡng xóa DD khi hồi phục (%)">
                <input
                  type="number"
                  min={3}
                  max={15}
                  step={0.5}
                  value={cancelReb}
                  onChange={(e) => setCancelReb(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
              <FieldLabel label="Độ trễ so sánh MA20 ngành (phiên)">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={ma20Lag}
                  onChange={(e) => setMa20Lag(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Quy tắc đếm: <strong className="text-slate-700 dark:text-slate-300">DD</strong> (giảm
              ≥ 0.2% + Vol tăng · trọng số 1.0) ·{' '}
              <strong className="text-slate-700 dark:text-slate-300">Stalling</strong> (tăng 0–0.4%
              đóng cửa nửa dưới + Vol tăng · trọng số 0.7) ·{' '}
              <strong className="text-slate-700 dark:text-slate-300">Churning</strong> (sát đỉnh +
              Vol đột biến · trọng số 0.5). Tự động xóa nếu chỉ số hồi phục vượt ngưỡng hoặc quá{' '}
              {ddWin} phiên.
            </p>
          </div>
        )}
      </SectionCard>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ErrorBanner message={error} className="flex-1" />
          <SecondaryButton onClick={runAnalysis}>Thử lại</SecondaryButton>
        </div>
      )}

      {/* Clean Skeleton State on first load */}
      {loading && !data && (
        <div className="space-y-4">
          <SectionCard className="p-4">
            <div className="flex items-center gap-3 text-[13px] text-slate-600 dark:text-slate-300">
              <span className="w-4 h-4 border-2 border-sky-600 dark:border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>
                Đang đếm ngày phân phối 4 chỉ số và quét độ rộng MA20 / MA50 các nhóm ngành HOSE...
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-pulse">
              <div className="lg:col-span-5 space-y-3">
                <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-7 w-64 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full" />
              </div>
              <div className="lg:col-span-7 grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 bg-slate-100 dark:bg-slate-800/70 rounded-lg"
                  />
                ))}
              </div>
            </div>
          </SectionCard>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <SectionCard className="lg:col-span-8 p-4 h-[360px] animate-pulse">
              <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded mb-4" />
              <div className="h-[290px] bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
            </SectionCard>
            <SectionCard className="lg:col-span-4 p-4 h-[360px] animate-pulse space-y-2.5">
              <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded mb-3" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 bg-slate-100 dark:bg-slate-800/70 rounded" />
              ))}
            </SectionCard>
          </div>
        </div>
      )}

      {/* Main Populated Dashboard */}
      {data && vniSummary && regime && (
        <div className="space-y-4">
          {/* 2. Focal Anchor: VNINDEX Regime Verdict + 4-Index Distribution Scorecard */}
          <SectionCard className="p-4 sm:p-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-0 items-stretch">
              {/* Left: Primary VNINDEX Health & Recommended Allocation */}
              <div className="lg:col-span-5 lg:pr-6 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Trạng thái thị trường VNINDEX
                    </span>
                    <span className="font-mono tabular-nums">
                      {fmtNum(vniSummary.close, 2)}{' '}
                      <span className={colorSignedClass(vniSummary.changePct)}>
                        ({fmtSigned(vniSummary.changePct, 2, '%')})
                      </span>
                    </span>
                  </div>

                  <div className="flex items-start gap-2.5">
                    {regime.tone === 'emerald' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : regime.tone === 'red' ? (
                      <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <h4
                        className={`text-[17px] font-bold tracking-tight leading-snug ${
                          regime.tone === 'emerald'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : regime.tone === 'red'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {regime.title}
                      </h4>
                      <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        {regime.subtitle}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Allocation + Risk Score dual bar */}
                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="text-[12px] text-slate-500 dark:text-slate-400">
                      Tỷ trọng cổ phiếu đề xuất
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[26px] font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-slate-50 leading-none">
                        {vniSummary.targetExposure}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full rounded-full transition-all ${
                          vniSummary.targetExposure >= 70
                            ? 'bg-emerald-500'
                            : vniSummary.targetExposure >= 30
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, vniSummary.targetExposure))}%` }}
                      />
                    </div>
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5 truncate">
                      {vniSummary.allocReason}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] text-slate-500 dark:text-slate-400">
                      Điểm rủi ro phân phối
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span
                        className={`text-[26px] font-bold font-mono tabular-nums tracking-tight leading-none ${
                          vniSummary.riskScore >= 5
                            ? 'text-red-600 dark:text-red-400'
                            : vniSummary.riskScore >= 3
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {fmtNum(vniSummary.riskScore, 1)}
                      </span>
                      <span className="text-[12px] font-mono text-slate-400 dark:text-slate-500">
                        / 9.0
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full rounded-full transition-all ${
                          vniSummary.riskScore >= 5
                            ? 'bg-red-500'
                            : vniSummary.riskScore >= 3
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(4, (vniSummary.riskScore / 9) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5 font-mono tabular-nums">
                      DD {vniSummary.dd} · Stall {vniSummary.stall} · Churn {vniSummary.churn}
                    </div>
                  </div>
                </div>

                {/* MA20 / MA50 / MA200 structural position strip (unboxed text, zero pills) */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[12px] tabular-nums">
                  {[
                    { label: 'MA20', val: vniSummary.ma20, above: vniSummary.aboveMa20 },
                    { label: 'MA50', val: vniSummary.ma50, above: vniSummary.aboveMa50 },
                    { label: 'MA200', val: vniSummary.ma200, above: vniSummary.aboveMa200 },
                  ].map((m) => (
                    <span
                      key={m.label}
                      className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
                    >
                      {m.above === true ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : m.above === false ? (
                        <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                      ) : (
                        <span className="w-3.5 h-3.5 inline-block text-center text-slate-400">—</span>
                      )}
                      <span className="font-semibold">{m.label}</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {m.val !== null ? fmtNum(m.val, 1) : '—'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Right: 4-Index Distribution Scorecard (click any index to inspect chart & events) */}
              <div className="lg:col-span-7 lg:pl-6 lg:border-l border-slate-100 dark:border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                    So sánh phân phối 4 chỉ số chính ({activeWin} phiên)
                  </span>
                  <span className="text-[11.5px] text-slate-400 dark:text-slate-500">
                    Bấm vào chỉ số để xem biểu đồ &amp; nhật ký
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead className={tableHeadCls}>
                      <tr>
                        <th className="py-2 px-2.5 text-left">Chỉ số</th>
                        <th className="py-2 px-2.5 text-right">Điểm / %</th>
                        <th className="py-2 px-2.5 text-right">DD</th>
                        <th className="py-2 px-2.5 text-right">Stall</th>
                        <th className="py-2 px-2.5 text-right">Churn</th>
                        <th className="py-2 px-2.5 text-right">Rủi ro</th>
                        <th className="py-2 px-2.5 text-right">MA20 / MA50</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {data.summaries.map((s) => {
                        const isSelected = activeIndexSummary?.index === s.index;
                        const tone = getRiskTone(s.riskScore, s.aboveMa50);
                        return (
                          <tr
                            key={s.index}
                            onClick={() => setSelectedIndex(s.index)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-sky-50/80 dark:bg-sky-950/35'
                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/45'
                            }`}
                          >
                            <td className="py-2.5 px-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-bold font-mono ${
                                    isSelected
                                      ? 'text-sky-700 dark:text-sky-400'
                                      : 'text-slate-900 dark:text-slate-100'
                                  }`}
                                >
                                  {s.index}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {fmtNum(s.close, 2)}
                              </span>{' '}
                              <span className={`text-[12px] ${colorSignedClass(s.changePct)}`}>
                                {fmtSigned(s.changePct, 2, '%')}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  s.dd >= 5
                                    ? 'text-red-600 dark:text-red-400 font-bold'
                                    : s.dd >= 3
                                    ? 'text-amber-600 dark:text-amber-400 font-bold'
                                    : 'text-slate-700 dark:text-slate-300 font-semibold'
                                }
                              >
                                {s.dd}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {s.stall}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {s.churn}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                              <span
                                className={`font-bold ${
                                  tone === 'red'
                                    ? 'text-red-600 dark:text-red-400'
                                    : tone === 'amber'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                {fmtNum(s.riskScore, 1)}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right text-[12px] whitespace-nowrap">
                              <span
                                className={
                                  s.aboveMa20
                                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                    : 'text-red-600 dark:text-red-400 font-medium'
                                }
                              >
                                {s.aboveMa20 ? 'Trên' : 'Dưới'}
                              </span>
                              <span className="text-slate-300 dark:text-slate-700 mx-1">/</span>
                              <span
                                className={
                                  s.aboveMa50
                                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                    : 'text-red-600 dark:text-red-400 font-medium'
                                }
                              >
                                {s.aboveMa50 ? 'Trên' : 'Dưới'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Quick summary of active index DD dates */}
                {activeIndexSummary && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
                    <span className="leading-relaxed">
                      Ngày phân phối (DD) của{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {activeIndexSummary.index}
                      </strong>
                      :{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {activeIndexSummary.ddDates}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      Cập nhật {activeIndexSummary.dateDisplay}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          {/* 3. Distribution Days Overlay Chart + Chronological Event Log */}
          {activeIndexSummary && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* Left 8 cols: Interactive Price + MA20/MA50 + Distribution Markers Chart */}
              <SectionCard className="lg:col-span-8 p-4 flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h4 className="text-[14.5px] font-bold text-slate-900 dark:text-slate-100">
                      Biểu Đồ Ngày Phân Phối ·{' '}
                      <span className="font-mono text-sky-600 dark:text-sky-400">
                        {activeIndexSummary.index}
                      </span>
                    </h4>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                      Vùng tô mờ biểu thị cửa sổ {activeWin} phiên đang tính điểm rủi ro (tổng{' '}
                      {activeIndexSummary.events.length} sự kiện).
                    </p>
                  </div>

                  <SegmentedControl
                    value={activeIndexSummary.index}
                    onChange={setSelectedIndex}
                    options={data.summaries.map((s) => ({
                      value: s.index,
                      label: s.index,
                    }))}
                  />
                </div>

                {distChart ? (
                  <div className="flex-1 min-h-[320px]">
                    <PlotlyChart
                      data={distChart.data}
                      layout={distChart.layout}
                      height={330}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-[13px] text-slate-500 dark:text-slate-400 py-12">
                    Không đủ dữ liệu lịch sử để vẽ biểu đồ phân phối.
                  </div>
                )}
              </SectionCard>

              {/* Right 4 cols: Event Log with expiry countdown */}
              <SectionCard className="lg:col-span-4 p-4 flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h4 className="text-[14.5px] font-bold text-slate-900 dark:text-slate-100">
                      Nhật Ký Sự Kiện ({activeIndexSummary.events.length})
                    </h4>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                      Sắp xếp mới nhất · kèm số phiên còn hiệu lực
                    </p>
                  </div>
                </div>

                {activeIndexSummary.events.length > 0 ? (
                  <div className="overflow-y-auto max-h-[330px] -mx-1 px-1">
                    <table className="w-full text-[12.5px] border-collapse">
                      <thead className={tableHeadCls}>
                        <tr>
                          <th className="py-1.5 px-2 text-left">Ngày</th>
                          <th className="py-1.5 px-2 text-left">Loại</th>
                          <th className="py-1.5 px-2 text-right">% Giá</th>
                          <th className="py-1.5 px-2 text-right">Hiệu lực</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {activeIndexSummary.events.map((ev) => {
                          const meta = EVENT_META[ev.type];
                          return (
                            <tr key={`${ev.date}-${ev.type}`} className={tableRowCls}>
                              <td className="py-2 px-2 font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {ev.dateDisplay}
                              </td>
                              <td className={`py-2 px-2 whitespace-nowrap ${meta.textCls}`}>
                                {meta.short}
                              </td>
                              <td
                                className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${colorSignedClass(
                                  ev.changePct
                                )}`}
                              >
                                {fmtSigned(ev.changePct, 2, '%')}
                              </td>
                              <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                còn {ev.sessionsLeft}p
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500 mb-2" />
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">
                      Không có phiên phân phối
                    </p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1 max-w-[260px]">
                      {activeIndexSummary.index} không ghi nhận phiên DD, Stalling hay Churning nào
                      trong {activeWin} phiên gần nhất.
                    </p>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* 4. HOSE Breadth Overview + Unified Sector Strength & Rotation Explorer */}
          <SectionCard className="p-4 space-y-4">
            {/* Compact Market Breadth Strip (single container, hairline dividers — zero nested cards) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Độ rộng HOSE &gt; MA20
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span
                    className={`text-[20px] font-bold font-mono tabular-nums ${colorPctStrengthClass(
                      data.breadth.aboveMa20Pct
                    )}`}
                  >
                    {fmtNum(data.breadth.aboveMa20Pct, 1)}%
                  </span>
                  <span className="text-[11.5px] font-mono text-slate-400 dark:text-slate-500">
                    ({data.breadth.aboveMa20Count}/{data.breadth.totalStocks})
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, data.breadth.aboveMa20Pct)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Độ rộng HOSE &gt; MA50
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span
                    className={`text-[20px] font-bold font-mono tabular-nums ${colorPctStrengthClass(
                      data.breadth.aboveMa50Pct
                    )}`}
                  >
                    {fmtNum(data.breadth.aboveMa50Pct, 1)}%
                  </span>
                  <span className="text-[11.5px] font-mono text-slate-400 dark:text-slate-500">
                    ({data.breadth.aboveMa50Count}/{data.breadth.totalStocks})
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-sky-500 rounded-full"
                    style={{ width: `${Math.min(100, data.breadth.aboveMa50Pct)}%` }}
                  />
                </div>
              </div>

              <div className="sm:pl-4 sm:border-l border-slate-100 dark:border-slate-800">
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Ngành dẫn dắt (&gt;50% MA20)
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-[20px] font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {data.breadth.leaderSectorsCount}
                  </span>
                  <span className="text-[12px] text-slate-400 dark:text-slate-500">
                    / {data.breadth.totalSectors} ngành
                  </span>
                </div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">
                  Dòng tiền ngắn hạn tích cực
                </div>
              </div>

              <div className="lg:pl-4 lg:border-l border-slate-100 dark:border-slate-800">
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Ngành suy yếu (&gt;50% &lt;MA50)
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-[20px] font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
                    {data.breadth.weakSectorsCount}
                  </span>
                  <span className="text-[12px] text-slate-400 dark:text-slate-500">
                    / {data.breadth.totalSectors} ngành
                  </span>
                </div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">
                  Xu hướng trung hạn yếu
                </div>
              </div>

              <div className="lg:pl-4 lg:border-l border-slate-100 dark:border-slate-800">
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Cảnh báo suy yếu nhanh
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span
                    className={`text-[20px] font-bold font-mono tabular-nums ${
                      data.breadth.warningSectorsCount > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {data.breadth.warningSectorsCount}
                  </span>
                  <span className="text-[12px] text-slate-400 dark:text-slate-500">ngành</span>
                </div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">
                  Giảm ≥ 25 đpt so với Lag {activeLag}
                </div>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h4 className="text-[14.5px] font-bold text-slate-900 dark:text-slate-100">
                  Độ Rộng &amp; Luân Chuyển Nhóm Ngành HOSE
                </h4>
                <SegmentedControl
                  value={sectorFilter}
                  onChange={(v) => setSectorFilter(v as SectorFilter)}
                  options={[
                    { value: 'all', label: `Tất cả (${data.allSectors.length})` },
                    { value: 'leader', label: `Dẫn dắt (${data.leaders.length})` },
                    { value: 'weak', label: `Suy yếu (${data.weak.length})` },
                    {
                      value: 'warning',
                      label: `Giảm tốc (${data.breadth.warningSectorsCount})`,
                    },
                  ]}
                />
              </div>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchTxt}
                  onChange={(e) => setSearchTxt(e.target.value)}
                  placeholder="Tìm nhóm ngành..."
                  className={`${inputCls} pl-8 pr-7`}
                />
                {searchTxt && (
                  <button
                    type="button"
                    onClick={() => setSearchTxt('')}
                    aria-label="Xóa từ khóa tìm kiếm"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Unified Sortable Sector Breadth Table */}
            {filteredSectors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead className={tableHeadCls}>
                    <tr>
                      <th className="py-2 px-2.5 text-left">Nhóm Ngành</th>
                      <th className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('pctAboveMa20')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          % &gt; MA20 <SortIcon col="pctAboveMa20" />
                        </button>
                      </th>
                      <th className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('prevPct')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          Trước đó (Lag {activeLag}) <SortIcon col="prevPct" />
                        </button>
                      </th>
                      <th className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('change')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          Biến động <SortIcon col="change" />
                        </button>
                      </th>
                      <th className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('pctBelowMa50')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          % &lt; MA50 <SortIcon col="pctBelowMa50" />
                        </button>
                      </th>
                      <th className="py-2 px-2.5 text-left">Trạng thái</th>
                      <th className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('count')}
                          className="inline-flex items-center hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          Số mã <SortIcon col="count" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredSectors.map((r) => (
                      <tr key={r.industry} className={tableRowCls}>
                        <td className="py-2.5 px-2.5 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {r.industry}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                          <div className="inline-flex items-center justify-end gap-2.5 min-w-[112px]">
                            <div className="w-14 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  r.pctAboveMa20 >= 60
                                    ? 'bg-emerald-500'
                                    : r.pctAboveMa20 > 50
                                    ? 'bg-sky-500'
                                    : 'bg-slate-400 dark:bg-slate-600'
                                }`}
                                style={{ width: `${Math.min(100, r.pctAboveMa20)}%` }}
                              />
                            </div>
                            <span
                              className={`w-12 text-right ${colorPctStrengthClass(
                                r.pctAboveMa20
                              )}`}
                            >
                              {fmtNum(r.pctAboveMa20, 1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {fmtNum(r.prevPct, 1)}%
                        </td>
                        <td
                          className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                            r.change
                          )}`}
                        >
                          {fmtSigned(r.change, 1, '%')}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                          <div className="inline-flex items-center justify-end gap-2.5 min-w-[112px]">
                            <div className="w-14 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  r.pctBelowMa50 >= 65
                                    ? 'bg-red-500'
                                    : r.pctBelowMa50 > 50
                                    ? 'bg-amber-500'
                                    : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                                style={{ width: `${Math.min(100, r.pctBelowMa50)}%` }}
                              />
                            </div>
                            <span
                              className={`w-12 text-right ${
                                r.pctBelowMa50 > 50
                                  ? colorPctWeakClass(r.pctBelowMa50)
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {fmtNum(r.pctBelowMa50, 1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap text-[12.5px]">
                          {r.isWarning ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Suy yếu nhanh
                            </span>
                          ) : r.status === 'leader' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                              <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                              Dẫn dắt
                            </span>
                          ) : r.status === 'weak' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                              <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                              Suy yếu
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">Trung tính</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {r.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
                Không có nhóm ngành nào khớp bộ lọc hiện tại.
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
};
