import {
  ALL_MAIN_INDICES,
  HARDCODED_HOSE_INDUSTRIES_MAPPING,
  PENNY_SYMBOLS,
} from '../src/shared/constants.ts';

export type ExchangeCode = 'HOSE' | 'HNX' | 'UPCOM' | 'INDEX';

export interface ClassifiedStockMeta {
  symbol: string;
  companyName: string;
  industry: string;
  icbCode: string;
  exchange: ExchangeCode;
  refPrice: number;
  ceiling: number;
  floor: number;
  isIndex?: boolean;
  isPenny?: boolean;
}

/**
 * Official Vietnam Stock Market / SSI iBoard ICB Level-2 (Supersector) taxonomy.
 * Both SSI (fiin-core / iboard-query) and VNDirect (industry_classification level 2)
 * follow this exact 19-supersector ICB standard.
 */
export const SSI_ICB_L2_MAP: Record<string, string> = {
  '0500': 'Dầu khí',
  '1300': 'Hóa chất',
  '1700': 'Tài nguyên Cơ bản',
  '2300': 'Xây dựng và Vật liệu',
  '2700': 'Hàng & Dịch vụ Công nghiệp',
  '3300': 'Ô tô và phụ tùng',
  '3500': 'Thực phẩm và đồ uống',
  '3700': 'Hàng cá nhân & Gia dụng',
  '4500': 'Y tế',
  '5300': 'Bán lẻ',
  '5500': 'Truyền thông',
  '5700': 'Du lịch và Giải trí',
  '6500': 'Viễn thông',
  '7500': 'Điện, nước & xăng dầu khí đốt',
  '8300': 'Ngân hàng',
  '8500': 'Bảo hiểm',
  '8600': 'Bất động sản',
  '8700': 'Dịch vụ tài chính',
  '9500': 'Công nghệ Thông tin',
};

/**
 * Maps any 4-digit ICB code (Level 2, 3, or 4) to its Level-2 SSI Supersector code.
 */
export function resolveIcbL2Code(rawCode?: string | number | null): string {
  if (rawCode === null || rawCode === undefined) return '';
  const digits = String(rawCode).replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(4, '0').slice(0, 4);
  if (SSI_ICB_L2_MAP[padded]) return padded;

  const prefix2 = `${padded.slice(0, 2)}00`;
  if (SSI_ICB_L2_MAP[prefix2]) return prefix2;

  // Handle sub-codes that span adjacent hundred blocks in ICB v2
  const num = Number(padded);
  if (num >= 500 && num < 1000) return '0500';
  if (num >= 1300 && num < 1700) return '1300';
  if (num >= 1700 && num < 2000) return '1700';
  if (num >= 2300 && num < 2700) return '2300';
  if (num >= 2700 && num < 3000) return '2700';
  if (num >= 3300 && num < 3500) return '3300';
  if (num >= 3500 && num < 3700) return '3500';
  if (num >= 3700 && num < 4000) return '3700';
  if (num >= 4500 && num < 5000) return '4500';
  if (num >= 5300 && num < 5500) return '5300';
  if (num >= 5500 && num < 5700) return '5500';
  if (num >= 5700 && num < 6000) return '5700';
  if (num >= 6500 && num < 7000) return '6500';
  if (num >= 7500 && num < 8000) return '7500';
  if (num >= 8300 && num < 8500) return '8300';
  if (num >= 8500 && num < 8600) return '8500';
  if (num >= 8600 && num < 8700) return '8600';
  if (num >= 8700 && num < 9000) return '8700';
  if (num >= 9500 && num < 9999) return '9500';
  return '';
}

const NAME_TO_ICB_L2: Array<[RegExp, string]> = [
  [/dầu khí|oil\s*&?\s*gas/i, '0500'],
  [/hóa chất|phân bón|chemical/i, '1300'],
  [/tài nguyên|thép|khoáng sản|kim loại|basic\s*resource/i, '1700'],
  [/xây dựng|vật liệu|đầu tư công|construction/i, '2300'],
  [/hàng.*công nghiệp|vận tải|cảng|công nghiệp|industrial\s*goods/i, '2700'],
  [/ô\s*tô|ôtô|phụ tùng|automobile/i, '3300'],
  [/thực phẩm|đồ uống|thủy sản|nông nghiệp|food\s*&?\s*beverage/i, '3500'],
  [/cá nhân|gia dụng|dệt may|nhựa|personal\s*&?\s*household/i, '3700'],
  [/y tế|dược|health\s*care/i, '4500'],
  [/bán lẻ|retail/i, '5300'],
  [/truyền thông|media/i, '5500'],
  [/du lịch|giải trí|hàng không|travel\s*&?\s*leisure/i, '5700'],
  [/viễn thông|telecom/i, '6500'],
  [/tiện ích|điện|nước|năng lượng|utilities/i, '7500'],
  [/ngân hàng|bank/i, '8300'],
  [/bảo hiểm|insurance/i, '8500'],
  [/bất động sản|real\s*estate/i, '8600'],
  [/dịch vụ tài chính|chứng khoán|financial\s*service/i, '8700'],
  [/công nghệ|technology/i, '9500'],
];

/**
 * Normalizes any raw industry name or ICB code (from SSI iBoard, SSI FiinCore,
 * VNDirect ICB L2, or legacy labels) into the canonical SSI ICB Level-2 Vietnamese name.
 */
export function normalizeSsiIndustry(
  rawIndustryName?: string | null,
  rawIcbCode?: string | number | null
): { icbCode: string; industry: string } {
  const fromCode = resolveIcbL2Code(rawIcbCode);
  if (fromCode && SSI_ICB_L2_MAP[fromCode]) {
    return { icbCode: fromCode, industry: SSI_ICB_L2_MAP[fromCode] };
  }

  const trimmed = String(rawIndustryName || '').trim();
  if (!trimmed) {
    return { icbCode: '', industry: 'Khác' };
  }
  if (trimmed === 'Chỉ số') {
    return { icbCode: 'INDEX', industry: 'Chỉ số' };
  }

  for (const [pattern, code] of NAME_TO_ICB_L2) {
    if (pattern.test(trimmed)) {
      return { icbCode: code, industry: SSI_ICB_L2_MAP[code] };
    }
  }

  return { icbCode: '', industry: trimmed };
}

export function normalizeSsiExchange(raw?: string | null): ExchangeCode | null {
  const u = String(raw || '').trim().toUpperCase();
  if (u === 'HOSE' || u === 'HSX' || u === 'VN') return 'HOSE';
  if (u === 'HNX' || u === 'HASTC') return 'HNX';
  if (u === 'UPCOM' || u === 'UPCO' || u === 'OTC') return 'UPCOM';
  if (u === 'INDEX') return 'INDEX';
  return null;
}

export interface RawSsiStockInput {
  symbol: string;
  companyName?: string;
  exchange?: string;
  icbCode?: string | number | null;
  industryName?: string | null;
  refPrice?: number;
  ceiling?: number;
  floor?: number;
}

/**
 * Automatically classifies a single stock using SSI's official ICB Level-2 hierarchy.
 * Penny status is computed dynamically (refPrice < 10k or known penny list) as an
 * orthogonal flag (`isPenny`) without overwriting the stock's true SSI ICB sector.
 */
export function classifySsiStock(input: RawSsiStockInput): ClassifiedStockMeta | null {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  if (!symbol || symbol.length !== 3 || !/^[A-Z0-9]{3}$/.test(symbol)) return null;

  const exchange = normalizeSsiExchange(input.exchange);
  if (!exchange || exchange === 'INDEX') return null;

  let { icbCode, industry } = normalizeSsiIndustry(input.industryName, input.icbCode);

  // Only fall back to legacy mapping if SSI/VNDirect returned nothing at all
  if (industry === 'Khác' && HARDCODED_HOSE_INDUSTRIES_MAPPING[symbol]) {
    const legacy = HARDCODED_HOSE_INDUSTRIES_MAPPING[symbol];
    if (legacy !== 'Chỉ số' && legacy !== 'Penny') {
      const normalized = normalizeSsiIndustry(legacy, null);
      icbCode = normalized.icbCode;
      industry = normalized.industry;
    }
  }

  const refPrice = Number.isFinite(Number(input.refPrice)) ? Number(input.refPrice) : 0;
  const ceiling = Number.isFinite(Number(input.ceiling)) ? Number(input.ceiling) : 0;
  const floor = Number.isFinite(Number(input.floor)) ? Number(input.floor) : 0;
  const isPenny = PENNY_SYMBOLS.has(symbol) || (refPrice > 0 && refPrice < 10);

  return {
    symbol,
    companyName: String(input.companyName || symbol).trim() || symbol,
    industry,
    icbCode,
    exchange,
    refPrice,
    ceiling,
    floor,
    isPenny,
  };
}

export interface CatalogSelectOptions {
  industry?: string;
  exchange?: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL';
  excludePenny?: boolean;
}

/**
 * Unified symbol selector shared by EVERY backend scanner and analytics route
 * (Market Health, Sector MA, Money Flow, Radar EOD, Minervini, Gainers, Backtest).
 */
export function selectCatalogSymbols(
  stocks: Record<string, ClassifiedStockMeta>,
  opts: CatalogSelectOptions = {}
): string[] {
  const industry = opts.industry || 'Tất cả ngành';
  const exchange = opts.exchange || 'HOSE';
  const excludePenny = Boolean(opts.excludePenny);

  if (industry === 'Chỉ số') {
    return [...ALL_MAIN_INDICES];
  }

  const out: string[] = [];
  for (const meta of Object.values(stocks)) {
    if (meta.exchange === 'INDEX' || meta.isIndex) continue;
    if (exchange !== 'ALL' && meta.exchange !== exchange) continue;

    if (industry === 'Penny') {
      if (meta.isPenny) out.push(meta.symbol);
      continue;
    }

    if (excludePenny && meta.isPenny) continue;
    if (industry !== 'Tất cả ngành' && meta.industry !== industry) continue;
    out.push(meta.symbol);
  }

  return out.sort();
}

export function buildIndustryMapFromCatalog(
  stocks: Record<string, ClassifiedStockMeta>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [sym, meta] of Object.entries(stocks)) {
    map[sym] = meta.industry || 'Khác';
  }
  return map;
}
