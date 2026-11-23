import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patchIndicesWithTicks,
  patchOhlcBarsWithTick,
  patchPortfolioWithTicks,
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
      prevTotalValBil: 10000,
      totalVolMil: 600,
      valDeltaPct: 40,
      points: [{ x: '14:44', close: 1250 }],
    },
  ];
  const tick: Record<string, LiveTickDto> = {
    VNINDEX: {
      symbol: 'VNINDEX',
      last: 1260,
      ref: 1240,
      delta: 20,
      pct: 1.61,
      volume: 650_000_000,
      value_bil: 15000,
      time: '14:45:00',
    },
  };

  const patched = patchIndicesWithTicks(base, tick);
  assert.notEqual(patched, base);
  assert.equal(patched[0].lastPx, 1260);
  assert.equal(patched[0].delta, 20);
  assert.equal(patched[0].totalValBil, 15000);
  assert.equal(patched[0].totalVolMil, 650);
  assert.equal(patched[0].valDeltaPct, 50);
  assert.equal(patched[0].points[0].close, 1260);

  // Idempotent: second identical tick returns exact same reference
  const same = patchIndicesWithTicks(patched, tick);
  assert.equal(same, patched);
});

test('patchTreemapWithTicks recalculates counts and row metrics in-place', () => {
  const base = {
    syncTime: '14:00:00',
    counts: { up: 1, down: 1, ref: 0 },
    rows: [
      { symbol: 'FPT', price: 130, pct: 1.5, sizeVal: 500 },
      { symbol: 'VCB', price: 90, pct: -0.5, sizeVal: 400 },
    ],
  };
  const ticks: Record<string, LiveTickDto> = {
    VCB: {
      symbol: 'VCB',
      last: 92,
      ref: 90.5,
      delta: 1.5,
      pct: 1.66,
      volume: 5_000_000,
      value_bil: 460,
      time: '14:15:00',
    },
  };

  const patched = patchTreemapWithTicks(base, ticks, 'value');
  assert.deepEqual(patched.counts, { up: 2, down: 0, ref: 0 });
  assert.equal(patched.rows[1].price, 92);
  assert.equal(patched.rows[1].sizeVal, 460);
  assert.equal(patched.syncTime, '14:15:00');
});

test('patchOhlcBarsWithTick updates last candle high/low/close/volume smoothly', () => {
  const bars = [
    { open: 100, high: 102, low: 99, close: 101, volume: 1000, prevClose: 100, pct: 1 },
  ];
  const tick: LiveTickDto = {
    symbol: 'FPT',
    last: 105,
    ref: 100,
    delta: 5,
    pct: 5,
    volume: 2500,
    time: '14:20:00',
  };
  const patched = patchOhlcBarsWithTick(bars, tick, false);
  assert.equal(patched[0].close, 105);
  assert.equal(patched[0].high, 105);
  assert.equal(patched[0].low, 99);
  assert.equal(patched[0].volume, 2500);
  assert.equal(patched[0].pct, 5);
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
    FPT: {
      symbol: 'FPT',
      last: 110,
      ref: 105,
      delta: 5,
      pct: 4.76,
      volume: 1_000_000,
      time: '14:25:00',
    },
  };
  const patched = patchPortfolioWithTicks(portEval, ticks, 50_000_000);
  assert.equal(patched.rows[0].currentPrice, 110);
  assert.equal(patched.rows[0].plVnd, 10_000_000);
  assert.equal(patched.rows[0].plPct, 10);
  assert.equal(patched.rows[0].todayPl, 5_000_000);
  assert.equal(patched.kpis.stockVal, 110_000_000);
  assert.equal(patched.kpis.nav, 160_000_000);
  assert.equal(patched.kpis.totalPl, 10_000_000);
});

test('patchStockRowsWithTicks updates generic screener rows in-place', () => {
  const rows = [
    { symbol: 'SSI', price: 25.0, changePct: 0.4, volume: 1000000 },
    { symbol: 'FPT', price: 130.0, changePct: 1.0, volume: 2000000 },
  ];
  const ticks: Record<string, LiveTickDto> = {
    SSI: {
      symbol: 'SSI',
      last: 26.5,
      ref: 24.9,
      delta: 1.6,
      pct: 6.43,
      volume: 1_500_000,
      time: '14:30:00',
    },
  };
  const patched = patchStockRowsWithTicks(rows, ticks);
  assert.equal(patched[0].price, 26.5);
  assert.equal(patched[0].changePct, 6.43);
  assert.equal(patched[0].volume, 1_500_000);
  assert.equal(patched[1], rows[1]);
});
