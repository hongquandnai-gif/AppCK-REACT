import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ALL_MAIN_INDICES,
  INDUSTRY_GROUPS,
  MA_COLORS,
  getSymbolsByIndustry,
} from '../shared/constants';
import { DynamicOhlcChart } from '../components/DynamicOhlcChart';
import {
  FieldLabel,
  LoadingBar,
  PrimaryButton,
  SubTabs,
  inputCls,
} from '../components/UiPrimitives';
import { addDaysIso, colorSignedClass, fmtInt, fmtNum, fmtSigned, vnTodayIso } from '../utils/format';

interface Props {
  liveAuto: boolean;
}

const FALLBACK_MA_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

export const ChartAnalysisWorkspace: React.FC<Props> = ({ liveAuto }) => {
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'eod' | 'intraday'>('eod');

  // --- 4.1 EOD Technical Chart ---
  const [indSel, setIndSel] = useState(INDUSTRY_GROUPS[0]);
  const symList = useMemo(() => {
    if (indSel === 'Chỉ số') {
      return [
        ...ALL_MAIN_INDICES,
        ...getSymbolsByIndustry('Chỉ số').filter((s) => !ALL_MAIN_INDICES.includes(s)),
      ];
    }
    if (indSel === 'Tất cả ngành') {
      return [...ALL_MAIN_INDICES, ...getSymbolsByIndustry('Tất cả ngành', false)];
    }
    return getSymbolsByIndustry(indSel, false);
  }, [indSel]);

  const [symSel, setSymSel] = useState('FPT');
  useEffect(() => {
    if (!symList.includes(symSel)) {
      setSymSel(symList.includes('FPT') ? 'FPT' : symList[0] || 'VNINDEX');
    }
  }, [symList, symSel]);

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

  const loadEod = useCallback(
    async (silent = false) => {
      if (!silent) setEodLoading(true);
      try {
        const q = new URLSearchParams({
          symbol: symSel,
          start: hStart,
          end: hEnd,
          tf: hTf,
          mas: activeMas.join(','),
        });
        const resp = await fetch(`/api/chart/eod?${q.toString()}`);
        if (resp.ok) setEodData(await resp.json());
      } finally {
        if (!silent) setEodLoading(false);
      }
    },
    [symSel, hStart, hEnd, hTf, activeMas]
  );

  useEffect(() => {
    if (subTab !== 'eod') return;
    loadEod(false);
    if (liveAuto && hEnd >= today) {
      const id = setInterval(() => loadEod(true), 5000);
      return () => clearInterval(id);
    }
  }, [subTab, liveAuto, hEnd, today, loadEod]);

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
  const [inSymInput, setInSymInput] = useState('FPT');
  const [inSym, setInSym] = useState('FPT');
  const [inDate, setInDate] = useState(today);
  const [inTf, setInTf] = useState('1');
  const [intraData, setIntraData] = useState<any>(null);
  const [intraLoading, setIntraLoading] = useState(false);

  const loadIntraday = useCallback(
    async (forceRefresh = false, silent = false) => {
      const sym = inSym.trim().toUpperCase();
      if (!sym) return;
      if (!silent) setIntraLoading(true);
      try {
        const q = new URLSearchParams({
          symbol: sym,
          date: inDate,
          tf: inTf,
          refresh: forceRefresh ? '1' : '0',
        });
        const resp = await fetch(`/api/chart/intraday?${q.toString()}`);
        if (resp.ok) setIntraData(await resp.json());
      } finally {
        if (!silent) setIntraLoading(false);
      }
    },
    [inSym, inDate, inTf]
  );

  useEffect(() => {
    if (subTab !== 'intraday') return;
    loadIntraday(false, false);
    if (liveAuto && inDate === today) {
      const id = setInterval(() => loadIntraday(false, true), 5000);
      return () => clearInterval(id);
    }
  }, [subTab, liveAuto, inDate, today, loadIntraday]);

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          { id: 'eod', label: '📉 Biểu Đồ Kỹ Thuật (EOD)' },
          { id: 'intraday', label: '⚡ Khớp Lệnh Trong Phiên & Bảng Giá SSI' },
        ]}
      />

      {subTab === 'eod' && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-[10px] p-3 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <FieldLabel label="Nhóm ngành">
                  <select
                    value={indSel}
                    onChange={(e) => setIndSel(e.target.value)}
                    className={inputCls}
                  >
                    {INDUSTRY_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Mã cổ phiếu / Chỉ số">
                  <select
                    value={symSel}
                    onChange={(e) => setSymSel(e.target.value)}
                    className={inputCls}
                  >
                    {symList.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
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
              <div className="md:col-span-3">
                <FieldLabel label="Khung">
                  <select
                    value={hTf}
                    onChange={(e) => setHTf(e.target.value as 'D' | 'W' | 'M')}
                    className={inputCls}
                  >
                    <option value="D">1 Ngày</option>
                    <option value="W">1 Tuần</option>
                    <option value="M">1 Tháng</option>
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

          {eodLoading && !eodData && (
            <LoadingBar text={`Đang tải dữ liệu biểu đồ ${symSel} từ SSI...`} />
          )}

          {eodData?.empty && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
              Không có dữ liệu biểu đồ cho mã {symSel}.
            </div>
          )}

          {eodData && !eodData.empty && (
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
          )}
        </div>
      )}

      {subTab === 'intraday' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-2">
              <FieldLabel label="Mã CP / Chỉ số">
                <input
                  type="text"
                  value={inSymInput}
                  onChange={(e) => setInSymInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setInSym(inSymInput.trim().toUpperCase());
                  }}
                  className={inputCls}
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
            <div className="md:col-span-2">
              <PrimaryButton
                onClick={() => {
                  const next = inSymInput.trim().toUpperCase();
                  if (next !== inSym) setInSym(next);
                  else loadIntraday(true, false);
                }}
                loading={intraLoading}
                className="w-full"
              >
                🔄 Cập nhật
              </PrimaryButton>
            </div>
          </div>

          {intraLoading && !intraData && (
            <LoadingBar text={`Đang tải dữ liệu khớp lệnh ${inSym}...`} />
          )}

          {intraData?.empty && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-sm">
              Chưa có dữ liệu khớp lệnh trong ngày đã chọn.
            </div>
          )}

          {intraData && !intraData.empty && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-[10px] p-2 overflow-auto max-h-[545px]">
                <table className="w-full text-[12.5px] border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-slate-600 text-right">
                      <th className="py-1.5 px-2 text-left">Giờ</th>
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
                      <tr key={`${b.time}_${i}`} className="border-b border-slate-100 hover:bg-slate-50 text-right tabular-nums">
                        <td className="py-1.5 px-2 text-left font-semibold text-slate-700">{b.time}</td>
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
                  uirevision={`intra_${intraData.symbol}_${inTf}`}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
