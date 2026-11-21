import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ALL_MAIN_INDICES, getVnTreemapColor } from '../shared/constants';
import { PlotlyChart } from '../components/PlotlyChart';
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
  liveAuto: boolean;
}

export const MarketOverviewWorkspace: React.FC<Props> = ({ liveAuto }) => {
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'indices' | 'treemap' | 'health'>('indices');

  // --- Sub-tab 1.1: Indices Live ---
  const [idxDate, setIdxDate] = useState(today);
  const [selectedIndices, setSelectedIndices] = useState<string[]>(ALL_MAIN_INDICES);
  const [idxData, setIdxData] = useState<any[]>([]);
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
        }
      } finally {
        if (!silent) setIdxLoading(false);
      }
    },
    [idxDate, selectedIndices]
  );

  useEffect(() => {
    if (subTab !== 'indices') return;
    loadIndices(false, false);
    if (liveAuto && idxDate === today) {
      const id = setInterval(() => loadIndices(false, true), 5000);
      return () => clearInterval(id);
    }
  }, [subTab, liveAuto, idxDate, today, loadIndices]);

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

      annotations.push({
        xref: `${xRef} domain`,
        yref: `${yRef} domain`,
        x: 0.5,
        y: 1.07,
        text: `<b>${item.symbol}</b>`,
        showarrow: false,
        font: { size: 13, color: '#0f172a' },
      });
    });

    layout.shapes = shapes;
    layout.annotations = annotations;

    return { traces, layout, height: Math.max(420, nRows * 250) };
  }, [idxData]);

  // --- Sub-tab 1.2: Treemap ---
  const [tmDate, setTmDate] = useState(today);
  const [tmSizeMode, setTmSizeMode] = useState<'value' | 'volume'>('value');
  const [tmResp, setTmResp] = useState<any>(null);
  const [tmLoading, setTmLoading] = useState(false);

  const loadTreemap = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) setTmLoading(true);
      try {
        const q = new URLSearchParams({
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
    [tmDate, tmSizeMode]
  );

  useEffect(() => {
    if (subTab !== 'treemap') return;
    loadTreemap(false, false);
    if (liveAuto && tmDate === today) {
      const id = setInterval(() => loadTreemap(false, true), 5000);
      return () => clearInterval(id);
    }
  }, [subTab, liveAuto, tmDate, today, loadTreemap]);

  const treemapPlot = useMemo(() => {
    const rows: any[] = tmResp?.rows || [];
    if (!rows.length) return null;

    const totalGtgd = rows.reduce((s, r) => s + r.sizeVal, 0);
    const mktAvgPct =
      totalGtgd > 0 ? rows.reduce((s, r) => s + r.pct * r.sizeVal, 0) / totalGtgd : 0;

    const ids: string[] = ['HOSE'];
    const labels: string[] = ['HOSE'];
    const parents: string[] = [''];
    const values: number[] = [0];
    const colors: string[] = ['#0f172a'];
    const texts: string[] = [
      `<b>HOSE (${fmtSigned(mktAvgPct, 2, '%')}) • Tổng: ${fmtNum(totalGtgd, 0)} ${
        tmSizeMode === 'value' ? 'Tỷ' : 'CP'
      }</b>`,
    ];
    const hovers: string[] = [
      `<b>Toàn sàn HOSE</b><br>Biến động BQ gia quyền: <b>${fmtSigned(mktAvgPct, 2, '%')}</b><br>Tổng: <b>${fmtNum(
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
      parents.push('HOSE');
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
        hovers.push(
          `<b>${r.symbol}</b> (${ind})<br>Giá đóng cửa: <b>${fmtNum(r.price, 2)}</b><br>Thay đổi: <b>${fmtSigned(
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
        uirevision: 'treemap_keep',
      },
    };
  }, [tmResp, tmSizeMode]);

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
            <LoadingBar text="Đang đồng bộ dữ liệu chỉ số trực tiếp từ SSI..." />
          )}

          {!selectedIndices.length && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-sm">
              Vui lòng chọn ít nhất một chỉ số.
            </div>
          )}

          {idxData.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {idxData.map((item) => (
                  <MetricCard
                    key={item.symbol}
                    label={`${item.symbol} (${item.tradeDateStr})`}
                    value={fmtNum(item.lastPx, 2)}
                    delta={`${fmtSigned(item.delta, 2)} (${fmtSigned(item.pct, 2, '%')})`}
                    deltaPositive={item.delta > 0 ? true : item.delta < 0 ? false : null}
                  />
                ))}
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

      {subTab === 'treemap' && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
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
            <LoadingBar text="Đang tải dữ liệu bản đồ nhiệt toàn sàn HOSE từ SSI..." />
          )}

          {tmResp?.counts && (
            <div className="text-[12.5px] text-slate-600 px-1">
              🟢 <strong>SSI {tmResp.mode === 'live' ? 'Realtime HOSE' : 'Lịch sử HOSE'}</strong> •
              Đồng bộ lúc <code className="bg-slate-200/70 px-1.5 py-0.5 rounded">{tmResp.syncTime}</code> •
              Tăng: <strong className="text-[#059669]">{tmResp.counts.up}</strong> | Giảm:{' '}
              <strong className="text-[#dc2626]">{tmResp.counts.down}</strong> | TC:{' '}
              <strong className="text-[#d97706]">{tmResp.counts.ref}</strong>
            </div>
          )}

          {treemapPlot ? (
            <div className="bg-white border border-slate-200 rounded-[10px] p-1">
              <PlotlyChart data={treemapPlot.data} layout={treemapPlot.layout} height={700} />
            </div>
          ) : (
            !tmLoading && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
                Đang đồng bộ dữ liệu khớp lệnh từ SSI hoặc không có dữ liệu cho ngày đã chọn.
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
