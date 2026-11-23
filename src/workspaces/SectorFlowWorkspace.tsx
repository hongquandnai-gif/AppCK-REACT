import React, { useEffect, useMemo, useState } from 'react';
import { INDUSTRY_GROUPS, MA_WINDOWS } from '../shared/constants';
import { useMarketStream, useSubscribeSymbols } from '../context/MarketStreamContext';
import { patchSectorMaWithTicks } from '../utils/livePatch';
import {
  FieldLabel,
  LoadingBar,
  PrimaryButton,
  SecondaryButton,
  SubTabs,
  inputCls,
} from '../components/UiPrimitives';
import {
  colorPctStrengthClass,
  colorPctWeakClass,
  colorSignedClass,
  colorStatusClass,
  downloadCsv,
  fmtNum,
  fmtSigned,
  vnTodayIso,
} from '../utils/format';

interface Props {
  isActive?: boolean;
}

export const SectorFlowWorkspace: React.FC<Props> = ({ isActive = true }) => {
  const { catalog, ticks, tickVersion, liveAuto } = useMarketStream();
  const today = useMemo(() => vnTodayIso(), []);
  const [subTab, setSubTab] = useState<'ma' | 'mf'>('ma');

  // Unified SSI ICB Level-2 industries shared across all tabs
  const sectorOptions = useMemo(() => {
    const raw = catalog?.industries?.length ? catalog.industries : INDUSTRY_GROUPS;
    return raw.filter((g) => g !== 'Chỉ số');
  }, [catalog]);

  // 2.1 Sector MA
  const [maExchange, setMaExchange] = useState<'HOSE' | 'HNX' | 'UPCOM' | 'ALL'>('HOSE');
  const [indChoice, setIndChoice] = useState('Tất cả ngành');
  const [maAsof, setMaAsof] = useState(today);
  const [secMaRes, setSecMaRes] = useState<{
    mode: 'all' | 'group';
    rows: any[];
    stockSnapshots?: any[];
    liveWsCount?: number;
    syncTime?: string;
    liveUpdated?: boolean;
  } | null>(null);
  const [secMaLoading, setSecMaLoading] = useState(false);

  useEffect(() => {
    if (sectorOptions.length && !sectorOptions.includes(indChoice)) {
      setIndChoice(sectorOptions[0]);
    }
  }, [sectorOptions, indChoice]);

  // Subscribe ALL tracked stocks in BOTH 'all' (all sectors via stockSnapshots) and 'group' modes
  const trackedMaSymbols = useMemo(() => {
    if (!secMaRes) return [];
    if (secMaRes.mode === 'all' && secMaRes.stockSnapshots?.length) {
      return secMaRes.stockSnapshots.map((s) => String(s.symbol || '')).filter(Boolean);
    }
    if (secMaRes.mode === 'group' && secMaRes.rows?.length) {
      return secMaRes.rows.map((r) => String(r.symbol || '')).filter(Boolean);
    }
    return [];
  }, [secMaRes?.mode, secMaRes?.stockSnapshots?.length, secMaRes?.rows?.length]);

  useSubscribeSymbols(
    trackedMaSymbols,
    isActive && subTab === 'ma' && maAsof >= today && liveAuto && trackedMaSymbols.length > 0
  );

  // Patch Sector MA in-place from real-time SSI WS ticks (both 'all' and 'group' modes)
  useEffect(() => {
    if (!liveAuto || !isActive || subTab !== 'ma' || maAsof < today) return;
    setSecMaRes((prev) => patchSectorMaWithTicks(prev, ticks));
  }, [tickVersion, ticks, liveAuto, isActive, subTab, maAsof, today]);

  const runSectorMa = async () => {
    setSecMaLoading(true);
    try {
      const resp = await fetch('/api/sector-ma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: indChoice, date: maAsof, exchange: maExchange }),
      });
      if (resp.ok) setSecMaRes(await resp.json());
    } finally {
      setSecMaLoading(false);
    }
  };

  const exportSectorCsv = () => {
    if (!secMaRes?.rows.length) return;
    if (secMaRes.mode === 'all') {
      downloadCsv(
        `sector_ma_${maExchange}_${maAsof}.csv`,
        ['Ngành', 'Phân loại', '% Mạnh (>MA20)', '% Yếu (<MA50)', 'Tổng mã', 'Mã nổi bật', 'MA tham chiếu', 'Δ (%)'],
        secMaRes.rows.map((r) => [
          r.industry,
          r.classification,
          r.pctStrong,
          r.pctWeak,
          r.total,
          r.highlight,
          r.refMa,
          r.deltaPct,
        ])
      );
    } else {
      downloadCsv(
        `sector_ma_${maExchange}_${maAsof}.csv`,
        ['Mã', 'Giá', '% Thay đổi', ...MA_WINDOWS.map((w) => `MA${w}`)],
        secMaRes.rows.map((r) => [
          r.symbol,
          r.price,
          r.changePct,
          ...MA_WINDOWS.map((w) => r.mas[`MA${w}`]),
        ])
      );
    }
  };

  // 2.2 Money Flow
  const [mfExchange, setMfExchange] = useState<'HOSE' | 'HNX' | 'UPCOM' | 'ALL'>('HOSE');
  const [mfDate, setMfDate] = useState(today);
  const [mfDays, setMfDays] = useState(10);
  const [mfMethod, setMfMethod] = useState<'dp' | 'stp' | 'cmf'>('dp');
  const [mfRowsRaw, setMfRowsRaw] = useState<any[]>([]);
  const [mfLoading, setMfLoading] = useState(false);

  const runMoneyFlow = async () => {
    setMfLoading(true);
    try {
      const resp = await fetch('/api/money-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: mfDate, days: mfDays, exchange: mfExchange }),
      });
      if (resp.ok) {
        const json = await resp.json();
        setMfRowsRaw(json.rows || []);
      }
    } finally {
      setMfLoading(false);
    }
  };

  const mfSorted = useMemo(() => {
    return [...mfRowsRaw]
      .map((r) => ({
        ...r,
        netFlow: mfMethod === 'dp' ? r.netDpBil : mfMethod === 'stp' ? r.netStpBil : r.netCmfBil,
      }))
      .sort((a, b) => b.netFlow - a.netFlow);
  }, [mfRowsRaw, mfMethod]);

  return (
    <div>
      <SubTabs
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
        tabs={[
          { id: 'ma', label: '🧭 Xu Hướng MA Ngành' },
          { id: 'mf', label: '💸 Dòng Tiền Ngành (Money Flow)' },
        ]}
      />

      {subTab === 'ma' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-2">
              <FieldLabel label="Sàn">
                <select
                  value={maExchange}
                  onChange={(e) => setMaExchange(e.target.value as 'HOSE' | 'HNX' | 'UPCOM' | 'ALL')}
                  className={inputCls}
                >
                  <option value="HOSE">HOSE</option>
                  <option value="HNX">HNX</option>
                  <option value="UPCOM">UPCOM</option>
                  <option value="ALL">Tất cả 3 sàn</option>
                </select>
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <FieldLabel label="Nhóm ngành (SSI ICB)">
                <select
                  value={indChoice}
                  onChange={(e) => setIndChoice(e.target.value)}
                  className={inputCls}
                >
                  {sectorOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Ngày tra cứu">
                <input
                  type="date"
                  value={maAsof}
                  onChange={(e) => setMaAsof(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <PrimaryButton onClick={runSectorMa} loading={secMaLoading} className="w-full">
                🔄 Quét Xu Hướng MA
              </PrimaryButton>
            </div>
            <div className="md:col-span-2">
              {secMaRes && secMaRes.rows.length > 0 && (
                <SecondaryButton onClick={exportSectorCsv} className="w-full">
                  💾 Xuất CSV
                </SecondaryButton>
              )}
            </div>
          </div>

          {secMaLoading && <LoadingBar text="Đang quét đường trung bình MA theo chuẩn ngành SSI..." />}

          {secMaRes && secMaRes.rows.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-slate-600 px-1 tabular-nums">
                <strong className="text-slate-900">
                  {secMaRes.mode === 'all'
                    ? `${secMaRes.rows.length} nhóm ngành (SSI ICB)`
                    : `${indChoice} (${secMaRes.rows.length} mã)`}
                </strong>
                <span className="text-slate-300">·</span>
                <span>Sàn: {maExchange === 'ALL' ? 'HOSE · HNX · UPCOM' : maExchange}</span>
                {(secMaRes.liveUpdated || (secMaRes.liveWsCount ?? 0) > 0) && maAsof >= today && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[#059669]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                      SSI WS Live
                      {secMaRes.syncTime ? ` (${secMaRes.syncTime})` : ''}
                    </span>
                  </>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-x-auto">
              {secMaRes.mode === 'all' ? (
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                      <th className="py-2 px-3">Ngành (SSI ICB)</th>
                      <th className="py-2 px-3">Phân loại</th>
                      <th className="py-2 px-3 text-right">% Mạnh (&gt;MA20)</th>
                      <th className="py-2 px-3 text-right">% Yếu (&lt;MA50)</th>
                      <th className="py-2 px-3 text-right">Tổng mã</th>
                      <th className="py-2 px-3">Mã nổi bật</th>
                      <th className="py-2 px-3">MA tham chiếu</th>
                      <th className="py-2 px-3 text-right">Δ (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {secMaRes.rows.map((r) => (
                      <tr key={r.industry} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold">{r.industry}</td>
                        <td className={`py-2 px-3 ${colorStatusClass(r.classification)}`}>{r.classification}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${colorPctStrengthClass(r.pctStrong)}`}>
                          {fmtNum(r.pctStrong, 1)}%
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${colorPctWeakClass(r.pctWeak)}`}>
                          {fmtNum(r.pctWeak, 1)}%
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.total}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">{r.highlight || '—'}</td>
                        <td className="py-2 px-3 text-slate-600">{r.refMa}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.deltaPct)}`}>
                          {r.deltaPct !== null ? fmtSigned(r.deltaPct, 1, '%') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                      <th className="py-2 px-3">Mã</th>
                      <th className="py-2 px-3 text-right">Giá</th>
                      <th className="py-2 px-3 text-right">% Thay đổi</th>
                      {MA_WINDOWS.map((w) => (
                        <th key={w} className="py-2 px-3">
                          MA{w}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {secMaRes.rows.map((r) => (
                      <tr key={r.symbol} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-900">{r.symbol}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmtNum(r.price, 2)}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.changePct)}`}>
                          {fmtSigned(r.changePct, 2, '%')}
                        </td>
                        {MA_WINDOWS.map((w) => {
                          const v = r.mas[`MA${w}`];
                          return (
                            <td key={w} className={`py-2 px-3 tabular-nums ${colorStatusClass(v)}`}>
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'mf' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-white border border-slate-200 rounded-[10px] p-3">
            <div className="md:col-span-2">
              <FieldLabel label="Sàn">
                <select
                  value={mfExchange}
                  onChange={(e) => setMfExchange(e.target.value as 'HOSE' | 'HNX' | 'UPCOM' | 'ALL')}
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
              <FieldLabel label="Ngày kết thúc">
                <input
                  type="date"
                  value={mfDate}
                  onChange={(e) => setMfDate(e.target.value)}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Số phiên">
                <input
                  type="number"
                  min={3}
                  max={60}
                  value={mfDays}
                  onChange={(e) => setMfDays(Number(e.target.value))}
                  className={inputCls}
                />
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <FieldLabel label="Phương pháp">
                <select
                  value={mfMethod}
                  onChange={(e) => setMfMethod(e.target.value as any)}
                  className={inputCls}
                >
                  <option value="dp">ΔP × Vol (VNĐ)</option>
                  <option value="stp">Signed TP × Vol (VNĐ)</option>
                  <option value="cmf">CMF × GTGD (VNĐ)</option>
                </select>
              </FieldLabel>
            </div>
            <div className="md:col-span-3">
              <PrimaryButton onClick={runMoneyFlow} loading={mfLoading} className="w-full">
                💸 Phân Tích Dòng Tiền
              </PrimaryButton>
            </div>
          </div>

          {mfLoading && <LoadingBar text="Đang tải dữ liệu dòng tiền theo nhóm ngành SSI..." />}

          {mfSorted.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-[10px] p-2 overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                    <th className="py-2 px-3">Ngành (SSI ICB)</th>
                    <th className="py-2 px-3 text-right">Dòng tiền ròng (Tỷ VNĐ)</th>
                    <th className="py-2 px-3 text-right">Tổng GTGD (Tỷ VNĐ)</th>
                    <th className="py-2 px-3 text-right">CMF (N phiên)</th>
                    <th className="py-2 px-3 text-right">% Giá TB</th>
                    <th className="py-2 px-3 text-right">Số mã</th>
                  </tr>
                </thead>
                <tbody>
                  {mfSorted.map((r) => (
                    <tr key={r.industry} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-semibold">{r.industry}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.netFlow)}`}>
                        {fmtSigned(r.netFlow, 2)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtNum(r.totalValBil, 2)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.cmf)}`}>
                        {fmtSigned(r.cmf, 3)}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${colorSignedClass(r.avgPct)}`}>
                        {fmtSigned(r.avgPct, 2, '%')}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.count}</td>
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
