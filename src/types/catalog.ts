export interface StockCatalogItem {
  symbol: string;
  companyName: string;
  industry: string;
  exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'INDEX';
  refPrice?: number;
  ceiling?: number;
  floor?: number;
  isIndex?: boolean;
}

export interface StockCatalogCounts {
  HOSE: number;
  HNX: number;
  UPCOM: number;
  INDEX: number;
  total: number;
}

export interface StockCatalogResponse {
  list: StockCatalogItem[];
  counts: StockCatalogCounts;
  industries: string[];
  source: 'SSI' | 'VNDirect' | 'Fallback';
}
