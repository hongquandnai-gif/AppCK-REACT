export interface LiveTickDto {
  symbol: string;
  last: number;
  open?: number;
  high?: number;
  low?: number;
  ref: number | null;
  delta: number;
  pct: number;
  volume: number;
  lastVol?: number;
  value_bil?: number;
  time: string;
  tradeDate?: string;
  exchange?: 'HOSE' | 'HNX' | 'UPCOM';
  liveSource?: 'SSI_WS' | 'BOARD';
}

export interface PatchOhlcOptions {
  isIntraday?: boolean;
  tfMinutes?: number;
  activeMas?: number[];
  showMaVol?: boolean;
  fallbackToDaily?: boolean;
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
 * Switches status metadata to `mode: 'live', source: 'SSI WS'` whenever live SSI WS ticks update tiles.
 */
export function patchTreemapWithTicks(
  tmResp: any,
  ticks: Record<string, LiveTickDto>,
  sizeMode: 'value' | 'volume'
): any {
  if (!tmResp || !Array.isArray(tmResp.rows) || !tmResp.rows.length) return tmResp;
  let changed = false;
  let hasSsiWsTick = false;
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

    if (tick.liveSource === 'SSI_WS') hasSsiWsTick = true;

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

  if (!changed) {
    if (hasSsiWsTick && tmResp.source !== 'SSI WS') {
      return {
        ...tmResp,
        mode: 'live',
        source: 'SSI WS',
        syncTime: latestTime,
      };
    }
    return tmResp;
  }

  return {
    ...tmResp,
    mode: hasSsiWsTick ? 'live' : tmResp.mode,
    source: hasSsiWsTick ? 'SSI WS' : tmResp.source,
    syncTime: latestTime,
    counts: { up, down, ref },
    rows: nextRows,
  };
}

function formatDdMmYyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDate;
}

function formatDdMmYy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : isoDate;
}

function bucketHm(hms: string, tfMinutes: number): string | null {
  const parts = String(hms || '').split(':');
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const step = Math.max(1, Math.round(tfMinutes));
  const totalMin = hh * 60 + mm;
  const floored = Math.floor(totalMin / step) * step;
  const fh = String(Math.floor(floored / 60)).padStart(2, '0');
  const fm = String(floored % 60).padStart(2, '0');
  return `${fh}:${fm}`;
}

function computeLastMas(
  bars: any[],
  activeMas?: number[],
  showMaVol?: boolean,
  existingMas?: Record<string, number | null>
): Record<string, number | null> | undefined {
  if (!existingMas && (!activeMas || !activeMas.length)) return existingMas;
  const out: Record<string, number | null> = { ...(existingMas || {}) };
  const keys = activeMas && activeMas.length
    ? activeMas
    : Object.keys(out)
        .filter((k) => /^MA\d+$/.test(k))
        .map((k) => Number(k.slice(2)))
        .filter((n) => Number.isFinite(n) && n > 1);

  for (const w of keys) {
    const slice = bars.slice(-w);
    if (slice.length > 0) {
      const avg = slice.reduce((acc, b) => acc + Number(b.close || 0), 0) / slice.length;
      out[`MA${w}`] = Number(avg.toFixed(4));
    }
  }
  if (showMaVol || (existingMas && 'MA20_Vol' in existingMas)) {
    const slice = bars.slice(-20);
    if (slice.length > 0) {
      const avgV = slice.reduce((acc, b) => acc + Number(b.volume || 0), 0) / slice.length;
      out.MA20_Vol = Math.round(avgV);
    }
  }
  return out;
}

/**
 * Patches EOD or Intraday OHLC candlestick bars in-place from a live WS tick:
 * - For EOD: appends a new daily bar if `tick.tradeDate > last.date`, or updates today's bar OHLCV & MAs in-place.
 * - For Intraday: updates the current timeframe bucket bar or appends a new bucket bar when `tick.time` advances.
 */
export function patchOhlcBarsWithTick(
  bars: any[],
  tick: LiveTickDto | undefined,
  isIntradayOrOpts: boolean | PatchOhlcOptions = false
): any[] {
  if (!bars.length || !tick || !Number.isFinite(tick.last) || tick.last <= 0) return bars;
  const opts: PatchOhlcOptions =
    typeof isIntradayOrOpts === 'boolean' ? { isIntraday: isIntradayOrOpts } : isIntradayOrOpts;
  const isIntraday = Boolean(opts.isIntraday && !opts.fallbackToDaily);

  const lastIdx = bars.length - 1;
  const last = bars[lastIdx];

  // --- INTRADAY MODE (1m / 5m / 15m / 30m / 60m) ---
  if (isIntraday) {
    const tfMin = opts.tfMinutes ?? 1;
    const tickHm = bucketHm(tick.time, tfMin);
    const tickDate = tick.tradeDate || last.date;

    // If chart is still showing an older session and a live tick for today arrives, append/switch bucket
    const isSameSession = !tickDate || !last.date || last.date === tickDate;
    const isNewBucket =
      tickHm !== null &&
      ((tickDate && last.date && tickDate > last.date) ||
        (isSameSession && typeof last.time === 'string' && tickHm > last.time));

    if (isNewBucket && tickHm) {
      const dStr = tickDate || last.date || '';
      const [y, m, d] = dStr.split('-');
      const prevClose = last.close;
      const pct =
        prevClose && prevClose > 0
          ? Number((((tick.last - prevClose) / prevClose) * 100).toFixed(2))
          : 0;
      const newBar = {
        date: dStr,
        time: tickHm,
        dtDisplay: dStr ? `${formatDdMmYyyy(dStr)} ${tickHm}` : tickHm,
        label: tickHm,
        open: tick.last,
        high: tick.last,
        low: tick.last,
        close: tick.last,
        volume: tick.lastVol && tick.lastVol > 0 ? tick.lastVol : 0,
        prevClose,
        pct,
        _cumVol: tick.volume > 0 ? tick.volume : undefined,
      };
      // If switching from yesterday's session to today's live session, keep label clear
      if (dStr && last.date && dStr > last.date && y && m && d) {
        newBar.label = `${d}/${m} ${tickHm}`;
      }
      return [...bars, newBar];
    }

    const nextClose = tick.last;
    const nextHigh = Math.max(last.high, nextClose);
    const nextLow = Math.min(last.low, nextClose);
    let nextVol = last.volume || 0;
    if (tick.volume > 0 && typeof last._cumVol === 'number' && tick.volume > last._cumVol) {
      nextVol = nextVol + (tick.volume - last._cumVol);
    } else if (tick.lastVol && tick.lastVol > 0 && Math.abs(last.close - nextClose) >= 1e-6) {
      nextVol = nextVol + tick.lastVol;
    }

    const nextPct =
      last.prevClose && last.prevClose > 0
        ? Number((((nextClose - last.prevClose) / last.prevClose) * 100).toFixed(2))
        : last.pct;

    if (
      Math.abs(last.close - nextClose) < 1e-6 &&
      Math.abs(last.high - nextHigh) < 1e-6 &&
      Math.abs(last.low - nextLow) < 1e-6 &&
      Math.abs((last.volume ?? 0) - nextVol) < 1e-6
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
      _cumVol: tick.volume > 0 ? tick.volume : last._cumVol,
    };
    return next;
  }

  // --- EOD / DAILY MODE ---
  const tickDate = tick.tradeDate;
  if (tickDate && typeof last.date === 'string' && tickDate > last.date) {
    // Append today's brand-new live daily candle from SSI WS!
    const open = tick.open && tick.open > 0 ? tick.open : tick.last;
    const high = Math.max(open, tick.high && tick.high > 0 ? tick.high : tick.last, tick.last);
    const low = Math.min(open, tick.low && tick.low > 0 ? tick.low : tick.last, tick.last);
    const prevClose = tick.ref && tick.ref > 0 ? tick.ref : last.close;
    const pct =
      prevClose && prevClose > 0
        ? Number((((tick.last - prevClose) / prevClose) * 100).toFixed(2))
        : tick.pct;
    const newBar: any = {
      date: tickDate,
      time: formatDdMmYyyy(tickDate),
      dtDisplay: formatDdMmYyyy(tickDate),
      label: formatDdMmYy(tickDate),
      open,
      high,
      low,
      close: tick.last,
      volume: tick.volume > 0 ? tick.volume : 0,
      prevClose,
      pct,
    };
    const appended = [...bars, newBar];
    if (last.mas || opts.activeMas?.length) {
      newBar.mas = computeLastMas(appended, opts.activeMas, opts.showMaVol, last.mas);
    }
    return appended;
  }

  const nextClose = tick.last;
  const nextOpen = last.open > 0 ? last.open : tick.open || nextClose;
  const nextHigh = Math.max(last.high, tick.high && tick.high > 0 ? tick.high : nextClose, nextClose);
  const nextLow = Math.min(last.low, tick.low && tick.low > 0 ? tick.low : nextClose, nextClose);
  const nextVol = tick.volume > 0 ? Math.max(last.volume || 0, tick.volume) : last.volume;
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
  const updatedLast: any = {
    ...last,
    open: nextOpen,
    high: nextHigh,
    low: nextLow,
    close: nextClose,
    volume: nextVol,
    pct: nextPct,
  };
  next[lastIdx] = updatedLast;
  if (last.mas || opts.activeMas?.length) {
    updatedLast.mas = computeLastMas(next, opts.activeMas, opts.showMaVol, last.mas);
  }
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

function maStatusLabel(px: number, mv: number | null | undefined): string {
  if (mv === null || mv === undefined || !Number.isFinite(mv)) return '—';
  const stt = Math.abs(px - mv) <= 0.001 * px ? 'CHẠM' : px > mv ? 'TRÊN' : 'DƯỚI';
  return `${stt} (${mv.toFixed(2)})`;
}

/**
 * Patches Sector MA Trend results in-place from real-time SSI WebSocket ticks for BOTH modes:
 * - `mode: 'all'`: updates underlying stock snapshots & recomputes every sector's `% Mạnh (>MA20)`,
 *   `% Yếu (<MA50)`, `Phân loại`, `Mã nổi bật`, and `Δ (%)` live without re-fetching!
 * - `mode: 'group'`: updates `price`, `changePct`, AND recomputes `TRÊN / DƯỚI / CHẠM` for MA10..MA200!
 */
export function patchSectorMaWithTicks(
  secMaRes: any,
  ticks: Record<string, LiveTickDto>
): any {
  if (!secMaRes || !Array.isArray(secMaRes.rows) || !secMaRes.rows.length) return secMaRes;

  if (secMaRes.mode === 'group') {
    let changed = false;
    let latestTime = secMaRes.syncTime;
    const nextRows = secMaRes.rows.map((r: any) => {
      const tick = ticks[r.symbol];
      if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) return r;
      const nextPrice = Number(tick.last.toFixed(2));
      const nextPct = Number(tick.pct.toFixed(2));
      if (Math.abs(r.price - nextPrice) < 1e-6 && Math.abs(r.changePct - nextPct) < 1e-6) {
        return r;
      }
      changed = true;
      if (tick.time) latestTime = tick.time;

      let nextMas = r.mas;
      if (r.maValues && typeof r.maValues === 'object') {
        nextMas = { ...r.mas };
        for (const [k, mv] of Object.entries(r.maValues as Record<string, number | null>)) {
          nextMas[k] = maStatusLabel(nextPrice, mv);
        }
      }
      return {
        ...r,
        price: nextPrice,
        changePct: nextPct,
        mas: nextMas,
      };
    });

    if (!changed) return secMaRes;
    return {
      ...secMaRes,
      syncTime: latestTime,
      liveUpdated: true,
      rows: nextRows,
    };
  }

  if (secMaRes.mode === 'all' && Array.isArray(secMaRes.stockSnapshots) && secMaRes.stockSnapshots.length) {
    let anyPriceChanged = false;
    let latestTime = secMaRes.syncTime;

    const nextSnapshots = secMaRes.stockSnapshots.map((s: any) => {
      const tick = ticks[s.symbol];
      if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) return s;
      const nextPrice = Number(tick.last.toFixed(2));
      if (Math.abs(s.price - nextPrice) < 1e-6) return s;
      anyPriceChanged = true;
      if (tick.time) latestTime = tick.time;
      return { ...s, price: nextPrice };
    });

    if (!anyPriceChanged) return secMaRes;

    const groups = new Map<
      string,
      { tot: number; a20: number; b50: number; bestD: number; hl: string }
    >();

    for (const s of nextSnapshots) {
      const ind = s.industry || 'Khác';
      const g = groups.get(ind) || { tot: 0, a20: 0, b50: 0, bestD: -1e9, hl: '' };
      g.tot += 1;
      const cNow = s.price;
      const m20 = s.ma20;
      const m50 = s.ma50;
      if (typeof m20 === 'number' && Number.isFinite(m20) && m20 > 0) {
        if (Math.abs(cNow - m20) > 0.001 * cNow && cNow > m20) g.a20 += 1;
        const dPct = ((cNow - m20) / m20) * 100;
        if (dPct > g.bestD) {
          g.bestD = dPct;
          g.hl = s.symbol;
        }
      }
      if (typeof m50 === 'number' && Number.isFinite(m50) && m50 > 0) {
        if (Math.abs(cNow - m50) > 0.001 * cNow && cNow < m50) g.b50 += 1;
      }
      groups.set(ind, g);
    }

    const nextRows = [...groups.entries()].map(([ind, g]) => {
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

    nextRows.sort((a, b) => b.pctStrong - a.pctStrong || a.pctWeak - b.pctWeak);

    return {
      ...secMaRes,
      syncTime: latestTime,
      liveUpdated: true,
      stockSnapshots: nextSnapshots,
      rows: nextRows,
    };
  }

  return secMaRes;
}
