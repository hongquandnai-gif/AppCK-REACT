import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart2,
  Flame,
  Globe,
  HeartPulse,
  LayoutGrid,
  RefreshCw,
  Snowflake,
} from 'lucide-react';
import { ALL_MAIN_INDICES, getVnTreemapColor } from '../shared/constants';
import { DateInput } from '../components/DateInput';
import { PlotlyChart } from '../components/PlotlyChart';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { useTheme } from '../context/ThemeContext';
import { patchIndicesWithTicks, patchTreemapWithTicks } from '../utils/livePatch';
import { VnIndexImpactPanel } from '../components/VnIndexImpactPanel';
import { ForeignTradingPanel } from './ForeignTradingPanel';
import {
  ErrorBanner,
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SectionCard,
  SegmentedControl,
  SubTabs,
  inputCls,
  tableHeadCls,
  tableRowCls,
} from '../components/UiPrimitives';
import {
  colorPctStrengthClass,
  colorPctWeakClass,
  colorSignedClass,
  colorStatusClass,
  fmtDisplayDateOrTime,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface Props {
  isActive?: boolean;
}

const TREEMAP_WILDCARD = ['*'];

interface MarketTotalSummary {
  dateDisplay: string;
  totalValBil: number;
  nmValBil: number;
  ptValBil: number;
  totalVolMil: number;
  prevTotalValBil: number;
  valDeltaPct: number | null;
}

interface IntradayLiquidityResp {
  symbol: string;
  empty?: boolean;
  source?: string;
  isLiveNow?: boolean;
  cutoffTime?: string;
  curDate?: string;
  curDateDisplay?: string;
  curDateShort?: string;
  prevDate?: string | null;
  prevDateDisplay?: string | null;
  prevDateShort?: string | null;
  avgSessionsCount?: number;
  times?: string[];
  series?: {
    curVol: (number | null)[];
    prevVol: (number | null)[];
    avg5Vol: (number | null)[];
    curVal: (number | null)[];
    prevVal: (number | null)[];
    avg5Val: (number | null)[];
  };
  summary?: {
    curVolMil: number;
    prevVolMil: number;
    volDiffMil: number;
    volDiffPct: number | null;
    avg5VolMil: number;
    volVsAvg5Pct: number | null;
    curValBil: number;
    prevValBil: number;
    valDiffBil: number;
    valDiffPct: number | null;
    avg5ValBil: number;
    valVsAvg5Pct: number | null;
    officialTotalValBil: number;
    officialNmValBil: number;
    officialPtValBil: number;
    officialTotalVolMil: number;
    officialPrevTotalValBil: number;
  };
  milestones?: Array<{
    time: string;
    curVol: number | null;
    prevVol: number | null;
    volDiffPct: number | null;
    curVal: number | null;
    prevVal: number | null;
    valDiffPct: number | null;
  }>;
}

const LIQUIDITY_SYMBOLS: Array<{ id: string; label: string }> = [
  { id: 'VNINDEX', label: 'VNINDEX' },
  { id: 'VN30', label: 'VN30' },
  { id: 'HNX', label: 'HNX' },
  { id: 'UPCOM', label: 'UPCOM' },
  { id: 'VNMID', label: 'VNMID' },
  { id: 'VNSMALL', label: 'VNSMALL' },
  { id: 'ALL3', label: 'Toàn TT (3 sàn)' },
];

export const MarketOverviewWorkspace: React.FC<Props> = ({ isActive = true }) => {
  const { isDark } = useTheme();
  const { liveAuto, ticks, tickVersion, syncVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'indices' | 'liquidity' | 'treemap' | 'foreign' | 'health'>(
    'indices'
  );

  // --- Sub-tab 1.1: Indices Live ---
  const [idxDate, setIdxDate] = useState(today);
  const [selectedIndices, setSelectedIndices] = useState<string[]>(ALL_MAIN_INDICES);
  const [idxData, setIdxData] = useState<any[]>([]);
  const [idxMeta, setIdxMeta] = useState<{
    dataSource?: string;
    syncTime?: string;
    marketTotal?: MarketTotalSummary | null;
  }>({});
  const [idxLoading, setIdxLoading] = useState(false);
  const [idxRefreshSig, setIdxRefreshSig] = useState(0);

  const loadIndices = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!selectedIndices.length) {
        setIdxData([]);
        return;
      }
      if (!silent) setIdxLoading(true);
      try {
        const q = new URLSearchParams({
          date: idxDate,
          indices: selectedIndices.join(','),
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/indices-live?${q.toString()}`);
        if (resp.ok) {
          const json = await resp.json();
          setIdxData(json.indices || []);
          setIdxMeta({
            dataSource: json.dataSource,
            syncTime: json.syncTime,
            marketTotal: json.marketTotal || null,
          });
        }
      } finally {
        if (!silent) setIdxLoading(false);
      }
    },
    [idxDate, selectedIndices]
  );

  useSubscribeSymbols(
    selectedIndices,
    isActive && subTab === 'indices' && idxDate === today && liveAuto
  );

  useEffect(() => {
    if (subTab !== 'indices') return;
    loadIndices(false, false);
  }, [subTab, loadIndices]);

  // Patch live index prices & values in-place on WS ticks without interrupting chart zoom/hover
  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'indices' || idxDate !== today) return;
    setIdxData((prev) => patchIndicesWithTicks(prev, ticks));
  }, [tickVersion, ticks, liveAuto, isActive, subTab, idxDate, today]);

  // Silently reconcile index candles & official total GTGD when server pushes a sync event
  const lastIdxSyncRef = useRef(syncVersion.indices);
  useEffect(() => {
    if (syncVersion.indices === lastIdxSyncRef.current) return;
    lastIdxSyncRef.current = syncVersion.indices;
    if (!liveAuto || !isActive || subTab !== 'indices' || idxDate !== today) return;
    loadIndices(false, true);
  }, [syncVersion.indices, liveAuto, isActive, subTab, idxDate, today, loadIndices]);

  const indicesChart = useMemo(() => {
    if (!idxData.length) return null;
    const nSel = idxData.length;
    const nCols = nSel === 1 ? 1 : 2;
    const nRows = Math.ceil(nSel / nCols);
    const traces: any[] = [];
    const shapes: any[] = [];
    const annotations: any[] = [];
    const layout: Record<string, any> = {
      uirevision: 'v11_keep_view',
      showlegend: false,
      hovermode: 'x unified',
      margin: { l: 46, r: 16, t: 34, b: 28 },
      grid: { rows: nRows, columns: nCols, pattern: 'independent', roworder: 'top to bottom' },
    };

    idxData.forEach((item, i) => {
      const axisNum = i + 1;
      const xRef = axisNum === 1 ? 'x' : `x${axisNum}`;
      const yRef = axisNum === 1 ? 'y' : `y${axisNum}`;
      const lineCol = item.delta > 0 ? '#10b981' : item.delta < 0 ? '#ef4444' : '#d97706';

      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: item.points.map((p: any) => p.x),
        y: item.points.map((p: any) => p.close),
        text: item.points.map((p: any) => p.hover),
        hovertemplate: '%{text}<extra></extra>',
        name: item.symbol,
        line: { color: lineCol, width: 2 },
        xaxis: xRef,
        yaxis: yRef,
      });

      const xKey = axisNum === 1 ? 'xaxis' : `xaxis${axisNum}`;
      const yKey = axisNum === 1 ? 'yaxis' : `yaxis${axisNum}`;
      layout[xKey] = {
        type: 'category',
        nticks: 10,
        showgrid: true,
        gridcolor: '#f1f5f9',
        zeroline: false,
      };
      layout[yKey] = {
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: false,
      };

      if (item.prevClose) {
        shapes.push({
          type: 'line',
          xref: `${xRef} domain`,
          x0: 0,
          x1: 1,
          yref: yRef,
          y0: item.prevClose,
          y1: item.prevClose,
          line: { dash: 'dash', color: '#64748b', width: 1.1 },
        });
      }

      const valLabel = item.totalValBil > 0 ? ` · ${fmtNum(item.totalValBil, 0)} Tỷ` : '';
      annotations.push({
        xref: `${xRef} domain`,
        yref: `${yRef} domain`,
        x: 0.5,
        y: 1.07,
        text: `<b>${item.symbol}</b>${valLabel}`,
        showarrow: false,
        font: { size: 12.5, color: '#0f172a' },
      });
    });

    layout.shapes = shapes;
    layout.annotations = annotations;

    return { traces, layout, height: Math.max(420, nRows * 250) };
  }, [idxData]);

  // --- Sub-tab 1.1B: Intraday Liquidity Comparison ---
  const [liqSym, setLiqSym] = useState<string>('VNINDEX');
  const [liqDate, setLiqDate] = useState(today);
  const [liqMetric, setLiqMetric] = useState<'vol' | 'val'>('vol');
  const [liqShowAvg5, setLiqShowAvg5] = useState(true);
  const [liqResp, setLiqResp] = useState<IntradayLiquidityResp | null>(null);
  const [liqLoading, setLiqLoading] = useState(false);
  const [liqError, setLiqError] = useState<string | null>(null);

  const loadLiquidity = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) {
        setLiqLoading(true);
        setLiqError(null);
      }
      try {
        const q = new URLSearchParams({
          symbol: liqSym,
          date: liqDate,
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/intraday-liquidity?${q.toString()}`);
        if (resp.ok) {
          const json: IntradayLiquidityResp = await resp.json();
          setLiqResp(json);
          setLiqError(null);
        } else if (!silent) {
          setLiqError('Không thể tải dữ liệu thanh khoản trong ngày.');
        }
      } catch {
        if (!silent) setLiqError('Lỗi kết nối khi tải thanh khoản trong ngày.');
      } finally {
        if (!silent) setLiqLoading(false);
      }
    },
    [liqSym, liqDate]
  );

  const liqSubSyms = useMemo(
    () => (liqSym === 'ALL3' ? ['VNINDEX', 'HNX', 'UPCOM'] : [liqSym]),
    [liqSym]
  );

  useSubscribeSymbols(
    liqSubSyms,
    isActive && subTab === 'liquidity' && liqDate === today && liveAuto
  );

  useEffect(() => {
    if (subTab !== 'liquidity') return;
    loadLiquidity(false, false);
  }, [subTab, loadLiquidity]);

  const lastLiqSyncRef = useRef(syncVersion.indices);
  useEffect(() => {
    if (syncVersion.indices === lastLiqSyncRef.current) return;
    lastLiqSyncRef.current = syncVersion.indices;
    if (!liveAuto || !isActive || subTab !== 'liquidity' || liqDate !== today) return;
    loadLiquidity(false, true);
  }, [syncVersion.indices, liveAuto, isActive, subTab, liqDate, today, loadLiquidity]);

  const liquidityChart = useMemo(() => {
    if (!liqResp || liqResp.empty || !liqResp.times?.length || !liqResp.series) return null;
    const times = liqResp.times;
    const isVol = liqMetric === 'vol';
    const unit = isVol ? 'Tr CP' : 'Tỷ';
    const dec = isVol ? 2 : 1;
    const curArr = isVol ? liqResp.series.curVol : liqResp.series.curVal;
    const prevArr = isVol ? liqResp.series.prevVol : liqResp.series.prevVal;
    const avg5Arr = isVol ? liqResp.series.avg5Vol : liqResp.series.avg5Val;

    const summary = liqResp.summary;
    const curHigher = isVol
      ? (summary?.curVolMil ?? 0) >= (summary?.prevVolMil ?? 0)
      : (summary?.curValBil ?? 0) >= (summary?.prevValBil ?? 0);

    const curLineColor = curHigher ? '#10b981' : '#f97316';
    const curFillColor = curHigher ? 'rgba(16, 185, 129, 0.24)' : 'rgba(249, 115, 22, 0.22)';

    const curCustomHover = times.map((_, idx) => {
      const c = curArr[idx];
      if (c === null || c === undefined) return '';
      const p = prevArr[idx];
      let pctTxt = '';
      if (p !== null && p !== undefined && p > 0) {
        const diffPct = ((c - p) / p) * 100;
        pctTxt = ` (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}% vs hôm trước)`;
      }
      return `${fmtNum(c, dec)} ${unit}${pctTxt}`;
    });

    const traces: any[] = [
      {
        type: 'scatter',
        mode: 'lines',
        name: `Phiên trước (${liqResp.prevDateShort || '—'})`,
        x: times,
        y: prevArr,
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.22)',
        line: { color: isDark ? '#94a3b8' : '#64748b', width: 1.8 },
        hovertemplate: `Phiên trước: <b>%{y:,.${dec}f} ${unit}</b><extra></extra>`,
      },
    ];

    if (liqShowAvg5 && (liqResp.avgSessionsCount ?? 0) > 0) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: `TB ${liqResp.avgSessionsCount} phiên`,
        x: times,
        y: avg5Arr,
        line: { color: '#f59e0b', width: 1.6, dash: 'dot' },
        hovertemplate: `TB ${liqResp.avgSessionsCount} phiên: <b>%{y:,.${dec}f} ${unit}</b><extra></extra>`,
      });
    }

    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: `Hôm nay (${liqResp.curDateShort || '—'})`,
      x: times,
      y: curArr,
      text: curCustomHover,
      fill: 'tozeroy',
      fillcolor: curFillColor,
      line: { color: curLineColor, width: 2.5 },
      hovertemplate: 'Hôm nay: <b>%{text}</b><extra></extra>',
    });

    const layout: Record<string, any> = {
      uirevision: `liq_${liqSym}_${liqMetric}_${liqDate}`,
      hovermode: 'x unified',
      margin: { l: 58, r: 22, t: 44, b: 36 },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        font: { size: 12 },
      },
      xaxis: {
        type: 'category',
        tickmode: 'array',
        tickvals: [
          '09:00',
          '09:30',
          '10:00',
          '10:30',
          '11:00',
          '11:30',
          '13:00',
          '13:30',
          '14:00',
          '14:30',
          '15:00',
        ],
        showgrid: true,
        gridcolor: '#f1f5f9',
        zeroline: false,
      },
      yaxis: {
        title: {
          text: isVol ? 'KL Khớp lệnh lũy kế (Triệu CP)' : 'GT Khớp lệnh lũy kế (Tỷ VNĐ)',
          font: { size: 11.5, color: '#64748b' },
        },
        showgrid: true,
        gridcolor: '#e2e8f0',
        zeroline: false,
        rangemode: 'tozero',
      },
      shapes: [
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: '11:30',
          x1: '11:30',
          y0: 0,
          y1: 1,
          line: { dash: 'dash', color: isDark ? '#334155' : '#cbd5e1', width: 1.2 },
        },
      ],
      annotations: [
        {
          xref: 'x',
          yref: 'paper',
          x: '11:30',
          y: 0.99,
          text: 'Nghỉ trưa',
          showarrow: false,
          xanchor: 'left',
          xshift: 4,
          font: { size: 10.5, color: '#94a3b8' },
        },
      ],
    };

    return { traces, layout };
  }, [liqResp, liqMetric, liqShowAvg5, liqSym, liqDate, isDark]);

  // --- Sub-tab 1.2: Treemap ---
  const [tmExchange, setTmExchange] = useState<'HOSE' | 'HNX' | 'UPCOM'>('HOSE');
  const [tmDate, setTmDate] = useState(today);
  const [tmSizeMode, setTmSizeMode] = useState<'value' | 'volume'>('value');
  const [tmResp, setTmResp] = useState<any>(null);
  const [tmLoading, setTmLoading] = useState(false);

  const loadTreemap = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) setTmLoading(true);
      try {
        const q = new URLSearchParams({
          exchange: tmExchange,
          date: tmDate,
          sizeMode: tmSizeMode,
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/treemap?${q.toString()}`);
        if (resp.ok) {
          setTmResp(await resp.json());
        }
      } finally {
        if (!silent) setTmLoading(false);
      }
    },
    [tmExchange, tmDate, tmSizeMode]
  );

  useSubscribeSymbols(
    TREEMAP_WILDCARD,
    isActive && subTab === 'treemap' && tmDate === today && liveAuto
  );

  useEffect(() => {
    if (subTab !== 'treemap') return;
    loadTreemap(false, false);
  }, [subTab, loadTreemap]);

  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'treemap' || tmDate !== today) return;
    setTmResp((prev: any) => patchTreemapWithTicks(prev, ticks, tmSizeMode));
  }, [tickVersion, ticks, tmSizeMode, liveAuto, isActive, subTab, tmDate, today]);

  const lastTmSyncRef = useRef(syncVersion.board);
  useEffect(() => {
    if (syncVersion.board === lastTmSyncRef.current) return;
    lastTmSyncRef.current = syncVersion.board;
    if (!liveAuto || !isActive || subTab !== 'treemap' || tmDate !== today) return;
    loadTreemap(false, true);
  }, [syncVersion.board, liveAuto, isActive, subTab, tmDate, today, loadTreemap]);

  const treemapPlot = useMemo(() => {
    const rows: any[] = tmResp?.rows || [];
    if (!rows.length) return null;

    const rootEx = tmResp?.exchange || tmExchange;
    const totalGtgd = rows.reduce((s, r) => s + r.sizeVal, 0);
    const mktAvgPct =
      totalGtgd > 0 ? rows.reduce((s, r) => s + r.pct * r.sizeVal, 0) / totalGtgd : 0;

    const ids: string[] = [rootEx];
    const labels: string[] = [rootEx];
    const parents: string[] = [''];
    const values: number[] = [0];
    const colors: string[] = [isDark ? '#0b1120' : '#0f172a'];
    const texts: string[] = [
      `<b>${rootEx} (${fmtSigned(mktAvgPct, 2, '%')}) • Tổng: ${fmtNum(totalGtgd, 0)} ${
        tmSizeMode === 'value' ? 'Tỷ' : 'CP'
      }</b>`,
    ];
    const hovers: string[] = [
      `<b>Toàn sàn ${rootEx}</b><br>Biến động BQ gia quyền: <b>${fmtSigned(
        mktAvgPct,
        2,
        '%'
      )}</b><br>Tổng: <b>${fmtNum(totalGtgd, 1)}</b><br>Số mã khớp lệnh: ${rows.length}`,
    ];

    const byInd = new Map<string, any[]>();
    for (const r of rows) {
      const list = byInd.get(r.industry) || [];
      list.push(r);
      byInd.set(r.industry, list);
    }

    for (const [ind, list] of byInd.entries()) {
      const secSum = list.reduce((s, r) => s + r.sizeVal, 0);
      if (secSum <= 0) continue;
      const secPct = list.reduce((s, r) => s + r.pct * r.sizeVal, 0) / secSum;
      const secId = `SEC_${ind}`;

      ids.push(secId);
      labels.push(ind);
      parents.push(rootEx);
      values.push(0);
      colors.push(isDark ? '#1e293b' : '#1e293b');
      texts.push(`<b>${ind}</b> (${fmtSigned(secPct, 2, '%')})`);
      hovers.push(
        `<b>Ngành ${ind}</b><br>Biến động BQ: <b>${fmtSigned(secPct, 2, '%')}</b><br>Tổng: <b>${fmtNum(
          secSum,
          1
        )}</b><br>Số mã: ${list.length}`
      );

      for (const r of list) {
        ids.push(`${secId}_${r.symbol}`);
        labels.push(r.symbol);
        parents.push(secId);
        values.push(r.sizeVal);
        colors.push(getVnTreemapColor(r.pct));
        texts.push(`<b>${r.symbol}</b><br>${fmtSigned(r.pct, 2, '%')}`);
        const nameLine =
          r.companyName && r.companyName !== r.symbol ? `<br>${r.companyName}` : '';
        hovers.push(
          `<b>${r.symbol}</b> (${ind})${nameLine}<br>Giá đóng cửa: <b>${fmtNum(
            r.price,
            2
          )}</b><br>Thay đổi: <b>${fmtSigned(r.pct, 2, '%')}</b><br>${
            tmSizeMode === 'value' ? 'GTGD' : 'KLGD'
          }: <b>${fmtNum(r.sizeVal, 2)} ${tmSizeMode === 'value' ? 'Tỷ VNĐ' : 'CP'}</b>`
        );
      }
    }

    return {
      data: [
        {
          type: 'treemap',
          ids,
          labels,
          parents,
          values,
          text: texts,
          textinfo: 'text',
          textposition: 'middle center',
          hovertext: hovers,
          hoverinfo: 'text',
          marker: {
            colors,
            line: { width: 1.2, color: isDark ? '#0f172a' : '#ffffff' },
            cornerradius: 4,
          },
          textfont: {
            color: '#ffffff',
            size: 13,
            family: '"Plus Jakarta Sans", -apple-system, sans-serif',
          },
          pathbar: { visible: false },
          tiling: { packing: 'squarify', pad: 3 },
        },
      ],
      layout: {
        margin: { l: 4, r: 4, t: 6, b: 4 },
        uirevision: `treemap_${rootEx}`,
      },
    };
  }, [tmResp, tmSizeMode, tmExchange, isDark]);

  // --- Sub-tab 1.3: Market Health & Distribution Days ---
  const [maDate, setMaDate] = useState(today);
  const [ddWin, setDdWin] = useState(25);
  const [cancelReb, setCancelReb] = useState(6.0);
  const [ma20Lag, setMa20Lag] = useState(1);
  const [healthRes, setHealthRes] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const runHealthAnalysis = async () => {
    setHealthLoading(true);
    try {
      const resp = await fetch('/api/market-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: maDate, ddWin, cancelReb, ma20Lag }),
      });
      if (resp.ok) setHealthRes(await resp.json());
    } finally {
      setHealthLoading(false);
    }
  };

  const toggleIndex = (sym: string) => {
    setSelectedIndices((prev) =>
      prev.includes(sym) ? prev.filter((x) => x !== sym) : [...prev, sym]
    );
  };

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          {
            id: 'indices',
            label: 'Chỉ Số Trực Tiếp',
            icon: <Activity className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'liquidity',
            label: 'Thanh Khoản Trong Ngày',
            icon: <BarChart2 className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'treemap',
            label: 'Bản Đồ Nhiệt',
            icon: <LayoutGrid className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'foreign',
            label: 'Giao Dịch Nước Ngoài',
            icon: <Globe className="w-3.5 h-3.5" strokeWidth={2} />,
          },
          {
            id: 'health',
            label: 'Sức Khỏe & Phân Phối',
            icon: <HeartPulse className="w-3.5 h-3.5" strokeWidth={2} />,
          },
        ]}
      />

      {subTab === 'indices' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <FieldLabel label="Ngày giao dịch">
                  <DateInput value={idxDate} onChange={setIdxDate} />
                </FieldLabel>
              </div>
              <div className="md:col-span-8">
                <div className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Chọn chỉ số hiển thị
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_MAIN_INDICES.map((sym) => {
                    const active = selectedIndices.includes(sym);
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => toggleIndex(sym)}
                        className={`h-9 px-3 rounded-lg text-[12.5px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950 border-sky-600 dark:border-sky-500'
                            : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sym}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <PrimaryButton
                  onClick={() => {
                    loadIndices(true, false);
                    setIdxRefreshSig((n) => n + 1);
                  }}
                  loading={idxLoading}
                  className="w-full"
                >
                  {!idxLoading && <RefreshCw className="w-3.5 h-3.5" />}
                  Làm mới
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          {idxLoading && !idxData.length && (
            <LoadingBar text="Đang đồng bộ dữ liệu chỉ số trực tiếp..." />
          )}

          {!selectedIndices.length && (
            <div className="p-4 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-xl text-sky-900 dark:text-sky-200 text-[13px]">
              Vui lòng chọn ít nhất một chỉ số.
            </div>
          )}

          {idxData.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-500 dark:text-slate-400 px-1 tabular-nums">
                {idxMeta.marketTotal && (
                  <>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Tổng GTGD 3 sàn ({idxMeta.marketTotal.dateDisplay}):{' '}
                      <span className="font-mono text-sky-600 dark:text-sky-400">
                        {fmtNum(idxMeta.marketTotal.totalValBil, 1)} Tỷ
                      </span>
                    </span>
                    {idxMeta.marketTotal.valDeltaPct !== null && (
                      <span
                        className={`font-semibold font-mono ${
                          idxMeta.marketTotal.valDeltaPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        ({fmtSigned(idxMeta.marketTotal.valDeltaPct, 1, '%')} vs phiên trước)
                      </span>
                    )}
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      Khớp lệnh:{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {fmtNum(idxMeta.marketTotal.nmValBil, 1)} Tỷ
                      </strong>
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      Thỏa thuận:{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {fmtNum(idxMeta.marketTotal.ptValBil, 1)} Tỷ
                      </strong>
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      KLGD:{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {fmtNum(idxMeta.marketTotal.totalVolMil, 1)} Tr CP
                      </strong>
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                  </>
                )}
                {idxMeta.dataSource && (
                  <span>
                    Nguồn:{' '}
                    <strong className="text-slate-700 dark:text-slate-200">
                      {idxMeta.dataSource}
                    </strong>
                    {idxMeta.syncTime && (
                      <>
                        {' '}
                        · Đồng bộ:{' '}
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          {fmtDisplayDateOrTime(idxMeta.syncTime)}
                        </span>
                      </>
                    )}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {idxData.map((item) => {
                  const pxColor =
                    item.delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : item.delta < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400';
                  const dotColor =
                    item.delta > 0
                      ? 'bg-emerald-500'
                      : item.delta < 0
                      ? 'bg-red-500'
                      : 'bg-amber-500';
                  const valPct =
                    typeof item.valDeltaPct === 'number' ? item.valDeltaPct : null;
                  const valTooltip =
                    item.nmValBil > 0 || item.ptValBil > 0
                      ? `Khớp lệnh: ${fmtNum(item.nmValBil, 1)} Tỷ | Thỏa thuận: ${fmtNum(
                          item.ptValBil,
                          1
                        )} Tỷ`
                      : undefined;
                  return (
                    <div
                      key={item.symbol}
                      title={valTooltip}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide truncate">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                          {item.symbol}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                          {item.tradeDateStr}
                        </span>
                      </div>
                      <div className="text-[20px] font-bold font-mono text-slate-900 dark:text-slate-50 mt-1.5 leading-tight tabular-nums tracking-tight">
                        {fmtNum(item.lastPx, 2)}
                      </div>
                      <div
                        className={`text-[12px] font-semibold font-mono mt-0.5 tabular-nums ${pxColor}`}
                      >
                        {fmtSigned(item.delta, 2)} ({fmtSigned(item.pct, 2, '%')})
                      </div>
                      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-0.5 text-[11.5px] font-mono tabular-nums">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="font-sans text-slate-500 dark:text-slate-400">
                            GTGD
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {item.totalValBil > 0 ? `${fmtNum(item.totalValBil, 1)} Tỷ` : '—'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-1 text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400">
                            KL {item.totalVolMil > 0 ? `${fmtNum(item.totalVolMil, 1)} Tr` : '—'}
                          </span>
                          {valPct !== null && (
                            <span
                              className={`font-semibold ${
                                valPct >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {fmtSigned(valPct, 1, '%')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {indicesChart && (
                <SectionCard className="p-2.5">
                  <PlotlyChart
                    data={indicesChart.traces}
                    layout={indicesChart.layout}
                    height={indicesChart.height}
                  />
                </SectionCard>
              )}
            </>
          )}

          {selectedIndices.includes('VNINDEX') && (
            <VnIndexImpactPanel
              date={idxDate}
              isActive={isActive && subTab === 'indices'}
              refreshSignal={idxRefreshSig}
            />
          )}
        </div>
      )}

      {subTab === 'liquidity' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5 space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-6">
                <div className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Chỉ số / Sàn theo dõi thanh khoản
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {LIQUIDITY_SYMBOLS.map((opt) => {
                    const active = liqSym === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLiqSym(opt.id)}
                        className={`h-9 px-3 rounded-lg text-[12.5px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950 border-sky-600 dark:border-sky-500'
                            : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-3">
                <div className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Hiển thị theo
                </div>
                <SegmentedControl
                  value={liqMetric}
                  onChange={setLiqMetric}
                  options={[
                    { value: 'vol', label: 'KL (Triệu CP)' },
                    { value: 'val', label: 'GT Khớp (Tỷ)' },
                  ]}
                />
              </div>

              <div className="lg:col-span-2">
                <FieldLabel label="Ngày giao dịch">
                  <DateInput value={liqDate} onChange={setLiqDate} />
                </FieldLabel>
              </div>

              <div className="lg:col-span-1">
                <PrimaryButton
                  onClick={() => loadLiquidity(true, false)}
                  loading={liqLoading}
                  aria-label="Làm mới thanh khoản"
                  className="w-full"
                >
                  {!liqLoading && <RefreshCw className="w-4 h-4" />}
                </PrimaryButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[12px] text-slate-500 dark:text-slate-400">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={liqShowAvg5}
                  onChange={(e) => setLiqShowAvg5(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                Hiển thị đường trung bình 5 phiên gần nhất
              </label>

              {liqResp && !liqResp.empty && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                  <strong className="text-slate-800 dark:text-slate-200">
                    {liqSym === 'ALL3' ? 'Toàn thị trường (HOSE + HNX + UPCOM)' : liqSym}
                  </strong>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <span>
                    {liqResp.isLiveNow
                      ? `Trực tiếp đến ${liqResp.cutoffTime}`
                      : `Phiên ${liqResp.curDateDisplay} (đến ${liqResp.cutoffTime})`}
                  </span>
                  {liqResp.prevDateDisplay && (
                    <>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span>So với phiên trước: {liqResp.prevDateDisplay}</span>
                    </>
                  )}
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <span>Nguồn: {liqResp.source || 'VNDirect'}</span>
                </div>
              )}
            </div>
          </SectionCard>

          {liqLoading && !liqResp && (
            <LoadingBar text={`Đang tải dữ liệu thanh khoản trong ngày cho ${liqSym}...`} />
          )}

          {liqError && <ErrorBanner message={liqError} />}

          {liqResp && liqResp.empty && !liqLoading && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 rounded-xl text-amber-900 dark:text-amber-200 text-[13px]">
              Không có dữ liệu khớp lệnh theo phút cho {liqSym} quanh ngày đã chọn.
            </div>
          )}

          {liqResp && !liqResp.empty && liqResp.summary && (
            <>
              {(() => {
                const s = liqResp.summary!;
                const isVol = liqMetric === 'vol';
                const unit = isVol ? 'Tr CP' : 'Tỷ';
                const dec = isVol ? 2 : 1;
                const curVal = isVol ? s.curVolMil : s.curValBil;
                const prevVal = isVol ? s.prevVolMil : s.prevValBil;
                const diffVal = isVol ? s.volDiffMil : s.valDiffBil;
                const diffPct = isVol ? s.volDiffPct : s.valDiffPct;
                const avg5Val = isVol ? s.avg5VolMil : s.avg5ValBil;
                const vsAvg5Pct = isVol ? s.volVsAvg5Pct : s.valVsAvg5Pct;
                const prevSeries = isVol ? liqResp.series?.prevVol : liqResp.series?.prevVal;
                const prevFullDay =
                  prevSeries && prevSeries.length
                    ? prevSeries[prevSeries.length - 1] ?? prevVal
                    : prevVal;

                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard
                      label={`${isVol ? 'KL' : 'GT'} Khớp Lệnh (${liqResp.curDateShort} · ${
                        liqResp.cutoffTime
                      })`}
                      value={`${fmtNum(curVal, dec)} ${unit}`}
                      delta={
                        diffPct !== null
                          ? `${fmtSigned(diffPct, 2, '%')} (${fmtSigned(diffVal, dec)} ${unit}) vs ${
                              liqResp.prevDateShort
                            }`
                          : undefined
                      }
                      deltaPositive={
                        diffPct !== null ? (diffPct > 0 ? true : diffPct < 0 ? false : null) : null
                      }
                    />
                    <MetricCard
                      label={`Cùng Thời Điểm (${liqResp.prevDateShort || '—'})`}
                      value={`${fmtNum(prevVal, dec)} ${unit}`}
                      delta={`Cả phiên ${liqResp.prevDateShort || '—'}: ${fmtNum(
                        prevFullDay,
                        dec
                      )} ${unit}`}
                      deltaPositive={null}
                    />
                    <MetricCard
                      label={`TB ${liqResp.avgSessionsCount || 5} Phiên Cùng Giờ`}
                      value={`${fmtNum(avg5Val, dec)} ${unit}`}
                      delta={
                        vsAvg5Pct !== null
                          ? `${fmtSigned(vsAvg5Pct, 2, '%')} so với TB ${
                              liqResp.avgSessionsCount || 5
                            } phiên`
                          : undefined
                      }
                      deltaPositive={
                        vsAvg5Pct !== null
                          ? vsAvg5Pct > 0
                            ? true
                            : vsAvg5Pct < 0
                            ? false
                            : null
                          : null
                      }
                    />
                    <MetricCard
                      label={`Tổng GTGD Phiên (${liqResp.curDateShort})`}
                      value={
                        s.officialTotalValBil > 0
                          ? `${fmtNum(s.officialTotalValBil, 1)} Tỷ`
                          : `${fmtNum(s.curValBil, 1)} Tỷ`
                      }
                      delta={
                        s.officialTotalValBil > 0
                          ? `KL: ${fmtNum(s.officialNmValBil, 1)} · TT: ${fmtNum(
                              s.officialPtValBil,
                              1
                            )} Tỷ`
                          : undefined
                      }
                      deltaPositive={null}
                    />
                  </div>
                );
              })()}

              {liquidityChart && (
                <SectionCard className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                    <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100">
                      Biểu đồ {liqMetric === 'vol' ? 'Khối lượng' : 'Giá trị'} khớp lệnh lũy kế trong
                      ngày — {liqSym === 'ALL3' ? 'Toàn thị trường (3 sàn)' : liqSym}
                    </h4>
                    <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                      Xanh: cao hơn phiên trước · Cam: thấp hơn phiên trước
                    </span>
                  </div>
                  <PlotlyChart
                    data={liquidityChart.traces}
                    layout={liquidityChart.layout}
                    height={430}
                  />
                </SectionCard>
              )}

              {liqResp.milestones && liqResp.milestones.length > 0 && (
                <SectionCard className="p-3.5">
                  <h4 className="font-bold text-[14.5px] text-slate-900 dark:text-slate-100 mb-2.5">
                    So sánh thanh khoản lũy kế theo khung giờ ({liqResp.curDateShort} vs{' '}
                    {liqResp.prevDateShort || '—'})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] border-collapse">
                      <thead className={tableHeadCls}>
                        <tr>
                          <th className="py-2.5 px-3 text-left">Khung giờ</th>
                          <th className="py-2.5 px-3 text-right">
                            KL {liqResp.curDateShort} (Tr CP)
                          </th>
                          <th className="py-2.5 px-3 text-right">
                            KL {liqResp.prevDateShort || 'Trước'} (Tr CP)
                          </th>
                          <th className="py-2.5 px-3 text-right">Chênh lệch KL</th>
                          <th className="py-2.5 px-3 text-right">
                            GT {liqResp.curDateShort} (Tỷ)
                          </th>
                          <th className="py-2.5 px-3 text-right">
                            GT {liqResp.prevDateShort || 'Trước'} (Tỷ)
                          </th>
                          <th className="py-2.5 px-3 text-right">Chênh lệch GT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                        {liqResp.milestones.map((m) => (
                          <tr key={m.time} className={tableRowCls}>
                            <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">
                              {m.time}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                              {m.curVol !== null ? fmtNum(m.curVol, 2) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                              {m.prevVol !== null ? fmtNum(m.prevVol, 2) : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right ${
                                m.volDiffPct !== null
                                  ? colorSignedClass(m.volDiffPct)
                                  : 'text-slate-400 dark:text-slate-600'
                              }`}
                            >
                              {m.volDiffPct !== null ? fmtSigned(m.volDiffPct, 2, '%') : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                              {m.curVal !== null ? fmtNum(m.curVal, 1) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                              {m.prevVal !== null ? fmtNum(m.prevVal, 1) : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right ${
                                m.valDiffPct !== null
                                  ? colorSignedClass(m.valDiffPct)
                                  : 'text-slate-400 dark:text-slate-600'
                              }`}
                            >
                              {m.valDiffPct !== null ? fmtSigned(m.valDiffPct, 2, '%') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      )}

      {subTab === 'treemap' && (
        <div className="space-y-3">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <FieldLabel label="Sàn giao dịch">
                  <select
                    value={tmExchange}
                    onChange={(e) => setTmExchange(e.target.value as 'HOSE' | 'HNX' | 'UPCOM')}
                    className={inputCls}
                  >
                    <option value="HOSE">HOSE</option>
                    <option value="HNX">HNX</option>
                    <option value="UPCOM">UPCOM</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-3">
                <FieldLabel label="Ngày bản đồ nhiệt">
                  <DateInput value={tmDate} onChange={setTmDate} />
                </FieldLabel>
              </div>
              <div className="md:col-span-3">
                <FieldLabel label="Kích thước ô theo">
                  <select
                    value={tmSizeMode}
                    onChange={(e) => setTmSizeMode(e.target.value as 'value' | 'volume')}
                    className={inputCls}
                  >
                    <option value="value">Giá trị GD (Tỷ)</option>
                    <option value="volume">Khối lượng GD</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <PrimaryButton
                  onClick={() => loadTreemap(true, false)}
                  loading={tmLoading}
                  className="w-full"
                >
                  {!tmLoading && <RefreshCw className="w-3.5 h-3.5" />}
                  Nạp lại
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-center justify-between px-1 text-[12px]">
            <div className="flex flex-wrap items-center gap-1.5 font-semibold font-mono text-[11px]">
              <span className="font-sans text-[12px] text-slate-500 dark:text-slate-400 mr-1">
                Thang màu:
              </span>
              <span className="rounded px-2 py-0.5 text-white bg-[#0284c7]">≤ −6.5% Sàn</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#dc2626]">−6.5 ~ −2%</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#ef4444]">−2 ~ 0%</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#d97706]">0% TC</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#10b981]">0 ~ +2%</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#059669]">+2 ~ +6.5%</span>
              <span className="rounded px-2 py-0.5 text-white bg-[#9333ea]">≥ +6.5% Trần</span>
            </div>

            {tmResp?.counts && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500 dark:text-slate-400 tabular-nums">
                <strong className="text-slate-800 dark:text-slate-200">
                  Sàn {tmResp.exchange || tmExchange}
                </strong>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span>
                  {tmResp.mode === 'live'
                    ? `Trực tiếp (${fmtDisplayDateOrTime(tmResp.syncTime)})`
                    : `EOD ${tmResp.tradeDateDisplay || fmtDisplayDateOrTime(tmResp.tradeDate)}`}
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span>{tmResp.totalSymbols ?? tmResp.rows?.length ?? 0} mã</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono">
                  Tăng{' '}
                  <strong className="text-emerald-600 dark:text-emerald-400">
                    {tmResp.counts.up}
                  </strong>{' '}
                  / Giảm{' '}
                  <strong className="text-red-600 dark:text-red-400">{tmResp.counts.down}</strong> /
                  TC{' '}
                  <strong className="text-amber-600 dark:text-amber-400">
                    {tmResp.counts.ref}
                  </strong>
                </span>
              </div>
            )}
          </div>

          {tmLoading && !tmResp && (
            <LoadingBar text={`Đang tải dữ liệu bản đồ nhiệt sàn ${tmExchange}...`} />
          )}

          {treemapPlot ? (
            <SectionCard className="p-1.5">
              <PlotlyChart data={treemapPlot.data} layout={treemapPlot.layout} height={700} />
            </SectionCard>
          ) : (
            !tmLoading && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 rounded-xl text-amber-900 dark:text-amber-200 text-[13px]">
                Không có dữ liệu giao dịch cho sàn {tmExchange} vào ngày đã chọn.
              </div>
            )
          )}
        </div>
      )}

      {subTab === 'foreign' && (
        <ForeignTradingPanel isActive={isActive && subTab === 'foreign'} />
      )}

      {subTab === 'health' && (
        <div className="space-y-3.5">
          <SectionCard className="p-3.5">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <FieldLabel label="Ngày phân tích">
                  <DateInput value={maDate} onChange={setMaDate} />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Cửa sổ DD">
                  <input
                    type="number"
                    min={10}
                    max={60}
                    value={ddWin}
                    onChange={(e) => setDdWin(Number(e.target.value))}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Xóa DD (%)">
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
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Độ trễ MA20">
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
              <div className="md:col-span-3">
                <PrimaryButton
                  onClick={runHealthAnalysis}
                  loading={healthLoading}
                  className="w-full"
                >
                  {!healthLoading && <HeartPulse className="w-4 h-4" />}
                  Phân Tích Thị Trường
                </PrimaryButton>
              </div>
            </div>
          </SectionCard>

          {healthLoading && (
            <LoadingBar text="Đang đếm ngày phân phối các chỉ số và quét sức mạnh các nhóm ngành..." />
          )}

          {healthRes && (
            <div className="space-y-3.5">
              <div className="space-y-2">
                {healthRes.summaries.map((s: any) => (
                  <div
                    key={s.index}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-[13px] text-slate-700 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <strong className="font-mono text-slate-900 dark:text-slate-50">
                      {s.index}
                    </strong>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      Phân phối <strong className="font-mono">{s.dd}</strong> ({s.ddDates})
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      Stalling <strong className="font-mono">{s.stall}</strong>
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span>
                      Churning <strong className="font-mono">{s.churn}</strong>
                    </span>
                    {s.extra && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span>
                          Rủi ro:{' '}
                          <strong className="font-mono text-slate-900 dark:text-slate-100">
                            {s.extra.riskScore}
                          </strong>
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">→</span>
                        <span>
                          Tỷ trọng:{' '}
                          <strong className="font-mono text-sky-600 dark:text-sky-400">
                            {s.extra.allocTxt}
                          </strong>{' '}
                          <span className="text-slate-500 dark:text-slate-400">
                            ({s.extra.reason})
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <SectionCard className="lg:col-span-7 p-3.5">
                  <h4 className="inline-flex items-center gap-2 font-bold text-[14.5px] text-slate-900 dark:text-slate-100 mb-2.5">
                    <Flame className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Nhóm Ngành Dẫn Dắt (&gt; 50% mã trên MA20)
                  </h4>
                  {healthRes.leaders.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] border-collapse">
                        <thead className={tableHeadCls}>
                          <tr>
                            <th className="py-2 px-2.5 text-left">Ngành</th>
                            <th className="py-2 px-2.5 text-right">% &gt; MA20</th>
                            <th className="py-2 px-2.5 text-right">Trước đó</th>
                            <th className="py-2 px-2.5 text-right">Thay đổi</th>
                            <th className="py-2 px-2.5 text-left">Cảnh báo</th>
                            <th className="py-2 px-2.5 text-right">Số mã</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {healthRes.leaders.map((r: any) => (
                            <tr key={r.industry} className={tableRowCls}>
                              <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                                {r.industry}
                              </td>
                              <td
                                className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorPctStrengthClass(
                                  r.pctAboveMa20
                                )}`}
                              >
                                {fmtNum(r.pctAboveMa20, 1)}%
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                {fmtNum(r.prevPct, 1)}%
                              </td>
                              <td
                                className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorSignedClass(
                                  r.change
                                )}`}
                              >
                                {fmtSigned(r.change, 1, '%')}
                              </td>
                              <td className={`py-2 px-2.5 ${colorStatusClass(r.warning)}`}>
                                {r.warning}
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                {r.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">
                      Không có nhóm ngành nào đạt chuẩn dẫn dắt.
                    </p>
                  )}
                </SectionCard>

                <SectionCard className="lg:col-span-5 p-3.5">
                  <h4 className="inline-flex items-center gap-2 font-bold text-[14.5px] text-slate-900 dark:text-slate-100 mb-2.5">
                    <Snowflake className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    Nhóm Ngành Suy Yếu (&gt; 50% mã dưới MA50)
                  </h4>
                  {healthRes.weak.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] border-collapse">
                        <thead className={tableHeadCls}>
                          <tr>
                            <th className="py-2 px-2.5 text-left">Ngành</th>
                            <th className="py-2 px-2.5 text-right">% &lt; MA50</th>
                            <th className="py-2 px-2.5 text-right">Số mã</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {healthRes.weak.map((r: any) => (
                            <tr key={r.industry} className={tableRowCls}>
                              <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                                {r.industry}
                              </td>
                              <td
                                className={`py-2 px-2.5 text-right font-mono tabular-nums ${colorPctWeakClass(
                                  r.pctBelowMa50
                                )}`}
                              >
                                {fmtNum(r.pctBelowMa50, 1)}%
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                {r.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">
                      Không có nhóm ngành nào suy yếu &gt; 50%.
                    </p>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
