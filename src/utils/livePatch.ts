export interface LiveTickDto {
  symbol: string;
  last: number;
  ref: number | null;
  delta: number;
  pct: number;
  volume: number;
  value_bil?: number;
  time: string;
}

/**
 * Patches live index cards and their last chart point in-place from WS ticks.
 * Returns the original array reference if nothing actually changed.
 */
export function patchIndicesWithTicks(
  indices: any[],
  ticks: Record<string, LiveTickDto>
): any[] {
  if (!indices.length) return indices;
  let changed = false;

  const next = indices.map((item) => {
    const tick = ticks[item.symbol];
    if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) return item;

    const prevClose = item.prevClose && item.prevClose > 0 ? item.prevClose : tick.ref;
    const delta = prevClose && prevClose > 0 ? tick.last - prevClose : tick.delta;
    const pct = prevClose && prevClose > 0 ? (delta / prevClose) * 100 : tick.pct;
    const nextValBil =
      tick.value_bil && tick.value_bil > 0 ? Number(tick.value_bil.toFixed(2)) : item.totalValBil;
    const nextVolMil =
      tick.volume > 0 ? Number((tick.volume / 1e6).toFixed(2)) : item.totalVolMil;

    const samePx = Math.abs((item.lastPx ?? 0) - tick.last) < 1e-6;
    const sameVal = Math.abs((item.totalValBil ?? 0) - (nextValBil ?? 0)) < 1e-6;
    const sameVol = Math.abs((item.totalVolMil ?? 0) - (nextVolMil ?? 0)) < 1e-6;
    if (samePx && sameVal && sameVol) return item;

    changed = true;
    let nextPoints = item.points;
    if (Array.isArray(item.points) && item.points.length > 0) {
      const lastIdx = item.points.length - 1;
      const lastPt = item.points[lastIdx];
      nextPoints = item.points.slice();
      nextPoints[lastIdx] = {
        ...lastPt,
        close: tick.last,
      };
    }

    const prevTotalValBil = item.prevTotalValBil ?? 0;
    const valDeltaPct =
      prevTotalValBil > 0 && nextValBil > 0
        ? Number((((nextValBil - prevTotalValBil) / prevTotalValBil) * 100).toFixed(2))
        : item.valDeltaPct;

    return {
      ...item,
      lastPx: tick.last,
      delta,
      pct,
      totalValBil: nextValBil,
      totalVolMil: nextVolMil,
      valDeltaPct,
      points: nextPoints,
    };
  });

  return changed ? next : indices;
}

/**
 * Patches Treemap rows and up/down/ref counts in-place from WS ticks.
 */
export function patchTreemapWithTicks(
  tmResp: any,
  ticks: Record<string, LiveTickDto>,
  sizeMode: 'value' | 'volume'
): any {
  if (!tmResp || !Array.isArray(tmResp.rows) || !tmResp.rows.length) return tmResp;
  let changed = false;
  let up = 0;
  let down = 0;
  let ref = 0;
  let latestTime = tmResp.syncTime;

  const nextRows = tmResp.rows.map((r: any) => {
    const tick = ticks[r.symbol];
    if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) {
      if (r.pct > 0) up++;
      else if (r.pct < 0) down++;
      else ref++;
      return r;
    }

    const nextPrice = Number(tick.last.toFixed(2));
    const nextPct = Number(tick.pct.toFixed(2));
    const vol = tick.volume > 0 ? tick.volume : 0;
    const valBil =
      tick.value_bil && tick.value_bil > 0
        ? tick.value_bil
        : vol > 0
        ? (tick.last * vol) / 1e6
        : r.sizeVal;
    const nextSizeVal =
      sizeMode === 'value'
        ? Number(valBil.toFixed(2))
        : vol > 0
        ? Math.round(vol)
        : r.sizeVal;

    if (nextPct > 0) up++;
    else if (nextPct < 0) down++;
    else ref++;

    if (
      Math.abs(r.price - nextPrice) >= 1e-6 ||
      Math.abs(r.pct - nextPct) >= 1e-6 ||
      Math.abs(r.sizeVal - nextSizeVal) >= 1e-6
    ) {
      changed = true;
      if (tick.time) latestTime = tick.time;
      return {
        ...r,
        price: nextPrice,
        pct: nextPct,
        sizeVal: nextSizeVal > 0 ? nextSizeVal : r.sizeVal,
      };
    }
    return r;
  });

  if (!changed) return tmResp;
  return {
    ...tmResp,
    syncTime: latestTime,
    counts: { up, down, ref },
    rows: nextRows,
  };
}

/**
 * Patches the latest OHLC candlestick bar in-place from a WS tick.
 */
export function patchOhlcBarsWithTick(
  bars: any[],
  tick: LiveTickDto | undefined,
  isIntraday = false
): any[] {
  if (!bars.length || !tick || !Number.isFinite(tick.last) || tick.last <= 0) return bars;
  const lastIdx = bars.length - 1;
  const last = bars[lastIdx];

  const nextClose = tick.last;
  const nextHigh = Math.max(last.high, nextClose);
  const nextLow = Math.min(last.low, nextClose);
  const nextVol =
    !isIntraday && tick.volume > 0 ? Math.max(last.volume || 0, tick.volume) : last.volume;
  const nextPct =
    last.prevClose && last.prevClose > 0
      ? Number((((nextClose - last.prevClose) / last.prevClose) * 100).toFixed(2))
      : last.pct;

  if (
    Math.abs(last.close - nextClose) < 1e-6 &&
    Math.abs(last.high - nextHigh) < 1e-6 &&
    Math.abs(last.low - nextLow) < 1e-6 &&
    Math.abs((last.volume ?? 0) - (nextVol ?? 0)) < 1e-6
  ) {
    return bars;
  }

  const next = bars.slice();
  next[lastIdx] = {
    ...last,
    high: nextHigh,
    low: nextLow,
    close: nextClose,
    volume: nextVol,
    pct: nextPct,
  };
  return next;
}

/**
 * Patches portfolio rows and KPI totals instantaneously from WS ticks.
 */
export function patchPortfolioWithTicks(
  portEval: any,
  ticks: Record<string, LiveTickDto>,
  cashVnd: number
): any {
  if (!portEval || !Array.isArray(portEval.rows) || !portEval.rows.length) return portEval;
  let changed = false;

  let totCost = 0;
  let totVal = 0;
  let totTodayPl = 0;

  const updated = portEval.rows.map((r: any) => {
    const tick = ticks[r.symbol];
    const bp = Number(r.buyPrice);
    const qty = Number(r.qty);
    let curPx = Number(r.currentPrice);
    let todayPl = Number(r.todayPl);

    if (tick && Number.isFinite(tick.last) && tick.last > 0) {
      const nextPx = Number(tick.last.toFixed(2));
      const nextTodayPl =
        tick.ref && tick.ref > 0
          ? Math.round((tick.last - tick.ref) * qty * 1000)
          : Math.round(tick.delta * qty * 1000);
      if (Math.abs(nextPx - curPx) >= 1e-6 || nextTodayPl !== todayPl) {
        changed = true;
        curPx = nextPx;
        todayPl = nextTodayPl;
      }
    }

    const plVnd = Math.round((curPx - bp) * qty * 1000);
    const plPct = bp > 0 ? Number(((curPx / bp - 1) * 100).toFixed(2)) : 0;
    const rowVal = curPx * qty * 1000;
    totCost += bp * qty * 1000;
    totVal += rowVal;
    totTodayPl += todayPl;

    return {
      ...r,
      currentPrice: curPx,
      plVnd,
      plPct,
      todayPl,
      _rowVal: rowVal,
    };
  });

  if (!changed) return portEval;

  const navAll = totVal + cashVnd;
  const denom = navAll > 0 ? navAll : 1;
  const rows = updated.map(({ _rowVal, ...rest }: any) => ({
    ...rest,
    weightPct: Number(((_rowVal / denom) * 100).toFixed(2)),
  }));
  const totPl = totVal - totCost;

  return {
    ...portEval,
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

/**
 * Patches generic screener / sector stock table rows (`price`, `changePct`, `volume`)
 * cleanly in-place from WS ticks.
 */
export function patchStockRowsWithTicks<
  T extends { symbol: string; price?: number; changePct?: number; volume?: number }
>(rows: T[], ticks: Record<string, LiveTickDto>): T[] {
  if (!rows.length) return rows;
  let changed = false;

  const next = rows.map((r) => {
    const tick = ticks[r.symbol];
    if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) return r;
    const nextPrice = Number(tick.last.toFixed(2));
    const nextPct =
      typeof r.changePct === 'number' ? Number(tick.pct.toFixed(2)) : r.changePct;
    const nextVol =
      typeof r.volume === 'number' && tick.volume > 0 ? Math.round(tick.volume) : r.volume;

    if (
      (typeof r.price === 'number' && Math.abs(r.price - nextPrice) >= 1e-6) ||
      (typeof r.changePct === 'number' &&
        typeof nextPct === 'number' &&
        Math.abs(r.changePct - nextPct) >= 1e-6) ||
      (typeof r.volume === 'number' && typeof nextVol === 'number' && r.volume !== nextVol)
    ) {
      changed = true;
      return {
        ...r,
        ...(typeof r.price === 'number' ? { price: nextPrice } : {}),
        ...(typeof r.changePct === 'number' ? { changePct: nextPct } : {}),
        ...(typeof r.volume === 'number' ? { volume: nextVol } : {}),
      };
    }
    return r;
  });

  return changed ? next : rows;
}
