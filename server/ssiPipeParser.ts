export interface ParsedSsiPipeTick {
  symbol: string;
  exchange?: 'HOSE' | 'HNX' | 'UPCOM';
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
}

function parseSsiPrice(raw: string | undefined): number | null {
  if (!raw || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // SSI pipe stream sends equity prices in raw VND (e.g. 45750 -> 45.75 nghìn VNĐ)
  return n >= 500 ? n / 1000 : n;
}

function parseSsiSignedPrice(raw: string | undefined): number | null {
  if (!raw || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) >= 50 ? n / 1000 : n;
}

function parseSsiExchange(raw: string | undefined): 'HOSE' | 'HNX' | 'UPCOM' | undefined {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'HOSE' || s === 'HSX') return 'HOSE';
  if (s === 'HNX') return 'HNX';
  if (s === 'UPCOM') return 'UPCOM';
  return undefined;
}

/**
 * Parses a live pipe-delimited frame from SSI `stockRealtimeByListV2`.
 * Format: `MAIN|S#<SYM>|bid1..bid10(20)|ask1..ask10(20)|matchedPrice(42)|matchedVol(43)|highest(44)|exchange(45)|lowest(46)|avg(47)|...|change(52)|pctChange(53)|nmTotalQty(54)|nmTotalVal(55)|...|ceil(59)|floor(60)|ref(61)|...|open(75)|...`
 *
 * Ignores non-MAIN frames (such as `ODD_LOT|...`) and frames without a valid matched price.
 */
export function parseSsiPipeTick(message: string): ParsedSsiPipeTick | null {
  if (!message || !message.startsWith('MAIN|')) return null;
  const parts = message.split('|');
  if (parts.length < 62) return null;

  const rawSym = parts[1] || '';
  const sym = rawSym.replace(/^S#/i, '').trim().toUpperCase();
  if (!sym) return null;

  const last = parseSsiPrice(parts[42]);
  if (last === null || last <= 0) return null;

  const ref = parseSsiPrice(parts[61]);
  const high = parseSsiPrice(parts[44]) ?? undefined;
  const low = parseSsiPrice(parts[46]) ?? undefined;
  const open = parseSsiPrice(parts[75]) ?? undefined;
  const exchange = parseSsiExchange(parts[45]);

  const rawChg = parseSsiSignedPrice(parts[52]);
  const delta =
    rawChg !== null ? rawChg : ref && ref > 0 ? Number((last - ref).toFixed(4)) : 0;

  const rawPct = parts[53] !== '' && parts[53] !== undefined ? Number(parts[53]) : NaN;
  const pct = Number.isFinite(rawPct)
    ? rawPct
    : ref && ref > 0
    ? Number(((delta / ref) * 100).toFixed(2))
    : 0;

  const rawVol = Number(parts[54]);
  const volume = Number.isFinite(rawVol) && rawVol >= 0 ? Math.round(rawVol) : 0;

  const rawLastVol = Number(parts[43]);
  const lastVol = Number.isFinite(rawLastVol) && rawLastVol > 0 ? Math.round(rawLastVol) : undefined;

  const rawValVnd = Number(parts[55]);
  const value_bil =
    Number.isFinite(rawValVnd) && rawValVnd > 0
      ? Number((rawValVnd / 1e9).toFixed(3))
      : volume > 0
      ? Number(((last * volume) / 1e6).toFixed(3))
      : undefined;

  return {
    symbol: sym,
    exchange,
    last,
    open,
    high,
    low,
    ref,
    delta,
    pct,
    volume,
    lastVol,
    value_bil,
  };
}
