import { HARDCODED_HOSE_INDUSTRIES_MAPPING, MA_WINDOWS, isPennyStock } from './constants.ts';
import { formatDdMm, formatDdMmYyyy, type LiveTick, type OhlcvBar } from './types.ts';
import {
  computeDistributionDaysCore,
  evaluateMarketFtdStep,
  getTargetExposureFromRisk,
  rollingMean,
  type FtdState,
} from './quantEngine.ts';

export function buildHistoricalTreemap(
  rawMap: Record<string, OhlcvBar[]>,
  tmDate: string,
  sizeMode: 'value' | 'volume'
) {
  const rows = [];
  let cntUp = 0;
  let cntDown = 0;
  let cntRef = 0;

  for (const [sym, bars] of Object.entries(rawMap)) {
    const sub = bars.filter((b) => b.date <= tmDate);
    if (sub.length >= 2) {
      const cNow = sub[sub.length - 1].close;
      const cPrev = sub[sub.length - 2].close;
      const vol = sub[sub.length - 1].volume;
      if (vol > 0 && cPrev > 0) {
        const pct = ((cNow - cPrev) / cPrev) * 100;
        if (pct > 0) cntUp++;
        else if (pct < 0) cntDown++;
        else cntRef++;
        const ind = isPennyStock(sym) ? 'Penny' : HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] || 'Khác';
        rows.push({
          symbol: sym,
          industry: ind,
          sizeVal: sizeMode === 'value' ? Number(((cNow * vol) / 1e6).toFixed(2)) : Math.round(vol),
          pct: Number(pct.toFixed(2)),
          price: Number(cNow.toFixed(2)),
        });
      }
    }
  }

  return {
    mode: 'historical',
    syncTime: tmDate,
    counts: { up: cntUp, down: cntDown, ref: cntRef },
    rows,
  };
}

export function buildMarketHealth(
  idxMap: Record<string, OhlcvBar[]>,
  secDfs: Record<string, OhlcvBar[]>,
  opts: { ddWin: number; cancelReb: number; ma20Lag: number }
) {
  const summaries = [];
  for (const idxName of ['VNINDEX', 'VN30', 'HNX', 'UPCOM']) {
    const bars = idxMap[idxName];
    if (bars && bars.length) {
      const resDd = computeDistributionDaysCore(bars, {
        window: opts.ddWin,
        cancelReboundPct: opts.cancelReb,
      });
      const ddDates =
        resDd.details
          .filter((d) => d.type === 'DD')
          .slice(-8)
          .map((d) => formatDdMm(d.date))
          .join(', ') || '—';

      let extra: { riskScore?: number; allocTxt?: string; reason?: string } | null = null;
      if (idxName === 'VNINDEX') {
        const closes = bars.map((b) => b.close);
        const close = closes[closes.length - 1];
        const ma50Arr = rollingMean(closes, 50, 50);
        const ma20Arr = rollingMean(closes, 20, 20);
        const ma50 = ma50Arr[ma50Arr.length - 1];
        const ma20 = ma20Arr[ma20Arr.length - 1];

        let allocTxt = '';
        let reason = '';
        if (ma50 !== null && close < ma50) {
          allocTxt = '0%';
          reason = 'Gãy MA50';
        } else if (resDd.dd >= 5 && ma20 !== null && close < ma20) {
          allocTxt = '0%';
          reason = 'Phân phối ≥ 5 + Dưới MA20';
        } else {
          allocTxt = `${Math.round(getTargetExposureFromRisk(resDd.riskScore) * 100)}%`;
          reason = `Theo Risk Score (${resDd.riskScore.toFixed(1)})`;
        }
        extra = { riskScore: Number(resDd.riskScore.toFixed(1)), allocTxt, reason };
      }

      summaries.push({
        index: idxName,
        dd: resDd.dd,
        ddDates,
        stall: resDd.stall,
        churn: resDd.churn,
        extra,
      });
    }
  }

  const secGroups = new Map<
    string,
    { tot: number; a20: number; b50: number; prevSum: number; prevCnt: number }
  >();
  const lag = Math.max(1, Math.round(opts.ma20Lag));

  for (const [s, bars] of Object.entries(secDfs)) {
    if (bars.length < 60 + lag) continue;
    const ind = HARDCODED_HOSE_INDUSTRIES_MAPPING[s] || 'Khác';
    const subC = bars.slice(-100).map((b) => b.close);
    const m20 = rollingMean(subC, 20, 20);
    const m50 = rollingMean(subC, 50, 50);
    const g = secGroups.get(ind) || { tot: 0, a20: 0, b50: 0, prevSum: 0, prevCnt: 0 };
    g.tot += 1;
    const lastIdx = subC.length - 1;
    if (m20[lastIdx] !== null && subC[lastIdx] > m20[lastIdx]!) g.a20 += 1;
    if (m50[lastIdx] !== null && subC[lastIdx] < m50[lastIdx]!) g.b50 += 1;

    const pStart = Math.max(0, subC.length - (lag + 1));
    const pEnd = subC.length - 1;
    if (pEnd > pStart) {
      let hits = 0;
      const len = pEnd - pStart;
      for (let k = pStart; k < pEnd; k++) {
        if (m20[k] !== null && subC[k] > m20[k]!) hits++;
      }
      g.prevSum += hits / len;
      g.prevCnt += 1;
    }
    secGroups.set(ind, g);
  }

  const leaders: any[] = [];
  const weak: any[] = [];
  for (const [k, v] of secGroups.entries()) {
    if (!v.tot) continue;
    const pctNow = (v.a20 / v.tot) * 100;
    const pctPrev = v.prevCnt ? (v.prevSum / v.prevCnt) * 100 : 0;
    const deltaPp = pctNow - pctPrev;
    const pctB50 = (v.b50 / v.tot) * 100;
    if (pctNow > 50) {
      leaders.push({
        industry: k,
        pctAboveMa20: Number(pctNow.toFixed(1)),
        prevPct: Number(pctPrev.toFixed(1)),
        change: Number(deltaPp.toFixed(1)),
        warning: pctPrev - pctNow >= 25 ? 'Suy yếu' : '—',
        count: v.tot,
      });
    }
    if (pctB50 > 50) {
      weak.push({
        industry: k,
        pctBelowMa50: Number(pctB50.toFixed(1)),
        count: v.tot,
      });
    }
  }

  leaders.sort((a, b) => b.pctAboveMa20 - a.pctAboveMa20);
  weak.sort((a, b) => b.pctBelowMa50 - a.pctBelowMa50);

  return { summaries, leaders, weak };
}

export function buildSectorMa(dfs: Record<string, OhlcvBar[]>, industry: string) {
  const maStt = (px: number, mv: number | null) => {
    if (mv === null || !Number.isFinite(mv)) return '—';
    return Math.abs(px - mv) <= 0.001 * px ? 'CHẠM' : px > mv ? 'TRÊN' : 'DƯỚI';
  };

  if (industry === 'Tất cả ngành') {
    const groups = new Map<
      string,
      { tot: number; a20: number; b50: number; bestD: number; hl: string }
    >();
    for (const [s, bars] of Object.entries(dfs)) {
      if (bars.length < 50) continue;
      const ind = HARDCODED_HOSE_INDUSTRIES_MAPPING[s] || 'Khác';
      const closes = bars.map((b) => b.close);
      const cNow = closes[closes.length - 1];
      const m20 = rollingMean(closes, 20, 20)[closes.length - 1];
      const m50 = rollingMean(closes, 50, 50)[closes.length - 1];
      const g = groups.get(ind) || { tot: 0, a20: 0, b50: 0, bestD: -1e9, hl: '' };
      g.tot += 1;
      if (maStt(cNow, m20) === 'TRÊN') g.a20 += 1;
      if (maStt(cNow, m50) === 'DƯỚI') g.b50 += 1;
      if (m20 && m20 > 0) {
        const dPct = ((cNow - m20) / m20) * 100;
        if (dPct > g.bestD) {
          g.bestD = dPct;
          g.hl = s;
        }
      }
      groups.set(ind, g);
    }

    const rows = [...groups.entries()].map(([ind, g]) => {
      const pctS = Number(((g.a20 / g.tot) * 100).toFixed(1));
      const pctW = Number(((g.b50 / g.tot) * 100).toFixed(1));
      const lbl = pctS >= 50 ? 'DẪN DẮT' : pctW >= 50 ? 'YẾU' : 'TRUNG LẬP';
      return {
        industry: ind,
        classification: lbl,
        pctStrong: pctS,
        pctWeak: pctW,
        total: g.tot,
        highlight: g.hl,
        refMa: 'MA20',
        deltaPct: g.hl ? Number(g.bestD.toFixed(1)) : null,
      };
    });

    rows.sort((a, b) => b.pctStrong - a.pctStrong || a.pctWeak - b.pctWeak);
    return { mode: 'all' as const, rows };
  }

  const rows = [];
  for (const [s, bars] of Object.entries(dfs)) {
    if (!bars.length) continue;
    const closes = bars.map((b) => b.close);
    const cNow = closes[closes.length - 1];
    const cPrev = closes.length >= 2 ? closes[closes.length - 2] : cNow;
    let score = 0;
    const mas: Record<string, string> = {};
    for (const w of MA_WINDOWS) {
      if (closes.length >= w) {
        const mv = rollingMean(closes, w, w)[closes.length - 1];
        const stt = maStt(cNow, mv);
        if (stt === 'TRÊN') score += 1;
        mas[`MA${w}`] = mv !== null ? `${stt} (${mv.toFixed(2)})` : '—';
      } else {
        mas[`MA${w}`] = '—';
      }
    }
    rows.push({
      symbol: s,
      price: Number(cNow.toFixed(2)),
      changePct: cPrev > 0 ? Number(((cNow / cPrev - 1) * 100).toFixed(2)) : 0,
      mas,
      _score: score,
    });
  }

  rows.sort((a, b) => b._score - a._score || a.symbol.localeCompare(b.symbol));
  return { mode: 'group' as const, rows: rows.map(({ _score, ...rest }) => rest) };
}

export function buildMoneyFlow(dfs: Record<string, OhlcvBar[]>, mfDate: string, mfDays: number) {
  const perInd = new Map<
    string,
    { dp: number; stp: number; cmfNum: number; tv: number; pcts: number[]; cnt: number }
  >();

  for (const [sym, bars] of Object.entries(dfs)) {
    const subAll = bars.filter((b) => b.date <= mfDate);
    if (subAll.length < mfDays + 1) continue;
    const sub = subAll.slice(-(mfDays + 1));

    let tv = 0;
    let dpVol = 0;
    let stpv = 0;
    let cmfMultVol = 0;
    let sumVol = 0;

    for (let i = 1; i < sub.length; i++) {
      const cur = sub[i];
      const prev = sub[i - 1];
      const hl = cur.high - cur.low;
      const tp = (cur.high + cur.low + cur.close) / 3;
      const prevTp = (prev.high + prev.low + prev.close) / 3;
      const mfMult = hl > 0 ? ((cur.close - cur.low) - (cur.high - cur.close)) / hl : 0;
      const vol = cur.volume;

      tv += cur.close * 1000 * vol;
      dpVol += (cur.close - prev.close) * 1000 * vol;
      const sgn = tp > prevTp ? 1 : tp < prevTp ? -1 : 0;
      stpv += sgn * tp * 1000 * vol;
      cmfMultVol += mfMult * vol;
      sumVol += vol;
    }

    const cmfR = sumVol > 0 ? cmfMultVol / sumVol : 0;
    const pct = sub[0].close > 0 ? (sub[sub.length - 1].close / sub[0].close - 1) * 100 : 0;
    const ind = isPennyStock(sym) ? 'Penny' : HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] || 'Khác';

    const g = perInd.get(ind) || { dp: 0, stp: 0, cmfNum: 0, tv: 0, pcts: [], cnt: 0 };
    g.dp += dpVol;
    g.stp += stpv;
    g.cmfNum += cmfR * tv;
    g.tv += tv;
    g.pcts.push(pct);
    g.cnt += 1;
    perInd.set(ind, g);
  }

  const rows = [...perInd.entries()].map(([ind, g]) => ({
    industry: ind,
    netDpBil: Number((g.dp / 1e9).toFixed(2)),
    netStpBil: Number((g.stp / 1e9).toFixed(2)),
    netCmfBil: Number((g.cmfNum / 1e9).toFixed(2)),
    totalValBil: Number((g.tv / 1e9).toFixed(2)),
    cmf: g.tv > 0 ? Number((g.cmfNum / g.tv).toFixed(3)) : 0,
    avgPct: Number((g.pcts.reduce((a, b) => a + b, 0) / g.pcts.length).toFixed(2)),
    count: g.cnt,
  }));

  return { rows };
}

export function buildRadarEod(
  dfs: Record<string, OhlcvBar[]>,
  today: string,
  opts: { maFast: number; maMid: number; minVol: number; useFtd: boolean; ftdMode: number }
) {
  const { maFast, maMid, minVol, useFtd, ftdMode } = opts;
  const vni = dfs['VNINDEX'];
  let riskInfo = {
    date: formatDdMmYyyy(today),
    phase: 'Không xác định',
    target: 0,
    dd: 0,
    rally: 0,
    isFtd: false,
    risk: 0,
  };

  if (vni && vni.length) {
    const vniVols = vni.map((b) => b.volume);
    const vniCloses = vni.map((b) => b.close);
    const volMa20 = rollingMean(vniVols, 20, 20);
    let ftdState: FtdState = {
      historical_peak: 0,
      reference_peak: 0,
      is_confirmed_uptrend: true,
      rally_attempt_count: 0,
      rally_low: Infinity,
      market_phase: 'Uptrend',
      actual_drawdown: 0,
    };

    for (let i = 0; i < vni.length; i++) {
      const b = vni[i];
      const pC = i > 0 ? vni[i - 1].close : b.close;
      const pV = i > 0 ? vni[i - 1].volume : b.volume;
      ftdState = evaluateMarketFtdStep(
        ftdState,
        b.close,
        b.low,
        b.volume,
        pC,
        pV,
        volMa20[i] ?? 0,
        useFtd,
        ftdMode
      );
    }

    const ddRes = computeDistributionDaysCore(vni, { window: 25 });
    const tgtExp = !ftdState.is_confirmed_uptrend
      ? 0
      : ftdState.market_phase === 'Pullback'
      ? 0.7
      : getTargetExposureFromRisk(ddRes.riskScore);
    const ma200Arr = rollingMean(vniCloses, 200, 200);
    const ma200Last = ma200Arr[ma200Arr.length - 1];
    const below200 = ma200Last !== null && vniCloses[vniCloses.length - 1] < ma200Last;

    riskInfo = {
      date: formatDdMmYyyy(vni[vni.length - 1].date),
      phase: `${ftdState.market_phase}${below200 ? ' (<MA200)' : ''}`.trim(),
      target: tgtExp * 100,
      dd: ftdState.actual_drawdown * 100,
      rally: ftdState.rally_attempt_count,
      isFtd: ftdState.is_confirmed_uptrend,
      risk: Number(ddRes.riskScore.toFixed(1)),
    };
  }

  const secMap = new Map<string, string[]>();
  for (const [sym, sec] of Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)) {
    if (!['Chỉ số', 'Penny', 'Khác'].includes(sec) && !isPennyStock(sym) && dfs[sym]) {
      const list = secMap.get(sec) || [];
      list.push(sym);
      secMap.set(sec, list);
    }
  }

  const sectors = [...secMap.entries()].map(([sec, sList]) => {
    let cntUp = 0;
    for (const s of sList) {
      const bars = dfs[s];
      if (bars.length >= maFast) {
        const closes = bars.map((b) => b.close);
        const maf = rollingMean(closes, maFast, maFast)[closes.length - 1];
        if (maf !== null && closes[closes.length - 1] > maf) cntUp++;
      }
    }
    return {
      industry: sec,
      strength: Number(((cntUp / sList.length) * 100).toFixed(1)),
      ratioText: `${cntUp}/${sList.length}`,
    };
  });
  sectors.sort((a, b) => b.strength - a.strength);

  const stocksRaw = [];
  for (const [sym, bars] of Object.entries(dfs)) {
    if (sym === 'VNINDEX' || bars.length < 200) continue;
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume);
    const lastIdx = bars.length - 1;
    const c = closes[lastIdx];
    const v = vols[lastIdx];
    const maf = rollingMean(closes, maFast, maFast)[lastIdx];
    const mam = rollingMean(closes, maMid, maMid)[lastIdx];
    const mas = rollingMean(closes, 200, 200)[lastIdx];
    const vma = rollingMean(vols, maFast, maFast)[lastIdx];

    if (maf !== null && mam !== null && mas !== null && vma !== null && c > maf && vma > 0) {
      const full = c > maf && maf > mam && mam > mas;
      const vSc = v / vma;
      const brk = v > minVol && vSc > 1.0;
      const sig = full && brk ? 'ĐẠT (Full)' : full ? 'Chờ Vol' : brk ? 'Nổ Vol (Hồi)' : 'Tích lũy';
      stocksRaw.push({
        symbol: sym,
        industry: HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] || 'Khác',
        price: Number(c.toFixed(2)),
        volume: Math.round(v),
        volRatio: Number(vSc.toFixed(2)),
        signal: sig,
        _full: full ? 1 : 0,
      });
    }
  }

  stocksRaw.sort((a, b) => b._full - a._full || b.volRatio - a.volRatio);
  const stocks = stocksRaw.slice(0, 50).map(({ _full, ...rest }) => rest);

  return { risk: riskInfo, sectors, stocks };
}

export function buildGainers(
  dfs: Record<string, OhlcvBar[]>,
  startDate: string,
  endDate: string,
  industry: string
) {
  const rows = [];
  for (const [sym, bars] of Object.entries(dfs)) {
    const sub = bars.filter((b) => b.date >= startDate && b.date <= endDate);
    if (sub.length < 2) continue;
    const c0 = sub[0].close;
    const cl = sub[sub.length - 1].close;
    let hmax = -Infinity;
    let lmin = Infinity;
    let peakDate = sub[0].date;
    for (const b of sub) {
      if (b.high > hmax) {
        hmax = b.high;
        peakDate = b.date;
      }
      if (b.low < lmin) lmin = b.low;
    }
    if (c0 > 0 && lmin > 0 && hmax > 0) {
      const [y, m, d] = peakDate.split('-');
      rows.push({
        symbol: sym,
        industry: industry === 'Penny' ? 'Penny' : HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] || 'Khác',
        pctChange: Number((((cl - c0) / c0) * 100).toFixed(2)),
        pctFromLow: Number((((cl - lmin) / lmin) * 100).toFixed(2)),
        pctFromHigh: Number((((cl - hmax) / hmax) * 100).toFixed(2)),
        amplitude: Number((((hmax - lmin) / c0) * 100).toFixed(2)),
        peakDate: `${d}-${m}-${y}`,
      });
    }
  }
  return { rows };
}

export function buildPortfolioEvaluation(
  holdings: { symbol: string; buy_date: string; buy_price: number; qty: number; note?: string }[],
  histP: Record<string, OhlcvBar[]>,
  liveP: Record<string, LiveTick>,
  cashVnd: number
) {
  let totCost = 0;
  let totVal = 0;
  let totTodayPl = 0;

  const rawRows = holdings.map((h) => {
    const sym = h.symbol.toUpperCase().trim();
    const bp = Number(h.buy_price);
    const qty = Math.round(Number(h.qty));
    const bars = histP[sym];

    let lastPx = bp;
    let prevPx = bp;
    let ma20: number | null = null;
    let ma50: number | null = null;
    let ma150: number | null = null;
    let ma200: number | null = null;
    let daysHeld = 0;

    if (bars && bars.length) {
      const closes = bars.map((b) => b.close);
      lastPx = closes[closes.length - 1];
      prevPx = closes.length >= 2 ? closes[closes.length - 2] : lastPx;
      if (closes.length >= 20) ma20 = rollingMean(closes, 20, 20)[closes.length - 1];
      if (closes.length >= 50) ma50 = rollingMean(closes, 50, 50)[closes.length - 1];
      if (closes.length >= 150) ma150 = rollingMean(closes, 150, 150)[closes.length - 1];
      if (closes.length >= 200) ma200 = rollingMean(closes, 200, 200)[closes.length - 1];
      daysHeld = bars.filter((b) => b.date >= h.buy_date).length;
    }

    if (liveP[sym]?.last) {
      lastPx = liveP[sym].last;
    }

    const plVnd = (lastPx - bp) * qty * 1000;
    const plPct = bp > 0 ? (lastPx / bp - 1) * 100 : 0;
    const todayPl = (lastPx - prevPx) * qty * 1000;
    const rowVal = lastPx * qty * 1000;
    totCost += bp * qty * 1000;
    totVal += rowVal;
    totTodayPl += todayPl;

    const isStrong = Boolean(ma50 && ma150 && ma200 && lastPx > ma50 && ma50 > ma150 && ma150 > ma200);
    let reco = 'NẮM GIỮ (Theo dõi)';
    if (plPct <= -7.0) reco = 'BÁN CẮT LỖ (-7%)';
    else if (plPct <= -5.0) reco = 'CẢNH BÁO (-5%)';
    else if (ma50 && lastPx < ma50) reco = 'BÁN/HẠ TỶ TRỌNG (Gãy MA50)';
    else if (plPct >= 25.0) reco = 'CHỐT LỜI (>25%)';
    else if (plPct >= 20.0) {
      reco = daysHeld < 15 ? 'POWER PLAY (Giữ 8 tuần)' : 'CÂN NHẮC CHỐT LỜI (20-25%)';
    } else if (ma20 && lastPx < ma20) {
      reco = plPct > 0 ? 'BÁN KHÓA LÃI (<MA20)' : 'QUAN SÁT (<MA20)';
    } else if (plPct >= 2.0 && plPct <= 5.0 && isStrong) {
      reco = 'MUA THÊM (Xác nhận Trend)';
    } else if (isStrong) {
      reco = 'NẮM GIỮ (Trend mạnh)';
    }

    return {
      symbol: sym,
      buyDate: h.buy_date,
      buyPrice: bp,
      qty,
      daysHeld,
      currentPrice: Number(lastPx.toFixed(2)),
      plVnd: Math.round(plVnd),
      plPct: Number(plPct.toFixed(2)),
      todayPl: Math.round(todayPl),
      _val: rowVal,
      reco,
      note: h.note || '',
    };
  });

  const navAll = totVal + cashVnd;
  const denom = navAll > 0 ? navAll : 1;
  const rows = rawRows.map(({ _val, ...rest }) => ({
    ...rest,
    weightPct: Number(((_val / denom) * 100).toFixed(2)),
  }));
  const totPl = totVal - totCost;

  return {
    kpis: {
      totalPl: Math.round(totPl),
      totalPlPct: totCost > 0 ? Number(((totPl / totCost) * 100).toFixed(2)) : 0,
      todayPl: Math.round(totTodayPl),
      stockVal: Math.round(totVal),
      nav: Math.round(navAll),
    },
    rows,
  };
}
