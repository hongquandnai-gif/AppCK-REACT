import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { ALL_MAIN_INDICES, MA_WINDOWS } from './src/shared/constants.ts';
import {
  addDaysToDateStr,
  buildIndustryMapFromCatalog,
  clearAllCaches,
  fetchBatchOhlcvSsi,
  fetchExchangeBoardWithFallback,
  fetchFullStockCatalog,
  fetchIndexMarketStats,
  fetchSsiOhlcvWithMetaCached,
  getSsiWsManager,
  isSsiRestBlocked,
  isVnMarketHours,
  selectCatalogSymbols,
  vnNowParts,
  vnTodayStr,
  type IndexSessionStat,
  type LiveTick,
  type OhlcvBar,
} from './server/ssiClient.ts';
import {
  computeDistributionDaysCore,
  evaluateMarketFtdStep,
  formatDdMm,
  formatDdMmYyyy,
  getTargetExposureFromRisk,
  rollingMean,
  runHybridBacktest,
  runMinerviniScreener,
  type BacktestParams,
  type FtdState,
} from './server/quantEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

const wsMgr = getSsiWsManager();

// Helpers matching main.py
function filterVnTradingHours(bars: OhlcvBar[]): OhlcvBar[] {
  if (!bars.length) return bars;
  const filtered = bars.filter((b) => {
    const [hh, mm] = b.time.split(':').map(Number);
    const hhmm = hh * 100 + mm;
    return (hhmm >= 900 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1505);
  });
  return filtered.length ? filtered : bars;
}

function patchLiveCandle(bars: OhlcvBar[], tick: LiveTick | undefined, isIntraday = false): OhlcvBar[] {
  if (!bars.length || !tick || !tick.last) return bars;
  const out = bars.map((b) => ({ ...b }));
  const last = out[out.length - 1];
  last.close = tick.last;
  last.high = Math.max(last.high, tick.last);
  last.low = Math.min(last.low, tick.last);
  if (!isIntraday && tick.volume > 0) {
    last.volume = Math.max(last.volume, tick.volume);
  }
  return out;
}

function mergeLiveIntradaySeries(
  hist1m: OhlcvBar[],
  wsBars: OhlcvBar[],
  targetDate: string
): OhlcvBar[] {
  if (targetDate !== vnTodayStr() || !wsBars.length) return hist1m;
  const wsToday = wsBars.filter((b) => b.date === targetDate);
  if (!wsToday.length) return hist1m;
  if (!hist1m.length) return wsToday;

  const map = new Map<string, OhlcvBar>();
  for (const b of hist1m) map.set(b.datetime, { ...b });
  const lastHistDt = hist1m[hist1m.length - 1].datetime;

  for (const row of wsToday) {
    const ex = map.get(row.datetime);
    if (ex) {
      ex.high = Math.max(ex.high, row.high);
      ex.low = Math.min(ex.low, row.low);
      ex.close = row.close;
      if (row.volume > 0) ex.volume = row.volume;
    } else if (row.datetime > lastHistDt) {
      map.set(row.datetime, { ...row });
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function makeTradingLabel(bar: OhlcvBar, isIntraday: boolean, multiDayIntraday: boolean): string {
  const [y, m, d] = bar.date.split('-');
  if (isIntraday) {
    return multiDayIntraday ? `${d}/${m} ${bar.time}` : bar.time;
  }
  return `${d}/${m}/${y.slice(2)}`;
}

function resampleBars(bars: OhlcvBar[], tf: 'D' | 'W' | 'M'): OhlcvBar[] {
  if (tf === 'D' || !bars.length) return bars;
  const buckets = new Map<string, OhlcvBar>();

  for (const b of bars) {
    let key = b.date;
    if (tf === 'W') {
      const [y, m, d] = b.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const day = dt.getUTCDay(); // 0..6
      const diffToFri = (5 - day + 7) % 7;
      dt.setUTCDate(dt.getUTCDate() + diffToFri);
      key = dt.toISOString().slice(0, 10);
    } else if (tf === 'M') {
      key = b.date.slice(0, 7);
    }

    const ex = buckets.get(key);
    if (!ex) {
      buckets.set(key, { ...b });
    } else {
      ex.high = Math.max(ex.high, b.high);
      ex.low = Math.min(ex.low, b.low);
      ex.close = b.close;
      ex.volume += b.volume;
      ex.t = b.t;
      ex.date = b.date;
      ex.datetime = b.datetime;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

async function resolveLiquidUniverse(
  syms: string[],
  exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL',
  refDate: string,
  maxCap = 260
): Promise<string[]> {
  if (syms.length <= maxCap) return syms;
  const boardsToFetch: ('HOSE' | 'HNX' | 'UPCOM')[] =
    exchange === 'ALL' ? ['HOSE', 'HNX', 'UPCOM'] : [exchange];
  const boards = await Promise.all(
    boardsToFetch.map((ex) => fetchExchangeBoardWithFallback(ex, refDate, false))
  );
  const valBySym = new Map<string, number>();
  for (const br of boards) {
    for (const [s, t] of Object.entries(br.board)) {
      if (t.volume > 0) valBySym.set(s, t.value_bil || (t.last * t.volume) / 1e6);
    }
  }
  const ranked = syms
    .filter((s) => (valBySym.get(s) ?? 0) > 0)
    .sort((a, b) => (valBySym.get(b) ?? 0) - (valBySym.get(a) ?? 0))
    .slice(0, maxCap);
  return ranked.length ? ranked : syms.slice(0, maxCap);
}

async function buildStatusPayload() {
  const catalog = await fetchFullStockCatalog();
  const parts = vnNowParts();
  return {
    connected: true,
    upstreamSsiConnected: wsMgr.isConnected,
    hoseCount: catalog.counts.HOSE,
    hnxCount: catalog.counts.HNX,
    upcomCount: catalog.counts.UPCOM,
    totalCount: catalog.counts.total,
    dataSource: isSsiRestBlocked() ? 'VNDirect' : catalog.source,
    classificationStandard: catalog.classificationStandard,
    ssiRestBlocked: isSsiRestBlocked(),
    vnClock: parts.clock,
    today: parts.dateStr,
    lastUpdate: wsMgr.lastUpdate || parts.hms,
  };
}

// ==============================================================================
// API ROUTES
// ==============================================================================

app.get('/api/status', async (_req, res) => {
  try {
    res.json(await buildStatusPayload());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Status error' });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1';
    const catalog = await fetchFullStockCatalog(refresh);
    res.json({
      list: catalog.list,
      counts: catalog.counts,
      industries: catalog.industries,
      source: catalog.source,
      classificationStandard: catalog.classificationStandard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Stocks catalog error' });
  }
});

app.post('/api/cache/clear', (_req, res) => {
  clearAllCaches();
  res.json({ ok: true });
});

// 1.1 LIVE INDICES
app.get('/api/indices-live', async (req, res) => {
  try {
    const today = vnTodayStr();
    const idxDate = String(req.query.date || today);
    const rawIndices = String(req.query.indices || ALL_MAIN_INDICES.join(','));
    const selectedIndices = rawIndices
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const refresh = req.query.refresh === '1';

    if (!selectedIndices.length) {
      return res.json({ indices: [] });
    }

    wsMgr.subscribe(selectedIndices);
    if (refresh) {
      clearAllCaches();
      await wsMgr.refreshIndicesNow(selectedIndices);
    } else if (idxDate === today) {
      await wsMgr.ensureIndicesLoaded(selectedIndices);
    }

    const [liveTicks, indexStatsMap] = await Promise.all([
      Promise.resolve(wsMgr.getSnapshot(selectedIndices)),
      fetchIndexMarketStats(idxDate, refresh),
    ]);

    const results = await Promise.all(
      selectedIndices.map(async (sym) => {
        let bars1m: OhlcvBar[] = [];
        let barsD: OhlcvBar[] = [];
        let source: 'SSI' | 'VNDirect' = 'VNDirect';

        if (idxDate === today) {
          const cached = wsMgr.getIndexData(sym);
          bars1m = cached.bars1m;
          barsD = cached.barsD;
          source = cached.source;
        } else {
          const [res1m, resD] = await Promise.all([
            fetchSsiOhlcvWithMetaCached(sym, addDaysToDateStr(idxDate, -6), idxDate, '1', refresh),
            fetchSsiOhlcvWithMetaCached(sym, addDaysToDateStr(idxDate, -25), idxDate, 'D', refresh),
          ]);
          bars1m = res1m.bars;
          barsD = resD.bars;
          source = bars1m.length ? res1m.source : resD.source;
        }

        let lastPx = 0;
        let delta = 0;
        let pct = 0;
        let vol = 0;
        let resolvedDate = idxDate;
        let tradeDateStr = formatDdMm(idxDate);
        let prevClose: number | null = null;
        let plotSeries: OhlcvBar[] = [];
        let isIntradayMode = true;

        const mCut = bars1m.filter((b) => b.date <= idxDate);
        if (mCut.length) {
          const actualDate = mCut[mCut.length - 1].date;
          resolvedDate = actualDate;
          tradeDateStr = formatDdMm(actualDate);
          let day1m = mCut.filter((b) => b.date === actualDate);
          if (actualDate === today) {
            day1m = mergeLiveIntradaySeries(day1m, wsMgr.getMinuteBars(sym), today);
          }
          plotSeries = filterVnTradingHours(day1m);
          const prevDays = barsD.filter((b) => b.date < actualDate);
          if (prevDays.length) prevClose = prevDays[prevDays.length - 1].close;
        }

        if (!plotSeries.length && barsD.length) {
          const dCut = barsD.filter((b) => b.date <= idxDate);
          if (dCut.length) {
            isIntradayMode = false;
            plotSeries = dCut.slice(-30);
            resolvedDate = dCut[dCut.length - 1].date;
            tradeDateStr = formatDdMm(resolvedDate);
            if (dCut.length >= 2) prevClose = dCut[dCut.length - 2].close;
          }
        }

        if (plotSeries.length) {
          if (idxDate === today && isVnMarketHours() && liveTicks[sym]) {
            plotSeries = patchLiveCandle(plotSeries, liveTicks[sym], isIntradayMode);
          }
          lastPx = plotSeries[plotSeries.length - 1].close;
          vol = isIntradayMode
            ? plotSeries.reduce((s, b) => s + b.volume, 0)
            : plotSeries[plotSeries.length - 1].volume;
          if (idxDate === today && isVnMarketHours() && liveTicks[sym]?.volume) {
            vol = liveTicks[sym].volume;
          }
          if (prevClose && prevClose > 0) {
            delta = lastPx - prevClose;
            pct = (delta / prevClose) * 100;
          }
        }

        const statList = indexStatsMap[sym] || [];
        const curStat: IndexSessionStat | undefined =
          statList.find((s) => s.date === resolvedDate) || statList[0];
        const prevStat: IndexSessionStat | undefined = curStat
          ? statList.find((s) => s.date < curStat.date)
          : statList[1];

        let totalValBil = curStat?.totalValBil ?? 0;
        const nmValBil = curStat?.nmValBil ?? 0;
        const ptValBil = curStat?.ptValBil ?? 0;
        let totalVolMil = curStat?.totalVolMil ?? Number((vol / 1e6).toFixed(2));
        const nmVolMil = curStat?.nmVolMil ?? Number((vol / 1e6).toFixed(2));

        if (idxDate === today && isVnMarketHours() && liveTicks[sym]?.value_bil) {
          totalValBil = Number(liveTicks[sym].value_bil!.toFixed(2));
        }
        if (idxDate === today && isVnMarketHours() && liveTicks[sym]?.volume) {
          totalVolMil = Number((liveTicks[sym].volume / 1e6).toFixed(2));
        }

        const prevTotalValBil = prevStat?.totalValBil ?? 0;
        const valDeltaPct =
          prevTotalValBil > 0
            ? Number((((totalValBil - prevTotalValBil) / prevTotalValBil) * 100).toFixed(2))
            : null;

        const uniqueDates = new Set(plotSeries.map((b) => b.date)).size;
        const points = plotSeries.map((b) => {
          const x = makeTradingLabel(b, isIntradayMode, uniqueDates > 1);
          const tFmt = isIntradayMode ? `${formatDdMm(b.date)} ${b.time}` : formatDdMmYyyy(b.date);
          let hover = `<b>${sym}</b> • ${tFmt}<br>Điểm: <b>${b.close.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}</b>`;
          if (prevClose && prevClose > 0) {
            const dPt = b.close - prevClose;
            const pPt = (dPt / prevClose) * 100;
            hover += ` (${dPt >= 0 ? '+' : ''}${dPt.toFixed(2)} | ${pPt >= 0 ? '+' : ''}${pPt.toFixed(2)}%)`;
          }
          return { x, close: b.close, hover };
        });

        return {
          symbol: sym,
          tradeDateStr,
          resolvedDate,
          source,
          lastPx,
          delta,
          pct,
          vol,
          totalValBil,
          nmValBil,
          ptValBil,
          totalVolMil,
          nmVolMil,
          prevTotalValBil,
          valDeltaPct,
          breadth: curStat
            ? {
                advances: curStat.advances,
                declines: curStat.declines,
                noChange: curStat.noChange,
                ceilingStocks: curStat.ceilingStocks,
                floorStocks: curStat.floorStocks,
              }
            : null,
          prevClose,
          isIntradayMode,
          points,
        };
      })
    );

    // Aggregate 3-exchange market trading value & volume (HOSE + HNX + UPCOM)
    let mktTotalValBil = 0;
    let mktNmValBil = 0;
    let mktPtValBil = 0;
    let mktTotalVolMil = 0;
    let mktPrevTotalValBil = 0;
    let mktDate = idxDate;
    for (const exIdx of ['VNINDEX', 'HNX', 'UPCOM']) {
      const list = indexStatsMap[exIdx];
      if (list?.[0]) {
        mktTotalValBil += list[0].totalValBil;
        mktNmValBil += list[0].nmValBil;
        mktPtValBil += list[0].ptValBil;
        mktTotalVolMil += list[0].totalVolMil;
        if (exIdx === 'VNINDEX') mktDate = list[0].date;
      }
      if (list?.[1]) {
        mktPrevTotalValBil += list[1].totalValBil;
      }
    }
    const marketTotal =
      mktTotalValBil > 0
        ? {
            dateDisplay: formatDdMmYyyy(mktDate),
            totalValBil: Number(mktTotalValBil.toFixed(2)),
            nmValBil: Number(mktNmValBil.toFixed(2)),
            ptValBil: Number(mktPtValBil.toFixed(2)),
            totalVolMil: Number(mktTotalVolMil.toFixed(2)),
            prevTotalValBil: Number(mktPrevTotalValBil.toFixed(2)),
            valDeltaPct:
              mktPrevTotalValBil > 0
                ? Number(
                    (((mktTotalValBil - mktPrevTotalValBil) / mktPrevTotalValBil) * 100).toFixed(2)
                  )
                : null,
          }
        : null;

    const sources = [...new Set(results.map((r) => r.source))];
    res.json({
      indices: results,
      marketTotal,
      dataSource: sources.join(' / ') || 'VNDirect',
      syncTime: wsMgr.lastUpdate || vnNowParts().hms,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Indices live error' });
  }
});

// Helper: Canonical VN intraday timeline slots (09:00..11:30 & 13:00..15:00 -> 272 minute slots)
const VN_INTRADAY_SLOTS: string[] = [];
for (let m = 9 * 60; m <= 11 * 60 + 30; m++) {
  VN_INTRADAY_SLOTS.push(
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  );
}
for (let m = 13 * 60; m <= 15 * 60; m++) {
  VN_INTRADAY_SLOTS.push(
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  );
}

function timeToVnSlotIndex(hm: string): number {
  const [hh, mm] = hm.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  const totalMin = hh * 60 + mm;
  if (totalMin <= 9 * 60) return 0;
  if (totalMin <= 11 * 60 + 30) return totalMin - 9 * 60;
  if (totalMin < 13 * 60) return 150; // fold 11:31..12:59 into 11:30
  if (totalMin <= 15 * 60) return 151 + (totalMin - 13 * 60);
  return 271; // fold ATC prints 15:01..15:10 into 15:00
}

// 1.1B INTRADAY LIQUIDITY COMPARISON (FIREANT STYLE: TODAY VS YESTERDAY & 5-SESSION AVG)
app.get('/api/intraday-liquidity', async (req, res) => {
  try {
    const today = vnTodayStr();
    const targetDate = String(req.query.date || today);
    const rawSym = String(req.query.symbol || 'VNINDEX').toUpperCase().trim();
    const refresh = req.query.refresh === '1';
    if (refresh) clearAllCaches();

    const isAll3 = rawSym === 'ALL3';
    const componentSyms = isAll3 ? ['VNINDEX', 'HNX', 'UPCOM'] : [rawSym];

    const lookbackStart = addDaysToDateStr(targetDate, -14);
    const [indexStatsMap, barResults] = await Promise.all([
      fetchIndexMarketStats(targetDate, refresh),
      Promise.all(
        componentSyms.map((s) => fetchSsiOhlcvWithMetaCached(s, lookbackStart, targetDate, '1', refresh))
      ),
    ]);

    const source = barResults[0]?.source || 'VNDirect';

    // Group 1m bars per symbol by date <= targetDate
    const perSymByDate = new Map<string, Map<string, OhlcvBar[]>>();
    const allDatesSet = new Set<string>();

    componentSyms.forEach((sym, i) => {
      const m = new Map<string, OhlcvBar[]>();
      let bars = (barResults[i]?.bars || []).filter((b) => b.date <= targetDate);
      if (targetDate === today) {
        const wsBars = wsMgr.getMinuteBars(sym);
        if (wsBars.length) {
          const todayBars = bars.filter((b) => b.date === today);
          const merged = mergeLiveIntradaySeries(todayBars, wsBars, today);
          bars = [...bars.filter((b) => b.date !== today), ...merged];
        }
      }
      for (const b of bars) {
        let arr = m.get(b.date);
        if (!arr) {
          arr = [];
          m.set(b.date, arr);
        }
        arr.push(b);
        allDatesSet.add(b.date);
      }
      perSymByDate.set(sym, m);
    });

    const sortedDates = [...allDatesSet].sort((a, b) => b.localeCompare(a));
    if (!sortedDates.length) {
      return res.json({
        symbol: rawSym,
        empty: true,
        source,
      });
    }

    const curDate = sortedDates[0];
    const prevDate = sortedDates[1] || null;
    const avgDates = sortedDates.slice(1, 6); // up to 5 previous sessions

    // Build per-date cumulative slot arrays (Volume in Million shares, Value in Billion VND)
    const buildDayCumulative = (dateStr: string) => {
      const slotVol = new Float64Array(VN_INTRADAY_SLOTS.length);
      const slotVal = new Float64Array(VN_INTRADAY_SLOTS.length);
      let maxSlotSeen = -1;

      for (const sym of componentSyms) {
        const dayBars = perSymByDate.get(sym)?.get(dateStr) || [];
        if (!dayBars.length) continue;

        const symSlotVol = new Float64Array(VN_INTRADAY_SLOTS.length);
        let symTotalShares = 0;
        for (const b of dayBars) {
          const idx = timeToVnSlotIndex(b.time);
          if (idx > maxSlotSeen) maxSlotSeen = idx;
          symSlotVol[idx] += b.volume;
          symTotalShares += b.volume;
        }

        // Calibrate matched value (Tỷ VNĐ) using official vnmarket_prices nmValue / nmVolume
        const statList = indexStatsMap[sym] || [];
        const dayStat = statList.find((s) => s.date === dateStr) || statList[0];
        let bilPerMilShares = 20.0; // reasonable VN fallback (~20k VND/share)
        if (dayStat && dayStat.nmValBil > 0) {
          const denomMil =
            dayStat.date === dateStr && symTotalShares > 0
              ? symTotalShares / 1e6
              : dayStat.nmVolMil > 0
              ? dayStat.nmVolMil
              : symTotalShares / 1e6;
          if (denomMil > 0) {
            bilPerMilShares = dayStat.nmValBil / denomMil;
          }
        }

        for (let i = 0; i < VN_INTRADAY_SLOTS.length; i++) {
          const volMil = symSlotVol[i] / 1e6;
          slotVol[i] += volMil;
          slotVal[i] += volMil * bilPerMilShares;
        }
      }

      const cumVol: number[] = new Array(VN_INTRADAY_SLOTS.length);
      const cumVal: number[] = new Array(VN_INTRADAY_SLOTS.length);
      let runVol = 0;
      let runVal = 0;
      for (let i = 0; i < VN_INTRADAY_SLOTS.length; i++) {
        runVol += slotVol[i];
        runVal += slotVal[i];
        cumVol[i] = Number(runVol.toFixed(3));
        cumVal[i] = Number(runVal.toFixed(2));
      }
      return { cumVol, cumVal, maxSlotSeen };
    };

    const curDay = buildDayCumulative(curDate);
    const prevDay = prevDate ? buildDayCumulative(prevDate) : null;
    const avgDaysBuilt = avgDates.map((d) => buildDayCumulative(d));

    const isLiveNow = curDate === today && isVnMarketHours();
    const nowSlotIdx = isLiveNow ? timeToVnSlotIndex(vnNowParts().hm) : VN_INTRADAY_SLOTS.length - 1;
    const cutoffIdx = isLiveNow
      ? Math.max(curDay.maxSlotSeen, Math.min(nowSlotIdx, VN_INTRADAY_SLOTS.length - 1))
      : VN_INTRADAY_SLOTS.length - 1;

    const curVolSeries: (number | null)[] = VN_INTRADAY_SLOTS.map((_, i) =>
      i <= cutoffIdx ? curDay.cumVol[i] : null
    );
    const curValSeries: (number | null)[] = VN_INTRADAY_SLOTS.map((_, i) =>
      i <= cutoffIdx ? curDay.cumVal[i] : null
    );
    const prevVolSeries: (number | null)[] = prevDay
      ? prevDay.cumVol
      : VN_INTRADAY_SLOTS.map(() => null);
    const prevValSeries: (number | null)[] = prevDay
      ? prevDay.cumVal
      : VN_INTRADAY_SLOTS.map(() => null);

    const avg5VolSeries: (number | null)[] = VN_INTRADAY_SLOTS.map((_, i) => {
      if (!avgDaysBuilt.length) return null;
      const sum = avgDaysBuilt.reduce((acc, d) => acc + d.cumVol[i], 0);
      return Number((sum / avgDaysBuilt.length).toFixed(3));
    });
    const avg5ValSeries: (number | null)[] = VN_INTRADAY_SLOTS.map((_, i) => {
      if (!avgDaysBuilt.length) return null;
      const sum = avgDaysBuilt.reduce((acc, d) => acc + d.cumVal[i], 0);
      return Number((sum / avgDaysBuilt.length).toFixed(2));
    });

    // Aggregate official session stats (including put-through) for summary card
    let officialTotalValBil = 0;
    let officialNmValBil = 0;
    let officialPtValBil = 0;
    let officialTotalVolMil = 0;
    let officialPrevTotalValBil = 0;
    for (const sym of componentSyms) {
      const list = indexStatsMap[sym] || [];
      const curSt = list.find((s) => s.date === curDate) || list[0];
      const prevSt = prevDate ? list.find((s) => s.date === prevDate) || list[1] : list[1];
      if (curSt) {
        officialTotalValBil += curSt.totalValBil;
        officialNmValBil += curSt.nmValBil;
        officialPtValBil += curSt.ptValBil;
        officialTotalVolMil += curSt.totalVolMil;
      }
      if (prevSt) {
        officialPrevTotalValBil += prevSt.totalValBil;
      }
    }

    const curVolAtCut = curVolSeries[cutoffIdx] ?? 0;
    const prevVolAtCut = prevVolSeries[cutoffIdx] ?? 0;
    const avg5VolAtCut = avg5VolSeries[cutoffIdx] ?? 0;
    const curValAtCut = curValSeries[cutoffIdx] ?? 0;
    const prevValAtCut = prevValSeries[cutoffIdx] ?? 0;
    const avg5ValAtCut = avg5ValSeries[cutoffIdx] ?? 0;

    const milestoneTimes = ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '14:30', '15:00'];
    const milestones = milestoneTimes.map((t) => {
      const idx = timeToVnSlotIndex(t);
      const cv = curVolSeries[idx];
      const pv = prevVolSeries[idx];
      const cVal = curValSeries[idx];
      const pVal = prevValSeries[idx];
      return {
        time: t,
        curVol: cv,
        prevVol: pv,
        volDiffPct:
          cv !== null && pv !== null && pv > 0 ? Number((((cv - pv) / pv) * 100).toFixed(2)) : null,
        curVal: cVal,
        prevVal: pVal,
        valDiffPct:
          cVal !== null && pVal !== null && pVal > 0
            ? Number((((cVal - pVal) / pVal) * 100).toFixed(2))
            : null,
      };
    });

    res.json({
      symbol: rawSym,
      empty: false,
      source,
      isLiveNow,
      cutoffTime: VN_INTRADAY_SLOTS[cutoffIdx],
      curDate,
      curDateDisplay: formatDdMmYyyy(curDate),
      curDateShort: formatDdMm(curDate),
      prevDate,
      prevDateDisplay: prevDate ? formatDdMmYyyy(prevDate) : null,
      prevDateShort: prevDate ? formatDdMm(prevDate) : null,
      avgSessionsCount: avgDaysBuilt.length,
      times: VN_INTRADAY_SLOTS,
      series: {
        curVol: curVolSeries,
        prevVol: prevVolSeries,
        avg5Vol: avg5VolSeries,
        curVal: curValSeries,
        prevVal: prevValSeries,
        avg5Val: avg5ValSeries,
      },
      summary: {
        curVolMil: Number(curVolAtCut.toFixed(2)),
        prevVolMil: Number(prevVolAtCut.toFixed(2)),
        volDiffMil: Number((curVolAtCut - prevVolAtCut).toFixed(2)),
        volDiffPct:
          prevVolAtCut > 0
            ? Number((((curVolAtCut - prevVolAtCut) / prevVolAtCut) * 100).toFixed(2))
            : null,
        avg5VolMil: Number(avg5VolAtCut.toFixed(2)),
        volVsAvg5Pct:
          avg5VolAtCut > 0
            ? Number((((curVolAtCut - avg5VolAtCut) / avg5VolAtCut) * 100).toFixed(2))
            : null,
        curValBil: Number(curValAtCut.toFixed(2)),
        prevValBil: Number(prevValAtCut.toFixed(2)),
        valDiffBil: Number((curValAtCut - prevValAtCut).toFixed(2)),
        valDiffPct:
          prevValAtCut > 0
            ? Number((((curValAtCut - prevValAtCut) / prevValAtCut) * 100).toFixed(2))
            : null,
        avg5ValBil: Number(avg5ValAtCut.toFixed(2)),
        valVsAvg5Pct:
          avg5ValAtCut > 0
            ? Number((((curValAtCut - avg5ValAtCut) / avg5ValAtCut) * 100).toFixed(2))
            : null,
        officialTotalValBil: Number(officialTotalValBil.toFixed(2)),
        officialNmValBil: Number(officialNmValBil.toFixed(2)),
        officialPtValBil: Number(officialPtValBil.toFixed(2)),
        officialTotalVolMil: Number(officialTotalVolMil.toFixed(2)),
        officialPrevTotalValBil: Number(officialPrevTotalValBil.toFixed(2)),
      },
      milestones,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Intraday liquidity error' });
  }
});

// 1.2 TREEMAP (Supports HOSE, HNX, UPCOM with automatic EOD fallback)
app.get('/api/treemap', async (req, res) => {
  try {
    const today = vnTodayStr();
    const tmDate = String(req.query.date || today);
    const sizeMode = String(req.query.sizeMode || 'value'); // 'value' | 'volume'
    const rawExchange = String(req.query.exchange || 'HOSE').toUpperCase().trim();
    const exchange: 'HOSE' | 'HNX' | 'UPCOM' =
      rawExchange === 'HNX' || rawExchange === 'UPCOM' ? rawExchange : 'HOSE';
    const refresh = req.query.refresh === '1';

    const [catalog, boardRes] = await Promise.all([
      fetchFullStockCatalog(),
      fetchExchangeBoardWithFallback(exchange, tmDate, refresh),
    ]);

    const wsSnap = tmDate === today && isVnMarketHours() ? wsMgr.getSnapshot() : {};
    const rows: {
      symbol: string;
      companyName: string;
      industry: string;
      sizeVal: number;
      pct: number;
      price: number;
    }[] = [];
    let cntUp = 0;
    let cntDown = 0;
    let cntRef = 0;

    for (const [sym, baseItem] of Object.entries(boardRes.board)) {
      const wsTick = wsSnap[sym];
      const lastPx = wsTick?.last || baseItem.last || 0;
      const vol = wsTick?.volume && wsTick.volume > 0 ? wsTick.volume : baseItem.volume || 0;
      const pct = wsTick ? wsTick.pct : baseItem.pct || 0;
      if (lastPx <= 0 || vol <= 0) continue;

      if (pct > 0) cntUp++;
      else if (pct < 0) cntDown++;
      else cntRef++;

      const meta = catalog.stocks[sym];
      const ind = meta?.industry || 'Khác';

      const valBil =
        baseItem.value_bil && baseItem.value_bil > 0 && !wsTick
          ? baseItem.value_bil
          : (lastPx * vol) / 1e6;
      const sizeVal =
        sizeMode === 'value' ? Number(valBil.toFixed(2)) : Math.round(vol);

      if (sizeVal > 0) {
        rows.push({
          symbol: sym,
          companyName: meta?.companyName || sym,
          industry: ind,
          sizeVal,
          pct: Number(pct.toFixed(2)),
          price: Number(lastPx.toFixed(2)),
        });
      }
    }

    res.json({
      exchange,
      mode: boardRes.mode,
      source: boardRes.source,
      tradeDate: boardRes.tradeDate,
      tradeDateDisplay: formatDdMmYyyy(boardRes.tradeDate),
      syncTime: boardRes.syncTime,
      counts: { up: cntUp, down: cntDown, ref: cntRef },
      totalSymbols: rows.length,
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Treemap error' });
  }
});

// 1.3 MARKET HEALTH & DISTRIBUTION DAYS
app.post('/api/market-health', async (req, res) => {
  try {
    const maDate = String(req.body?.date || vnTodayStr());
    const ddWin = Number(req.body?.ddWin ?? 25);
    const cancelReb = Number(req.body?.cancelReb ?? 6.0);
    const ma20Lag = Number(req.body?.ma20Lag ?? 1);

    const idxMap = await fetchBatchOhlcvSsi(
      ['VNINDEX', 'VN30', 'HNX', 'UPCOM'],
      addDaysToDateStr(maDate, -365),
      maDate,
      'D',
      4
    );

    const summaries = [];
    for (const idxName of ['VNINDEX', 'VN30', 'HNX', 'UPCOM']) {
      const bars = idxMap[idxName];
      if (bars && bars.length) {
        const resDd = computeDistributionDaysCore(bars, {
          window: ddWin,
          cancelReboundPct: cancelReb,
        });
        const ddDates = resDd.details
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

    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange: 'HOSE',
      industry: 'Tất cả ngành',
      excludePenny: true,
    });
    const syms = await resolveLiquidUniverse(rawSyms, 'HOSE', maDate, 260);
    const secDfs = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(maDate, -180), maDate, 'D');

    const secGroups = new Map<string, { tot: number; a20: number; b50: number; prevSum: number; prevCnt: number }>();
    const lag = Math.max(1, Math.round(ma20Lag));

    for (const [s, bars] of Object.entries(secDfs)) {
      if (bars.length < 60 + lag) continue;
      const ind = industryMap[s] || 'Khác';
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
          warning: pctPrev - pctNow >= 25 ? '⚠️ Suy yếu' : '—',
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

    res.json({ summaries, leaders, weak });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Market health error' });
  }
});

// 2.1 SECTOR MA TREND
app.post('/api/sector-ma', async (req, res) => {
  try {
    const industry = String(req.body?.industry || 'Tất cả ngành');
    const asOfDate = String(req.body?.date || vnTodayStr());
    const rawEx = String(req.body?.exchange || 'HOSE').toUpperCase().trim();
    const exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' =
      rawEx === 'HNX' || rawEx === 'UPCOM' || rawEx === 'ALL' ? rawEx : 'HOSE';
    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange,
      industry,
      excludePenny: industry === 'Tất cả ngành',
    });
    const syms = await resolveLiquidUniverse(rawSyms, exchange, asOfDate, 260);
    const dfs = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(asOfDate, -450), asOfDate, 'D');

    const maStt = (px: number, mv: number | null) => {
      if (mv === null || !Number.isFinite(mv)) return '—';
      return Math.abs(px - mv) <= 0.001 * px ? 'CHẠM' : px > mv ? 'TRÊN' : 'DƯỚI';
    };

    if (industry === 'Tất cả ngành') {
      const groups = new Map<string, { tot: number; a20: number; b50: number; bestD: number; hl: string }>();
      for (const [s, bars] of Object.entries(dfs)) {
        if (bars.length < 50) continue;
        const ind = industryMap[s] || 'Khác';
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
      return res.json({ mode: 'all', rows });
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
    res.json({
      mode: 'group',
      rows: rows.map(({ _score, ...rest }) => rest),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sector MA error' });
  }
});

// 2.2 MONEY FLOW
app.post('/api/money-flow', async (req, res) => {
  try {
    const mfDate = String(req.body?.date || vnTodayStr());
    const mfDays = Math.max(3, Math.min(60, Number(req.body?.days ?? 10)));
    const rawEx = String(req.body?.exchange || 'HOSE').toUpperCase().trim();
    const exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' =
      rawEx === 'HNX' || rawEx === 'UPCOM' || rawEx === 'ALL' ? rawEx : 'HOSE';
    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange,
      industry: 'Tất cả ngành',
      excludePenny: false,
    });
    const syms = await resolveLiquidUniverse(rawSyms, exchange, mfDate, 260);
    const dfs = await fetchBatchOhlcvSsi(
      syms,
      addDaysToDateStr(mfDate, -(mfDays * 2 + 15)),
      mfDate,
      'D'
    );

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
      const ind = industryMap[sym] || 'Khác';

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

    res.json({ rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Money flow error' });
  }
});

// 3.1 RADAR EOD
app.post('/api/radar-eod', async (req, res) => {
  try {
    const maFast = Number(req.body?.maFast ?? 20);
    const maMid = Number(req.body?.maMid ?? 50);
    const minVol = Number(req.body?.minVol ?? 100_000);
    const useFtd = Boolean(req.body?.useFtd ?? true);
    const ftdMode = Number(req.body?.ftdMode ?? 0);

    const today = vnTodayStr();
    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange: 'HOSE',
      industry: 'Tất cả ngành',
      excludePenny: true,
    });
    const liquidSyms = await resolveLiquidUniverse(rawSyms, 'HOSE', today, 260);
    const syms = [...liquidSyms, 'VNINDEX'];
    const dfs = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(today, -350), today, 'D');

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
    for (const sym of liquidSyms) {
      const meta = catalog.stocks[sym];
      const sec = meta?.industry || 'Khác';
      if (!['Chỉ số', 'Penny', 'Khác'].includes(sec) && !meta?.isPenny && dfs[sym]) {
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
          industry: industryMap[sym] || 'Khác',
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

    res.json({ risk: riskInfo, sectors, stocks });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Radar EOD error' });
  }
});

// 3.2 MINERVINI & VCP PRO
app.post('/api/minervini', async (req, res) => {
  try {
    const today = vnTodayStr();
    const startDate = String(req.body?.startDate || addDaysToDateStr(today, -365));
    const endDate = String(req.body?.endDate || today);
    const minRs = Number(req.body?.minRs ?? 70);

    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange: 'HOSE',
      industry: 'Tất cả ngành',
      excludePenny: true,
    });
    const syms = await resolveLiquidUniverse(rawSyms, 'HOSE', endDate, 260);
    const rawMap = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(startDate, -450), endDate, 'D');
    const result = runMinerviniScreener(rawMap, startDate, endDate, minRs, industryMap);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Minervini error' });
  }
});

// 3.3 TOP GAINERS (Supports HOSE, HNX, UPCOM + unified SSI ICB catalog)
app.post('/api/gainers', async (req, res) => {
  try {
    const today = vnTodayStr();
    const startDate = String(req.body?.startDate || addDaysToDateStr(today, -30));
    const endDate = String(req.body?.endDate || today);
    const industry = String(req.body?.industry || 'Tất cả ngành');
    const rawEx = String(req.body?.exchange || 'HOSE').toUpperCase().trim();
    const exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' =
      rawEx === 'HNX' || rawEx === 'UPCOM' || rawEx === 'ALL' ? rawEx : 'HOSE';

    const catalog = await fetchFullStockCatalog();
    const rawSyms = selectCatalogSymbols(catalog.stocks, {
      exchange,
      industry,
      excludePenny: false,
    });
    const syms =
      industry === 'Chỉ số'
        ? rawSyms
        : await resolveLiquidUniverse(rawSyms, exchange, endDate, 260);

    const dfs = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(startDate, -10), endDate, 'D', 24);

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
        const meta = catalog.stocks[sym];
        rows.push({
          symbol: sym,
          exchange: meta?.exchange || 'HOSE',
          industry: industry === 'Penny' ? 'Penny' : meta?.industry || 'Khác',
          pctChange: Number((((cl - c0) / c0) * 100).toFixed(2)),
          pctFromLow: Number((((cl - lmin) / lmin) * 100).toFixed(2)),
          pctFromHigh: Number((((cl - hmax) / hmax) * 100).toFixed(2)),
          amplitude: Number((((hmax - lmin) / c0) * 100).toFixed(2)),
          peakDate: `${d}-${m}-${y}`,
        });
      }
    }

    res.json({ rows, scanned: syms.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gainers error' });
  }
});

// 4.1 EOD CHART (Works for ALL HOSE/HNX/UPCOM symbols & indices with automatic fallback)
app.get('/api/chart/eod', async (req, res) => {
  try {
    const today = vnTodayStr();
    const symbol = String(req.query.symbol || 'FPT').toUpperCase().trim();
    const startDate = String(req.query.start || addDaysToDateStr(today, -365));
    const endDate = String(req.query.end || today);
    const tf = String(req.query.tf || 'D').toUpperCase() as 'D' | 'W' | 'M';
    const masParam = String(req.query.mas || '10,20,50');
    const activeMas = [
      ...new Set(
        masParam
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 1 && n < 500)
      ),
    ].sort((a, b) => a - b);

    wsMgr.subscribe([symbol]);
    const tick =
      endDate >= today && isVnMarketHours() ? wsMgr.getSnapshot([symbol])[symbol] : undefined;

    const [catalog, fetched] = await Promise.all([
      fetchFullStockCatalog(),
      fetchSsiOhlcvWithMetaCached(symbol, addDaysToDateStr(startDate, -400), endDate, 'D'),
    ]);

    const meta = catalog.stocks[symbol];
    let bars = fetched.bars;
    if (!bars.length) {
      return res.json({
        symbol,
        companyName: meta?.companyName || symbol,
        exchange: meta?.exchange || '',
        industry: meta?.industry || '',
        source: fetched.source,
        resolvedDate: null,
        empty: true,
        bars: [],
        rawAth: 0,
      });
    }

    if (endDate >= today && tick) {
      bars = patchLiveCandle(bars, tick, false);
    }

    const rawAth = Math.max(...bars.map((b) => b.high));
    bars = resampleBars(bars, tf);

    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume);
    const maSeries: Record<number, (number | null)[]> = {};
    for (const p of activeMas) {
      maSeries[p] = rollingMean(closes, p, 1);
    }
    const ma20Vol = rollingMean(vols, 20, 1);

    const outBars = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.date < startDate) continue;
      const masObj: Record<string, number | null> = {};
      for (const p of activeMas) {
        masObj[`MA${p}`] = maSeries[p][i];
      }
      masObj.MA20_Vol = ma20Vol[i];
      const [y, m, d] = b.date.split('-');
      outBars.push({
        date: b.date,
        dtDisplay: `${d}/${m}/${y}`,
        label: `${d}/${m}/${y.slice(2)}`,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        prevClose: i > 0 ? bars[i - 1].close : null,
        mas: masObj,
      });
    }

    const resolvedDate = outBars.length ? outBars[outBars.length - 1].date : null;

    res.json({
      symbol,
      companyName: meta?.companyName || symbol,
      exchange: meta?.exchange || '',
      industry: meta?.industry || '',
      source: fetched.source,
      resolvedDate,
      resolvedDateDisplay: resolvedDate ? formatDdMmYyyy(resolvedDate) : null,
      empty: outBars.length === 0,
      rawAth,
      bars: outBars,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'EOD chart error' });
  }
});

// 4.2 INTRADAY CHART (7-day lookback to latest session + automatic EOD fallback)
app.get('/api/chart/intraday', async (req, res) => {
  try {
    const today = vnTodayStr();
    const symbol = String(req.query.symbol || 'FPT').toUpperCase().trim();
    const dateStr = String(req.query.date || today);
    const tf = String(req.query.tf || '1');
    const refresh = req.query.refresh === '1';

    if (refresh) clearAllCaches();
    wsMgr.subscribe([symbol]);
    const tick =
      dateStr === today && isVnMarketHours() ? wsMgr.getSnapshot([symbol])[symbol] : undefined;

    const lookbackStart = addDaysToDateStr(dateStr, -7);
    const [catalog, fetched] = await Promise.all([
      fetchFullStockCatalog(),
      fetchSsiOhlcvWithMetaCached(symbol, lookbackStart, dateStr, tf, refresh),
    ]);

    const meta = catalog.stocks[symbol];
    let source = fetched.source;
    let fallbackToDaily = false;
    let resolvedDate: string | null = null;
    let bars = fetched.bars.filter((b) => b.date <= dateStr);

    if (dateStr === today && tf === '1') {
      const wsBars = wsMgr.getMinuteBars(symbol);
      if (wsBars.length) {
        const todayBars = bars.filter((b) => b.date === today);
        const merged = mergeLiveIntradaySeries(todayBars, wsBars, today);
        if (merged.length) {
          bars = merged;
        }
      }
    }

    if (bars.length) {
      resolvedDate = bars[bars.length - 1].date;
      bars = filterVnTradingHours(bars.filter((b) => b.date === resolvedDate));
    }

    // If intraday is still empty (e.g., illiquid UPCOM symbol with no intraday bars), fall back to latest 30 daily EOD sessions
    if (!bars.length) {
      const dailyFetched = await fetchSsiOhlcvWithMetaCached(
        symbol,
        addDaysToDateStr(dateStr, -90),
        dateStr,
        'D',
        refresh
      );
      const dCut = dailyFetched.bars.filter((b) => b.date <= dateStr);
      if (dCut.length) {
        fallbackToDaily = true;
        source = dailyFetched.source;
        bars = dCut.slice(-30);
        resolvedDate = bars[bars.length - 1].date;
      }
    }

    if (!bars.length) {
      return res.json({
        symbol,
        companyName: meta?.companyName || symbol,
        exchange: meta?.exchange || '',
        industry: meta?.industry || '',
        source,
        requestedDate: dateStr,
        resolvedDate: null,
        fallbackToDaily: false,
        empty: true,
        bars: [],
      });
    }

    if (dateStr === today && resolvedDate === today && tick) {
      bars = patchLiveCandle(bars, tick, !fallbackToDaily);
    }

    const multiDay = new Set(bars.map((b) => b.date)).size > 1;
    const outBars = bars.map((b, i) => ({
      date: b.date,
      time: fallbackToDaily ? formatDdMmYyyy(b.date) : b.time,
      dtDisplay: fallbackToDaily ? formatDdMmYyyy(b.date) : `${formatDdMmYyyy(b.date)} ${b.time}`,
      label: makeTradingLabel(b, !fallbackToDaily, multiDay),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      prevClose: i > 0 ? bars[i - 1].close : null,
      pct:
        i > 0 && bars[i - 1].close > 0
          ? Number((((b.close - bars[i - 1].close) / bars[i - 1].close) * 100).toFixed(2))
          : 0,
    }));

    res.json({
      symbol,
      companyName: meta?.companyName || symbol,
      exchange: meta?.exchange || '',
      industry: meta?.industry || '',
      source,
      requestedDate: dateStr,
      requestedDateDisplay: formatDdMmYyyy(dateStr),
      resolvedDate,
      resolvedDateDisplay: resolvedDate ? formatDdMmYyyy(resolvedDate) : null,
      fallbackToDaily,
      empty: false,
      bars: outBars,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Intraday chart error' });
  }
});

// 5.1 PORTFOLIO EVALUATE
app.post('/api/portfolio/evaluate', async (req, res) => {
  try {
    const holdings: { symbol: string; buy_date: string; buy_price: number; qty: number; note?: string }[] =
      Array.isArray(req.body?.holdings) ? req.body.holdings : [];
    const cashVnd = Number(req.body?.cashVnd ?? 0);
    const refresh = Boolean(req.body?.refresh);
    if (refresh) clearAllCaches();

    if (!holdings.length) {
      return res.json({
        kpis: { totalPl: 0, totalPlPct: 0, todayPl: 0, stockVal: 0, nav: cashVnd },
        rows: [],
      });
    }

    const today = vnTodayStr();
    const syms = [...new Set(holdings.map((h) => h.symbol.toUpperCase().trim()))];
    wsMgr.subscribe(syms);
    const liveP = wsMgr.getSnapshot(syms);
    const histP = await fetchBatchOhlcvSsi(syms, addDaysToDateStr(today, -400), today, 'D');

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
      if (plPct <= -7.0) reco = '🛑 BÁN CẮT LỖ (-7%)';
      else if (plPct <= -5.0) reco = '⚠️ CẢNH BÁO (-5%)';
      else if (ma50 && lastPx < ma50) reco = 'BÁN/HẠ TỶ TRỌNG (Gãy MA50)';
      else if (plPct >= 25.0) reco = '💰 CHỐT LỜI (>25%)';
      else if (plPct >= 20.0) {
        reco = daysHeld < 15 ? '💎 POWER PLAY (Giữ 8 tuần)' : 'CÂN NHẮC CHỐT LỜI (20-25%)';
      } else if (ma20 && lastPx < ma20) {
        reco = plPct > 0 ? 'BÁN KHÓA LÃI (<MA20)' : 'QUAN SÁT (<MA20)';
      } else if (plPct >= 2.0 && plPct <= 5.0 && isStrong) {
        reco = '➕ MUA THÊM (Xác nhận Trend)';
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

    res.json({
      kpis: {
        totalPl: Math.round(totPl),
        totalPlPct: totCost > 0 ? Number(((totPl / totCost) * 100).toFixed(2)) : 0,
        todayPl: Math.round(totTodayPl),
        stockVal: Math.round(totVal),
        nav: Math.round(navAll),
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Portfolio evaluate error' });
  }
});

// 5.2 HYBRID BACKTEST
app.post('/api/backtest', async (req, res) => {
  try {
    const b = req.body || {};
    const industry = String(b.industry || 'Tất cả ngành');
    const startDate = String(b.startDate || '2024-10-17');
    const endDate = String(b.endDate || vnTodayStr());

    const catalog = await fetchFullStockCatalog();
    const industryMap = buildIndustryMapFromCatalog(catalog.stocks);
    const pennySet = new Set(
      Object.values(catalog.stocks)
        .filter((m) => m.isPenny)
        .map((m) => m.symbol)
    );
    const rawTarget = selectCatalogSymbols(catalog.stocks, {
      exchange: 'HOSE',
      industry,
      excludePenny: industry === 'Tất cả ngành',
    });
    const rawHose = selectCatalogSymbols(catalog.stocks, {
      exchange: 'HOSE',
      industry: 'Tất cả ngành',
      excludePenny: true,
    });
    const [targetSyms, allHose] = await Promise.all([
      resolveLiquidUniverse(rawTarget, 'HOSE', endDate, 240),
      resolveLiquidUniverse(rawHose, 'HOSE', endDate, 240),
    ]);
    const fetchSyms = [...new Set([...allHose, ...targetSyms, 'VNINDEX'])].sort();

    const rawBt = await fetchBatchOhlcvSsi(
      fetchSyms,
      addDaysToDateStr(startDate, -450),
      endDate,
      'D'
    );

    const params: BacktestParams = {
      symbols: targetSyms,
      initial_capital: Number(b.initialCapital ?? 1_000_000_000),
      fee_rate: Number(b.feePct ?? 0.15) / 100,
      t_plus: Number(b.tPlus ?? 2.5),
      max_positions: Number(b.maxPositions ?? 5),
      max_per_sector: Number(b.maxPerSector ?? 2),
      stop_loss: Number(b.stopLossPct ?? 7.0) / 100,
      ma_exit: Number(b.maExit ?? 20),
      start_date: startDate,
      end_date: endDate,
      entry_mode: Number(b.entryMode ?? 1),
      min_rs: Number(b.minRs ?? 70),
      max_pivot_pct: Number(b.maxPivotPct ?? 5.0),
      vol_mult: Number(b.volMult ?? 1.2),
      min_vol: Number(b.minVol ?? 1_000_000),
      filter_top_sectors: Boolean(b.filterTopSectors ?? false),
      top_sectors: Number(b.topSectors ?? 5),
      use_take_profit: Boolean(b.useTakeProfit ?? false),
      take_profit: Number(b.takeProfitPct ?? 25.0) / 100,
      use_power_play: Boolean(b.usePowerPlay ?? true),
      use_dd_shield: Boolean(b.useDdShield ?? true),
      w_dd: Number(b.wDd ?? 1.0),
      w_stall: Number(b.wStall ?? 0.7),
      dd_cancel_pct: Number(b.ddCancelPct ?? 5.0),
      t_low: 3,
      t_med: 5,
      t_high: 7,
      t_crit: 9,
      use_top_climax: Boolean(b.useTopClimax ?? true),
      climax_breadth_thresh: Number(b.climaxBreadthThresh ?? 80.0),
      use_bottom_fishing: Boolean(b.useBottomFishing ?? true),
      panic_ma200_thresh: Number(b.panicMa200Thresh ?? 20.0),
      panic_bot52_thresh: Number(b.panicBot52Thresh ?? 70.0),
    };

    const result = runHybridBacktest(rawBt, params, industryMap, pennySet);
    if (!result) {
      return res.json({ empty: true });
    }
    res.json({ empty: false, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Backtest error' });
  }
});

// ==============================================================================
// REALTIME WEBSOCKET HUB (/ws on port 3000) + VITE / STATIC SERVER
// ==============================================================================
function attachRealtimeWebSocketHub(httpServer: http.Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clientSubs = new Map<WsClient, Set<string>>();

  const sendSafe = (ws: WsClient, payload: Record<string, any>) => {
    if (ws.readyState === WsClient.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ignore closed socket
      }
    }
  };

  // Batch incoming ticks every 250ms to prevent flooding browser tabs
  let pendingTicks: Record<string, LiveTick> = {};
  let flushTimer: NodeJS.Timeout | null = null;

  const flushTicks = () => {
    flushTimer = null;
    const batch = pendingTicks;
    pendingTicks = {};
    const keys = Object.keys(batch);
    if (!keys.length || wss.clients.size === 0) return;
    const ts = vnNowParts().hms;

    for (const client of wss.clients) {
      if (client.readyState !== WsClient.OPEN) continue;
      const subs = clientSubs.get(client);
      if (!subs || subs.size === 0) {
        sendSafe(client, { type: 'ticks', ticks: batch, ts });
      } else {
        const filtered: Record<string, LiveTick> = {};
        let hasAny = false;
        for (const sym of keys) {
          if (subs.has('*') || subs.has(sym) || ALL_MAIN_INDICES.includes(sym)) {
            filtered[sym] = batch[sym];
            hasAny = true;
          }
        }
        if (hasAny) {
          sendSafe(client, { type: 'ticks', ticks: filtered, ts });
        }
      }
    }
  };

  wsMgr.onTicks((ticks) => {
    Object.assign(pendingTicks, ticks);
    if (!flushTimer) {
      flushTimer = setTimeout(flushTicks, 250);
    }
  });

  wsMgr.onSync(async (ev) => {
    if (wss.clients.size === 0) return;
    const status = await buildStatusPayload().catch(() => null);
    for (const client of wss.clients) {
      sendSafe(client, { type: 'sync', ...ev });
      if (status) sendSafe(client, { type: 'status', status });
    }
  });

  // Periodic status/clock push over WS so clients never need status polling
  setInterval(async () => {
    if (wss.clients.size === 0) return;
    const status = await buildStatusPayload().catch(() => null);
    if (!status) return;
    for (const client of wss.clients) {
      sendSafe(client, { type: 'status', status });
    }
  }, 15_000);

  wss.on('connection', (ws) => {
    const subs = new Set<string>([...ALL_MAIN_INDICES]);
    clientSubs.set(ws, subs);

    // Send initial status + snapshot immediately on connect
    buildStatusPayload()
      .then((status) => sendSafe(ws, { type: 'status', status }))
      .catch(() => {});

    const initTicks = wsMgr.getSnapshot([...ALL_MAIN_INDICES]);
    if (Object.keys(initTicks).length > 0) {
      sendSafe(ws, { type: 'ticks', ticks: initTicks, ts: vnNowParts().hms });
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        if (msg?.type === 'ping') {
          sendSafe(ws, { type: 'pong', ts: vnNowParts().hms });
        } else if (msg?.type === 'subscribe' && Array.isArray(msg.symbols)) {
          const syms = msg.symbols
            .map((s: unknown) => String(s || '').toUpperCase().trim())
            .filter(Boolean);
          const toUpstream: string[] = [];
          for (const s of syms) {
            subs.add(s);
            if (s !== '*') toUpstream.push(s);
          }
          if (toUpstream.length) {
            wsMgr.subscribe(toUpstream);
            const snap = wsMgr.getSnapshot(toUpstream);
            if (Object.keys(snap).length > 0) {
              sendSafe(ws, { type: 'ticks', ticks: snap, ts: vnNowParts().hms });
            }
          }
        } else if (msg?.type === 'unsubscribe' && Array.isArray(msg.symbols)) {
          for (const s of msg.symbols) {
            const sym = String(s || '').toUpperCase().trim();
            if (sym && !ALL_MAIN_INDICES.includes(sym)) subs.delete(sym);
          }
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', () => {
      clientSubs.delete(ws);
    });
  });

  return wss;
}

async function startServer() {
  const distDir = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV !== 'development' && fs.existsSync(distDir);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const httpServer = http.createServer(app);
  attachRealtimeWebSocketHub(httpServer);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`V11 PRO server + WebSocket hub (/ws) listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
