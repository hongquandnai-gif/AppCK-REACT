import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patchIndicesWithTicks,
  patchOhlcBarsWithTick,
  patchPortfolioWithTicks,
  patchSectorMaWithTicks,
  patchStockRowsWithTicks,
  patchTreemapWithTicks,
  type LiveTickDto,
} from './livePatch';

test('patchIndicesWithTicks updates index value/volume/last point and preserves reference when unchanged', () => {
  const base = [
    {
      symbol: 'VNINDEX',
      lastPx: 1250,
      prevClose: 1240,
      delta: 10,
      pct: 0.81,
      totalValBil: 14000,
      prevTotalValBil: 12000,
      totalVolMil: 600,
      valDeltaPct: 16.67,
      points: [
        { x: '09:15', close: 1245 },
        { x: '10:00', close: 1250 },
      ],
    },
  ];
  const ticks: Record<string, LiveTickDto> = {
    VNINDEX: {
      symbol: 'VNINDEX',
      last: 1255,
      ref: 1240,
      delta: 15,
      pct: 1.21,
      volume: 650_000_000,
      value_bil: 15000,
      time: '10:05:00',
    },
  };

  const patched = patchIndicesWithTicks(base, ticks);
  assert.notEqual(patched, base);
  assert.equal(patched[0].lastPx, 1255);
  assert.equal(patched[0].delta, 15);
  assert.equal(patched[0].totalValBil, 15000);
  assert.equal(patched[0].totalVolMil, 650);
  assert.equal(patched[0].valDeltaPct, 25);
  assert.equal(patched[0].points[1].close, 1255);

  // Applying identical ticks returns original array reference (zero unnecessary re-renders)
  const unchanged = patchIndicesWithTicks(patched, ticks);
  assert.equal(unchanged, patched);
});

test('patchTreemapWithTicks recalculates counts, row metrics, and live SSI WS badge in-place', () => {
  const tmResp = {
    exchange: 'HOSE',
    mode: 'eod',
    source: 'VNDirect',
    syncTime: '2026-11-20',
    counts: { up: 1, down: 1, ref: 0 },
    rows: [
      { symbol: 'FPT', industry: 'Công nghệ Thông tin', price: 45, pct: -0.5, sizeVal: 120 },
      { symbol: 'VCB', industry: 'Ngân hàng', price: 90, pct: 0.5, sizeVal: 200 },
    ],
  };
  const ticks: Record<string, LiveTickDto> = {
    FPT: {
      symbol: 'FPT',
      last: 45.75,
      ref: 45,
      delta: 0.75,
      pct: 1.67,
      volume: 6_333_700,
      value_bil: 284.13,
      time: '10:15:30',
      liveSource: 'SSI_WS',
    },
  };

  const next = patchTreemapWithTicks(tmResp, ticks, 'value');
  assert.equal(next.mode, 'live');
  assert.equal(next.source, 'SSI WS');
  assert.equal(next.syncTime, '10:15:30');
  assert.deepEqual(next.counts, { up: 2, down: 0, ref: 0 });
  assert.equal(next.rows[0].price, 45.75);
  assert.equal(next.rows[0].pct, 1.67);
  assert.equal(next.rows[0].sizeVal, 284.13);
});

test('patchOhlcBarsWithTick appends new today EOD candle when history lags behind SSI WS date', () => {
  const bars = [
    {
      date: '2026-11-19',
      dtDisplay: '19/11/2026',
      label: '19/11/26',
      open: 44,
      high: 45,
      low: 43.5,
      close: 44.5,
      volume: 4_000_000,
      prevClose: 44,
      mas: { MA10: 44.5 },
    },
    {
      date: '2026-11-20',
      dtDisplay: '20/11/2026',
      label: '20/11/26',
      open: 44.5,
      high: 45.2,
      low: 44.2,
      close: 45.0,
      volume: 5_000_000,
      prevClose: 44.5,
      mas: { MA10: 44.75 },
    },
  ];
  const tick: LiveTickDto = {
    symbol: 'FPT',
    last: 45.75,
    open: 44.9,
    high: 46.9,
    low: 44.05,
    ref: 45.0,
    delta: 0.75,
    pct: 1.67,
    volume: 6_333_700,
    time: '10:15:00',
    tradeDate: '2026-11-23',
    liveSource: 'SSI_WS',
  };

  const patched = patchOhlcBarsWithTick(bars, tick, { isIntraday: false, activeMas: [10] });
  assert.equal(patched.length, 3);
  assert.equal(patched[2].date, '2026-11-23');
  assert.equal(patched[2].open, 44.9);
  assert.equal(patched[2].high, 46.9);
  assert.equal(patched[2].low, 44.05);
  assert.equal(patched[2].close, 45.75);
  assert.equal(patched[2].volume, 6_333_700);
  assert.ok(patched[2].mas.MA10 > 44.75);

  // Subsequent tick on the same day updates today's bar in-place without duplicating
  const patched2 = patchOhlcBarsWithTick(
    patched,
    { ...tick, last: 46.0, volume: 6_500_000 },
    { isIntraday: false, activeMas: [10] }
  );
  assert.equal(patched2.length, 3);
  assert.equal(patched2[2].close, 46.0);
  assert.equal(patched2[2].volume, 6_500_000);
});

test('patchOhlcBarsWithTick updates intraday bucket and appends new candle on bucket rollover', () => {
  const bars = [
    {
      date: '2026-11-23',
      time: '10:15',
      dtDisplay: '23/11/2026 10:15',
      label: '10:15',
      open: 45.5,
      high: 45.6,
      low: 45.4,
      close: 45.55,
      volume: 10_000,
      prevClose: 45.4,
      pct: 0.33,
      _cumVol: 6_000_000,
    },
  ];
  const tickSameBucket: LiveTickDto = {
    symbol: 'FPT',
    last: 45.75,
    ref: 45,
    delta: 0.75,
    pct: 1.67,
    volume: 6_005_000,
    lastVol: 5_000,
    time: '10:18:40',
    tradeDate: '2026-11-23',
  };
  const updated = patchOhlcBarsWithTick(bars, tickSameBucket, { isIntraday: true, tfMinutes: 5 });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].close, 45.75);
  assert.equal(updated[0].high, 45.75);
  assert.equal(updated[0].volume, 15_000);

  // Rollover into 10:20 bucket
  const rolled = patchOhlcBarsWithTick(
    updated,
    { ...tickSameBucket, last: 45.8, lastVol: 1_200, volume: 6_006_200, time: '10:20:05' },
    { isIntraday: true, tfMinutes: 5 }
  );
  assert.equal(rolled.length, 2);
  assert.equal(rolled[1].time, '10:20');
  assert.equal(rolled[1].open, 45.8);
  assert.equal(rolled[1].volume, 1_200);
});

test('patchSectorMaWithTicks recomputes sector strength in all mode and MA statuses in group mode', () => {
  const allModeRes = {
    mode: 'all',
    syncTime: '2026-11-20',
    rows: [
      {
        industry: 'Ngân hàng',
        classification: 'YẾU',
        pctStrong: 0,
        pctWeak: 100,
        total: 2,
        highlight: 'VCB',
        refMa: 'MA20',
        deltaPct: -2.0,
      },
    ],
    stockSnapshots: [
      { symbol: 'VCB', industry: 'Ngân hàng', price: 88, ma20: 90, ma50: 89 },
      { symbol: 'BID', industry: 'Ngân hàng', price: 44, ma20: 45, ma50: 45 },
    ],
  };

  const liveAll = patchSectorMaWithTicks(allModeRes, {
    VCB: { symbol: 'VCB', last: 92, ref: 88, delta: 4, pct: 4.55, volume: 1000, time: '10:20:00' },
    BID: { symbol: 'BID', last: 47, ref: 44, delta: 3, pct: 6.82, volume: 2000, time: '10:20:01' },
  });
  assert.equal(liveAll.liveUpdated, true);
  assert.equal(liveAll.rows[0].classification, 'DẪN DẮT');
  assert.equal(liveAll.rows[0].pctStrong, 100);
  assert.equal(liveAll.rows[0].pctWeak, 0);
  assert.equal(liveAll.rows[0].highlight, 'BID');

  const groupModeRes = {
    mode: 'group',
    syncTime: '2026-11-20',
    rows: [
      {
        symbol: 'FPT',
        price: 45.0,
        changePct: -1.5,
        mas: { MA10: 'DƯỚI (45.50)', MA20: 'DƯỚI (46.00)' },
        maValues: { MA10: 45.5, MA20: 46.0 },
      },
    ],
  };

  const liveGroup = patchSectorMaWithTicks(groupModeRes, {
    FPT: { symbol: 'FPT', last: 46.5, ref: 45, delta: 1.5, pct: 3.33, volume: 1000, time: '10:21:00' },
  });
  assert.equal(liveGroup.rows[0].price, 46.5);
  assert.equal(liveGroup.rows[0].mas.MA10, 'TRÊN (45.50)');
  assert.equal(liveGroup.rows[0].mas.MA20, 'TRÊN (46.00)');
});

test('patchPortfolioWithTicks recalculates P&L, weight, and NAV instantaneously', () => {
  const portEval = {
    kpis: { totalPl: 0, totalPlPct: 0, todayPl: 0, stockVal: 100_000_000, nav: 150_000_000 },
    rows: [
      {
        symbol: 'FPT',
        buyPrice: 100,
        qty: 1000,
        currentPrice: 100,
        plVnd: 0,
        plPct: 0,
        todayPl: 0,
        weightPct: 66.67,
      },
    ],
  };
  const ticks: Record<string, LiveTickDto> = {
    FPT: { symbol: 'FPT', last: 110, ref: 105, delta: 5, pct: 4.76, volume: 1_000_000, time: '10:30:00' },
  };
  const patched = patchPortfolioWithTicks(portEval, ticks, 50_000_000);
  assert.equal(patched.kpis.totalPl, 10_000_000);
  assert.equal(patched.kpis.todayPl, 5_000_000);
  assert.equal(patched.kpis.stockVal, 110_000_000);
  assert.equal(patched.kpis.nav, 160_000_000);
  assert.equal(patched.rows[0].currentPrice, 110);
});

test('patchStockRowsWithTicks updates generic screener rows in-place', () => {
  const rows = [{ symbol: 'HPG', price: 27.5, changePct: 1.0, volume: 10_000_000 }];
  const patched = patchStockRowsWithTicks(rows, {
    HPG: { symbol: 'HPG', last: 28.0, ref: 27.2, delta: 0.8, pct: 2.94, volume: 15_000_000, time: '14:00:00' },
  });
  assert.equal(patched[0].price, 28.0);
  assert.equal(patched[0].changePct, 2.94);
  assert.equal(patched[0].volume, 15_000_000);
});
