import WebSocket from 'ws';
import {
  ALL_MAIN_INDICES,
  HARDCODED_HOSE_INDUSTRIES_MAPPING,
  INDEX_SYMBOLS,
  isPennyStock,
} from '../src/shared/constants.ts';

export interface OhlcvBar {
  /** Unix timestamp in seconds (UTC) */
  t: number;
  /** Local VN date string YYYY-MM-DD */
  date: string;
  /** Local VN time string HH:MM */
  time: string;
  /** Local VN display string YYYY-MM-DD HH:MM */
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveTick {
  symbol: string;
  last: number;
  ref: number | null;
  delta: number;
  pct: number;
  volume: number;
  value_bil?: number;
  time: string;
}

export interface StockMeta {
  symbol: string;
  companyName: string;
  industry: string;
  exchange: string;
  refPrice: number;
  ceiling: number;
  floor: number;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnNowParts(nowMs = Date.now()) {
  const d = new Date(nowMs + VN_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  const second = String(d.getUTCSeconds()).padStart(2, '0');
  const weekday = d.getUTCDay(); // 0=Sun, 6=Sat
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday,
    dateStr: `${year}-${month}-${day}`,
    ddmm: `${day}/${month}`,
    ddmmyyyy: `${day}/${month}/${year}`,
    clock: `${day}/${month}/${year} ${hour}:${minute}`,
    hms: `${hour}:${minute}:${second}`,
    hm: `${hour}:${minute}`,
    hhmm: Number(hour) * 100 + Number(minute),
  };
}

export function vnTodayStr(): string {
  return vnNowParts().dateStr;
}

export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function dateStrToVnUnix(dateStr: string, endOfDay = false): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcMs = Date.UTC(
    y,
    m - 1,
    d,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0
  ) - VN_OFFSET_MS;
  return Math.floor(utcMs / 1000);
}

export function isVnMarketHours(): boolean {
  const p = vnNowParts();
  if (p.weekday === 0 || p.weekday === 6) return false;
  return p.hhmm >= 850 && p.hhmm <= 1510;
}

export const SSI_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://iboard.ssi.com.vn',
  Referer: 'https://iboard.ssi.com.vn/',
};

export const ALL_INDEX_SYMBOLS = new Set<string>([
  ...INDEX_SYMBOLS,
  'VNINDEX', 'VN30', 'HNX', 'UPCOM', 'VNMID', 'VNSML', 'VNSMALL',
  'HNXINDEX', 'HNXUPCOMINDEX', 'VNMIDCAP', 'VNSMALLCAP', 'VN100', 'VNALL',
]);

const SSI_INDEX_ALIASES: Record<string, string[]> = {
  VNINDEX: ['VNINDEX'],
  VN30: ['VN30'],
  HNX: ['HNXINDEX', 'HNXIndex', 'HNX'],
  HNXINDEX: ['HNXINDEX', 'HNXIndex', 'HNX'],
  UPCOM: ['HNXUPCOMINDEX', 'HNXUpcomIndex', 'UPCOM'],
  HNXUPCOMINDEX: ['HNXUPCOMINDEX', 'HNXUpcomIndex', 'UPCOM'],
  VNMID: ['VNMID', 'VNMidcap'],
  VNSMALL: ['VNSML', 'VNSmallcap', 'VNSMALL'],
  VNSML: ['VNSML', 'VNSmallcap', 'VNSMALL'],
};

const VNDIRECT_INDEX_MAP: Record<string, string> = {
  VNINDEX: 'VNINDEX',
  VN30: 'VN30',
  HNX: 'HNX',
  HNXINDEX: 'HNX',
  UPCOM: 'UPCOM',
  HNXUPCOMINDEX: 'UPCOM',
  VNMID: 'VNMID',
  VNSMALL: 'VNSML',
  VNSML: 'VNSML',
};

const VNDIRECT_FIRST_INDICES = new Set(['VNMID', 'VNSMALL', 'VNSML']);

const WS_INDEX_CANONICAL_MIRROR: Record<string, string[]> = {
  HNXINDEX: ['HNX', 'HNXINDEX'],
  HNXUPCOMINDEX: ['UPCOM', 'HNXUPCOMINDEX'],
  VNMIDCAP: ['VNMID'],
  VNMID: ['VNMID'],
  VNSML: ['VNSMALL', 'VNSML'],
  VNSMALLCAP: ['VNSMALL', 'VNSML'],
};

const resolvedSsiSymbol = new Map<string, string>();

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toThousandVnd(val: unknown): number {
  const v = Number(val ?? 0);
  if (!Number.isFinite(v)) return 0;
  return v >= 500 ? v / 1000 : v;
}

// 1. Stock list cache (1 hour TTL)
let stockListCache: { ts: number; data: Record<string, StockMeta> } | null = null;

export async function fetchSsiStockList(exchange = 'hose'): Promise<Record<string, StockMeta>> {
  const now = Date.now();
  if (stockListCache && now - stockListCache.ts < 3600_000) {
    return stockListCache.data;
  }

  const url = `https://iboard-query.ssi.com.vn/stock/exchange/${exchange.toLowerCase()}`;
  const stockDict: Record<string, StockMeta> = {};

  const payload = await fetchJsonWithTimeout(url, SSI_HEADERS, 10000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of items) {
    const sym = String(item?.stockSymbol || item?.code || '').trim().toUpperCase();
    if (sym.length === 3 && /^[A-Z]+$/.test(sym)) {
      const ind =
        HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] ??
        (isPennyStock(sym) ? 'Penny' : item?.industryName || 'Khác');
      stockDict[sym] = {
        symbol: sym,
        companyName: item?.companyNameVi || item?.companyNameEn || sym,
        industry: ind,
        exchange: exchange.toUpperCase(),
        refPrice: Number(item?.refPrice || 0) / 1000,
        ceiling: Number(item?.ceiling || 0) / 1000,
        floor: Number(item?.floor || 0) / 1000,
      };
    }
  }

  if (Object.keys(stockDict).length === 0) {
    for (const [sym, ind] of Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)) {
      if (ind !== 'Chỉ số' && sym.length === 3) {
        stockDict[sym] = {
          symbol: sym,
          companyName: sym,
          industry: ind,
          exchange: 'HOSE',
          refPrice: 0,
          ceiling: 0,
          floor: 0,
        };
      }
    }
  }

  stockListCache = { ts: now, data: stockDict };
  return stockDict;
}

export async function fetchSsiRealtimeBoard(exchange = 'hose'): Promise<Record<string, LiveTick>> {
  const url = `https://iboard-query.ssi.com.vn/stock/exchange/${exchange.toLowerCase()}`;
  const board: Record<string, LiveTick> = {};
  const payload = await fetchJsonWithTimeout(url, SSI_HEADERS, 10000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
  const tsStr = vnNowParts().hms;

  for (const item of items) {
    const sym = String(item?.stockSymbol || item?.code || '').trim().toUpperCase();
    if (sym.length !== 3 || !/^[A-Z]+$/.test(sym)) continue;

    const ref = toThousandVnd(item?.refPrice || item?.priorClosePrice);
    let last = toThousandVnd(
      item?.matchedPrice ||
        item?.expectedMatchedPrice ||
        item?.lastPrice ||
        item?.closePrice
    );
    if (last <= 0) last = ref;

    const vol = Number(
      item?.nmTotalTradedQty ||
        item?.totalTradedQty ||
        item?.stockVol ||
        item?.totalVolume ||
        0
    );
    const valVnd = Number(item?.nmTotalTradedValue || 0);
    const delta = ref > 0 ? last - ref : 0;
    const pctRaw = item?.priceChangePercent;
    let pct = ref > 0 ? (delta / ref) * 100 : 0;
    if (pctRaw !== null && pctRaw !== undefined && ref > 0 && Number.isFinite(Number(pctRaw))) {
      pct = Number(pctRaw);
    }

    board[sym] = {
      symbol: sym,
      last,
      ref,
      delta,
      pct,
      volume: Number.isFinite(vol) ? vol : 0,
      value_bil: valVnd > 1e6 ? valVnd / 1e9 : (last * vol) / 1e6,
      time: tsStr,
    };
  }

  return board;
}

// 2. TradingView OHLCV parsing & fetching
function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function parseTvPayload(data: any, symbol: string): OhlcvBar[] {
  if (!data || !Array.isArray(data.t) || data.t.length === 0) return [];
  const map = new Map<number, OhlcvBar>();
  const len = data.t.length;

  for (let i = 0; i < len; i++) {
    const t = Number(data.t[i]);
    const o = Number(data.o?.[i]);
    const h = Number(data.h?.[i]);
    const l = Number(data.l?.[i]);
    const c = Number(data.c?.[i]);
    const v = Number(data.v?.[i] ?? 0);
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;

    const p = vnNowParts(t * 1000);
    map.set(t, {
      t,
      date: p.dateStr,
      time: p.hm,
      datetime: `${p.dateStr} ${p.hm}`,
      open: Number.isFinite(o) ? o : c,
      high: Number.isFinite(h) ? h : c,
      low: Number.isFinite(l) ? l : c,
      close: c,
      volume: Number.isFinite(v) ? v : 0,
    });
  }

  const bars = [...map.values()].sort((a, b) => a.t - b.t);
  if (!bars.length) return [];

  const symU = symbol.toUpperCase();
  const medClose = median(bars.map((b) => b.close));

  if (ALL_INDEX_SYMBOLS.has(symU)) {
    if (medClose < 50) return [];
  } else if (medClose > 500) {
    for (const b of bars) {
      b.open /= 1000;
      b.high /= 1000;
      b.low /= 1000;
      b.close /= 1000;
    }
  }

  return bars;
}

async function fetchVndirectOhlcv(
  symU: string,
  resolution: string,
  tFrom: number,
  tTo: number
): Promise<OhlcvBar[]> {
  const vndSym = VNDIRECT_INDEX_MAP[symU];
  if (!vndSym) return [];
  const url = `https://dchart-api.vndirect.com.vn/dchart/history?symbol=${encodeURIComponent(
    vndSym
  )}&resolution=${encodeURIComponent(resolution)}&from=${tFrom}&to=${tTo}`;
  const json = await fetchJsonWithTimeout(url, { 'User-Agent': 'Mozilla/5.0' }, 12000);
  if (!json) return [];
  return parseTvPayload(json, symU);
}

const singleCache = new Map<string, { ts: number; data: OhlcvBar[] }>();
const SINGLE_CACHE_TTL = 60_000;

export async function fetchSsiOhlcv(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D'
): Promise<OhlcvBar[]> {
  const symU = symbol.toUpperCase().trim();
  const tFrom = dateStrToVnUnix(startDate, false);
  const tTo = dateStrToVnUnix(endDate, true);

  if (VNDIRECT_FIRST_INDICES.has(symU)) {
    const vnd = await fetchVndirectOhlcv(symU, resolution, tFrom, tTo);
    if (vnd.length) return vnd;
  }

  let candidates = SSI_INDEX_ALIASES[symU] ? [...SSI_INDEX_ALIASES[symU]] : [symU];
  const resolved = resolvedSsiSymbol.get(symU);
  if (resolved) {
    candidates = [resolved, ...candidates.filter((c) => c !== resolved)];
  }

  for (const cand of candidates) {
    const url = `https://iboard-api.ssi.com.vn/statistics/charts/history?resolution=${encodeURIComponent(
      resolution
    )}&symbol=${encodeURIComponent(cand)}&from=${tFrom}&to=${tTo}`;
    const raw = await fetchJsonWithTimeout(url, SSI_HEADERS, 12000);
    if (raw) {
      const payload = raw.data ?? raw;
      const bars = parseTvPayload(payload, symU);
      if (bars.length) {
        resolvedSsiSymbol.set(symU, cand);
        return bars;
      }
    }
  }

  if (symU in VNDIRECT_INDEX_MAP && !VNDIRECT_FIRST_INDICES.has(symU)) {
    const vnd = await fetchVndirectOhlcv(symU, resolution, tFrom, tTo);
    if (vnd.length) return vnd;
  }

  return [];
}

export async function fetchSsiOhlcvCached(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D',
  forceRefresh = false
): Promise<OhlcvBar[]> {
  const key = `${symbol.toUpperCase()}|${startDate}|${endDate}|${resolution}`;
  const now = Date.now();
  if (!forceRefresh) {
    const hit = singleCache.get(key);
    if (hit && now - hit.ts < SINGLE_CACHE_TTL) {
      return hit.data.map((b) => ({ ...b }));
    }
  }
  const bars = await fetchSsiOhlcv(symbol, startDate, endDate, resolution);
  if (singleCache.size > 400) {
    const firstKey = singleCache.keys().next().value;
    if (firstKey) singleCache.delete(firstKey);
  }
  singleCache.set(key, { ts: now, data: bars });
  return bars.map((b) => ({ ...b }));
}

// 3. Batch OHLCV fetcher with concurrency & 15-min LRU cache
const batchCache = new Map<string, { ts: number; data: Record<string, OhlcvBar[]> }>();
const BATCH_CACHE_TTL = 900_000;
const BATCH_CACHE_MAX = 8;

export function clearAllCaches() {
  batchCache.clear();
  singleCache.clear();
}

export async function fetchBatchOhlcvSsi(
  symbols: string[],
  startDate: string,
  endDate: string,
  resolution = 'D',
  maxWorkers = 16
): Promise<Record<string, OhlcvBar[]>> {
  const uniqueSyms = [...new Set(symbols.map((s) => s.toUpperCase().trim()))].sort();
  if (!uniqueSyms.length) return {};

  const cacheKey = `${uniqueSyms.join(',')}|${startDate}|${endDate}|${resolution}`;
  const now = Date.now();
  const cached = batchCache.get(cacheKey);
  if (cached && now - cached.ts < BATCH_CACHE_TTL) {
    const copy: Record<string, OhlcvBar[]> = {};
    for (const [k, v] of Object.entries(cached.data)) {
      copy[k] = v.map((b) => ({ ...b }));
    }
    return copy;
  }

  const results: Record<string, OhlcvBar[]> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueSyms.length) {
      const idx = cursor++;
      const sym = uniqueSyms[idx];
      try {
        const bars = await fetchSsiOhlcv(sym, startDate, endDate, resolution);
        if (bars.length) {
          results[sym] = bars;
        }
      } catch {
        // skip failed symbol
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxWorkers, uniqueSyms.length) }, () => worker());
  await Promise.all(workers);

  if (batchCache.size >= BATCH_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of batchCache.entries()) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey) batchCache.delete(oldestKey);
  }
  batchCache.set(cacheKey, { ts: now, data: results });

  const copy: Record<string, OhlcvBar[]> = {};
  for (const [k, v] of Object.entries(results)) {
    copy[k] = v.map((b) => ({ ...b }));
  }
  return copy;
}

// 4. SSI WebSocket + Background Sync Manager
export class SSIWebSocketManager {
  private static readonly WS_URL = 'wss://iboard-pushstream.ssi.com.vn/realtime';

  private liveTicks = new Map<string, LiveTick>();
  private liveBoard = new Map<string, LiveTick>();
  private boardUpdatedAt: string | null = null;
  private indexCache = new Map<string, { bars1m: OhlcvBar[]; barsD: OhlcvBar[]; updatedAt: string }>();
  private minuteBars = new Map<string, Map<string, OhlcvBar>>();
  private barDate = vnTodayStr();
  private subscribed = new Set<string>();

  private ws: WebSocket | null = null;
  private running = false;
  private connected = false;
  private lastMsgTime: string | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollCycle = 0;

  get isConnected(): boolean {
    return this.connected;
  }

  get lastUpdate(): string | null {
    return this.boardUpdatedAt || this.lastMsgTime;
  }

  start(symbols?: string[]) {
    if (symbols) {
      for (const s of symbols) {
        if (s) this.subscribed.add(s.toUpperCase().trim());
      }
    }
    if (this.running) {
      if (symbols) this.subscribe(symbols);
      return;
    }
    this.running = true;
    this.connectWs();
    this.schedulePoll(100);
  }

  subscribe(symbols: string[]) {
    const newSyms: string[] = [];
    for (const raw of symbols) {
      const s = raw.toUpperCase().trim();
      if (s && !this.subscribed.has(s)) {
        this.subscribed.add(s);
        newSyms.push(s);
      }
    }
    if (this.ws && this.connected && newSyms.length) {
      this.sendSubPayload(newSyms);
    }
  }

  private sendSubPayload(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const stockSyms = symbols.filter((s) => !ALL_INDEX_SYMBOLS.has(s));
      const idxSyms = symbols.filter((s) => ALL_INDEX_SYMBOLS.has(s));

      for (let i = 0; i < stockSyms.length; i += 150) {
        const chunk = stockSyms.slice(i, i + 150);
        this.ws.send(
          JSON.stringify({
            type: 'sub',
            topic: 'stockRealtimeByListV2',
            variables: chunk,
            component: 'priceTableEquities',
          })
        );
      }

      if (idxSyms.length) {
        const expanded = new Set<string>();
        for (const s of idxSyms) {
          for (const alias of SSI_INDEX_ALIASES[s] || [s]) {
            expanded.add(alias);
          }
        }
        this.ws.send(
          JSON.stringify({
            type: 'sub',
            topic: 'indexRealtimeByList',
            variables: [...expanded].sort(),
            component: 'indexBar',
          })
        );
      }
    } catch {
      // ignore send errors
    }
  }

  private connectWs() {
    if (!this.running) return;
    try {
      const ws = new WebSocket(SSIWebSocketManager.WS_URL, { headers: SSI_HEADERS });
      this.ws = ws;

      ws.on('open', () => {
        this.connected = true;
        const all = [...this.subscribed];
        if (all.length) this.sendSubPayload(all);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.ping();
            } catch {
              // ignore
            }
          }
        }, 25_000);
      });

      ws.on('message', (rawBuf) => {
        const message = rawBuf.toString('utf8');
        this.lastMsgTime = vnNowParts().hms;
        if (!message.startsWith('{')) return;
        try {
          const data = JSON.parse(message);
          const payload = data?.data ?? data;
          if (Array.isArray(payload)) {
            for (const item of payload) {
              if (item && typeof item === 'object') this.parseDictTick(item);
            }
          } else if (payload && typeof payload === 'object') {
            this.parseDictTick(payload);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('error', () => {
        this.connected = false;
      });

      ws.on('close', () => {
        this.connected = false;
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (this.running) {
          setTimeout(() => this.connectWs(), 5000);
        }
      });
    } catch {
      this.connected = false;
      if (this.running) {
        setTimeout(() => this.connectWs(), 5000);
      }
    }
  }

  private parseDictTick(item: Record<string, any>) {
    const sym = String(item.stockSymbol || item.indexId || item.sym || '').toUpperCase().trim();
    if (!sym) return;

    const isIdx = ALL_INDEX_SYMBOLS.has(sym);
    const div = isIdx ? 1 : 1000;
    const rawLast = item.matchedPrice ?? item.indexValue ?? item.lastPrice ?? item.c;
    const rawRef = item.refPrice ?? item.prevIndexValue ?? item.r;
    const rawVol = item.nmTotalTradedQty ?? item.totalVolume ?? item.v;
    if (rawLast === null || rawLast === undefined) return;

    const lastF = Number(rawLast);
    if (!Number.isFinite(lastF)) return;
    const lastVal = lastF >= 500 && !isIdx ? lastF / div : lastF;
    if (isIdx && lastVal < 50) return;

    let refVal: number | null = null;
    if (rawRef !== null && rawRef !== undefined && Number.isFinite(Number(rawRef))) {
      const refF = Number(rawRef);
      refVal = refF >= 500 && !isIdx ? refF / div : refF;
      if (isIdx && refVal < 50) refVal = null;
    }

    const prev = this.liveTicks.get(sym);
    if (refVal === null) refVal = prev?.ref ?? null;
    const delta = refVal && refVal > 0 ? lastVal - refVal : 0;
    const pct = refVal && refVal > 0 ? (delta / refVal) * 100 : 0;
    const parts = vnNowParts();

    const tick: LiveTick = {
      symbol: sym,
      last: lastVal,
      ref: refVal,
      delta,
      pct,
      volume: rawVol !== null && rawVol !== undefined && Number.isFinite(Number(rawVol))
        ? Number(rawVol)
        : prev?.volume ?? 0,
      time: parts.hms,
    };

    if (parts.dateStr !== this.barDate) {
      this.minuteBars.clear();
      this.barDate = parts.dateStr;
    }

    const minuteKey = `${parts.dateStr} ${parts.hm}`;
    const minuteUnix = Math.floor(Date.now() / 60_000) * 60;
    const targets = new Set([sym, ...(WS_INDEX_CANONICAL_MIRROR[sym] || [])]);

    for (const tSym of targets) {
      this.liveTicks.set(tSym, { ...tick, symbol: tSym });
      const existingBoard = this.liveBoard.get(tSym);
      if (existingBoard) {
        this.liveBoard.set(tSym, {
          ...existingBoard,
          last: tick.last,
          delta: tick.delta,
          pct: tick.pct,
          volume: tick.volume > 0 ? tick.volume : existingBoard.volume,
          time: tick.time,
        });
      }

      let barsMap = this.minuteBars.get(tSym);
      if (!barsMap) {
        barsMap = new Map();
        this.minuteBars.set(tSym, barsMap);
      }
      const existingBar = barsMap.get(minuteKey);
      if (existingBar) {
        existingBar.high = Math.max(existingBar.high, tick.last);
        existingBar.low = Math.min(existingBar.low, tick.last);
        existingBar.close = tick.last;
        if (tick.volume > 0) existingBar.volume = tick.volume;
      } else {
        barsMap.set(minuteKey, {
          t: minuteUnix,
          date: parts.dateStr,
          time: parts.hm,
          datetime: minuteKey,
          open: tick.last,
          high: tick.last,
          low: tick.last,
          close: tick.last,
          volume: tick.volume,
        });
      }
    }
  }

  async refreshBoardNow(): Promise<Record<string, LiveTick>> {
    const board = await fetchSsiRealtimeBoard('hose');
    if (Object.keys(board).length > 0) {
      this.boardUpdatedAt = vnNowParts().hms;
      this.liveBoard.clear();
      for (const [sym, item] of Object.entries(board)) {
        this.liveBoard.set(sym, item);
        this.liveTicks.set(sym, { ...item });
      }
    }
    return this.getLiveBoard();
  }

  async refreshIndicesNow(symbols?: string[]): Promise<void> {
    const targetSyms = symbols && symbols.length ? symbols : ALL_MAIN_INDICES;
    const today = vnTodayStr();
    const start1m = addDaysToDateStr(today, -6);
    const startD = addDaysToDateStr(today, -25);

    await Promise.all(
      targetSyms.map(async (sym) => {
        try {
          const [bars1m, barsD] = await Promise.all([
            fetchSsiOhlcv(sym, start1m, today, '1'),
            fetchSsiOhlcv(sym, startD, today, 'D'),
          ]);
          if (bars1m.length || barsD.length) {
            this.indexCache.set(sym.toUpperCase(), {
              bars1m,
              barsD,
              updatedAt: vnNowParts().hms,
            });
          }
        } catch {
          // ignore
        }
      })
    );
  }

  async ensureIndicesLoaded(symbols: string[]): Promise<void> {
    const missing = symbols.filter((s) => !this.indexCache.has(s.toUpperCase()));
    if (missing.length) {
      await this.refreshIndicesNow(missing);
    }
  }

  private schedulePoll(delayMs: number) {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      try {
        await this.refreshBoardNow();
        if (this.pollCycle === 0 || this.pollCycle % 3 === 0) {
          await this.refreshIndicesNow(ALL_MAIN_INDICES);
        }
      } catch {
        // ignore background sync failures
      }
      this.pollCycle += 1;
      const nextDelay = isVnMarketHours() ? 5_000 : 30_000;
      this.schedulePoll(nextDelay);
    }, delayMs);
  }

  getLiveBoard(): Record<string, LiveTick> {
    const out: Record<string, LiveTick> = {};
    for (const [k, v] of this.liveBoard.entries()) {
      out[k] = { ...v };
    }
    return out;
  }

  getIndexData(symbol: string): { bars1m: OhlcvBar[]; barsD: OhlcvBar[] } {
    const hit = this.indexCache.get(symbol.toUpperCase().trim());
    if (!hit) return { bars1m: [], barsD: [] };
    return {
      bars1m: hit.bars1m.map((b) => ({ ...b })),
      barsD: hit.barsD.map((b) => ({ ...b })),
    };
  }

  getSnapshot(symbols?: string[]): Record<string, LiveTick> {
    const out: Record<string, LiveTick> = {};
    if (!symbols) {
      for (const [k, v] of this.liveTicks.entries()) out[k] = { ...v };
      return out;
    }
    for (const s of symbols) {
      const u = s.toUpperCase().trim();
      const v = this.liveTicks.get(u);
      if (v) out[u] = { ...v };
    }
    return out;
  }

  getMinuteBars(symbol: string): OhlcvBar[] {
    const symU = symbol.toUpperCase().trim();
    if (this.barDate !== vnTodayStr()) return [];
    const map = this.minuteBars.get(symU);
    if (!map) return [];
    return [...map.values()].sort((a, b) => a.t - b.t).map((b) => ({ ...b }));
  }
}

let singletonWsMgr: SSIWebSocketManager | null = null;

export function getSsiWsManager(): SSIWebSocketManager {
  if (!singletonWsMgr) {
    singletonWsMgr = new SSIWebSocketManager();
    const hoseSyms = Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)
      .filter(([, ind]) => ind !== 'Chỉ số')
      .map(([s]) => s);
    singletonWsMgr.start([...ALL_MAIN_INDICES, ...hoseSyms]);
  }
  return singletonWsMgr;
}
