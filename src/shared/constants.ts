// Shared constants ported faithfully from core/constants.py

export const INDEX_SYMBOLS = new Set<string>([
  'VNINDEX', 'VN30', 'HNX', 'UPCOM', 'VNMID', 'VNSML', 'VNSMALL',
  'HNXINDEX', 'HNXUPCOMINDEX', 'VN100', 'VNALL',
]);

export const ALL_MAIN_INDICES: string[] = [
  'VNINDEX', 'VN30', 'HNX', 'UPCOM', 'VNMID', 'VNSMALL',
];

export const BASE_INDUSTRIES_MAPPING: Record<string, string> = {
  // Chỉ số
  VNINDEX: 'Chỉ số', VN30: 'Chỉ số', HNX: 'Chỉ số', UPCOM: 'Chỉ số',
  VNMID: 'Chỉ số', VNSMALL: 'Chỉ số', VNSML: 'Chỉ số',
  VNALL: 'Chỉ số', VN100: 'Chỉ số',

  // Ngân hàng
  VCB: 'Ngân hàng', BID: 'Ngân hàng', CTG: 'Ngân hàng', MBB: 'Ngân hàng',
  TCB: 'Ngân hàng', VPB: 'Ngân hàng', STB: 'Ngân hàng', HDB: 'Ngân hàng',
  ACB: 'Ngân hàng', LPB: 'Ngân hàng', EIB: 'Ngân hàng', OCB: 'Ngân hàng',
  SHB: 'Ngân hàng', TPB: 'Ngân hàng', VIB: 'Ngân hàng', MSB: 'Ngân hàng',
  SSB: 'Ngân hàng', NAB: 'Ngân hàng', VAB: 'Ngân hàng', BAB: 'Ngân hàng',

  // Chứng khoán
  SSI: 'Chứng khoán', HCM: 'Chứng khoán', VND: 'Chứng khoán', VCI: 'Chứng khoán',
  FTS: 'Chứng khoán', VDS: 'Chứng khoán', CTS: 'Chứng khoán', BSI: 'Chứng khoán',
  VIX: 'Chứng khoán', ORS: 'Chứng khoán', AGR: 'Chứng khoán', TVS: 'Chứng khoán',
  MBS: 'Chứng khoán', SHS: 'Chứng khoán', APS: 'Chứng khoán', VIG: 'Chứng khoán',
  VCK: 'Chứng khoán', VPX: 'Chứng khoán', TCX: 'Chứng khoán',

  // Bất động sản
  VIC: 'Bất động sản', VHM: 'Bất động sản', NVL: 'Bất động sản', PDR: 'Bất động sản',
  DXG: 'Bất động sản', KDH: 'Bất động sản', NLG: 'Bất động sản', DIG: 'Bất động sản',
  CEO: 'Bất động sản', HDG: 'Bất động sản', TCH: 'Bất động sản', KHG: 'Bất động sản',
  SCR: 'Bất động sản', HQC: 'Bất động sản', IJC: 'Bất động sản', CRE: 'Bất động sản',
  NHA: 'Bất động sản', HPX: 'Bất động sản', HDC: 'Bất động sản', NTL: 'Bất động sản',
  AGG: 'Bất động sản', DRH: 'Bất động sản', LDG: 'Bất động sản', QCG: 'Bất động sản',

  // Bất động sản KCN
  KBC: 'Bất động sản KCN', IDC: 'Bất động sản KCN', SZC: 'Bất động sản KCN',
  ITA: 'Bất động sản KCN', GVR: 'Bất động sản KCN', PHR: 'Bất động sản KCN',
  DPR: 'Bất động sản KCN', LHG: 'Bất động sản KCN', BCM: 'Bất động sản KCN',
  VGC: 'Bất động sản KCN', TIP: 'Bất động sản KCN', SIP: 'Bất động sản KCN',
  DTD: 'Bất động sản KCN', GEL: 'Bất động sản KCN',

  // Thép
  HPG: 'Thép', HSG: 'Thép', NKG: 'Thép', TLH: 'Thép',
  POM: 'Thép', SMC: 'Thép', TVN: 'Thép', VGS: 'Thép',

  // Dầu khí
  GAS: 'Dầu khí', PLX: 'Dầu khí', PVD: 'Dầu khí', PVS: 'Dầu khí',
  BSR: 'Dầu khí', OIL: 'Dầu khí', PVT: 'Dầu khí', PVC: 'Dầu khí',
  PVB: 'Dầu khí', PVO: 'Dầu khí',

  // Năng lượng / Điện
  POW: 'Năng lượng', REE: 'Năng lượng', GEG: 'Năng lượng', NT2: 'Năng lượng',
  PC1: 'Năng lượng', VSH: 'Năng lượng', TV2: 'Năng lượng', PPC: 'Năng lượng',
  QTP: 'Năng lượng', HND: 'Năng lượng',

  // Bán lẻ
  MWG: 'Bán lẻ', PNJ: 'Bán lẻ', FRT: 'Bán lẻ', DGW: 'Bán lẻ',
  PET: 'Bán lẻ', VRE: 'Bán lẻ', MSN: 'Bán lẻ', SAB: 'Bán lẻ',
  VNM: 'Bán lẻ', HAX: 'Bán lẻ',

  // Công nghệ / Viễn thông
  FPT: 'Công nghệ', CMG: 'Công nghệ', ELC: 'Công nghệ',
  VTP: 'Công nghệ', CTR: 'Công nghệ', VGI: 'Công nghệ', FOX: 'Công nghệ',
  TTN: 'Công nghệ',

  // Hóa chất & Phân bón
  DGC: 'Hóa chất', DCM: 'Hóa chất', DPM: 'Hóa chất', CSV: 'Hóa chất',
  LAS: 'Hóa chất', DDV: 'Hóa chất', BFC: 'Hóa chất',

  // Thủy sản
  VHC: 'Thủy sản', ANV: 'Thủy sản', IDI: 'Thủy sản', FMC: 'Thủy sản',
  CMX: 'Thủy sản', ACL: 'Thủy sản',

  // Dệt may
  TNG: 'Dệt may', TCM: 'Dệt may', GIL: 'Dệt may', MSH: 'Dệt may',
  STK: 'Dệt may', VGT: 'Dệt may', ADS: 'Dệt may',

  // Xây dựng & Đầu tư công
  VCG: 'Đầu tư công', HHV: 'Đầu tư công', LCG: 'Đầu tư công', FCN: 'Đầu tư công',
  C4G: 'Đầu tư công', G36: 'Đầu tư công', CTD: 'Xây dựng', HBC: 'Xây dựng',
  HT1: 'Xây dựng', KSB: 'Xây dựng', BCC: 'Xây dựng', PLC: 'Xây dựng',
  CII: 'Đầu tư công', HUT: 'Đầu tư công', CTI: 'Đầu tư công',

  // Vận tải & Cảng
  GMD: 'Vận tải & Cảng', HAH: 'Vận tải & Cảng', VSC: 'Vận tải & Cảng',
  VOS: 'Vận tải & Cảng', GSP: 'Vận tải & Cảng',
  HVN: 'Hàng không', VJC: 'Hàng không',

  // Nông nghiệp
  HAG: 'Nông nghiệp', HNG: 'Nông nghiệp', DBC: 'Nông nghiệp', BAF: 'Nông nghiệp',
  SBT: 'Nông nghiệp', LSS: 'Nông nghiệp', QNS: 'Nông nghiệp', SLS: 'Nông nghiệp',
  PAN: 'Nông nghiệp', TAR: 'Nông nghiệp', LTG: 'Nông nghiệp', ASM: 'Nông nghiệp',
  NAF: 'Nông nghiệp',

  // Khác
  GEX: 'Đa ngành', AAA: 'Nhựa', APH: 'Nhựa', BMP: 'Nhựa', NTP: 'Nhựa',
  BVH: 'Bảo hiểm', MIG: 'Bảo hiểm', BMI: 'Bảo hiểm',
  TDM: 'Nước', BWE: 'Nước',
  DLG: 'Đa ngành',
};

export const RESTRICTED_OR_BANNED_HOSE = new Set<string>();

export const HOSE_PENNY_FORCE_INCLUDE = new Set<string>([
  'YEG', 'OGC', 'LDG', 'DRH', 'HQC', 'ITA', 'DLG', 'JVC', 'TTF',
  'HNG', 'AMD', 'HAI', 'TSC', 'DAH', 'TNI', 'C69', 'TNT',
  'HTN', 'QCG', 'C47', 'CDC', 'FIT', 'SAM', 'NAF', 'FIR',
  'DC4', 'HSL', 'MHC', 'TLD', 'CRC', 'APG', 'CTF',
  'CCL', 'TTA', 'TNH', 'NO1', 'CLL', 'NBB', 'APH', 'VIP',
  'SKG', 'TVS', 'TDP', 'HCD', 'TTH', 'TVN', 'DL1', 'EVG',
]);

export const PENNY_SYMBOLS = new Set<string>(
  [...HOSE_PENNY_FORCE_INCLUDE].filter((s) => !RESTRICTED_OR_BANNED_HOSE.has(s))
);

export const HARDCODED_HOSE_INDUSTRIES_MAPPING: Record<string, string> = {
  ...BASE_INDUSTRIES_MAPPING,
};
for (const sym of PENNY_SYMBOLS) {
  if (!(sym in HARDCODED_HOSE_INDUSTRIES_MAPPING)) {
    HARDCODED_HOSE_INDUSTRIES_MAPPING[sym] = 'Penny';
  }
}

export function isPennyStock(symbol: string): boolean {
  return PENNY_SYMBOLS.has(symbol) || HARDCODED_HOSE_INDUSTRIES_MAPPING[symbol] === 'Penny';
}

export function getSymbolsByIndustry(selectedIndustry: string, excludePenny = false): string[] {
  if (selectedIndustry === 'Chỉ số') {
    return Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)
      .filter(([, g]) => g === 'Chỉ số')
      .map(([s]) => s)
      .sort();
  }
  if (selectedIndustry === 'Penny') {
    return [...PENNY_SYMBOLS].sort();
  }
  if (selectedIndustry === 'Tất cả ngành') {
    return Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)
      .filter(
        ([s, g]) =>
          g !== 'Chỉ số' &&
          !RESTRICTED_OR_BANNED_HOSE.has(s) &&
          (!excludePenny || !isPennyStock(s))
      )
      .map(([s]) => s)
      .sort();
  }
  return Object.entries(HARDCODED_HOSE_INDUSTRIES_MAPPING)
    .filter(([s, g]) => g === selectedIndustry && !RESTRICTED_OR_BANNED_HOSE.has(s))
    .map(([s]) => s)
    .sort();
}

const allGroupSet = new Set(Object.values(HARDCODED_HOSE_INDUSTRIES_MAPPING));
allGroupSet.delete('Penny');
allGroupSet.delete('Chỉ số');
const sortedGroups = [...allGroupSet].sort((a, b) => a.localeCompare(b, 'vi'));

export const INDUSTRY_GROUPS: string[] = ['Tất cả ngành', 'Chỉ số', ...sortedGroups, 'Penny'];

export const MA_COLORS: Record<number, string> = {
  10: '#1f77b4',
  20: '#ff7f0e',
  50: '#2ca02c',
  100: '#d62728',
  200: '#9467bd',
};

export const MA_WINDOWS: number[] = [10, 20, 50, 100, 200];

export function getVnTreemapColor(pct: number): string {
  if (pct >= 6.5) return '#9333ea'; // Tím trần
  if (pct >= 2.0) return '#059669'; // Xanh lá đậm
  if (pct > 0.0) return '#10b981';  // Xanh lá tươi
  if (pct === 0.0) return '#d97706'; // Vàng tham chiếu
  if (pct <= -6.5) return '#0284c7'; // Xanh lơ sàn
  if (pct <= -2.0) return '#dc2626'; // Đỏ đậm
  return '#ef4444';                  // Đỏ nhạt
}
