import WebSocket from 'ws';
import {
  ALL_MAIN_INDICES,
  HARDCODED_HOSE_INDUSTRIES_MAPPING,
  INDEX_SYMBOLS,
} from '../src/shared/constants.ts';
import {
  buildIndustryMapFromCatalog,
  classifySsiStock,
  selectCatalogSymbols,
  type ClassifiedStockMeta,
} from './ssiClassifier.ts';
import { parseSsiPipeTick } from './ssiPipeParser.ts';

export { buildIndustryMapFromCatalog, selectCatalogSymbols };

export type DataSource = 'SSI' | 'VNDirect' | 'Fallback';

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

export interface OhlcvFetchResult {
  bars: OhlcvBar[];
  source: 'SSI' | 'VNDirect';
}

export interface LiveTick {
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
  fBuyVol?: number;
  fBuyValBil?: number;
  fSellVol?: number;
  fSellValBil?: number;
  fCurrentRoom?: number;
}

export type StockMeta = ClassifiedStockMeta;

export interface FullStockCatalog {
  stocks: Record<string, StockMeta>;
  list: StockMeta[];
  counts: {
    HOSE: number;
    HNX: number;
    UPCOM: number;
    INDEX: number;
    total: number;
  };
  industries: string[];
  source: DataSource;
  classificationStandard: string;
}

export interface ExchangeBoardResult {
  board: Record<string, LiveTick>;
  exchange: 'HOSE' | 'HNX' | 'UPCOM';
  tradeDate: string;
  mode: 'live' | 'eod';
  source: 'SSI' | 'VNDirect';
  syncTime: string;
}

export interface IndexSessionStat {
  symbol: string;
  date: string;
  time: string;
  close: number;
  change: number;
  pctChange: number;
  totalValBil: number;
  nmValBil: number;
  ptValBil: number;
  totalVolMil: number;
  nmVolMil: number;
  ptVolMil: number;
  advances: number;
  declines: number;
  noChange: number;
  ceilingStocks: number;
  floorStocks: number;
}

export interface ForeignRecord {
  code: string;
  floor: 'HOSE' | 'HNX' | 'UPCOM';
  tradingDate: string;
  buyValBil: number;
  sellValBil: number;
  netValBil: number;
  buyVol: number;
  sellVol: number;
  netVol: number;
  totalRoom: number;
  currentRoom: number;
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
  const utcMs =
    Date.UTC(
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

// IMPORTANT: Do NOT pass Accept: application/json to dchart-api.vndirect.com.vn (returns HTTP 406).
const VNDIRECT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

export const ALL_INDEX_SYMBOLS = new Set<string>([
  ...INDEX_SYMBOLS,
  'VNINDEX',
  'VN30',
  'HNX',
  'UPCOM',
  'VNMID',
  'VNSML',
  'VNSMALL',
  'HNXINDEX',
  'HNXUPCOMINDEX',
  'VNMIDCAP',
  'VNSMALLCAP',
  'VN100',
  'VNALL',
]);

const INDEX_LABELS: Record<string, string> = {
  VNINDEX: 'Chỉ số VN-Index (HOSE)',
  VN30: 'Chỉ số VN30 (Top 30 HOSE)',
  HNX: 'Chỉ số HNX-Index (Sàn Hà Nội)',
  UPCOM: 'Chỉ số UPCoM-Index',
  VNMID: 'Chỉ số VNMidcap (Vốn hóa vừa)',
  VNSMALL: 'Chỉ số VNSmallcap (Vốn hóa nhỏ)',
};

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
  VNMIDCAP: 'VNMID',
  VNSMALL: 'VNSML',
  VNSML: 'VNSML',
  VNSMALLCAP: 'VNSML',
  VN100: 'VN100',
  VNALL: 'VNALL',
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

// Circuit breaker for SSI REST WAF (HTTP 403 / HTML response) -> 2 minute cooldown
const SSI_BLOCK_COOLDOWN_MS = 120_000;
let ssiRestBlockedUntil = 0;

export function isSsiRestBlocked(): boolean {
  return Date.now() < ssiRestBlockedUntil;
}

function markSsiRestBlocked() {
  ssiRestBlockedUntil = Date.now() + SSI_BLOCK_COOLDOWN_MS;
}

interface HttpJsonResult {
  ok: boolean;
  status: number;
  data: any | null;
  blocked: boolean;
}

async function fetchJsonDetailed(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<HttpJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, status: resp.status, data: null, blocked: true };
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, data: null, blocked: false };
    }
    if (contentType.includes('text/html')) {
      return { ok: false, status: resp.status, data: null, blocked: true };
    }
    const text = await resp.text();
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('<')) {
      return { ok: false, status: resp.status, data: null, blocked: true };
    }
    const data = JSON.parse(trimmed);
    return { ok: true, status: resp.status, data, blocked: false };
  } catch {
    return { ok: false, status: 0, data: null, blocked: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSsiJson(url: string, timeoutMs = 10000): Promise<any | null> {
  if (isSsiRestBlocked()) return null;
  const res = await fetchJsonDetailed(url, SSI_HEADERS, timeoutMs);
  if (res.blocked) {
    markSsiRestBlocked();
    return null;
  }
  return res.ok ? res.data : null;
}

async function fetchVndirectJson(url: string, timeoutMs = 12000): Promise<any | null> {
  const res = await fetchJsonDetailed(url, VNDIRECT_HEADERS, timeoutMs);
  if (res.ok) return res.data;
  if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const retry = await fetchJsonDetailed(url, VNDIRECT_HEADERS, timeoutMs);
    return retry.ok ? retry.data : null;
  }
  return null;
}

function toThousandVnd(val: unknown): number {
  const v = Number(val ?? 0);
  if (!Number.isFinite(v)) return 0;
  return v >= 500 ? v / 1000 : v;
}

function isValidStockCode(sym: string): boolean {
  return sym.length === 3 && /^[A-Z0-9]{3}$/.test(sym);
}

// ==============================================================================
// 1. FULL 3-EXCHANGE STOCK CATALOG (HOSE + HNX + UPCOM + MAIN INDICES)
// ==============================================================================
let fullCatalogCache: { ts: number; ttl: number; data: FullStockCatalog } | null = null;
let fullCatalogInflight: Promise<FullStockCatalog> | null = null;
const CATALOG_CACHE_TTL = 3600_000;
const CATALOG_PARTIAL_TTL = 15_000;

async function fetchVndirectIndustryMap(): Promise<
  Record<string, { icbCode: string; industryName: string }>
> {
  const map: Record<string, { icbCode: string; industryName: string }> = {};
  const payload = await fetchVndirectJson(
    'https://api-finfo.vndirect.com.vn/v4/industry_classification?q=industryLevel:2&size=100',
    12000
  );
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of items) {
    const icbCode = String(item?.industryCode || '').trim();
    const indName = String(item?.vietnameseName || '').trim();
    const codesRaw = String(item?.codeList || '');
    if (!indName || !codesRaw) continue;
    for (const rawCode of codesRaw.split(',')) {
      const sym = rawCode.trim().toUpperCase();
      if (isValidStockCode(sym) && !map[sym]) {
        map[sym] = { icbCode, industryName: indName };
      }
    }
  }
  return map;
}

export async function fetchFullStockCatalog(forceRefresh = false): Promise<FullStockCatalog> {
  const now = Date.now();
  if (!forceRefresh && fullCatalogCache && now - fullCatalogCache.ts < fullCatalogCache.ttl) {
    return fullCatalogCache.data;
  }
  if (!forceRefresh && fullCatalogInflight) {
    return fullCatalogInflight;
  }

  const run = async (): Promise<FullStockCatalog> => {
    const stockDict: Record<string, StockMeta> = {};
    let source: DataSource = 'Fallback';

    // 1. Primary: SSI Official Exchange API (HOSE + HNX + UPCOM) with automatic SSI ICB classification
    if (!isSsiRestBlocked()) {
      const exchanges: ('HOSE' | 'HNX' | 'UPCOM')[] = ['HOSE', 'HNX', 'UPCOM'];
      const ssiPayloads = await Promise.all(
        exchanges.map((ex) =>
          fetchSsiJson(`https://iboard-query.ssi.com.vn/stock/exchange/${ex.toLowerCase()}`, 8000)
        )
      );

      let ssiCount = 0;
      ssiPayloads.forEach((payload, idx) => {
        const ex = exchanges[idx];
        const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
        for (const item of items) {
          const sym = String(item?.stockSymbol || item?.code || '').trim().toUpperCase();
          const classified = classifySsiStock({
            symbol: sym,
            companyName: String(item?.companyNameVi || item?.companyNameEn || sym).trim(),
            exchange: ex,
            icbCode: item?.icbCode || item?.subSectorCode || item?.sectorCode || null,
            industryName: item?.industryName || item?.sectorName || null,
            refPrice: toThousandVnd(item?.refPrice),
            ceiling: toThousandVnd(item?.ceiling),
            floor: toThousandVnd(item?.floor),
          });
          if (!classified) continue;
          stockDict[classified.symbol] = classified;
          ssiCount++;
        }
      });

      if (ssiCount > 100) {
        source = 'SSI';
      }
    }

    // 2. Fallback when SSI REST is WAF-blocked (403): VNDirect 3-exchange list classified into the exact same SSI ICB Level-2 standard
    if (Object.keys(stockDict).length < 500) {
      const [allStocksPayload, vndIndustryMap] = await Promise.all([
        fetchVndirectJson(
          'https://api-finfo.vndirect.com.vn/v4/stocks?q=type:STOCK~status:LISTED~floor:HOSE,HNX,UPCOM&size=2500',
          15000
        ),
        fetchVndirectIndustryMap(),
      ]);

      let items: any[] = Array.isArray(allStocksPayload?.data) ? allStocksPayload.data : [];
      if (items.length < 500) {
        const floors: ('HOSE' | 'HNX' | 'UPCOM')[] = ['HOSE', 'HNX', 'UPCOM'];
        items = [];
        for (const fl of floors) {
          const pl = await fetchVndirectJson(
            `https://api-finfo.vndirect.com.vn/v4/stocks?q=type:STOCK~status:LISTED~floor:${fl}&size=${
              fl === 'UPCOM' ? 2000 : 1000
            }`,
            12000
          );
          if (Array.isArray(pl?.data)) items.push(...pl.data);
        }
      }

      let vndCount = 0;
      for (const item of items) {
        const sym = String(item?.code || '').trim().toUpperCase();
        const rawFloor = String(item?.floor || '').trim().toUpperCase();
        const indInfo = vndIndustryMap[sym];
        const existing = stockDict[sym];
        const classified = classifySsiStock({
          symbol: sym,
          companyName: String(
            item?.companyName || item?.shortName || item?.companyNameEng || sym
          ).trim(),
          exchange: rawFloor,
          icbCode: indInfo?.icbCode || existing?.icbCode || null,
          industryName: indInfo?.industryName || existing?.industry || null,
          refPrice: existing?.refPrice ?? 0,
          ceiling: existing?.ceiling ?? 0,
          floor: existing?.floor ?? 0,
        });
        if (!classified) continue;
        stockDict[classified.symbol] = classified;
        vndCount++;
      }

      if (vndCount > 100) {
        source = 'VNDirect';
      }
    }

    // 3. Emergency offline fallback ONLY if both SSI & VNDirect are unreachable
    if (Object.keys(stockDict).length < 100) {
      for (const [sym, legacyInd] of Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)) {
        if (legacyInd === 'Chỉ số') continue;
        const classified = classifySsiStock({
          symbol: sym,
          companyName: sym,
          exchange: 'HOSE',
          industryName: legacyInd === 'Penny' ? null : legacyInd,
        });
        if (classified && !stockDict[classified.symbol]) {
          stockDict[classified.symbol] = classified;
        }
      }
    }

    // 4. Add main market indices
    for (const idxSym of ALL_MAIN_INDICES) {
      stockDict[idxSym] = {
        symbol: idxSym,
        companyName: INDEX_LABELS[idxSym] || `Chỉ số ${idxSym}`,
        industry: 'Chỉ số',
        icbCode: 'INDEX',
        exchange: 'INDEX',
        refPrice: 0,
        ceiling: 0,
        floor: 0,
        isIndex: true,
        isPenny: false,
      };
    }

    const counts = { HOSE: 0, HNX: 0, UPCOM: 0, INDEX: 0, total: 0 };
    const indSet = new Set<string>();
    for (const item of Object.values(stockDict)) {
      counts[item.exchange] += 1;
      if (item.exchange !== 'INDEX') {
        counts.total += 1;
      }
      if (item.industry && item.industry !== 'Chỉ số' && item.industry !== 'Penny') {
        indSet.add(item.industry);
      }
    }

    const sortedIndustries = [...indSet].sort((a, b) => a.localeCompare(b, 'vi'));
    const industries = ['Tất cả ngành', 'Chỉ số', ...sortedIndustries, 'Penny'];

    const exchangeOrder: Record<StockMeta['exchange'], number> = {
      INDEX: 0,
      HOSE: 1,
      HNX: 2,
      UPCOM: 3,
    };
    const list = Object.values(stockDict).sort((a, b) => {
      if (a.exchange !== b.exchange) return exchangeOrder[a.exchange] - exchangeOrder[b.exchange];
      return a.symbol.localeCompare(b.symbol);
    });

    const catalog: FullStockCatalog = {
      stocks: stockDict,
      list,
      counts,
      industries,
      source,
      classificationStandard: 'SSI ICB Level-2',
    };

    const isComplete = counts.HOSE > 100 && counts.HNX > 50 && counts.UPCOM > 100;
    fullCatalogCache = {
      ts: Date.now(),
      ttl: isComplete ? CATALOG_CACHE_TTL : CATALOG_PARTIAL_TTL,
      data: catalog,
    };
    return catalog;
  };

  fullCatalogInflight = run().finally(() => {
    fullCatalogInflight = null;
  });
  return fullCatalogInflight;
}

export async function fetchSsiStockList(exchange = 'hose'): Promise<Record<string, StockMeta>> {
  const catalog = await fetchFullStockCatalog();
  const target = exchange.toUpperCase();
  if (target === 'ALL') return catalog.stocks;
  const filtered: Record<string, StockMeta> = {};
  for (const [sym, meta] of Object.entries(catalog.stocks)) {
    if (meta.exchange === target) {
      filtered[sym] = meta;
    }
  }
  return filtered;
}

// ==============================================================================
// 2. REALTIME & EOD EXCHANGE BOARD (SSI PRIMARY -> VNDIRECT EOD FALLBACK)
// ==============================================================================
export async function fetchSsiRealtimeBoard(exchange = 'hose'): Promise<Record<string, LiveTick>> {
  const url = `https://iboard-query.ssi.com.vn/stock/exchange/${exchange.toLowerCase()}`;
  const board: Record<string, LiveTick> = {};
  const payload = await fetchSsiJson(url, 8000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
  if (!items.length) return board;

  const tsStr = vnNowParts().hms;

  for (const item of items) {
    const sym = String(item?.stockSymbol || item?.code || '').trim().toUpperCase();
    if (!isValidStockCode(sym)) continue;

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

const eodBoardCache = new Map<string, { ts: number; data: ExchangeBoardResult }>();
const EOD_BOARD_CACHE_TTL = 300_000;

export async function fetchVndirectEodBoard(
  exchange: 'HOSE' | 'HNX' | 'UPCOM',
  targetDate: string
): Promise<ExchangeBoardResult> {
  const ex = exchange.toUpperCase() as 'HOSE' | 'HNX' | 'UPCOM';
  const latestPayload = await fetchVndirectJson(
    `https://api-finfo.vndirect.com.vn/v4/stock_prices?sort=date:desc&q=floor:${ex}~date:lte:${encodeURIComponent(
      targetDate
    )}&size=1`,
    12000
  );
  const latestItem = Array.isArray(latestPayload?.data) ? latestPayload.data[0] : null;
  const tradeDate = String(latestItem?.date || targetDate);

  const board: Record<string, LiveTick> = {};
  if (!latestItem) {
    return {
      board,
      exchange: ex,
      tradeDate,
      mode: 'eod',
      source: 'VNDirect',
      syncTime: tradeDate,
    };
  }

  const pageSize = ex === 'UPCOM' ? 1500 : 1000;
  const dayPayload = await fetchVndirectJson(
    `https://api-finfo.vndirect.com.vn/v4/stock_prices?q=floor:${ex}~date:${encodeURIComponent(
      tradeDate
    )}&size=${pageSize}`,
    15000
  );
  const items: any[] = Array.isArray(dayPayload?.data) ? dayPayload.data : [];

  for (const item of items) {
    const sym = String(item?.code || '').trim().toUpperCase();
    if (!isValidStockCode(sym)) continue;

    const ref = Number(item?.basicPrice ?? 0);
    let last = Number(item?.close ?? 0);
    if (!Number.isFinite(last) || last <= 0) last = Number.isFinite(ref) ? ref : 0;

    const nmVol = Number(item?.nmVolume ?? 0);
    const ptVol = Number(item?.ptVolume ?? 0);
    const vol = Number.isFinite(nmVol) && nmVol > 0 ? nmVol : Number.isFinite(ptVol) ? ptVol : 0;

    const nmVal = Number(item?.nmValue ?? 0);
    const ptVal = Number(item?.ptValue ?? 0);
    const rawVal = Number.isFinite(nmVal) && nmVal > 0 ? nmVal : Number.isFinite(ptVal) ? ptVal : 0;
    const valueBil = rawVal > 0 ? rawVal / 1e9 : (last * vol) / 1e6;

    const deltaRaw = Number(item?.change);
    const delta = Number.isFinite(deltaRaw) ? deltaRaw : ref > 0 ? last - ref : 0;
    const pctRaw = Number(item?.pctChange);
    const pct = Number.isFinite(pctRaw) ? pctRaw : ref > 0 ? (delta / ref) * 100 : 0;

    board[sym] = {
      symbol: sym,
      last,
      ref: Number.isFinite(ref) ? ref : null,
      delta,
      pct,
      volume: vol,
      value_bil: valueBil,
      time: String(item?.time || tradeDate),
    };
  }

  return {
    board,
    exchange: ex,
    tradeDate,
    mode: 'eod',
    source: 'VNDirect',
    syncTime: tradeDate,
  };
}

export async function fetchExchangeBoardWithFallback(
  exchange: 'HOSE' | 'HNX' | 'UPCOM',
  targetDate: string,
  forceRefresh = false
): Promise<ExchangeBoardResult> {
  const ex = exchange.toUpperCase() as 'HOSE' | 'HNX' | 'UPCOM';
  const today = vnTodayStr();

  // Try SSI realtime board when viewing today and SSI REST isn't WAF-blocked
  if (targetDate === today && !isSsiRestBlocked()) {
    const ssiBoard = await fetchSsiRealtimeBoard(ex.toLowerCase());
    if (Object.keys(ssiBoard).length > 0) {
      return {
        board: ssiBoard,
        exchange: ex,
        tradeDate: today,
        mode: 'live',
        source: 'SSI',
        syncTime: vnNowParts().hms,
      };
    }
  }

  const cacheKey = `${ex}|${targetDate}`;
  const now = Date.now();
  if (!forceRefresh) {
    const cached = eodBoardCache.get(cacheKey);
    if (cached && now - cached.ts < EOD_BOARD_CACHE_TTL) {
      return cached.data;
    }
  }

  const eodRes = await fetchVndirectEodBoard(ex, targetDate);
  if (Object.keys(eodRes.board).length > 0) {
    eodBoardCache.set(cacheKey, { ts: now, data: eodRes });
  }
  return eodRes;
}

const indexStatsCache = new Map<string, { ts: number; data: Record<string, IndexSessionStat[]> }>();
const INDEX_STATS_CACHE_TTL = 45_000;

/**
 * Fetches recent trading session statistics (total value, matched value, put-through value,
 * volumes, market breadth) for VNINDEX, VN30, HNX, UPCOM, VNMID, VNSMALL via VNDirect vnmarket_prices.
 * Returns sessions sorted descending by date (index 0 = latest <= targetDate, index 1 = previous session).
 */
export async function fetchIndexMarketStats(
  targetDate: string,
  forceRefresh = false
): Promise<Record<string, IndexSessionStat[]>> {
  const now = Date.now();
  const key = targetDate;
  if (!forceRefresh) {
    const cached = indexStatsCache.get(key);
    if (cached && now - cached.ts < INDEX_STATS_CACHE_TTL) {
      return cached.data;
    }
  }

  const url = `https://api-finfo.vndirect.com.vn/v4/vnmarket_prices?sort=date:desc&q=code:VNINDEX,VN30,HNX,UPCOM,VNMID,VNSML~date:lte:${encodeURIComponent(
    targetDate
  )}&size=48`;
  const payload = await fetchVndirectJson(url, 12000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];

  const grouped: Record<string, IndexSessionStat[]> = {};
  const seen = new Set<string>();

  for (const item of items) {
    const rawCode = String(item?.code || '').trim().toUpperCase();
    const date = String(item?.date || '').trim();
    if (!rawCode || !date) continue;
    const sym = rawCode === 'VNSML' ? 'VNSMALL' : rawCode;
    const dedupKey = `${sym}|${date}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const nmVal = Number(item?.nmValue ?? 0);
    const ptVal = Number(item?.ptValue ?? 0);
    const accVal = Number(item?.accumulatedVal ?? 0);
    const totalValVnd = Number.isFinite(accVal) && accVal > 0 ? accVal : (nmVal || 0) + (ptVal || 0);

    const nmVol = Number(item?.nmVolume ?? 0);
    const ptVol = Number(item?.ptVolume ?? 0);
    const accVol = Number(item?.accumulatedVol ?? 0);
    const totalVol = Number.isFinite(accVol) && accVol > 0 ? accVol : (nmVol || 0) + (ptVol || 0);

    const stat: IndexSessionStat = {
      symbol: sym,
      date,
      time: String(item?.time || ''),
      close: Number(item?.close ?? 0),
      change: Number(item?.change ?? 0),
      pctChange: Number(item?.pctChange ?? 0),
      totalValBil: Number((totalValVnd / 1e9).toFixed(2)),
      nmValBil: Number(((Number.isFinite(nmVal) ? nmVal : 0) / 1e9).toFixed(2)),
      ptValBil: Number(((Number.isFinite(ptVal) ? ptVal : 0) / 1e9).toFixed(2)),
      totalVolMil: Number((totalVol / 1e6).toFixed(2)),
      nmVolMil: Number(((Number.isFinite(nmVol) ? nmVol : 0) / 1e6).toFixed(2)),
      ptVolMil: Number(((Number.isFinite(ptVol) ? ptVol : 0) / 1e6).toFixed(2)),
      advances: Number(item?.advances ?? 0),
      declines: Number(item?.declines ?? 0),
      noChange: Number(item?.noChange ?? 0),
      ceilingStocks: Number(item?.ceilingStocks ?? 0),
      floorStocks: Number(item?.floorStocks ?? 0),
    };

    if (!grouped[sym]) grouped[sym] = [];
    grouped[sym].push(stat);
    if (sym === 'VNSMALL') {
      if (!grouped.VNSML) grouped.VNSML = [];
      grouped.VNSML.push({ ...stat, symbol: 'VNSML' });
    }
  }

  for (const list of Object.values(grouped)) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }

  if (Object.keys(grouped).length > 0) {
    if (indexStatsCache.size > 30) {
      const firstKey = indexStatsCache.keys().next().value;
      if (firstKey) indexStatsCache.delete(firstKey);
    }
    indexStatsCache.set(key, { ts: now, data: grouped });
  }

  return grouped;
}

// ==============================================================================
// 2.6 FOREIGN TRADING DATA (VNDIRECT FINFO + LIVE SSI WS OVERLAY)
// ==============================================================================
const foreignIdxCache = new Map<string, { ts: number; data: ForeignRecord[] }>();
const foreignStocksCache = new Map<string, { ts: number; data: ForeignRecord[] }>();
const FOREIGN_CACHE_TTL = 45_000;

function parseForeignRecord(item: any): ForeignRecord | null {
  const code = String(item?.code || '').trim().toUpperCase();
  const tradingDate = String(item?.tradingDate || '').trim();
  if (!code || !tradingDate) return null;
  const rawFloor = String(item?.floor || '').trim().toUpperCase();
  const floor: 'HOSE' | 'HNX' | 'UPCOM' =
    rawFloor === 'HNX' ? 'HNX' : rawFloor === 'UPCOM' ? 'UPCOM' : 'HOSE';

  const buyValVnd = Number(item?.buyVal ?? 0);
  const sellValVnd = Number(item?.sellVal ?? 0);
  const netValVnd = Number(item?.netVal ?? buyValVnd - sellValVnd);
  const buyVol = Math.round(Number(item?.buyVol ?? 0) || 0);
  const sellVol = Math.round(Number(item?.sellVol ?? 0) || 0);
  const netVol = Math.round(Number(item?.netVol ?? buyVol - sellVol) || 0);
  const totalRoom = Math.round(Number(item?.totalRoom ?? 0) || 0);
  const currentRoom = Math.round(Number(item?.currentRoom ?? 0) || 0);

  return {
    code,
    floor,
    tradingDate,
    buyValBil: Number(((Number.isFinite(buyValVnd) ? buyValVnd : 0) / 1e9).toFixed(4)),
    sellValBil: Number(((Number.isFinite(sellValVnd) ? sellValVnd : 0) / 1e9).toFixed(4)),
    netValBil: Number(((Number.isFinite(netValVnd) ? netValVnd : 0) / 1e9).toFixed(4)),
    buyVol,
    sellVol,
    netVol,
    totalRoom,
    currentRoom,
  };
}

export async function fetchForeignIndexHistory(
  targetDate: string,
  maxSessions = 30,
  forceRefresh = false
): Promise<ForeignRecord[]> {
  const now = Date.now();
  const safeSessions = Math.max(5, Math.min(60, maxSessions));
  const key = `${targetDate}|${safeSessions}`;
  if (!forceRefresh) {
    const cached = foreignIdxCache.get(key);
    if (cached && now - cached.ts < FOREIGN_CACHE_TTL) {
      return cached.data;
    }
  }

  const size = safeSessions * 3 + 15;
  const url = `https://api-finfo.vndirect.com.vn/v4/foreigns?sort=tradingDate:desc&size=${size}&q=code:VNINDEX,HNX,UPCOM~tradingDate:lte:${encodeURIComponent(
    targetDate
  )}`;
  const payload = await fetchVndirectJson(url, 12000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];

  const seen = new Set<string>();
  const rows: ForeignRecord[] = [];
  for (const item of items) {
    const rec = parseForeignRecord(item);
    if (!rec) continue;
    const dk = `${rec.code}|${rec.tradingDate}`;
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push(rec);
  }

  if (rows.length > 0) {
    if (foreignIdxCache.size > 20) {
      const firstKey = foreignIdxCache.keys().next().value;
      if (firstKey) foreignIdxCache.delete(firstKey);
    }
    foreignIdxCache.set(key, { ts: now, data: rows });
  }
  return rows;
}

export async function fetchForeignStocksByDate(
  tradingDate: string,
  forceRefresh = false
): Promise<ForeignRecord[]> {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = foreignStocksCache.get(tradingDate);
    if (cached && now - cached.ts < FOREIGN_CACHE_TTL) {
      return cached.data;
    }
  }

  const url = `https://api-finfo.vndirect.com.vn/v4/foreigns?sort=netVal:desc&size=2200&q=type:STOCK~floor:HOSE,HNX,UPCOM~tradingDate:${encodeURIComponent(
    tradingDate
  )}`;
  const payload = await fetchVndirectJson(url, 14000);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];

  const seen = new Set<string>();
  const rows: ForeignRecord[] = [];
  for (const item of items) {
    const rec = parseForeignRecord(item);
    if (!rec) continue;
    if (seen.has(rec.code)) continue;
    seen.add(rec.code);
    rows.push(rec);
  }

  if (rows.length > 0) {
    if (foreignStocksCache.size > 20) {
      const firstKey = foreignStocksCache.keys().next().value;
      if (firstKey) foreignStocksCache.delete(firstKey);
    }
    foreignStocksCache.set(tradingDate, { ts: now, data: rows });
  }
  return rows;
}

// ==============================================================================
// 3. OHLCV FETCHING (SSI PRIMARY -> UNIVERSAL VNDIRECT FALLBACK)
// ==============================================================================
function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function parseTvPayload(data: any, symbol: string, alreadyInThousands = false): OhlcvBar[] {
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
  } else if (!alreadyInThousands && medClose > 1000) {
    for (const b of bars) {
      b.open /= 1000;
      b.high /= 1000;
      b.low /= 1000;
      b.close /= 1000;
    }
  } else if (alreadyInThousands && medClose > 2500) {
    // Safety guard if any endpoint returns raw VND for a stock
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
  const vndSym = VNDIRECT_INDEX_MAP[symU] || symU;
  const url = `https://dchart-api.vndirect.com.vn/dchart/history?symbol=${encodeURIComponent(
    vndSym
  )}&resolution=${encodeURIComponent(resolution)}&from=${tFrom}&to=${tTo}`;
  const json = await fetchVndirectJson(url, 12000);
  if (!json) return [];
  return parseTvPayload(json, symU, true);
}

const singleCache = new Map<string, { ts: number; data: OhlcvFetchResult }>();
const SINGLE_CACHE_TTL = 60_000;

export async function fetchOhlcvWithMeta(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D'
): Promise<OhlcvFetchResult> {
  const symU = symbol.toUpperCase().trim();
  const tFrom = dateStrToVnUnix(startDate, false);
  const tTo = dateStrToVnUnix(endDate, true);

  // Fast path: VNDirect-first indices or SSI REST circuit-breaker open
  if (VNDIRECT_FIRST_INDICES.has(symU) || isSsiRestBlocked()) {
    const vnd = await fetchVndirectOhlcv(symU, resolution, tFrom, tTo);
    if (vnd.length) return { bars: vnd, source: 'VNDirect' };
    if (isSsiRestBlocked()) return { bars: [], source: 'VNDirect' };
  }

  // Primary path: SSI REST TradingView history
  let candidates = SSI_INDEX_ALIASES[symU] ? [...SSI_INDEX_ALIASES[symU]] : [symU];
  const resolved = resolvedSsiSymbol.get(symU);
  if (resolved) {
    candidates = [resolved, ...candidates.filter((c) => c !== resolved)];
  }

  for (const cand of candidates) {
    if (isSsiRestBlocked()) break;
    const url = `https://iboard-api.ssi.com.vn/statistics/charts/history?resolution=${encodeURIComponent(
      resolution
    )}&symbol=${encodeURIComponent(cand)}&from=${tFrom}&to=${tTo}`;
    const raw = await fetchSsiJson(url, 10000);
    if (raw) {
      const payload = raw.data ?? raw;
      const bars = parseTvPayload(payload, symU, false);
      if (bars.length) {
        resolvedSsiSymbol.set(symU, cand);
        return { bars, source: 'SSI' };
      }
    }
  }

  // Universal automatic fallback to VNDirect for ALL stocks & indices
  const vnd = await fetchVndirectOhlcv(symU, resolution, tFrom, tTo);
  return { bars: vnd, source: 'VNDirect' };
}

export async function fetchSsiOhlcv(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D'
): Promise<OhlcvBar[]> {
  const res = await fetchOhlcvWithMeta(symbol, startDate, endDate, resolution);
  return res.bars;
}

export async function fetchSsiOhlcvWithMetaCached(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D',
  forceRefresh = false
): Promise<OhlcvFetchResult> {
  const key = `${symbol.toUpperCase().trim()}|${startDate}|${endDate}|${resolution}`;
  const now = Date.now();
  if (!forceRefresh) {
    const hit = singleCache.get(key);
    if (hit && now - hit.ts < SINGLE_CACHE_TTL) {
      return {
        source: hit.data.source,
        bars: hit.data.bars.map((b) => ({ ...b })),
      };
    }
  }
  const res = await fetchOhlcvWithMeta(symbol, startDate, endDate, resolution);
  if (singleCache.size > 500) {
    const firstKey = singleCache.keys().next().value;
    if (firstKey) singleCache.delete(firstKey);
  }
  if (res.bars.length > 0) {
    singleCache.set(key, { ts: now, data: res });
  }
  return {
    source: res.source,
    bars: res.bars.map((b) => ({ ...b })),
  };
}

export async function fetchSsiOhlcvCached(
  symbol: string,
  startDate: string,
  endDate: string,
  resolution = 'D',
  forceRefresh = false
): Promise<OhlcvBar[]> {
  const res = await fetchSsiOhlcvWithMetaCached(
    symbol,
    startDate,
    endDate,
    resolution,
    forceRefresh
  );
  return res.bars;
}

// ==============================================================================
// 4. BATCH OHLCV FETCHER WITH CONCURRENCY & 15-MIN LRU CACHE
// ==============================================================================
const batchCache = new Map<string, { ts: number; data: Record<string, OhlcvBar[]> }>();
const BATCH_CACHE_TTL = 900_000;
const BATCH_CACHE_MAX = 8;

export function clearAllCaches() {
  batchCache.clear();
  singleCache.clear();
  eodBoardCache.clear();
  indexStatsCache.clear();
  foreignIdxCache.clear();
  foreignStocksCache.clear();
}

export async function fetchBatchOhlcvSsi(
  symbols: string[],
  startDate: string,
  endDate: string,
  resolution = 'D',
  maxWorkers = 20
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

  // Probe the first symbol if SSI block status is unknown so workers don't all hit 403 simultaneously
  const results: Record<string, OhlcvBar[]> = {};
  let cursor = 0;
  if (!isSsiRestBlocked() && uniqueSyms.length > 1) {
    const firstSym = uniqueSyms[0];
    cursor = 1;
    try {
      const firstBars = await fetchSsiOhlcv(firstSym, startDate, endDate, resolution);
      if (firstBars.length) results[firstSym] = firstBars;
    } catch {
      // ignore
    }
  }

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

  if (Object.keys(results).length > 0) {
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
  }

  const copy: Record<string, OhlcvBar[]> = {};
  for (const [k, v] of Object.entries(results)) {
    copy[k] = v.map((b) => ({ ...b }));
  }
  return copy;
}

// ==============================================================================
// 5. SSI WEBSOCKET + BACKGROUND SYNC MANAGER
// ==============================================================================
export class SSIWebSocketManager {
  private static readonly WS_URL = 'wss://iboard-pushstream.ssi.com.vn/realtime';

  private liveTicks = new Map<string, LiveTick>();
  private ssiWsTicks = new Map<string, LiveTick>();
  private prevCumVol = new Map<string, number>();
  private liveBoard = new Map<string, LiveTick>();
  private boardUpdatedAt: string | null = null;
  private boardSource: 'SSI' | 'VNDirect' = 'SSI';
  private boardTradeDate: string = vnTodayStr();
  private boardMode: 'live' | 'eod' = 'live';
  private indexCache = new Map<
    string,
    { bars1m: OhlcvBar[]; barsD: OhlcvBar[]; source: 'SSI' | 'VNDirect'; updatedAt: string }
  >();
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
  private tickListeners = new Set<(ticks: Record<string, LiveTick>) => void>();
  private syncListeners = new Set<
    (ev: { kind: 'board' | 'indices'; syncTime: string; source: 'SSI' | 'VNDirect' }) => void
  >();

  onTicks(cb: (ticks: Record<string, LiveTick>) => void): () => void {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
  }

  onSync(
    cb: (ev: { kind: 'board' | 'indices'; syncTime: string; source: 'SSI' | 'VNDirect' }) => void
  ): () => void {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }

  private emitTicks(ticks: Record<string, LiveTick>) {
    if (!Object.keys(ticks).length) return;
    for (const cb of this.tickListeners) {
      try {
        cb(ticks);
      } catch {
        // ignore listener errors
      }
    }
  }

  private emitSync(kind: 'board' | 'indices', syncTime: string, source: 'SSI' | 'VNDirect') {
    for (const cb of this.syncListeners) {
      try {
        cb({ kind, syncTime, source });
      } catch {
        // ignore listener errors
      }
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get lastUpdate(): string | null {
    return this.boardUpdatedAt || this.lastMsgTime;
  }

  get currentBoardMeta() {
    return {
      source: this.boardSource,
      tradeDate: this.boardTradeDate,
      mode: this.boardMode,
      updatedAt: this.boardUpdatedAt || vnNowParts().hms,
    };
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
    this.schedulePoll(1200);
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

        // Primary SSI stockRealtimeByListV2 wire format: pipe-delimited `MAIN|S#<SYM>|...`
        if (message.startsWith('MAIN|')) {
          const parsed = parseSsiPipeTick(message);
          if (parsed) {
            this.recordRealtimeTick(parsed);
          }
          return;
        }

        if (!message.startsWith('{')) return;
        try {
          const data = JSON.parse(message);
          if (data?.errors) return;
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

  private recordRealtimeTick(parsed: {
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
    fBuyVol?: number;
    fBuyValBil?: number;
    fSellVol?: number;
    fSellValBil?: number;
    fCurrentRoom?: number;
  }) {
    const sym = parsed.symbol;
    const parts = vnNowParts();

    if (parts.dateStr !== this.barDate) {
      this.minuteBars.clear();
      this.ssiWsTicks.clear();
      this.prevCumVol.clear();
      this.barDate = parts.dateStr;
    }

    const prevWs = this.ssiWsTicks.get(sym);
    const refVal = parsed.ref ?? prevWs?.ref ?? null;
    const prevVol = this.prevCumVol.get(sym);
    let deltaVol = 0;
    if (parsed.volume > 0) {
      if (prevVol !== undefined && parsed.volume >= prevVol) {
        deltaVol = parsed.volume - prevVol;
      } else if (parsed.lastVol && parsed.lastVol > 0) {
        deltaVol = parsed.lastVol;
      }
      this.prevCumVol.set(sym, parsed.volume);
    }

    const tick: LiveTick = {
      symbol: sym,
      exchange: parsed.exchange ?? prevWs?.exchange,
      last: parsed.last,
      open: parsed.open ?? prevWs?.open,
      high: parsed.high ?? (prevWs?.high ? Math.max(prevWs.high, parsed.last) : parsed.last),
      low: parsed.low ?? (prevWs?.low ? Math.min(prevWs.low, parsed.last) : parsed.last),
      ref: refVal,
      delta: parsed.delta,
      pct: parsed.pct,
      volume: parsed.volume > 0 ? parsed.volume : prevWs?.volume ?? 0,
      lastVol: parsed.lastVol,
      value_bil: parsed.value_bil ?? prevWs?.value_bil,
      fBuyVol: parsed.fBuyVol ?? prevWs?.fBuyVol,
      fBuyValBil: parsed.fBuyValBil ?? prevWs?.fBuyValBil,
      fSellVol: parsed.fSellVol ?? prevWs?.fSellVol,
      fSellValBil: parsed.fSellValBil ?? prevWs?.fSellValBil,
      fCurrentRoom: parsed.fCurrentRoom ?? prevWs?.fCurrentRoom,
      time: parts.hms,
      tradeDate: parts.dateStr,
      liveSource: 'SSI_WS',
    };

    const minuteKey = `${parts.dateStr} ${parts.hm}`;
    const minuteUnix = Math.floor(Date.now() / 60_000) * 60;
    const targets = new Set([sym, ...(WS_INDEX_CANONICAL_MIRROR[sym] || [])]);

    const emitted: Record<string, LiveTick> = {};
    for (const tSym of targets) {
      const mirroredTick: LiveTick = { ...tick, symbol: tSym };
      const prevAny = this.ssiWsTicks.get(tSym);
      this.ssiWsTicks.set(tSym, mirroredTick);
      this.liveTicks.set(tSym, mirroredTick);

      // Only broadcast when price, volume, pct, value, or foreign flow actually changed
      if (
        !prevAny ||
        prevAny.last !== mirroredTick.last ||
        prevAny.volume !== mirroredTick.volume ||
        prevAny.pct !== mirroredTick.pct ||
        prevAny.value_bil !== mirroredTick.value_bil ||
        prevAny.fBuyVol !== mirroredTick.fBuyVol ||
        prevAny.fSellVol !== mirroredTick.fSellVol ||
        prevAny.fBuyValBil !== mirroredTick.fBuyValBil ||
        prevAny.fSellValBil !== mirroredTick.fSellValBil
      ) {
        emitted[tSym] = mirroredTick;
      }

      const existingBoard = this.liveBoard.get(tSym);
      if (existingBoard) {
        this.liveBoard.set(tSym, {
          ...existingBoard,
          last: tick.last,
          open: tick.open ?? existingBoard.open,
          high: tick.high ?? existingBoard.high,
          low: tick.low ?? existingBoard.low,
          delta: tick.delta,
          pct: tick.pct,
          volume: tick.volume > 0 ? tick.volume : existingBoard.volume,
          value_bil: tick.value_bil ?? existingBoard.value_bil,
          fBuyVol: tick.fBuyVol ?? existingBoard.fBuyVol,
          fBuyValBil: tick.fBuyValBil ?? existingBoard.fBuyValBil,
          fSellVol: tick.fSellVol ?? existingBoard.fSellVol,
          fSellValBil: tick.fSellValBil ?? existingBoard.fSellValBil,
          fCurrentRoom: tick.fCurrentRoom ?? existingBoard.fCurrentRoom,
          time: tick.time,
          tradeDate: tick.tradeDate,
          liveSource: 'SSI_WS',
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
        if (deltaVol > 0) existingBar.volume += deltaVol;
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
          volume: deltaVol > 0 ? deltaVol : parsed.lastVol ?? 0,
        });
      }
    }

    if (Object.keys(emitted).length > 0) {
      this.emitTicks(emitted);
    }
  }

  private parseDictTick(item: Record<string, any>) {
    const sym = String(item.stockSymbol || item.indexId || item.sym || '').toUpperCase().trim();
    if (!sym) return;

    const isIdx = ALL_INDEX_SYMBOLS.has(sym);
    const div = isIdx ? 1 : 1000;
    const rawLast = item.matchedPrice ?? item.indexValue ?? item.lastPrice ?? item.c;
    const rawRef = item.refPrice ?? item.prevIndexValue ?? item.r;
    const rawVol = item.nmTotalTradedQty ?? item.allQty ?? item.totalVolume ?? item.v;
    const rawVal = item.allValue ?? item.totalValue ?? item.nmTotalTradedValue ?? item.value;
    if (rawLast === null || rawLast === undefined) return;

    const lastF = Number(rawLast);
    if (!Number.isFinite(lastF) || lastF <= 0) return;
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

    let valueBil = prev?.value_bil;
    if (rawVal !== null && rawVal !== undefined && Number.isFinite(Number(rawVal))) {
      const vf = Number(rawVal);
      if (vf > 0) {
        valueBil = vf > 1e6 ? vf / 1e9 : vf;
      }
    }

    this.recordRealtimeTick({
      symbol: sym,
      last: lastVal,
      ref: refVal,
      delta,
      pct,
      volume:
        rawVol !== null && rawVol !== undefined && Number.isFinite(Number(rawVol))
          ? Number(rawVol)
          : prev?.volume ?? 0,
      value_bil: valueBil,
    });
  }

  async refreshBoardNow(forceRefresh = false): Promise<Record<string, LiveTick>> {
    const today = vnTodayStr();
    const res = await fetchExchangeBoardWithFallback('HOSE', today, forceRefresh);
    if (Object.keys(res.board).length > 0) {
      this.boardUpdatedAt = res.syncTime;
      this.boardSource = res.source;
      this.boardTradeDate = res.tradeDate;
      this.boardMode = res.mode;
      const changedTicks: Record<string, LiveTick> = {};
      this.liveBoard.clear();
      for (const [sym, item] of Object.entries(res.board)) {
        const ssiWsTick = this.ssiWsTicks.get(sym);
        const prevTick = this.liveTicks.get(sym);
        let finalTick: LiveTick;
        // NEVER overwrite a real-time SSI WS tick with stale EOD fallback data
        if (ssiWsTick && (res.mode === 'eod' || isVnMarketHours())) {
          finalTick = {
            ...item,
            ...ssiWsTick,
            value_bil: ssiWsTick.value_bil ?? item.value_bil,
            liveSource: 'SSI_WS',
          };
          this.liveBoard.set(sym, finalTick);
        } else {
          finalTick = { ...item, tradeDate: res.tradeDate, liveSource: 'BOARD' };
          this.liveBoard.set(sym, finalTick);
          this.liveTicks.set(sym, { ...finalTick });
        }
        if (
          !prevTick ||
          prevTick.last !== finalTick.last ||
          prevTick.volume !== finalTick.volume ||
          prevTick.pct !== finalTick.pct
        ) {
          changedTicks[sym] = finalTick;
        }
      }
      if (Object.keys(changedTicks).length > 0) {
        this.emitTicks(changedTicks);
      }
      this.emitSync('board', res.syncTime, this.ssiWsTicks.size > 0 ? 'SSI' : res.source);
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
          const [res1m, resD] = await Promise.all([
            fetchOhlcvWithMeta(sym, start1m, today, '1'),
            fetchOhlcvWithMeta(sym, startD, today, 'D'),
          ]);
          if (res1m.bars.length || resD.bars.length) {
            this.indexCache.set(sym.toUpperCase(), {
              bars1m: res1m.bars,
              barsD: resD.bars,
              source: res1m.bars.length ? res1m.source : resD.source,
              updatedAt: vnNowParts().hms,
            });
          }
        } catch {
          // ignore
        }
      })
    );
    this.emitSync('indices', vnNowParts().hms, this.boardSource);
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
        await this.refreshBoardNow(false);
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

  getIndexData(symbol: string): {
    bars1m: OhlcvBar[];
    barsD: OhlcvBar[];
    source: 'SSI' | 'VNDirect';
  } {
    const hit = this.indexCache.get(symbol.toUpperCase().trim());
    if (!hit) return { bars1m: [], barsD: [], source: 'VNDirect' };
    return {
      bars1m: hit.bars1m.map((b) => ({ ...b })),
      barsD: hit.barsD.map((b) => ({ ...b })),
      source: hit.source,
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

  /**
   * Returns ONLY ticks received directly from the real-time SSI WebSocket stream (`MAIN|S#...`).
   */
  getLiveWsSnapshot(symbols?: string[]): Record<string, LiveTick> {
    const out: Record<string, LiveTick> = {};
    if (!symbols) {
      for (const [k, v] of this.ssiWsTicks.entries()) out[k] = { ...v };
      return out;
    }
    for (const s of symbols) {
      const u = s.toUpperCase().trim();
      const v = this.ssiWsTicks.get(u);
      if (v) out[u] = { ...v };
    }
    return out;
  }

  getLiveWsTickCount(): number {
    return this.ssiWsTicks.size;
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
    singletonWsMgr.start([...ALL_MAIN_INDICES]);
    // Warm up unified 3-exchange SSI-classified catalog and subscribe ALL HOSE + HNX + UPCOM symbols to SSI WS
    fetchFullStockCatalog()
      .then((catalog) => {
        const allSyms = selectCatalogSymbols(catalog.stocks, {
          exchange: 'ALL',
          excludePenny: false,
        });
        if (allSyms.length) {
          singletonWsMgr?.subscribe(allSyms);
        }
      })
      .catch(() => {});
  }
  return singletonWsMgr;
}
