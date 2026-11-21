import React, { useMemo, useState } from 'react';
import { INDUSTRY_GROUPS } from '../shared/constants';
import { DynamicOhlcChart } from '../components/DynamicOhlcChart';
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
  addDaysIso,
  colorPctStrengthClass,
  colorRsClass,
  colorSignedClass,
  colorStatusClass,
  colorVolScoreClass,
  fmtInt,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

import type { StockCatalogResponse } from '../types/catalog';

interface Props {
  catalog: StockCatalogResponse | null;
}

export const BreakoutScreenerWorkspace: React.FC<Props> = ({ catalog }) => {
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'radar' | 'minervini' | 'gainers'>('radar');
  const industryOptions = useMemo(
    () => (catalog?.industries?.length ? catalog.industries : INDUSTRY_GROUPS),
    [catalog]
  );

  // --- 3.1 Radar EOD ---
  const [maFast, setMaFast] = useState(20);
  const [maMid, setMaMid] = useState(50);
  const [minVol, setMinVol] = useState(100_000);
  const [useFtd, setUseFtd] = useState(true);
  const [ftdMode, setFtdMode] = useState(0);
  const [radarRes, setRadarRes] = useState<any>(null);
  const [radarLoading, setRadarLoading] = useState(false);

  const runRadar = async () => {
    setRadarLoading(true);
    try {
      const resp = await fetch('/api/radar-eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maFast, maMid, minVol, useFtd, ftdMode }),
      });
      if (resp.ok) setRadarRes(await resp.json());
    } finally {
      setRadarLoading(false);
    }
  };

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
    return minRes.diagnostics[diagSym] || null;
  }, [minRes, diagSym]);

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
  const [gInd, setGInd] = useState(INDUSTRY_GROUPS[0]);
  const [gTop, setGTop] = useState(10);
  const [gRank, setGRank] = useState<'combo' | 'change' | 'low'>('combo');
  const [gainersRaw, setGainersRaw] = useState<any[]>([]);
  const [gainersLoading, setGainersLoading] = useState(false);

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
          { id: 'radar', label: '🏆 Radar Xếp Hạng EOD (FTD)' },
          { id: 'minervini', label: '⚡ Minervini & VCP Pro' },
          { id: 'gainers', label: '🚀 Lọc CP Tăng Mạnh' },
        ]}
      />

      {/* 3.1 RADAR EOD */}
      {subTab === 'radar' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-1">
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
            <div className="md:col-span-1">
              <FieldLabel label="MA Trung">
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
            <div className="md:col-span-2">
              <FieldLabel label="Min Vol">
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
            <div className="md:col-span-2 flex items-center h-[36px]">
              <label className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useFtd}
                  onChange={(e) => setUseFtd(e.target.checked)}
                  className="w-4 h-4 accent-[#0284c7]"
                />
                Bật FTD
              </label>
            </div>
            <div className="md:col-span-3">
              <FieldLabel label="Chuẩn FTD">
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
            <div className="md:col-span-3">
              <PrimaryButton onClick={runRadar} loading={radarLoading} className="w-full">
                📡 Quét Thị Trường EOD
              </PrimaryButton>
            </div>
          </div>

          {radarLoading && <LoadingBar text="Đang quét Radar EOD toàn sàn từ SSI..." />}

          {radarRes && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <MetricCard label="Ngày Cập Nhật" value={radarRes.risk.date} />
                <MetricCard label="Trạng Thái TT" value={radarRes.risk.phase} />
                <MetricCard label="Tỷ Trọng KN" value={`${Math.round(radarRes.risk.target)}%`} />
                <MetricCard label="Độ Sâu ĐC" value={`${fmtNum(radarRes.risk.dd, 1)}%`} />
                <MetricCard
                  label="Nỗ Lực Hồi Phục"
                  value={
                    radarRes.risk.isFtd
                      ? '✅ FTD'
                      : radarRes.risk.rally > 0
                      ? `Ngày ${radarRes.risk.rally}`
                      : 'Chưa tạo đáy'
                  }
                />
                <MetricCard label="Risk Score" value={fmtNum(radarRes.risk.risk, 1)} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-[10px] p-3">
                  <h4 className="font-bold text-[15px] text-slate-900 mb-2">🏆 Top Ngành Dẫn Dắt</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                          <th className="py-2 px-2.5">Ngành</th>
                          <th className="py-2 px-2.5 text-right">Sức Mạnh</th>
                          <th className="py-2 px-2.5 text-right">Số Mã &gt; MA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {radarRes.sectors.map((s: any) => (
                          <tr key={s.industry} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-2.5 font-semibold">{s.industry}</td>
                            <td className={`py-2 px-2.5 text-right tabular-nums ${colorPctStrengthClass(s.strength)}`}>
                              {fmtNum(s.strength, 1)}%
                            </td>
                            <td className="py-2 px-2.5 text-right tabular-nums">{s.ratioText}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-[10px] p-3">
                  <h4 className="font-bold text-[15px] text-slate-900 mb-2">🚀 Top Cổ Phiếu Nổi Bật</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                          <th className="py-2 px-2.5">Mã CP</th>
                          <th className="py-2 px-2.5">Ngành</th>
                          <th className="py-2 px-2.5 text-right">Giá</th>
                          <th className="py-2 px-2.5 text-right">Volume</th>
                          <th className="py-2 px-2.5 text-right">Hệ Số Vol</th>
                          <th className="py-2 px-2.5">Tín Hiệu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {radarRes.stocks.map((st: any) => (
                          <tr key={st.symbol} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-2.5 font-bold text-slate-900">{st.symbol}</td>
                            <td className="py-2 px-2.5 text-slate-600">{st.industry}</td>
                            <td className="py-2 px-2.5 text-right tabular-nums">{fmtNum(st.price, 2)}</td>
                            <td className="py-2 px-2.5 text-right tabular-nums">{fmtInt(st.volume)}</td>
                            <td className={`py-2 px-2.5 text-right tabular-nums ${colorVolScoreClass(st.volRatio)}`}>
                              {fmtNum(st.volRatio, 2)}x
                            </td>
                            <td className={`py-2 px-2.5 ${colorStatusClass(st.signal)}`}>{st.signal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3.2 MINERVINI & VCP PRO */}
      {subTab === 'minervini' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-3">
              <FieldLabel label="Từ ngày">
                <input
                  type="date"
                  value={minStart}
                  onChange={(e) => setMinStart(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <FieldLabel label="Đến ngày">
                <input
                  type="date"
                  value={minEnd}
                  onChange={(e) => setMinEnd(e.target.value)}
                  className={inputCls}
                />
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
                🚀 Quét Siêu Cổ Phiếu Minervini
              </PrimaryButton>
            </div>
          </div>

          {minLoading && (
            <LoadingBar text="Đang tải dữ liệu và tính RS Rating toàn sàn HOSE..." />
          )}

          {minRes && (
            <div className="space-y-3">
              {minRes.breadth?.length > 0 && (() => {
                const lb = minRes.breadth[minRes.breadth.length - 1];
                const p200 = lb.pctAboveMa200;
                const pbot = lb.pctBottoming;
                if (p200 >= 50) {
                  return (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[13.5px]">
                      🟢 <strong>UPTREND XÁC NHẬN</strong> ({fmtNum(p200, 1)}% cổ phiếu &gt; MA200)
                    </div>
                  );
                }
                if (p200 <= 20) {
                  return (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 text-[13.5px]">
                      🔴 <strong>VÙNG HOẢNG LOẠN / DÒ ĐÁY</strong> ({fmtNum(p200, 1)}% &gt; MA200 |{' '}
                      {fmtNum(pbot, 1)}% sát đáy 52T)
                    </div>
                  );
                }
                return (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[13.5px]">
                    🟡 <strong>THỊ TRƯỜNG PHÂN HÓA</strong> ({fmtNum(p200, 1)}% &gt; MA200)
                  </div>
                );
              })()}

              <SubTabs
                active={minSubTab}
                onChange={(id) => setMinSubTab(id as any)}
                tabs={[
                  { id: 'stocks', label: `🏆 Siêu Cổ Phiếu (${minRes.screened.length})` },
                  { id: 'diag', label: '🔍 Chẩn Đoán Chu Kỳ & Chart VCP' },
                  { id: 'breadth', label: '🌊 Độ Rộng Thị Trường' },
                ]}
              />

              {minSubTab === 'stocks' && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-x-auto">
                  {minRes.screened.length > 0 ? (
                    <table className="w-full text-[13px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                          <th className="py-2 px-3">Mã CP</th>
                          <th className="py-2 px-3">Ngành</th>
                          <th className="py-2 px-3 text-right">Giá</th>
                          <th className="py-2 px-3 text-right">RS Rating</th>
                          <th className="py-2 px-3">Chu Kỳ</th>
                          <th className="py-2 px-3 text-right">% Đỉnh 52T</th>
                          <th className="py-2 px-3">Mô Hình VCP</th>
                          <th className="py-2 px-3 text-right">Pivot</th>
                          <th className="py-2 px-3">Trạng Thái Pivot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {minRes.screened.map((r: any) => (
                          <tr
                            key={r.symbol}
                            onClick={() => {
                              setDiagSym(r.symbol);
                              setMinSubTab('diag');
                            }}
                            className="border-b border-slate-100 hover:bg-sky-50/60 cursor-pointer"
                          >
                            <td className="py-2 px-3 font-bold text-[#0284c7]">{r.symbol}</td>
                            <td className="py-2 px-3">{r.industry}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtNum(r.price, 2)}</td>
                            <td className={`py-2 px-3 text-right tabular-nums ${colorRsClass(r.rsRating)}`}>
                              {r.rsRating}
                            </td>
                            <td className={`py-2 px-3 ${colorStatusClass(r.phase)}`}>{r.phase}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtSigned(r.pctFromPeak, 1, '%')}</td>
                            <td className="py-2 px-3">{r.vcpPattern}</td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {r.pivot !== null ? fmtNum(r.pivot, 2) : '—'}
                            </td>
                            <td className={`py-2 px-3 ${colorStatusClass(r.pivotStatus)}`}>{r.pivotStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-sm text-slate-600">
                      Không có mã nào thỏa mãn toàn bộ 8 tiêu chí Trend Template ở thời điểm này.
                    </div>
                  )}
                </div>
              )}

              {minSubTab === 'diag' && minRes.allSymbols?.length > 0 && (
                <div className="space-y-3">
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
                        <div
                          className="p-3 bg-white rounded-lg border border-slate-200 border-l-4"
                          style={{ borderLeftColor: activeDiag.phaseColor }}
                        >
                          <div
                            className="font-bold text-[14.5px] mb-1"
                            style={{ color: activeDiag.phaseColor }}
                          >
                            {activeDiag.phaseTitle}
                          </div>
                          <div className="text-[13px] text-slate-700">{activeDiag.phaseDesc}</div>
                        </div>

                        {activeDiag.vcp && (
                          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px] text-emerald-950 space-y-1">
                            <div>
                              <strong>VCP {activeDiag.vcp.num_contractions}T:</strong>{' '}
                              {activeDiag.vcp.ranges.map((x: number) => `${x}%`).join(' -> ')}
                            </div>
                            <div>
                              <strong>Pivot:</strong>{' '}
                              <code className="bg-white px-1.5 py-0.5 rounded font-bold">
                                {fmtNum(activeDiag.vcp.buy_point, 2)}
                              </code>{' '}
                              ({activeDiag.vcp.status})
                            </div>
                          </div>
                        )}

                        <div className="p-3.5 bg-white border border-slate-200 rounded-lg text-[13px] space-y-1.5">
                          <div className="font-bold text-slate-900 mb-2">📋 Minervini Trend Template:</div>
                          <div>
                            Giá vs MA50 ({fmtNum(activeDiag.ma50, 2)}):{' '}
                            <strong>
                              {activeDiag.ma50 && activeDiag.close > activeDiag.ma50 ? '🟢 Trên' : '🔴 Dưới'}
                            </strong>
                          </div>
                          <div>
                            Giá vs MA150 ({fmtNum(activeDiag.ma150, 2)}):{' '}
                            <strong>
                              {activeDiag.ma150 && activeDiag.close > activeDiag.ma150 ? '🟢 Trên' : '🔴 Dưới'}
                            </strong>
                          </div>
                          <div>
                            Giá vs MA200 ({fmtNum(activeDiag.ma200, 2)}):{' '}
                            <strong>
                              {activeDiag.ma200 && activeDiag.close > activeDiag.ma200 ? '🟢 Trên' : '🔴 Dưới'}
                            </strong>
                          </div>
                          <div>
                            Đỉnh 52T: <strong>{fmtNum(activeDiag.peak52w, 2)}</strong> (
                            {fmtSigned(activeDiag.pctFromPeak, 1, '%')})
                          </div>
                          <div>
                            Đáy 52T: <strong>{fmtNum(activeDiag.bottom52w, 2)}</strong> (
                            {fmtSigned(activeDiag.pctFromBottom, 1, '%')})
                          </div>
                          <div>
                            <strong>RS Rating:</strong>{' '}
                            <span className={colorRsClass(activeDiag.rsRating)}>
                              {activeDiag.rsRating} / 99
                            </span>
                          </div>
                        </div>
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
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MetricCard label="Giá TB HOSE" value={fmtNum(lb.avgPrice, 1)} />
                      <MetricCard label="Độ Rộng (> MA200)" value={`${fmtNum(lb.pctAboveMa200, 1)}%`} />
                      <MetricCard label="% Sát Đáy 52T" value={`${fmtNum(lb.pctBottoming, 1)}%`} />
                      <MetricCard
                        label="Sụt Giảm Từ Đỉnh"
                        value={`-${fmtNum(minRes.stats.pctDrop, 1)}%`}
                      />
                    </div>
                    {breadthPlot && (
                      <div className="bg-white border border-slate-200 rounded-[10px] p-2">
                        <PlotlyChart
                          data={breadthPlot.data}
                          layout={breadthPlot.layout}
                          height={420}
                        />
                      </div>
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
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-2">
              <FieldLabel label="Sàn">
                <select
                  value={gExchange}
                  onChange={(e) => setGExchange(e.target.value as 'HOSE' | 'HNX' | 'UPCOM' | 'ALL')}
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
                <input
                  type="date"
                  value={gStart}
                  onChange={(e) => setGStart(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Đến ngày">
                <input
                  type="date"
                  value={gEnd}
                  onChange={(e) => setGEnd(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Nhóm ngành">
                <select value={gInd} onChange={(e) => setGInd(e.target.value)} className={inputCls}>
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
                🚀 Lọc Cổ Phiếu
              </PrimaryButton>
            </div>
          </div>

          {gainersLoading && <LoadingBar text="Đang tải dữ liệu lọc cổ phiếu tăng mạnh..." />}

          {gainersSorted.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                    <th className="py-2 px-3">Mã CP</th>
                    <th className="py-2 px-3">Sàn</th>
                    <th className="py-2 px-3">Nhóm Ngành</th>
                    <th className="py-2 px-3 text-right">% Thay Đổi</th>
                    <th className="py-2 px-3 text-right">% Tăng từ Đáy</th>
                    <th className="py-2 px-3 text-right">% Giảm từ Đỉnh</th>
                    <th className="py-2 px-3 text-right">Biên Độ (H/L)</th>
                    <th className="py-2 px-3 text-right">Ngày đạt đỉnh</th>
                  </tr>
                </thead>
                <tbody>
                  {gainersSorted.map((r) => (
                    <tr key={r.symbol} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-bold text-slate-900">{r.symbol}</td>
                      <td className="py-2 px-3 text-[12px] font-semibold text-slate-500">
                        {r.exchange || 'HOSE'}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{r.industry}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.pctChange)}`}>
                        {fmtSigned(r.pctChange, 2, '%')}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.pctFromLow)}`}>
                        {fmtSigned(r.pctFromLow, 2, '%')}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.pctFromHigh)}`}>
                        {fmtSigned(r.pctFromHigh, 2, '%')}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#9333ea] font-bold">
                        {fmtNum(r.amplitude, 2)}%
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-600">{r.peakDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
