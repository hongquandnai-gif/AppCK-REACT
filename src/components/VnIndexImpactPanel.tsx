import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, RefreshCw, Search } from 'lucide-react';
import { PlotlyChart } from './PlotlyChart';
import {
  ErrorBanner,
  LoadingBar,
  SecondaryButton,
  SectionCard,
  SegmentedControl,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from './UiPrimitives';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { useTheme } from '../context/ThemeContext';
import { patchVnIndexImpactWithTicks } from '../utils/livePatch';
import { colorSignedClass, fmtDisplayDateOrTime, fmtNum, fmtSigned, vnTodayIso } from '../utils/format';

export interface VnIndexImpactStock {
  symbol: string;
  companyName: string;
  industry: string;
  price: number;
  prevPrice: number;
  delta: number;
  pct: number;
  impact: number;
  weight: number;
  valueBil: number;
  outstandingShares: number;
  prevCmv: number;
  bmv: number;
}

export interface VnIndexImpactResp {
  indexCode: 'VNINDEX';
  empty?: boolean;
  requestedDate: string;
  resolvedDate: string;
  resolvedDateDisplay: string;
  resolvedDateShort: string;
  source: string;
  isLiveWs: boolean;
  liveWsCount: number;
  syncTime: string;
  summary: {
    netImpact: number;
    positiveImpact: number;
    negativeImpact: number;
    positiveCount: number;
    negativeCount: number;
    flatCount: number;
  };
  topPositive: VnIndexImpactStock[];
  topNegative: VnIndexImpactStock[];
  stocks: VnIndexImpactStock[];
}

interface Props {
  date: string;
  isActive?: boolean;
  refreshSignal?: number;
}

const IMPACT_WILDCARD = ['*'];

export const VnIndexImpactPanel: React.FC<Props> = ({
  date,
  isActive = true,
  refreshSignal = 0,
}) => {
  const { isDark } = useTheme();
  const { liveAuto, ticks, tickVersion, syncVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);

  const [data, setData] = useState<VnIndexImpactResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topN, setTopN] = useState<'10' | '15'>('10');
  const [sideFilter, setSideFilter] = useState<'all' | 'pos' | 'neg'>('all');
  const [searchTxt, setSearchTxt] = useState('');

  const loadImpact = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const q = new URLSearchParams({
          date,
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/vnindex-impact?${q.toString()}`);
        if (resp.ok) {
          const json: VnIndexImpactResp = await resp.json();
          setData(json);
          setError(null);
        } else if (!silent) {
          setError('Không thể tải dữ liệu tác động tới chỉ số VNINDEX.');
        }
      } catch {
        if (!silent) setError('Lỗi kết nối khi tải dữ liệu tác động VNINDEX.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date]
  );

  // Subscribe to all live HOSE ticks when viewing today so VNINDEX impact updates seamlessly via SSI WS
  useSubscribeSymbols(IMPACT_WILDCARD, isActive && date === today && liveAuto);

  useEffect(() => {
    if (!isActive) return;
    loadImpact(false, false);
  }, [isActive, loadImpact]);

  const lastRefreshSigRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === lastRefreshSigRef.current) return;
    lastRefreshSigRef.current = refreshSignal;
    if (!isActive) return;
    loadImpact(true, false);
  }, [refreshSignal, isActive, loadImpact]);

  // Patch live per-stock VNINDEX impact in-place from SSI WebSocket ticks without resetting chart zoom
  useEffect(() => {
    if (!liveAuto || !isActive || date !== today) return;
    setData((prev) => patchVnIndexImpactWithTicks(prev, ticks));
  }, [tickVersion, ticks, liveAuto, isActive, date, today]);

  // Silently reconcile on periodic server index sync
  const lastSyncRef = useRef(syncVersion.indices);
  useEffect(() => {
    if (syncVersion.indices === lastSyncRef.current) return;
    lastSyncRef.current = syncVersion.indices;
    if (!liveAuto || !isActive || date !== today) return;
    loadImpact(false, true);
  }, [syncVersion.indices, liveAuto, isActive, date, today, loadImpact]);

  // Diverging vertical bar chart: Top N positive contributors (left, green) + Top N negative contributors (right, red)
  const impactChart = useMemo(() => {
    if (!data || data.empty || !data.stocks?.length) return null;
    const limit = Number(topN) || 10;
    const pos = data.topPositive.slice(0, limit);
    // Order negative from smallest drag to largest drag left-to-right so strongest red bar sits on the far right (mirroring strongest green on far left)
    const neg = [...data.topNegative.slice(0, limit)].reverse();
    const combined = [...pos, ...neg];
    if (!combined.length) return null;

    const xSymbols = combined.map((s) => s.symbol);
    const yVals = combined.map((s) => Number(s.impact.toFixed(2)));
    const colors = yVals.map((v) => (v >= 0 ? '#10b981' : '#ef4444'));
    const barTexts = yVals.map((v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
    const hoverTexts = combined.map(
      (s) =>
        `<b>${s.symbol}</b> — ${s.industry}<br>` +
        `Tác động VNINDEX: <b>${fmtSigned(s.impact, 2)} điểm</b><br>` +
        `Giá: <b>${fmtNum(s.price, 2)}</b> (${fmtSigned(s.pct, 2, '%')})<br>` +
        `Tỷ trọng rổ: <b>${fmtNum(s.weight, 2)}%</b>` +
        (s.valueBil > 0 ? `<br>GTGD: <b>${fmtNum(s.valueBil, 1)} Tỷ</b>` : '')
    );

    const maxPos = Math.max(0.2, ...yVals.filter((v) => v > 0));
    const maxNeg = Math.max(0.2, ...yVals.filter((v) => v < 0).map((v) => Math.abs(v)));
    // Give clean top/bottom headroom for outside value labels without clipping
    const yMax = Number((maxPos * 1.22).toFixed(2));
    const yMin = -Number((Math.max(maxNeg * 1.28, maxPos * 0.24)).toFixed(2));

    const traces: any[] = [
      {
        type: 'bar',
        x: xSymbols,
        y: yVals,
        text: barTexts,
        textposition: 'outside',
        cliponaxis: false,
        textfont: {
          size: limit > 10 ? 9.5 : 10.5,
          color: isDark ? '#cbd5e1' : '#334155',
        },
        hovertext: hoverTexts,
        hovertemplate: '%{hovertext}<extra></extra>',
        marker: {
          color: colors,
          line: { width: 0 },
        },
      },
    ];

    const layout: Record<string, any> = {
      uirevision: `vnindex_impact_${date}_${topN}`,
      showlegend: false,
      hovermode: 'closest',
      margin: { l: 48, r: 16, t: 18, b: 44 },
      xaxis: {
        type: 'category',
        showgrid: false,
        tickangle: limit > 10 ? -38 : 0,
        tickfont: {
          size: limit > 10 ? 10.5 : 11.5,
          color: isDark ? '#e2e8f0' : '#0f172a',
        },
      },
      yaxis: {
        title: { text: 'Điểm tác động', font: { size: 11, color: '#64748b' } },
        range: [yMin, yMax],
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: true,
        zerolinecolor: '#64748b',
        zerolinewidth: 1.4,
      },
    };

    return { traces, layout };
  }, [data, topN, date, isDark]);

  const filteredStocks = useMemo(() => {
    if (!data?.stocks?.length) return [];
    const q = searchTxt.trim().toUpperCase();
    const list = data.stocks.filter((s) => {
      if (sideFilter === 'pos' && s.impact <= 0) return false;
      if (sideFilter === 'neg' && s.impact >= 0) return false;
      if (
        q &&
        !s.symbol.includes(q) &&
        !s.companyName.toUpperCase().includes(q) &&
        !s.industry.toUpperCase().includes(q)
      ) {
        return false;
      }
      return Math.abs(s.impact) >= 0.001 || q.length > 0;
    });

    if (sideFilter === 'pos') {
      return [...list].sort((a, b) => b.impact - a.impact);
    }
    if (sideFilter === 'neg') {
      return [...list].sort((a, b) => a.impact - b.impact);
    }
    return [...list].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }, [data, sideFilter, searchTxt]);

  return (
    <SectionCard className="p-3.5 space-y-3">
      {/* Header + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 dark:border-slate-800">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
              Tác Động Tới Chỉ Số VNINDEX Theo Mã
            </h4>
            {data && !data.empty && (
              <span className="text-[12px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                ({data.resolvedDateDisplay})
              </span>
            )}
            {data?.isLiveWs && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                SSI WS · {fmtDisplayDateOrTime(data.syncTime)}
              </span>
            )}
          </div>
          {data && !data.empty && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span>
                Tổng tác động:{' '}
                <strong className={`font-mono ${colorSignedClass(data.summary.netImpact)}`}>
                  {fmtSigned(data.summary.netImpact, 2)} đ
                </strong>
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span>
                Kéo tăng:{' '}
                <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                  +{fmtNum(data.summary.positiveImpact, 2)} đ
                </strong>{' '}
                ({data.summary.positiveCount} mã)
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span>
                Kéo giảm:{' '}
                <strong className="font-mono text-red-600 dark:text-red-400">
                  {fmtNum(data.summary.negativeImpact, 2)} đ
                </strong>{' '}
                ({data.summary.negativeCount} mã)
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl
            value={topN}
            onChange={setTopN}
            options={[
              { value: '10', label: 'Top 10' },
              { value: '15', label: 'Top 15' },
            ]}
          />
          <SecondaryButton
            onClick={() => loadImpact(true, false)}
            disabled={loading}
            aria-label="Làm mới tác động VNINDEX"
            className="px-2.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </SecondaryButton>
        </div>
      </div>

      {loading && !data && (
        <LoadingBar text="Đang tải dữ liệu tác động tới chỉ số VNINDEX..." />
      )}

      {error && <ErrorBanner message={error} />}

      {data && !data.empty && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Vertical Diverging Bar Chart */}
          <div className="lg:col-span-7 min-w-0">
            <div className="flex items-center justify-between text-[11.5px] text-slate-500 dark:text-slate-400 px-1 mb-1">
              <span>
                Top {topN} mã dẫn dắt tăng (xanh) &amp; Top {topN} mã gây áp lực giảm (đỏ)
              </span>
              <span className="font-mono">Đơn vị: điểm VNINDEX</span>
            </div>
            {impactChart ? (
              <PlotlyChart data={impactChart.traces} layout={impactChart.layout} height={360} />
            ) : (
              <div className="p-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
                Chưa có biến động tác động điểm trên VNINDEX.
              </div>
            )}
          </div>

          {/* Right: Interactive Filterable Detail Table */}
          <div className="lg:col-span-5 min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                value={sideFilter}
                onChange={setSideFilter}
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'pos', label: 'Kéo tăng' },
                  { value: 'neg', label: 'Kéo giảm' },
                ]}
              />
              <div className="relative flex-1 min-w-[130px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchTxt}
                  onChange={(e) => setSearchTxt(e.target.value)}
                  placeholder="Tìm mã / ngành..."
                  className={`${inputCls} pl-8 h-9 text-[12.5px]`}
                />
              </div>
            </div>

            <div className="overflow-auto max-h-[322px] border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-[12px] border-collapse">
                <thead className={tableHeadCls}>
                  <tr className="text-left">
                    <th className="py-2 px-2.5">Mã</th>
                    <th className="py-2 px-2 text-right">Giá</th>
                    <th className="py-2 px-2 text-right">%</th>
                    <th className="py-2 px-2.5 text-right">Tác động</th>
                    <th className="py-2 px-2 text-right">Tỷ trọng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredStocks.slice(0, 80).map((row) => (
                    <tr key={row.symbol} className={tableRowCls} title={`${row.companyName} · ${row.industry}`}>
                      <td className="py-1.5 px-2.5">
                        <div className="font-bold font-mono text-slate-900 dark:text-slate-100">
                          {row.symbol}
                        </div>
                        <div className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate max-w-[110px]">
                          {row.industry}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {fmtNum(row.price, 2)}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-mono tabular-nums ${colorSignedClass(
                          row.pct
                        )}`}
                      >
                        {fmtSigned(row.pct, 2, '%')}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 text-right font-bold font-mono tabular-nums ${colorSignedClass(
                          row.impact
                        )}`}
                      >
                        {fmtSigned(row.impact, 2)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {fmtNum(row.weight, 2)}%
                      </td>
                    </tr>
                  ))}
                  {filteredStocks.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-6 text-center text-slate-400 dark:text-slate-500"
                      >
                        Không tìm thấy mã phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
};
