import { HARDCODED_HOSE_INDUSTRIES_MAPPING, isPennyStock } from '../src/shared/constants.ts';
import { addDaysToDateStr, type OhlcvBar } from './ssiClient.ts';

// Helper rolling calculations
export function rollingMean(values: number[], window: number, minPeriods = window): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
    if (i >= window) {
      const old = values[i - window];
      if (Number.isFinite(old)) {
        sum -= old;
        count--;
      }
    }
    if (count >= minPeriods) {
      out[i] = sum / count;
    }
  }
  return out;
}

export function rollingMax(values: number[], window: number, minPeriods = window): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    let m = -Infinity;
    let cnt = 0;
    for (let j = start; j <= i; j++) {
      if (Number.isFinite(values[j])) {
        if (values[j] > m) m = values[j];
        cnt++;
      }
    }
    if (cnt >= minPeriods) out[i] = m;
  }
  return out;
}

export function rollingMin(values: number[], window: number, minPeriods = window): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    let m = Infinity;
    let cnt = 0;
    for (let j = start; j <= i; j++) {
      if (Number.isFinite(values[j])) {
        if (values[j] < m) m = values[j];
        cnt++;
      }
    }
    if (cnt >= minPeriods) out[i] = m;
  }
  return out;
}

export function formatDdMm(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

export function formatDdMmYyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ==============================================================================
// 1. VCP PATTERN & MINERVINI STAGE EVALUATION
// ==============================================================================
export interface VcpResult {
  is_vcp: boolean;
  buy_point: number;
  ranges: number[];
  pct_from_pivot: number;
  status: string;
  num_contractions: number;
}

export function detectVcpPattern(
  bars: OhlcvBar[],
  currentDate: string,
  lookbackDays = 150
): VcpResult | null {
  const minDate = addDaysToDateStr(currentDate, -lookbackDays);
  const sub = bars.filter((b) => b.date <= currentDate && b.date >= minDate);
  if (sub.length < 35) return null;

  const reversalPct = 0.03;
  type Swing = { kind: 'peak' | 'valley'; date: string; val: number };
  const swings: Swing[] = [];
  let currentMode: 'peak' | 'valley' = 'peak';
  let extremeVal = sub[0].high;
  let extremeDate = sub[0].date;

  for (let i = 1; i < sub.length; i++) {
    const hi = sub[i].high;
    const lo = sub[i].low;
    const dt = sub[i].date;
    if (currentMode === 'peak') {
      if (hi >= extremeVal) {
        extremeVal = hi;
        extremeDate = dt;
      } else if (extremeVal > 0 && (extremeVal - lo) / extremeVal >= reversalPct) {
        swings.push({ kind: 'peak', date: extremeDate, val: extremeVal });
        currentMode = 'valley';
        extremeVal = lo;
        extremeDate = dt;
      }
    } else {
      if (lo <= extremeVal) {
        extremeVal = lo;
        extremeDate = dt;
      } else if (extremeVal > 0 && (hi - extremeVal) / extremeVal >= reversalPct) {
        swings.push({ kind: 'valley', date: extremeDate, val: extremeVal });
        currentMode = 'peak';
        extremeVal = hi;
        extremeDate = dt;
      }
    }
  }
  swings.push({ kind: currentMode, date: extremeDate, val: extremeVal });

  const cleanSwings: Swing[] = [];
  for (const s of swings) {
    if (!cleanSwings.length) {
      cleanSwings.push(s);
    } else if (cleanSwings[cleanSwings.length - 1].kind === s.kind) {
      const last = cleanSwings[cleanSwings.length - 1];
      if (s.kind === 'peak' && s.val > last.val) cleanSwings[cleanSwings.length - 1] = s;
      else if (s.kind === 'valley' && s.val < last.val) cleanSwings[cleanSwings.length - 1] = s;
    } else {
      cleanSwings.push(s);
    }
  }

  const contractions: { peakVal: number; valleyVal: number; depth: number }[] = [];
  for (let i = 0; i < cleanSwings.length - 1; i++) {
    if (cleanSwings[i].kind === 'peak' && cleanSwings[i + 1].kind === 'valley') {
      const pVal = cleanSwings[i].val;
      const vVal = cleanSwings[i + 1].val;
      if (pVal > 0) {
        contractions.push({
          peakVal: pVal,
          valleyVal: vVal,
          depth: ((pVal - vVal) / pVal) * 100,
        });
      }
    }
  }

  if (contractions.length < 2) return null;

  for (const numC of [4, 3, 2]) {
    if (contractions.length >= numC) {
      const cand = contractions.slice(-numC);
      const depths = cand.map((c) => c.depth);
      const valleys = cand.map((c) => c.valleyVal);

      let isContracting = true;
      for (let i = 0; i < depths.length - 1; i++) {
        if (!(depths[i] > depths[i + 1])) {
          isContracting = false;
          break;
        }
      }
      let higherLows = true;
      for (let i = 0; i < valleys.length - 1; i++) {
        if (!(valleys[i] <= valleys[i + 1] * 1.015)) {
          higherLows = false;
          break;
        }
      }
      const tightFinish = depths[depths.length - 1] <= 8.5;

      if (isContracting && higherLows && tightFinish) {
        const pivot = cand[cand.length - 1].peakVal;
        const currPrice = sub[sub.length - 1].close;
        const pctFromPivot = pivot > 0 ? ((currPrice - pivot) / pivot) * 100 : 0;

        let status = '';
        if (pctFromPivot >= 0 && pctFromPivot <= 5.0) {
          status = '🟢 Điểm Mua Chuẩn (<= 5%)';
        } else if (pctFromPivot > 5.0) {
          status = `⚠️ Quá Điểm Mua (+${pctFromPivot.toFixed(1)}%)`;
        } else {
          status = `⏳ Chờ Pivot (${pctFromPivot.toFixed(1)}%)`;
        }

        return {
          is_vcp: true,
          buy_point: pivot,
          ranges: depths.map((d) => Number(d.toFixed(1))),
          pct_from_pivot: pctFromPivot,
          status,
          num_contractions: numC,
        };
      }
    }
  }

  return null;
}

export function evaluateStockPhase(tk: {
  close: number;
  ma50: number | null;
  ma200: number | null;
  ma200_20d: number | null;
  pctFromPeak: number;
  pctFromBottom: number;
}): { title: string; color: string; desc: string } {
  const { close, ma50, ma200, ma200_20d, pctFromPeak, pctFromBottom } = tk;
  const ma200Slope =
    ma200 !== null && ma200_20d !== null && ma200_20d > 0
      ? ((ma200 - ma200_20d) / ma200_20d) * 100
      : 0;

  if (ma50 === null || ma200 === null) {
    return {
      title: 'CHƯA ĐỦ DỮ LIỆU MA200',
      color: '#64748b',
      desc: 'Cổ phiếu chưa có đủ lịch sử 200 phiên để phân loại chu kỳ.',
    };
  }

  if (close > ma50 && ma50 > ma200 && close > ma200 && ma200Slope >= 0) {
    if (pctFromBottom >= 25 && pctFromPeak >= -25) {
      return {
        title: 'GIAI ĐOẠN 2 (TĂNG TỐC - UPTREND MẠNH)',
        color: '#059669',
        desc: 'Đạt chuẩn Stage 2 Minervini: Cấu trúc xu hướng hoàn hảo, MA dốc lên, sát đỉnh 52 tuần. Ưu tiên MUA.',
      };
    }
    return {
      title: 'GIAI ĐOẠN 2 (ĐANG TRONG XU HƯỚNG TĂNG)',
      color: '#10b981',
      desc: 'Nằm trên MA50 & MA200 dốc lên. Cổ phiếu đang trong chu kỳ tăng giá.',
    };
  }

  if (close < ma200 && ma50 < ma200) {
    return {
      title: 'GIAI ĐOẠN 4 (SUY THOÁI - DOWNTREND)',
      color: '#dc2626',
      desc: 'Xu hướng giảm dài hạn (Stage 4). TUYỆT ĐỐI KHÔNG BẮT ĐÁY!',
    };
  }

  if (close < ma200 && close < ma50) {
    return {
      title: 'CHUYỂN GIAO SANG GIAI ĐOẠN 4',
      color: '#ea580c',
      desc: 'Giá xuyên thủng MA200 và MA50, cảnh báo rủi ro cao rơi vào chu kỳ giảm.',
    };
  }

  if (pctFromPeak >= -25 && (close < ma50 || Math.abs(ma200Slope) < 0.5)) {
    return {
      title: 'GIAI ĐOẠN 3 (PHÂN PHỐI - TẠO ĐỈNH)',
      color: '#d97706',
      desc: 'Biến động lỏng lẻo gần đỉnh, mất mốc MA50, MA200 phẳng ra. Ưu tiên chốt lời.',
    };
  }

  if (Math.abs(ma200Slope) <= 1.0 && Math.abs(close - ma200) / (ma200 > 0 ? ma200 : 1) <= 0.15) {
    return {
      title: 'GIAI ĐOẠN 1 (TÍCH LŨY - TẠO ĐÁY)',
      color: '#2563eb',
      desc: 'Giá dao động biên hẹp quanh MA200 đang phẳng. Đưa vào danh sách theo dõi.',
    };
  }

  if (close > ma200) {
    return {
      title: 'CHUYỂN GIAO (GIAI ĐOẠN 1 SANG 2)',
      color: '#7c3aed',
      desc: 'Giá bứt lên trên MA200, các đường trung bình ngắn hạn đang chuẩn bị Golden Cross.',
    };
  }

  return {
    title: 'GIAI ĐOẠN 4 (SUY THOÁI)',
    color: '#dc2626',
    desc: 'Xu hướng giảm chi phối, giá nằm dưới MA200.',
  };
}

// ==============================================================================
// 2. DISTRIBUTION DAYS (DD / STALL / CHURN) & FTD STATE MACHINE
// ==============================================================================
export interface DistributionResult {
  dd: number;
  stall: number;
  churn: number;
  riskScore: number;
  details: { date: string; type: 'DD' | 'STALL' | 'CHURN' }[];
}

export function computeDistributionDaysCore(
  bars: OhlcvBar[],
  opts?: {
    window?: number;
    cancelReboundPct?: number;
    nearHighLookback?: number;
    wDd?: number;
    wStall?: number;
    wChurn?: number;
    includeChurn?: boolean;
  }
): DistributionResult {
  const window = opts?.window ?? 25;
  const cancelReboundPct = opts?.cancelReboundPct ?? 5.0;
  const nearHighLookback = opts?.nearHighLookback ?? 25;
  const wDd = opts?.wDd ?? 1.0;
  const wStall = opts?.wStall ?? 0.7;
  const wChurn = opts?.wChurn ?? 0.5;
  const includeChurn = opts?.includeChurn ?? true;

  if (!bars || bars.length < 2) {
    return { dd: 0, stall: 0, churn: 0, riskScore: 0, details: [] };
  }

  const nAll = bars.length;
  const closesAll = bars.map((b) => b.close);
  const volsAll = bars.map((b) => b.volume);
  const lookback = Math.max(window, nearHighLookback);
  const rollMaxClose = rollingMax(closesAll, lookback, 1);
  const volMa10 = rollingMean(volsAll, 10, 2);

  const startIdx = Math.max(0, nAll - window);
  const tailLen = nAll - startIdx;
  const reboundPct = cancelReboundPct > 0 && cancelReboundPct < 1 ? cancelReboundPct * 100 : cancelReboundPct;

  const details: { date: string; type: 'DD' | 'STALL' | 'CHURN' }[] = [];

  for (let offset = 0; offset < tailLen; offset++) {
    const i = startIdx + offset;
    if (i === 0) continue;

    const b = bars[i];
    const prev = bars[i - 1];
    const pct = prev.close > 0 ? ((b.close - prev.close) / prev.close) * 100 : 0;
    const volUp = b.volume > prev.volume;
    const rng = b.high - b.low;
    const closePos = rng > 0 ? (b.close - b.low) / rng : Number.NaN;
    const rMax = rollMaxClose[i] ?? b.close;
    const pctBelowHigh = rMax > 0 ? ((rMax - b.close) / rMax) * 100 : 100;
    const vMa = volMa10[i];
    const volSurge = vMa !== null ? b.volume >= vMa * 1.3 : false;

    const isM = pct <= -0.2 && volUp;
    const isS = pct >= 0.0 && pct <= 0.4 && volUp && Number.isFinite(closePos) && closePos <= 0.5;
    const isC = pct >= -0.1 && pct <= 0.5 && volUp && volSurge && pctBelowHigh <= 2.0;

    if (!(isM || isS || (includeChurn && isC))) continue;

    let futMax = b.close;
    for (let j = i + 1; j < nAll; j++) {
      if (bars[j].close > futMax) futMax = bars[j].close;
    }
    if (futMax >= b.close * (1 + reboundPct / 100)) continue;

    if (isM) details.push({ date: b.date, type: 'DD' });
    else if (isS) details.push({ date: b.date, type: 'STALL' });
    else if (includeChurn && isC) details.push({ date: b.date, type: 'CHURN' });
  }

  const dd = details.filter((d) => d.type === 'DD').length;
  const stall = details.filter((d) => d.type === 'STALL').length;
  const churn = details.filter((d) => d.type === 'CHURN').length;
  const riskScore = dd * wDd + stall * wStall + (includeChurn ? churn * wChurn : 0);

  return { dd, stall, churn, riskScore, details };
}

export function getTargetExposureFromRisk(
  riskScore: number,
  tLow = 3.0,
  tMed = 5.0,
  tHigh = 7.0,
  tCrit = 9.0
): number {
  if (riskScore < tLow) return 1.0;
  if (riskScore < tMed) return 0.7;
  if (riskScore < tHigh) return 0.5;
  if (riskScore < tCrit) return 0.3;
  return 0.0;
}

export interface FtdState {
  historical_peak: number;
  reference_peak: number;
  is_confirmed_uptrend: boolean;
  rally_attempt_count: number;
  rally_low: number;
  market_phase: string;
  actual_drawdown: number;
}

export function evaluateMarketFtdStep(
  state: FtdState,
  closeIdx: number,
  lowIdx: number,
  volIdx: number,
  prevClose: number,
  prevVol: number,
  volMa20: number,
  useFtd = true,
  ftdMode = 0
): FtdState {
  let histPeak = state.historical_peak;
  let refPeak = state.reference_peak;
  let isConfirmedUptrend = state.is_confirmed_uptrend;
  let rallyAttemptCount = state.rally_attempt_count;
  let rallyLow = state.rally_low;
  let marketPhase = state.market_phase;

  const pctChange = prevClose > 0 ? (closeIdx - prevClose) / prevClose : 0;

  if (closeIdx > histPeak) histPeak = closeIdx;
  if (closeIdx > refPeak) {
    refPeak = closeIdx;
    isConfirmedUptrend = true;
    rallyAttemptCount = 0;
  }

  const actualDrawdown = histPeak > 0 ? (closeIdx - histPeak) / histPeak : 0;
  const refDrawdown = refPeak > 0 ? (closeIdx - refPeak) / refPeak : 0;

  if (isConfirmedUptrend) {
    if ((rallyLow < Infinity && closeIdx < rallyLow) || refDrawdown <= -0.08) {
      isConfirmedUptrend = false;
      marketPhase = actualDrawdown > -0.15 ? 'Correction' : 'Bear Market';
      rallyAttemptCount = 0;
      rallyLow = lowIdx;
    } else if (refDrawdown > -0.05) {
      if (marketPhase !== 'Confirmed Uptrend (FTD)' || actualDrawdown >= -0.02) {
        marketPhase = 'Uptrend';
      }
    } else {
      marketPhase = 'Pullback';
    }
  } else {
    marketPhase = actualDrawdown > -0.15 ? 'Correction' : 'Bear Market';
    if (lowIdx < rallyLow) {
      rallyLow = lowIdx;
      rallyAttemptCount = 0;
    }

    if (rallyAttemptCount === 0) {
      if (closeIdx > prevClose) rallyAttemptCount = 1;
    } else {
      rallyAttemptCount += 1;
      if (useFtd && rallyAttemptCount >= 4 && pctChange >= 0.012) {
        const isAdvanced = ftdMode === 0;
        const volOk = isAdvanced ? volIdx > prevVol && volIdx > volMa20 : volIdx > prevVol;
        if (volOk) {
          isConfirmedUptrend = true;
          marketPhase = 'Confirmed Uptrend (FTD)';
          refPeak = closeIdx;
        }
      }
    }
  }

  return {
    historical_peak: histPeak,
    reference_peak: refPeak,
    is_confirmed_uptrend: isConfirmedUptrend,
    rally_attempt_count: rallyAttemptCount,
    rally_low: rallyLow,
    market_phase: marketPhase,
    actual_drawdown: actualDrawdown,
  };
}

// ==============================================================================
// 3. MINERVINI SCREENER & RS RATING
// ==============================================================================
function percentileRanks(values: (number | null)[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({
    i,
    v: v !== null && Number.isFinite(v) ? v : -Infinity,
    valid: v !== null && Number.isFinite(v),
  }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(n).fill(1);
  let idx = 0;
  while (idx < n) {
    let end = idx;
    while (end + 1 < n && indexed[end + 1].v === indexed[idx].v) end++;
    const avgRank1Based = (idx + 1 + (end + 1)) / 2;
    const pct = avgRank1Based / n;
    const rs = Math.floor(pct * 99) + 1;
    for (let k = idx; k <= end; k++) {
      ranks[indexed[k].i] = Math.min(99, Math.max(1, rs));
    }
    idx = end + 1;
  }
  return ranks;
}

export interface ScreenedStock {
  symbol: string;
  industry: string;
  price: number;
  rsRating: number;
  phase: string;
  pctFromPeak: number;
  vcpPattern: string;
  pivot: number | null;
  pivotStatus: string;
}

export interface StockDiagnostic {
  symbol: string;
  phaseTitle: string;
  phaseColor: string;
  phaseDesc: string;
  vcp: VcpResult | null;
  close: number;
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;
  peak52w: number | null;
  bottom52w: number | null;
  pctFromPeak: number;
  pctFromBottom: number;
  rsRating: number;
  chartBars: {
    date: string;
    label: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    prevClose: number | null;
    ma50: number | null;
    ma150: number | null;
    ma200: number | null;
  }[];
}

export interface BreadthPoint {
  date: string;
  label: string;
  avgPrice: number;
  pctAboveMa200: number;
  pctBottoming: number;
}

export function runMinerviniScreener(
  rawMap: Record<string, OhlcvBar[]>,
  startDate: string,
  endDate: string,
  minRs = 70,
  industryMap: Record<string, string> = HARDCODED_HOSE_INDUSTRIES_MAPPING
) {
  interface ProcEntry {
    bars: OhlcvBar[];
    ma50: (number | null)[];
    ma150: (number | null)[];
    ma200: (number | null)[];
    ma200_20d: (number | null)[];
    peak52w: (number | null)[];
    bottom52w: (number | null)[];
    pctFromPeak: (number | null)[];
    pctFromBottom: (number | null)[];
    isBottoming: number[];
    momentum: number[];
    dateToIdx: Map<string, number>;
    rsRating: number;
  }

  const procMap = new Map<string, ProcEntry>();
  const latestRows: {
    symbol: string;
    idx: number;
    close: number;
    ma50: number | null;
    ma150: number | null;
    ma200: number | null;
    ma200_20d: number | null;
    peak52w: number | null;
    bottom52w: number | null;
    pctFromPeak: number;
    pctFromBottom: number;
    momentum: number;
  }[] = [];

  for (const [sym, barsRaw] of Object.entries(rawMap)) {
    if (sym === 'VNINDEX' || barsRaw.length < 60) continue;
    const bars = [...barsRaw].sort((a, b) => a.t - b.t);
    const closes = bars.map((b) => b.close);
    const ma50 = rollingMean(closes, 50, 30);
    const ma150 = rollingMean(closes, 150, 80);
    const ma200 = rollingMean(closes, 200, 100);
    const ma200_20d = ma200.map((_, i) => (i >= 20 ? ma200[i - 20] : null));
    const peak52w = rollingMax(closes, 252, 80);
    const bottom52w = rollingMin(closes, 252, 80);

    const pctFromPeak = closes.map((c, i) => {
      const pk = peak52w[i];
      return pk && pk > 0 ? ((c - pk) / pk) * 100 : null;
    });
    const pctFromBottom = closes.map((c, i) => {
      const bt = bottom52w[i];
      return bt && bt > 0 ? ((c - bt) / bt) * 100 : null;
    });
    const isBottoming = pctFromBottom.map((p) => (p !== null && p <= 10 ? 1 : 0));
    const momentum = closes.map((c, i) => {
      const r63 = i >= 63 && closes[i - 63] > 0 ? c / closes[i - 63] - 1 : 0;
      const r126 = i >= 126 && closes[i - 126] > 0 ? c / closes[i - 126] - 1 : 0;
      const r252 = i >= 252 && closes[i - 252] > 0 ? c / closes[i - 252] - 1 : 0;
      return (r63 * 0.4 + r126 * 0.3 + r252 * 0.3) * 100;
    });

    const dateToIdx = new Map<string, number>();
    let lastValidIdx = -1;
    for (let i = 0; i < bars.length; i++) {
      dateToIdx.set(bars[i].date, i);
      if (bars[i].date <= endDate) lastValidIdx = i;
    }

    procMap.set(sym, {
      bars,
      ma50,
      ma150,
      ma200,
      ma200_20d,
      peak52w,
      bottom52w,
      pctFromPeak,
      pctFromBottom,
      isBottoming,
      momentum,
      dateToIdx,
      rsRating: 0,
    });

    if (lastValidIdx >= 0) {
      latestRows.push({
        symbol: sym,
        idx: lastValidIdx,
        close: closes[lastValidIdx],
        ma50: ma50[lastValidIdx],
        ma150: ma150[lastValidIdx],
        ma200: ma200[lastValidIdx],
        ma200_20d: ma200_20d[lastValidIdx],
        peak52w: peak52w[lastValidIdx],
        bottom52w: bottom52w[lastValidIdx],
        pctFromPeak: pctFromPeak[lastValidIdx] ?? -100,
        pctFromBottom: pctFromBottom[lastValidIdx] ?? 0,
        momentum: momentum[lastValidIdx],
      });
    }
  }

  if (!latestRows.length) {
    return {
      screened: [] as ScreenedStock[],
      breadth: [] as BreadthPoint[],
      stats: { peakPrice: 0, peakDate: null as string | null, pctDrop: 0 },
      allSymbols: [] as string[],
      diagnostics: {} as Record<string, StockDiagnostic>,
    };
  }

  const rsRatings = percentileRanks(latestRows.map((r) => r.momentum));
  const screened: ScreenedStock[] = [];
  const diagnostics: Record<string, StockDiagnostic> = {};

  for (let i = 0; i < latestRows.length; i++) {
    const r = latestRows[i];
    const rs = rsRatings[i];
    const entry = procMap.get(r.symbol)!;
    entry.rsRating = rs;

    const vcpRes = detectVcpPattern(entry.bars, endDate, 150);
    const phase = evaluateStockPhase({
      close: r.close,
      ma50: r.ma50,
      ma200: r.ma200,
      ma200_20d: r.ma200_20d,
      pctFromPeak: r.pctFromPeak,
      pctFromBottom: r.pctFromBottom,
    });

    if (
      r.ma50 !== null &&
      r.ma150 !== null &&
      r.ma200 !== null &&
      r.ma200_20d !== null &&
      r.close > r.ma50 &&
      r.ma50 > r.ma150 &&
      r.ma150 > r.ma200 &&
      r.ma200 > r.ma200_20d &&
      r.pctFromBottom >= 25 &&
      r.pctFromPeak >= -25 &&
      rs >= minRs
    ) {
      screened.push({
        symbol: r.symbol,
        industry: industryMap[r.symbol] || 'Khác',
        price: Number(r.close.toFixed(2)),
        rsRating: rs,
        phase: phase.title.split('(')[0].trim(),
        pctFromPeak: Number(r.pctFromPeak.toFixed(1)),
        vcpPattern: vcpRes
          ? `${vcpRes.num_contractions}T (${vcpRes.ranges.map((x) => `${x}%`).join(' -> ')})`
          : '—',
        pivot: vcpRes ? Number(vcpRes.buy_point.toFixed(2)) : null,
        pivotStatus: vcpRes ? vcpRes.status : 'Chưa hình thành',
      });
    }

    // Build compact diagnostic object (last 150 bars)
    const sliceStart = Math.max(0, entry.bars.length - 150);
    const chartBars = [];
    for (let k = sliceStart; k < entry.bars.length; k++) {
      const b = entry.bars[k];
      const [y, m, d] = b.date.split('-');
      chartBars.push({
        date: b.date,
        label: `${d}/${m}/${y.slice(2)}`,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        prevClose: k > 0 ? entry.bars[k - 1].close : null,
        ma50: entry.ma50[k],
        ma150: entry.ma150[k],
        ma200: entry.ma200[k],
      });
    }

    diagnostics[r.symbol] = {
      symbol: r.symbol,
      phaseTitle: phase.title,
      phaseColor: phase.color,
      phaseDesc: phase.desc,
      vcp: vcpRes,
      close: r.close,
      ma50: r.ma50,
      ma150: r.ma150,
      ma200: r.ma200,
      peak52w: r.peak52w,
      bottom52w: r.bottom52w,
      pctFromPeak: r.pctFromPeak,
      pctFromBottom: r.pctFromBottom,
      rsRating: rs,
      chartBars,
    };
  }

  screened.sort((a, b) => b.rsRating - a.rsRating);

  // Market breadth
  const dateSet = new Set<string>();
  for (const entry of procMap.values()) {
    for (const b of entry.bars) {
      if (b.date >= startDate && b.date <= endDate) dateSet.add(b.date);
    }
  }
  const commonDates = [...dateSet].sort();
  const breadth: BreadthPoint[] = [];

  for (const d of commonDates) {
    let nTot = 0;
    let nAbove200 = 0;
    let nBot = 0;
    let sumPrices = 0;
    for (const entry of procMap.values()) {
      const idx = entry.dateToIdx.get(d);
      if (idx === undefined) continue;
      nTot++;
      const c = entry.bars[idx].close;
      sumPrices += c;
      const m200 = entry.ma200[idx];
      if (m200 !== null && c > m200) nAbove200++;
      if (entry.isBottoming[idx] === 1) nBot++;
    }
    if (nTot > 0) {
      const [y, m, day] = d.split('-');
      breadth.push({
        date: d,
        label: `${day}/${m}/${y.slice(2)}`,
        avgPrice: sumPrices / nTot,
        pctAboveMa200: (nAbove200 / nTot) * 100,
        pctBottoming: (nBot / nTot) * 100,
      });
    }
  }

  let peakPrice = 0;
  let peakDate: string | null = null;
  let pctDrop = 0;
  if (breadth.length) {
    for (const bp of breadth) {
      if (bp.avgPrice > peakPrice) {
        peakPrice = bp.avgPrice;
        peakDate = bp.date;
      }
    }
    const lastVal = breadth[breadth.length - 1].avgPrice;
    pctDrop = peakPrice > 0 ? ((peakPrice - lastVal) / peakPrice) * 100 : 0;
  }

  return {
    screened,
    breadth,
    stats: { peakPrice, peakDate, pctDrop },
    allSymbols: [...procMap.keys()].sort(),
    diagnostics,
  };
}

// ==============================================================================
// 4. HYBRID BACKTEST ENGINE
// ==============================================================================
export interface BacktestParams {
  symbols: string[];
  initial_capital: number;
  fee_rate: number;
  t_plus: number;
  max_positions: number;
  max_per_sector: number;
  stop_loss: number;
  ma_exit: number;
  start_date: string;
  end_date: string;
  entry_mode: number;
  min_rs: number;
  max_pivot_pct: number;
  vol_mult: number;
  min_vol: number;
  filter_top_sectors: boolean;
  top_sectors: number;
  use_take_profit: boolean;
  take_profit: number;
  use_power_play: boolean;
  use_dd_shield: boolean;
  w_dd: number;
  w_stall: number;
  dd_cancel_pct: number;
  t_low: number;
  t_med: number;
  t_high: number;
  t_crit: number;
  use_top_climax: boolean;
  climax_breadth_thresh: number;
  use_bottom_fishing: boolean;
  panic_ma200_thresh: number;
  panic_bot52_thresh: number;
}

function diffCalendarDays(d1: string, d2: string): number {
  const t1 = Date.parse(`${d1}T00:00:00Z`);
  const t2 = Date.parse(`${d2}T00:00:00Z`);
  return Math.round((t2 - t1) / 86_400_000);
}

export function runHybridBacktest(
  rawMap: Record<string, OhlcvBar[]>,
  p: BacktestParams,
  industryMap: Record<string, string> = HARDCODED_HOSE_INDUSTRIES_MAPPING,
  pennySet?: Set<string>
) {
  interface BtStockData {
    bars: OhlcvBar[];
    dateToIdx: Map<string, number>;
    pct: number[];
    ma10: (number | null)[];
    maExit: (number | null)[];
    ma20: (number | null)[];
    ma50: (number | null)[];
    ma150: (number | null)[];
    ma200: (number | null)[];
    ma200_20d: (number | null)[];
    volMa10: (number | null)[];
    volMa20: (number | null)[];
    closePos: number[];
    pctFromPeak: (number | null)[];
    pctFromBottom: (number | null)[];
    isBottoming: number[];
    momentum: number[];
    rsByDate: Map<string, number>;
  }

  const dataMap = new Map<string, BtStockData>();
  const allDateSet = new Set<string>();
  const nonIndexSyms: string[] = [];

  for (const [sym, rawBars] of Object.entries(rawMap)) {
    if (rawBars.length < 60) continue;
    const bars = [...rawBars].sort((a, b) => a.t - b.t);
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume);
    const pct = closes.map((c, i) => (i > 0 && closes[i - 1] > 0 ? ((c - closes[i - 1]) / closes[i - 1]) * 100 : 0));
    const ma10 = rollingMean(closes, 10, 5);
    const maExit = rollingMean(closes, p.ma_exit, 10);
    const ma20 = rollingMean(closes, 20, 15);
    const ma50 = rollingMean(closes, 50, 30);
    const ma150 = rollingMean(closes, 150, 80);
    const ma200 = rollingMean(closes, 200, 100);
    const ma200_20d = ma200.map((_, i) => (i >= 20 ? ma200[i - 20] : null));
    const volMa10 = rollingMean(vols, 10, 5);
    const volMa20 = rollingMean(vols, 20, 10);

    const closePos = bars.map((b) => {
      const r = b.high - b.low;
      return r > 0 ? (b.close - b.low) / r : 0.5;
    });
    const peak52 = rollingMax(closes, 252, 80);
    const bot52 = rollingMin(closes, 252, 80);
    const pctFromPeak = closes.map((c, i) => (peak52[i] && peak52[i]! > 0 ? ((c - peak52[i]!) / peak52[i]!) * 100 : null));
    const pctFromBottom = closes.map((c, i) => (bot52[i] && bot52[i]! > 0 ? ((c - bot52[i]!) / bot52[i]!) * 100 : null));
    const isBottoming = pctFromBottom.map((v) => (v !== null && v <= 12.0 ? 1 : 0));
    const momentum = closes.map((c, i) => {
      const r63 = i >= 63 && closes[i - 63] > 0 ? c / closes[i - 63] - 1 : 0;
      const r126 = i >= 126 && closes[i - 126] > 0 ? c / closes[i - 126] - 1 : 0;
      const r252 = i >= 252 && closes[i - 252] > 0 ? c / closes[i - 252] - 1 : 0;
      return (r63 * 0.4 + r126 * 0.3 + r252 * 0.3) * 100;
    });

    const dateToIdx = new Map<string, number>();
    for (let i = 0; i < bars.length; i++) {
      dateToIdx.set(bars[i].date, i);
      allDateSet.add(bars[i].date);
    }

    dataMap.set(sym, {
      bars,
      dateToIdx,
      pct,
      ma10,
      maExit,
      ma20,
      ma50,
      ma150,
      ma200,
      ma200_20d,
      volMa10,
      volMa20,
      closePos,
      pctFromPeak,
      pctFromBottom,
      isBottoming,
      momentum,
      rsByDate: new Map(),
    });
    if (sym !== 'VNINDEX') nonIndexSyms.push(sym);
  }

  const allDatesAll = [...allDateSet].sort();
  const allDates = allDatesAll.filter((d) => d >= p.start_date && d <= p.end_date);
  if (!allDates.length) return null;

  // Cross-sectional RS rating + Breadth per date
  const breadthMap = new Map<string, { pctAbove200: number; pctBottoming: number; peak10: number; prevPctAbove200: number }>();
  const pctAboveSeries: number[] = [];

  for (const d of allDatesAll) {
    const symsOnDate: string[] = [];
    const momsOnDate: number[] = [];
    let cntMa200 = 0;
    let cntAbove = 0;
    let cntBotTot = 0;
    let cntBot = 0;

    for (const sym of nonIndexSyms) {
      const sd = dataMap.get(sym)!;
      const idx = sd.dateToIdx.get(d);
      if (idx === undefined) continue;
      symsOnDate.push(sym);
      momsOnDate.push(sd.momentum[idx]);
      const m200 = sd.ma200[idx];
      if (m200 !== null) {
        cntMa200++;
        if (sd.bars[idx].close > m200) cntAbove++;
      }
      cntBotTot++;
      if (sd.isBottoming[idx] === 1) cntBot++;
    }

    if (symsOnDate.length && d >= p.start_date && d <= p.end_date) {
      const rsArr = percentileRanks(momsOnDate);
      for (let i = 0; i < symsOnDate.length; i++) {
        dataMap.get(symsOnDate[i])!.rsByDate.set(d, rsArr[i]);
      }
    }

    const p200 = cntMa200 > 0 ? (cntAbove / cntMa200) * 100 : 50;
    const pBot = cntBotTot > 0 ? (cntBot / cntBotTot) * 100 : 0;
    const prevP200 = pctAboveSeries.length > 0 ? pctAboveSeries[pctAboveSeries.length - 1] : p200;
    pctAboveSeries.push(p200);

    let peak10 = p200;
    const wStart = Math.max(0, pctAboveSeries.length - 10);
    for (let k = wStart; k < pctAboveSeries.length; k++) {
      if (pctAboveSeries[k] > peak10) peak10 = pctAboveSeries[k];
    }

    breadthMap.set(d, { pctAbove200: p200, pctBottoming: pBot, peak10, prevPctAbove200: prevP200 });
  }

  // Optional Top Sectors precalc
  const dailyTopSectors = new Map<string, Set<string>>();
  if (p.filter_top_sectors) {
    const secToSyms = new Map<string, string[]>();
    for (const [sym, sec] of Object.entries(industryMap)) {
      const symIsPenny = pennySet ? pennySet.has(sym) : isPennyStock(sym);
      if (!['Chỉ số', 'Penny', 'Khác'].includes(sec) && !symIsPenny && dataMap.has(sym)) {
        const arr = secToSyms.get(sec) || [];
        arr.push(sym);
        secToSyms.set(sec, arr);
      }
    }
    for (const d of allDates) {
      const scores: [string, number][] = [];
      for (const [sec, syms] of secToSyms.entries()) {
        let up = 0;
        for (const s of syms) {
          const sd = dataMap.get(s)!;
          const idx = sd.dateToIdx.get(d);
          if (idx !== undefined && sd.ma20[idx] !== null && sd.ma50[idx] !== null) {
            const c = sd.bars[idx].close;
            if (c > sd.ma20[idx]! && c > sd.ma50[idx]!) up++;
          }
        }
        scores.push([sec, up / syms.length]);
      }
      scores.sort((a, b) => b[1] - a[1]);
      dailyTopSectors.set(d, new Set(scores.slice(0, p.top_sectors).map((x) => x[0])));
    }
  }

  let cash = Number(p.initial_capital);
  const initialCapital = cash;
  const tPlus = Math.ceil(p.t_plus);
  const vnindex = dataMap.get('VNINDEX') || null;
  const tradableSymbols = p.symbols.filter((s) => s !== 'VNINDEX' && dataMap.has(s));

  interface Holding {
    qty: number;
    price: number;
    lastPrice: number;
    date: string;
    isPowerPlay: boolean;
    vcpTag: string;
    isBottomBet: boolean;
  }
  interface PendingStock {
    arrivalIdx: number;
    sym: string;
    qty: number;
    price: number;
    buyDate: string;
    sec: string;
    tradeTag: string;
    isBottomBet: boolean;
  }

  const holdings = new Map<string, Holding>();
  let pendingStocks: PendingStock[] = [];
  let pendingCash: { settleIdx: number; amount: number }[] = [];

  const tradesHistory: any[] = [];
  const closedTrades: any[] = [];
  const equityHistory: any[] = [];
  const dailySnapshots: any[] = [];

  const totalDays = allDates.length;
  let wasInPanicZone = false;
  let panicCooldownDays = 0;

  // Track last known VNINDEX bar index <= currentDate
  let vniPtr = -1;

  for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
    const currentDate = allDates[dayIdx];
    const fmtDate = formatDdMmYyyy(currentDate);

    // 1. Settle cash
    const remCash: typeof pendingCash = [];
    for (const item of pendingCash) {
      if (dayIdx >= item.settleIdx) cash += item.amount;
      else remCash.push(item);
    }
    pendingCash = remCash;

    // 2. Settle stocks
    const remStocks: PendingStock[] = [];
    for (const item of pendingStocks) {
      if (dayIdx >= item.arrivalIdx) {
        const existing = holdings.get(item.sym);
        if (existing) {
          const newQty = existing.qty + item.qty;
          const newPrice = (existing.qty * existing.price + item.qty * item.price) / newQty;
          existing.qty = newQty;
          existing.price = newPrice;
          existing.lastPrice = item.price;
        } else {
          holdings.set(item.sym, {
            qty: item.qty,
            price: item.price,
            lastPrice: item.price,
            date: item.buyDate,
            isPowerPlay: false,
            vcpTag: item.tradeTag,
            isBottomBet: item.isBottomBet,
          });
        }
      } else {
        remStocks.push(item);
      }
    }
    pendingStocks = remStocks;

    // 3. Market DD / Risk
    let cntDd = 0;
    let riskScore = 0;
    if (vnindex) {
      while (vniPtr + 1 < vnindex.bars.length && vnindex.bars[vniPtr + 1].date <= currentDate) {
        vniPtr++;
      }
      if (vniPtr >= 25) {
        const ddRes = computeDistributionDaysCore(vnindex.bars.slice(0, vniPtr + 1), {
          window: 25,
          cancelReboundPct: p.dd_cancel_pct,
          wDd: p.w_dd,
          wStall: p.w_stall,
          includeChurn: true,
        });
        cntDd = ddRes.dd;
        riskScore = ddRes.riskScore;
      }
    }

    const bInfo = breadthMap.get(currentDate) || {
      pctAbove200: 50,
      pctBottoming: 0,
      peak10: 50,
      prevPctAbove200: 50,
    };
    const pctAbove200 = bInfo.pctAbove200;
    const prevPctAbove200 = bInfo.prevPctAbove200;
    const breadthPeak10 = bInfo.peak10;
    const pctBottoming = bInfo.pctBottoming;

    let vniAboveMa20 = true;
    let vniAboveMa50 = true;
    let vniGreenDay = false;
    if (vnindex) {
      const vIdx = vnindex.dateToIdx.get(currentDate);
      if (vIdx !== undefined) {
        const vc = vnindex.bars[vIdx].close;
        const m20 = vnindex.ma20[vIdx];
        const m50 = vnindex.ma50[vIdx];
        vniAboveMa20 = m20 === null || vc >= m20;
        vniAboveMa50 = m50 === null || vc >= m50;
        vniGreenDay = vnindex.pct[vIdx] >= 0.3;
      }
    }

    const isPanicZoneToday =
      pctAbove200 <= p.panic_ma200_thresh && pctBottoming >= p.panic_bot52_thresh;
    if (isPanicZoneToday) {
      wasInPanicZone = true;
      panicCooldownDays = 15;
    } else if (panicCooldownDays > 0) {
      panicCooldownDays--;
      if (pctAbove200 >= 35.0) {
        wasInPanicZone = false;
        panicCooldownDays = 0;
      }
    } else {
      wasInPanicZone = false;
    }

    const canBottomFish =
      p.use_bottom_fishing &&
      (isPanicZoneToday || wasInPanicZone) &&
      (vniGreenDay || pctAbove200 > prevPctAbove200);
    const isEuphoriaTop =
      p.use_top_climax &&
      breadthPeak10 >= p.climax_breadth_thresh &&
      pctAbove200 < breadthPeak10 - 2.0 &&
      (riskScore >= 3.5 || !vniAboveMa20);

    let targetExposure = 1.0;
    if (p.use_dd_shield) {
      targetExposure = getTargetExposureFromRisk(riskScore, p.t_low, p.t_med, p.t_high, p.t_crit);
      if (!vniAboveMa50 && cntDd >= 4) targetExposure = Math.min(targetExposure, 0.25);
      else if (!vniAboveMa20 && cntDd >= 5) targetExposure = Math.min(targetExposure, 0.4);
    }
    if (isEuphoriaTop) targetExposure = Math.min(targetExposure, 0.5);
    if (canBottomFish) targetExposure = Math.max(targetExposure, 0.6);

    // 4. Mark-to-market & exit signals
    let activeHoldingsVal = 0;
    let pendingHoldingsVal = 0;
    const toSell: { sym: string; price: number; reason: string }[] = [];

    for (const [sym, pos] of holdings.entries()) {
      const sd = dataMap.get(sym);
      const idx = sd?.dateToIdx.get(currentDate);
      if (!sd || idx === undefined) {
        activeHoldingsVal += pos.qty * pos.lastPrice * 1000;
        continue;
      }
      const currPrice = sd.bars[idx].close;
      pos.lastPrice = currPrice;
      activeHoldingsVal += pos.qty * currPrice * 1000;

      const pctPnl = (currPrice - pos.price) / pos.price;
      const daysHeld = diffCalendarDays(pos.date, currentDate);

      if (p.use_power_play && !pos.isPowerPlay && !pos.isBottomBet) {
        if (pctPnl >= 0.2 && daysHeld <= 15) pos.isPowerPlay = true;
      }

      let reason: string | null = null;
      if (pos.isBottomBet) {
        if (pctPnl <= -0.05) reason = `Cắt lỗ Bắt đáy (${(pctPnl * 100).toFixed(1)}%)`;
        else if (pctPnl >= 0.15) reason = `Chốt lời Bắt đáy (+${(pctPnl * 100).toFixed(1)}%)`;
        else if (sd.ma10[idx] !== null && currPrice < sd.ma10[idx]! && daysHeld >= 3) {
          reason = `Gãy MA10 Bắt đáy (${pctPnl >= 0 ? '+' : ''}${(pctPnl * 100).toFixed(1)}%)`;
        }
      } else {
        if (pctPnl <= -p.stop_loss) {
          reason = `Cắt lỗ (${(pctPnl * 100).toFixed(1)}%)`;
        } else if (isEuphoriaTop && pctPnl >= 0.12 && sd.ma10[idx] !== null && currPrice < sd.ma10[idx]!) {
          reason = `Bán Đỉnh Hưng Phấn <MA10 (+${(pctPnl * 100).toFixed(1)}%)`;
        } else if (p.use_take_profit && pctPnl >= p.take_profit && !pos.isPowerPlay) {
          reason = `Chốt lời mục tiêu (+${(pctPnl * 100).toFixed(1)}%)`;
        } else {
          const useMa50Trail = pos.isPowerPlay && daysHeld < 56;
          const trendLine = useMa50Trail ? sd.ma50[idx] : sd.maExit[idx];
          if (trendLine !== null && currPrice < trendLine) {
            const exitName = useMa50Trail ? 'MA50 (PP)' : `MA${p.ma_exit}`;
            reason = `Gãy ${exitName} (${pctPnl >= 0 ? '+' : ''}${(pctPnl * 100).toFixed(1)}%)`;
          }
        }
      }

      if (reason) toSell.push({ sym, price: currPrice, reason });
    }

    for (const item of pendingStocks) {
      const sd = dataMap.get(item.sym);
      const idx = sd?.dateToIdx.get(currentDate);
      const px = sd && idx !== undefined ? sd.bars[idx].close : item.price;
      pendingHoldingsVal += item.qty * px * 1000;
    }

    for (const s of toSell) {
      const pos = holdings.get(s.sym)!;
      const proceeds = pos.qty * s.price * 1000 * (1 - p.fee_rate);
      const costBasis = pos.qty * pos.price * 1000;
      const settleIdx = Math.min(dayIdx + tPlus, totalDays - 1);
      pendingCash.push({ settleIdx, amount: proceeds });
      activeHoldingsVal -= pos.qty * s.price * 1000;
      const ppNote = pos.isPowerPlay ? ' [PP]' : '';
      tradesHistory.push({
        date: fmtDate,
        symbol: s.sym,
        side: 'SELL',
        price: Number(s.price.toFixed(2)),
        qty: pos.qty,
        pnl: Math.round(proceeds - costBasis),
        note: `${pos.vcpTag}${ppNote} (T+${tPlus})`.trim(),
        reason: s.reason,
      });
      closedTrades.push({
        symbol: s.sym,
        buyDate: formatDdMmYyyy(pos.date),
        sellDate: fmtDate,
        buyPrice: Number(pos.price.toFixed(2)),
        sellPrice: Number(s.price.toFixed(2)),
        qty: pos.qty,
        pnl: Math.round(proceeds - costBasis),
        pnlPct: Number((((s.price - pos.price) / pos.price) * 100).toFixed(2)),
        reason: pos.vcpTag ? `${s.reason} | ${pos.vcpTag}` : s.reason,
      });
      holdings.delete(s.sym);
    }

    // 5. Exposure trim
    let totalStockVal = activeHoldingsVal + pendingHoldingsVal;
    let pendingCashVal = pendingCash.reduce((acc, x) => acc + x.amount, 0);
    let totalNav = cash + pendingCashVal + totalStockVal;
    const targetEquityVal = totalNav * targetExposure;

    if (p.use_dd_shield && totalStockVal > targetEquityVal * 1.05 && activeHoldingsVal > 0) {
      const keepRatio = targetExposure === 0 ? 0 : targetEquityVal / totalStockVal;
      for (const [sym, pos] of [...holdings.entries()]) {
        if (keepRatio > 0 && pos.isPowerPlay) continue;
        const targetQty = Math.floor(pos.qty * keepRatio);
        const sellQty = pos.qty - targetQty;
        if (sellQty > 0) {
          const price = pos.lastPrice;
          const proceeds = sellQty * price * 1000 * (1 - p.fee_rate);
          const costBasis = sellQty * pos.price * 1000;
          const settleIdx = Math.min(dayIdx + tPlus, totalDays - 1);
          pendingCash.push({ settleIdx, amount: proceeds });
          totalStockVal -= sellQty * price * 1000;
          activeHoldingsVal -= sellQty * price * 1000;
          pendingCashVal += proceeds;
          const trimReason = isEuphoriaTop
            ? 'Bán Đỉnh Hưng Phấn'
            : `Hạ Tỷ Trọng PP (Risk=${riskScore.toFixed(1)})`;
          let noteTxt = '';
          if (targetQty > 0) {
            pos.qty = targetQty;
            noteTxt = `Hạ ${Math.round(100 * (1 - keepRatio))}% (T+${tPlus})`;
          } else {
            holdings.delete(sym);
            noteTxt = `Thoát hết (T+${tPlus})`;
          }
          tradesHistory.push({
            date: fmtDate,
            symbol: sym,
            side: 'SELL',
            price: Number(price.toFixed(2)),
            qty: sellQty,
            pnl: Math.round(proceeds - costBasis),
            note: noteTxt,
            reason: trimReason,
          });
          closedTrades.push({
            symbol: sym,
            buyDate: formatDdMmYyyy(pos.date),
            sellDate: fmtDate,
            buyPrice: Number(pos.price.toFixed(2)),
            sellPrice: Number(price.toFixed(2)),
            qty: sellQty,
            pnl: Math.round(proceeds - costBasis),
            pnlPct: Number((((price - pos.price) / pos.price) * 100).toFixed(2)),
            reason: trimReason,
          });
        }
      }
    }

    // 6. Entries
    const currentSymbols = new Set<string>([
      ...holdings.keys(),
      ...pendingStocks.map((x) => x.sym),
    ]);
    const allowNormalVcpBuy = !isEuphoriaTop && vniAboveMa20 && targetExposure >= 0.5;

    if (
      (allowNormalVcpBuy || canBottomFish) &&
      totalStockVal < targetEquityVal &&
      currentSymbols.size < p.max_positions &&
      cash >= 10_000_000
    ) {
      const allowedSectors = p.filter_top_sectors ? dailyTopSectors.get(currentDate) || new Set<string>() : null;
      const secCounts = new Map<string, number>();
      for (const s of currentSymbols) {
        const sec = industryMap[s] || 'Khác';
        secCounts.set(sec, (secCounts.get(sec) || 0) + 1);
      }

      const candidates: {
        sym: string;
        score: number;
        price: number;
        sec: string;
        rs: number;
        tradeTag: string;
        isBotBet: boolean;
      }[] = [];

      for (const sym of tradableSymbols) {
        if (currentSymbols.has(sym)) continue;
        const sec = industryMap[sym] || 'Khác';
        if ((secCounts.get(sec) || 0) >= p.max_per_sector) continue;

        const sd = dataMap.get(sym)!;
        const idx = sd.dateToIdx.get(currentDate);
        if (idx === undefined) continue;

        const c = sd.bars[idx].close;
        const vol = sd.bars[idx].volume;
        const volMa20 = sd.volMa20[idx] ?? 0;
        const volMa10 = sd.volMa10[idx] ?? 0;
        const rs = sd.rsByDate.get(currentDate) ?? 0;

        if (vol < p.min_vol || volMa20 <= 0 || c <= 0) continue;

        if (allowNormalVcpBuy) {
          if (allowedSectors && !allowedSectors.has(sec)) continue;
          if (vol / volMa20 < p.vol_mult || sd.closePos[idx] < 0.5) continue;

          const m50 = sd.ma50[idx];
          const m150 = sd.ma150[idx];
          const m200 = sd.ma200[idx];
          const m200_20 = sd.ma200_20d[idx];
          const pBot = sd.pctFromBottom[idx] ?? 0;
          const pPeak = sd.pctFromPeak[idx] ?? -100;

          if (
            m50 !== null &&
            m150 !== null &&
            m200 !== null &&
            m200_20 !== null &&
            c > m50 &&
            m50 > m150 &&
            m150 > m200 &&
            m200 > m200_20 &&
            pBot >= 25.0 &&
            pPeak >= -25.0 &&
            rs >= p.min_rs
          ) {
            const vcpRes = detectVcpPattern(sd.bars.slice(0, idx + 1), currentDate, 150);
            let isValidVcpBuy = false;
            let tradeTag = 'Stage2 Trend';
            let priority = 1;

            if (vcpRes && vcpRes.pct_from_pivot >= -1.5 && vcpRes.pct_from_pivot <= p.max_pivot_pct) {
              isValidVcpBuy = true;
              priority = 3;
              const rStr = vcpRes.ranges.map((x) => `${Math.round(x)}%`).join('->');
              tradeTag = `VCP ${vcpRes.num_contractions}T (${rStr})`;
            }

            if (p.entry_mode === 0 && !isValidVcpBuy) continue;
            if (p.entry_mode === 1 && !isValidVcpBuy) {
              let high20 = -Infinity;
              const start20 = Math.max(0, idx - 19);
              for (let k = start20; k <= idx; k++) {
                if (sd.bars[k].close > high20) high20 = sd.bars[k].close;
              }
              if (c < high20) continue;
              tradeTag = 'Stage2 Breakout 20D';
              priority = 2;
            }

            candidates.push({
              sym,
              score: priority * 1000 + rs * 5 + vol / volMa20,
              price: c,
              sec,
              rs,
              tradeTag,
              isBotBet: false,
            });
          }
        } else if (canBottomFish) {
          if (
            rs >= Math.max(65, p.min_rs - 5) &&
            sd.pct[idx] >= 2.5 &&
            sd.closePos[idx] >= 0.6 &&
            sd.ma10[idx] !== null &&
            c > sd.ma10[idx]! &&
            volMa10 > 0 &&
            vol / volMa10 >= 1.2
          ) {
            candidates.push({
              sym,
              score: 500 + rs * 5 + vol / volMa10,
              price: c,
              sec,
              rs,
              tradeTag: `Bắt Đáy Hoảng Loạn (MA200=${Math.round(pctAbove200)}%)`,
              isBotBet: true,
            });
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      let buyPow = targetEquityVal - totalStockVal;
      const slots = p.max_positions - currentSymbols.size;

      for (let i = 0; i < Math.min(slots, candidates.length); i++) {
        if (buyPow < 10_000_000 || cash < 10_000_000) break;
        const cand = candidates[i];
        if ((secCounts.get(cand.sec) || 0) >= p.max_per_sector) continue;

        const allocAmt = Math.min(cash, totalNav / p.max_positions, buyPow);
        const qty = Math.floor(Math.floor(allocAmt / (cand.price * 1000 * (1 + p.fee_rate))) / 100) * 100;
        const cost = qty * cand.price * 1000 * (1 + p.fee_rate);

        if (qty > 0 && cash >= cost) {
          cash -= cost;
          const settleIdx = Math.min(dayIdx + tPlus, totalDays - 1);
          pendingStocks.push({
            arrivalIdx: settleIdx,
            sym: cand.sym,
            qty,
            price: cand.price,
            buyDate: currentDate,
            sec: cand.sec,
            tradeTag: cand.tradeTag,
            isBottomBet: cand.isBotBet,
          });
          pendingHoldingsVal += qty * cand.price * 1000;
          totalStockVal += qty * cand.price * 1000;
          buyPow -= qty * cand.price * 1000;
          secCounts.set(cand.sec, (secCounts.get(cand.sec) || 0) + 1);
          tradesHistory.push({
            date: fmtDate,
            symbol: cand.sym,
            side: 'BUY',
            price: Number(cand.price.toFixed(2)),
            qty,
            pnl: 0,
            note: `Hàng về T+${tPlus}`,
            reason: `${cand.tradeTag} | RS=${cand.rs}`,
          });
        }
      }
    }

    pendingCashVal = pendingCash.reduce((acc, x) => acc + x.amount, 0);
    totalStockVal = activeHoldingsVal + pendingHoldingsVal;
    totalNav = cash + pendingCashVal + totalStockVal;
    const actualExposurePct = totalNav > 0 ? (totalStockVal / totalNav) * 100 : 0;

    const [y, m, d] = currentDate.split('-');
    equityHistory.push({
      date: currentDate,
      label: `${d}/${m}/${y.slice(2)}`,
      nav: totalNav,
      exposure: actualExposurePct,
      breadth200: pctAbove200,
      risk: riskScore,
      isPanic: isPanicZoneToday,
      isClimax: isEuphoriaTop,
    });

    const holdStrs: string[] = [];
    const seenBase = new Set<string>();
    for (const [s, h] of holdings.entries()) {
      const tag = h.isBottomBet ? '(Đáy)' : h.isPowerPlay ? '(PP)' : '';
      holdStrs.push(`${s}${tag}`);
      seenBase.add(s);
    }
    for (const ps of pendingStocks) {
      if (!seenBase.has(ps.sym)) {
        holdStrs.push(`${ps.sym}(T+)`);
        seenBase.add(ps.sym);
      }
    }
    holdStrs.sort();

    dailySnapshots.push({
      date: fmtDate,
      totalNav: Math.round(totalNav),
      cash: Math.round(cash),
      pendingCash: Math.round(pendingCashVal),
      stockVal: Math.round(totalStockVal),
      riskScore: Number(riskScore.toFixed(1)),
      pctAboveMa200: Number(pctAbove200.toFixed(1)),
      holdings: holdStrs.join(', '),
    });
  }

  const finalNav = equityHistory[equityHistory.length - 1].nav;
  const profit = finalNav - initialCapital;
  const calDays = diffCalendarDays(allDates[0], allDates[allDates.length - 1]);
  const cagr = calDays > 0 && initialCapital > 0 ? Math.pow(finalNav / initialCapital, 365 / calDays) - 1 : 0;

  let peakNav = -Infinity;
  let maxDd = 0;
  for (const eq of equityHistory) {
    if (eq.nav > peakNav) peakNav = eq.nav;
    const dd = peakNav > 0 ? ((eq.nav - peakNav) / peakNav) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const winTrades = closedTrades.filter((t) => t.pnl > 0).length;
  const winRate = closedTrades.length > 0 ? (winTrades / closedTrades.length) * 100 : 0;

  return {
    stats: {
      initial: initialCapital,
      final: finalNav,
      profit,
      profitPct: initialCapital > 0 ? (profit / initialCapital) * 100 : 0,
      maxDd,
      totalTrades: closedTrades.length,
      winRate,
      cagr: cagr * 100,
    },
    equity: equityHistory,
    trades: [...tradesHistory].reverse(),
    closed: [...closedTrades].reverse(),
    snapshots: [...dailySnapshots].reverse(),
  };
}
