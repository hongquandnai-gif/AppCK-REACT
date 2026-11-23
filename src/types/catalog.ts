export interface StockCatalogItem {
  symbol: string;
  companyName: string;
  industry: string;
  icbCode?: string;
  exchange: 'HOSE' | 'HNX' | 'UPCOM' | 'INDEX';
  refPrice?: number;
  ceiling?: number;
  floor?: number;
  isIndex?: boolean;
  isPenny?: boolean;
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
  classificationStandard?: string;
}
