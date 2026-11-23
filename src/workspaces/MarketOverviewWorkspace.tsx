import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_MAIN_INDICES, getVnTreemapColor } from '../shared/constants';
import { PlotlyChart } from '../components/PlotlyChart';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchIndicesWithTicks, patchTreemapWithTicks } from '../utils/livePatch';
import {
  FieldLabel,
  LoadingBar,
  MetricCard,
  PrimaryButton,
  SubTabs,
  inputCls,
} from '../components/UiPrimitives';
import {
  colorPctStrengthClass,
  colorPctWeakClass,
  colorSignedClass,
  colorStatusClass,
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
  const { liveAuto, ticks, tickVersion, syncVersion } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'indices' | 'liquidity' | 'treemap' | 'health'>('indices');

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

  // --- Sub-tab 1.1B: Intraday Liquidity Comparison (FireAnt style) ---
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

  // Silently reconcile intraday liquidity curves on WS index sync events (zero setInterval)
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
    const curFillColor = curHigher ? 'rgba(16, 185, 129, 0.26)' : 'rgba(249, 115, 22, 0.22)';

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
        fillcolor: 'rgba(148, 163, 184, 0.22)',
        line: { color: '#64748b', width: 1.8 },
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
        font: { size: 12, color: '#334155' },
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
          line: { dash: 'dash', color: '#cbd5e1', width: 1.2 },
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
  }, [liqResp, liqMetric, liqShowAvg5, liqSym, liqDate]);

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

  // Patch treemap stock tiles & up/down/ref counts in-place from WS ticks
  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'treemap' || tmDate !== today) return;
    setTmResp((prev: any) => patchTreemapWithTicks(prev, ticks, tmSizeMode));
  }, [tickVersion, ticks, tmSizeMode, liveAuto, isActive, subTab, tmDate, today]);

  // Silently reconcile full board on WS board sync events
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
    const colors: string[] = ['#0f172a'];
    const texts: string[] = [
      `<b>${rootEx} (${fmtSigned(mktAvgPct, 2, '%')}) • Tổng: ${fmtNum(totalGtgd, 0)} ${
        tmSizeMode === 'value' ? 'Tỷ' : 'CP'
      }</b>`,
    ];
    const hovers: string[] = [
      `<b>Toàn sàn ${rootEx}</b><br>Biến động BQ gia quyền: <b>${fmtSigned(mktAvgPct, 2, '%')}</b><br>Tổng: <b>${fmtNum(
        totalGtgd,
        1
      )}</b><br>Số mã khớp lệnh: ${rows.length}`,
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
      colors.push('#1e293b');
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
          `<b>${r.symbol}</b> (${ind})${nameLine}<br>Giá đóng cửa: <b>${fmtNum(r.price, 2)}</b><br>Thay đổi: <b>${fmtSigned(
            r.pct,
            2,
            '%'
          )}</b><br>${tmSizeMode === 'value' ? 'GTGD' : 'KLGD'}: <b>${fmtNum(r.sizeVal, 2)} ${
            tmSizeMode === 'value' ? 'Tỷ VNĐ' : 'CP'
          }</b>`
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
            line: { width: 1.2, color: '#ffffff' },
            cornerradius: 4,
          },
          textfont: { color: '#ffffff', size: 13, family: 'Segoe UI, Arial, sans-serif' },
          pathbar: { visible: false },
          tiling: { packing: 'squarify', pad: 3 },
        },
      ],
      layout: {
        margin: { l: 4, r: 4, t: 6, b: 4 },
        uirevision: `treemap_${rootEx}`,
      },
    };
  }, [tmResp, tmSizeMode, tmExchange]);

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
          { id: 'indices', label: '⏱️ Chỉ Số Trực Tiếp (SSI Realtime)' },
          { id: 'liquidity', label: '📊 Thanh Khoản Trong Ngày' },
          { id: 'treemap', label: '🗺️ Bản Đồ Nhiệt (Treemap)' },
          { id: 'health', label: '🩺 Sức Khỏe & Ngày Phân Phối' },
        ]}
      />

      {subTab === 'indices' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-2">
              <FieldLabel label="Ngày giao dịch">
                <input
                  type="date"
                  value={idxDate}
                  onChange={(e) => setIdxDate(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-8">
              <div className="text-[12px] font-bold text-slate-600 mb-1">Chọn chỉ số hiển thị</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_MAIN_INDICES.map((sym) => {
                  const active = selectedIndices.includes(sym);
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => toggleIndex(sym)}
                      className={`px-3 py-1 rounded-md text-[12.5px] font-bold border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#0284c7] text-white border-[#0284c7]'
                          : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
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
                onClick={() => loadIndices(true, false)}
                loading={idxLoading}
                className="w-full"
              >
                🔄 Làm mới ngay
              </PrimaryButton>
            </div>
          </div>

          {idxLoading && !idxData.length && (
            <LoadingBar text="Đang đồng bộ dữ liệu chỉ số trực tiếp..." />
          )}

          {!selectedIndices.length && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-sm">
              Vui lòng chọn ít nhất một chỉ số.
            </div>
          )}

          {idxData.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-600 px-1 tabular-nums">
                {idxMeta.marketTotal && (
                  <>
                    <strong className="text-slate-900">
                      Tổng GTGD 3 sàn ({idxMeta.marketTotal.dateDisplay}):{' '}
                      <span className="text-[#0284c7]">
                        {fmtNum(idxMeta.marketTotal.totalValBil, 1)} Tỷ
                      </span>
                    </strong>
                    {idxMeta.marketTotal.valDeltaPct !== null && (
                      <span
                        className={`font-bold ${
                          idxMeta.marketTotal.valDeltaPct >= 0
                            ? 'text-[#059669]'
                            : 'text-[#dc2626]'
                        }`}
                      >
                        ({fmtSigned(idxMeta.marketTotal.valDeltaPct, 1, '%')} vs phiên trước)
                      </span>
                    )}
                    <span className="text-slate-300">·</span>
                    <span>
                      Khớp lệnh:{' '}
                      <strong className="text-slate-800">
                        {fmtNum(idxMeta.marketTotal.nmValBil, 1)} Tỷ
                      </strong>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>
                      Thỏa thuận:{' '}
                      <strong className="text-slate-800">
                        {fmtNum(idxMeta.marketTotal.ptValBil, 1)} Tỷ
                      </strong>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>
                      KLGD:{' '}
                      <strong className="text-slate-800">
                        {fmtNum(idxMeta.marketTotal.totalVolMil, 1)} Tr CP
                      </strong>
                    </span>
                    <span className="text-slate-300">·</span>
                  </>
                )}
                {idxMeta.dataSource && (
                  <span>
                    Nguồn: <strong className="text-slate-800">{idxMeta.dataSource}</strong>
                    {idxMeta.syncTime && (
                      <>
                        {' '}
                        · Đồng bộ:{' '}
                        <span className="font-medium text-slate-700">{idxMeta.syncTime}</span>
                      </>
                    )}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {idxData.map((item) => {
                  const pxColor =
                    item.delta > 0
                      ? 'text-[#059669]'
                      : item.delta < 0
                      ? 'text-[#dc2626]'
                      : 'text-[#d97706]';
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
                      className="bg-white border border-slate-200 border-l-4 border-l-[#0284c7] rounded-[10px] px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                    >
                      <div className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wide truncate">
                        {item.symbol} ({item.tradeDateStr})
                      </div>
                      <div className="text-[20px] font-extrabold text-slate-900 mt-0.5 leading-tight tabular-nums">
                        {fmtNum(item.lastPx, 2)}
                      </div>
                      <div className={`text-[12px] font-bold mt-0.5 tabular-nums ${pxColor}`}>
                        {fmtSigned(item.delta, 2)} ({fmtSigned(item.pct, 2, '%')})
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-slate-100 space-y-0.5 text-[11.5px] tabular-nums">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-slate-500">GTGD:</span>
                          <span className="font-bold text-slate-900">
                            {item.totalValBil > 0 ? `${fmtNum(item.totalValBil, 1)} Tỷ` : '—'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-1 text-[11px]">
                          <span className="text-slate-500">
                            KL: {item.totalVolMil > 0 ? `${fmtNum(item.totalVolMil, 1)} Tr` : '—'}
                          </span>
                          {valPct !== null && (
                            <span
                              className={`font-semibold ${
                                valPct >= 0 ? 'text-[#059669]' : 'text-[#dc2626]'
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
                <div className="bg-white border border-slate-200 rounded-[10px] p-2">
                  <PlotlyChart
                    data={indicesChart.traces}
                    layout={indicesChart.layout}
                    height={indicesChart.height}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {subTab === 'liquidity' && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-2.5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-6">
                <div className="text-[12px] font-bold text-slate-600 mb-1">
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
                    onClick={() => setLiqMetric('vol')}
                    className={`py-1.5 px-2 text-[12px] font-bold transition-colors cursor-pointer ${
                      liqMetric === 'vol'
                        ? 'bg-[#0284c7] text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    KL (Triệu CP)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLiqMetric('val')}
                    className={`py-1.5 px-2 text-[12px] font-bold border-l border-slate-300 transition-colors cursor-pointer ${
                      liqMetric === 'val'
                        ? 'bg-[#0284c7] text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    GT Khớp (Tỷ)
                  </button>
                </div>
              </div>

              <div className="lg:col-span-2">
                <FieldLabel label="Ngày giao dịch">
                  <input
                    type="date"
                    value={liqDate}
                    onChange={(e) => setLiqDate(e.target.value)}
                    className={inputCls}
                  />
                </FieldLabel>
              </div>

              <div className="lg:col-span-1">
                <PrimaryButton
                  onClick={() => loadLiquidity(true, false)}
                  loading={liqLoading}
                  className="w-full"
                >
                  🔄
                </PrimaryButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[12.5px] text-slate-600">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={liqShowAvg5}
                  onChange={(e) => setLiqShowAvg5(e.target.checked)}
                  className="rounded border-slate-300 text-[#0284c7] focus:ring-[#0284c7]"
                />
                Hiển thị đường trung bình 5 phiên gần nhất
              </label>

              {liqResp && !liqResp.empty && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                  <strong className="text-slate-900">
                    {liqSym === 'ALL3' ? 'Toàn thị trường (HOSE + HNX + UPCOM)' : liqSym}
                  </strong>
                  <span className="text-slate-300">·</span>
                  <span>
                    {liqResp.isLiveNow
                      ? `Trực tiếp đến ${liqResp.cutoffTime}`
                      : `Phiên ${liqResp.curDateDisplay} (đến ${liqResp.cutoffTime})`}
                  </span>
                  {liqResp.prevDateDisplay && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>So với phiên trước: {liqResp.prevDateDisplay}</span>
                    </>
                  )}
                  <span className="text-slate-300">·</span>
                  <span>Nguồn: {liqResp.source || 'VNDirect'}</span>
                </div>
              )}
            </div>
          </div>

          {liqLoading && !liqResp && (
            <LoadingBar text={`Đang tải dữ liệu thanh khoản trong ngày cho ${liqSym}...`} />
          )}

          {liqError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              {liqError}
            </div>
          )}

          {liqResp && liqResp.empty && !liqLoading && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
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
                <div className="bg-white border border-slate-200 rounded-[10px] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
                    <h4 className="font-bold text-[14.5px] text-slate-900">
                      Biểu đồ {liqMetric === 'vol' ? 'Khối lượng' : 'Giá trị'} khớp lệnh lũy kế trong
                      ngày — {liqSym === 'ALL3' ? 'Toàn thị trường (3 sàn)' : liqSym}
                    </h4>
                    <span className="text-[11.5px] text-slate-500">
                      Đường màu xanh khi thanh khoản cao hơn phiên trước, màu cam khi thấp hơn
                    </span>
                  </div>
                  <PlotlyChart
                    data={liquidityChart.traces}
                    layout={liquidityChart.layout}
                    height={430}
                  />
                </div>
              )}

              {liqResp.milestones && liqResp.milestones.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-3">
                  <h4 className="font-bold text-[14.5px] text-slate-900 mb-2">
                    So sánh thanh khoản lũy kế theo khung giờ ({liqResp.curDateShort} vs{' '}
                    {liqResp.prevDateShort || '—'})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="py-2 px-2.5 text-left">Khung giờ</th>
                          <th className="py-2 px-2.5 text-right">
                            KL {liqResp.curDateShort} (Tr CP)
                          </th>
                          <th className="py-2 px-2.5 text-right">
                            KL {liqResp.prevDateShort || 'Trước'} (Tr CP)
                          </th>
                          <th className="py-2 px-2.5 text-right">Chênh lệch KL</th>
                          <th className="py-2 px-2.5 text-right">
                            GT {liqResp.curDateShort} (Tỷ)
                          </th>
                          <th className="py-2 px-2.5 text-right">
                            GT {liqResp.prevDateShort || 'Trước'} (Tỷ)
                          </th>
                          <th className="py-2 px-2.5 text-right">Chênh lệch GT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liqResp.milestones.map((m) => (
                          <tr
                            key={m.time}
                            className="border-b border-slate-100 hover:bg-slate-50 tabular-nums"
                          >
                            <td className="py-2 px-2.5 font-bold text-slate-800">{m.time}</td>
                            <td className="py-2 px-2.5 text-right font-semibold text-slate-900">
                              {m.curVol !== null ? fmtNum(m.curVol, 2) : '—'}
                            </td>
                            <td className="py-2 px-2.5 text-right text-slate-600">
                              {m.prevVol !== null ? fmtNum(m.prevVol, 2) : '—'}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right ${
                                m.volDiffPct !== null
                                  ? colorSignedClass(m.volDiffPct)
                                  : 'text-slate-400'
                              }`}
                            >
                              {m.volDiffPct !== null ? fmtSigned(m.volDiffPct, 2, '%') : '—'}
                            </td>
                            <td className="py-2 px-2.5 text-right font-semibold text-slate-900">
                              {m.curVal !== null ? fmtNum(m.curVal, 1) : '—'}
                            </td>
                            <td className="py-2 px-2.5 text-right text-slate-600">
                              {m.prevVal !== null ? fmtNum(m.prevVal, 1) : '—'}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right ${
                                m.valDiffPct !== null
                                  ? colorSignedClass(m.valDiffPct)
                                  : 'text-slate-400'
                              }`}
                            >
                              {m.valDiffPct !== null ? fmtSigned(m.valDiffPct, 2, '%') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {subTab === 'treemap' && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
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
                <input
                  type="date"
                  value={tmDate}
                  onChange={(e) => setTmDate(e.target.value)}
                  className={inputCls}
                />
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
                🔄 Nạp lại dữ liệu
              </PrimaryButton>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 items-center bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-bold">
            <span className="text-slate-700 mr-1">Chú thích màu:</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#0284c7]">≤ −6.5% (Sàn)</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#dc2626]">−6.5% ~ −2%</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#ef4444]">−2% ~ 0%</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#d97706]">0% (TC)</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#10b981]">0% ~ +2%</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#059669]">+2% ~ +6.5%</span>
            <span className="rounded px-2.5 py-0.5 text-white bg-[#9333ea]">≥ +6.5% (Trần)</span>
          </div>

          {tmLoading && !tmResp && (
            <LoadingBar text={`Đang tải dữ liệu bản đồ nhiệt sàn ${tmExchange}...`} />
          )}

          {tmResp?.counts && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-slate-600 px-1 tabular-nums">
              <strong className="text-slate-900">
                Sàn {tmResp.exchange || tmExchange}
              </strong>
              <span className="text-slate-300">·</span>
              <span>
                {tmResp.mode === 'live'
                  ? `Trực tiếp (${tmResp.syncTime})`
                  : `Dữ liệu EOD phiên gần nhất ${tmResp.tradeDateDisplay || tmResp.tradeDate}`}
              </span>
              <span className="text-slate-300">·</span>
              <span>Nguồn: {tmResp.source || 'VNDirect'}</span>
              <span className="text-slate-300">·</span>
              <span>{tmResp.totalSymbols ?? tmResp.rows?.length ?? 0} mã khớp lệnh</span>
              <span className="text-slate-300">·</span>
              <span>
                Tăng: <strong className="text-[#059669]">{tmResp.counts.up}</strong> | Giảm:{' '}
                <strong className="text-[#dc2626]">{tmResp.counts.down}</strong> | TC:{' '}
                <strong className="text-[#d97706]">{tmResp.counts.ref}</strong>
              </span>
            </div>
          )}

          {treemapPlot ? (
            <div className="bg-white border border-slate-200 rounded-[10px] p-1">
              <PlotlyChart data={treemapPlot.data} layout={treemapPlot.layout} height={700} />
            </div>
          ) : (
            !tmLoading && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
                Không có dữ liệu giao dịch cho sàn {tmExchange} vào ngày đã chọn.
              </div>
            )
          )}
        </div>
      )}

      {subTab === 'health' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-3">
              <FieldLabel label="Ngày phân tích">
                <input
                  type="date"
                  value={maDate}
                  onChange={(e) => setMaDate(e.target.value)}
                  className={inputCls}
                />
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
              <PrimaryButton onClick={runHealthAnalysis} loading={healthLoading} className="w-full">
                🩺 Phân Tích Thị Trường
              </PrimaryButton>
            </div>
          </div>

          {healthLoading && (
            <LoadingBar text="Đang đếm ngày phân phối các chỉ số và quét sức mạnh các nhóm ngành..." />
          )}

          {healthRes && (
            <div className="space-y-3">
              <div className="space-y-2">
                {healthRes.summaries.map((s: any) => (
                  <div
                    key={s.index}
                    className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-2.5 text-[13.5px] text-slate-800"
                  >
                    <strong>{s.index}</strong>: Phân phối <strong>{s.dd}</strong> ({s.ddDates}) |
                    Stalling <strong>{s.stall}</strong> | Churning <strong>{s.churn}</strong>
                    {s.extra && (
                      <>
                        {' '}
                        | <strong>Rủi ro:</strong>{' '}
                        <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 font-bold">
                          {s.extra.riskScore}
                        </code>{' '}
                        → <strong>Tỷ trọng:</strong>{' '}
                        <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 font-bold text-[#0284c7]">
                          {s.extra.allocTxt}
                        </code>{' '}
                        ({s.extra.reason})
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[10px] p-3">
                  <h4 className="font-bold text-[15px] text-slate-900 mb-2">
                    🔥 Nhóm Ngành DẪN DẮT (&gt; 50% mã trên MA20)
                  </h4>
                  {healthRes.leaders.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                            <th className="py-2 px-2.5">Ngành</th>
                            <th className="py-2 px-2.5 text-right">% &gt; MA20</th>
                            <th className="py-2 px-2.5 text-right">Trước đó</th>
                            <th className="py-2 px-2.5 text-right">Thay đổi</th>
                            <th className="py-2 px-2.5">Cảnh báo</th>
                            <th className="py-2 px-2.5 text-right">Số mã</th>
                          </tr>
                        </thead>
                        <tbody>
                          {healthRes.leaders.map((r: any) => (
                            <tr key={r.industry} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-2 px-2.5 font-semibold">{r.industry}</td>
                              <td className={`py-2 px-2.5 text-right tabular-nums ${colorPctStrengthClass(r.pctAboveMa20)}`}>
                                {fmtNum(r.pctAboveMa20, 1)}%
                              </td>
                              <td className="py-2 px-2.5 text-right tabular-nums">{fmtNum(r.prevPct, 1)}%</td>
                              <td className={`py-2 px-2.5 text-right tabular-nums ${colorSignedClass(r.change)}`}>
                                {fmtSigned(r.change, 1, '%')}
                              </td>
                              <td className={`py-2 px-2.5 ${colorStatusClass(r.warning)}`}>{r.warning}</td>
                              <td className="py-2 px-2.5 text-right tabular-nums">{r.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Không có nhóm ngành nào đạt chuẩn dẫn dắt.</p>
                  )}
                </div>

                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-[10px] p-3">
                  <h4 className="font-bold text-[15px] text-slate-900 mb-2">
                    ❄️ Nhóm Ngành SUY YẾU (&gt; 50% mã dưới MA50)
                  </h4>
                  {healthRes.weak.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                            <th className="py-2 px-2.5">Ngành</th>
                            <th className="py-2 px-2.5 text-right">% &lt; MA50</th>
                            <th className="py-2 px-2.5 text-right">Số mã</th>
                          </tr>
                        </thead>
                        <tbody>
                          {healthRes.weak.map((r: any) => (
                            <tr key={r.industry} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-2 px-2.5 font-semibold">{r.industry}</td>
                              <td className={`py-2 px-2.5 text-right tabular-nums ${colorPctWeakClass(r.pctBelowMa50)}`}>
                                {fmtNum(r.pctBelowMa50, 1)}%
                              </td>
                              <td className="py-2 px-2.5 text-right tabular-nums">{r.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Không có nhóm ngành nào suy yếu &gt; 50%.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
