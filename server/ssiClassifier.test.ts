import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndustryMapFromCatalog,
  classifySsiStock,
  normalizeSsiExchange,
  normalizeSsiIndustry,
  resolveIcbL2Code,
  selectCatalogSymbols,
  type ClassifiedStockMeta,
} from './ssiClassifier';

test('resolveIcbL2Code maps 4-digit ICB Level-2/3/4 codes to official SSI supersectors', () => {
  assert.equal(resolveIcbL2Code('8300'), '8300');
  assert.equal(resolveIcbL2Code('8355'), '8300');
  assert.equal(resolveIcbL2Code('8777'), '8700');
  assert.equal(resolveIcbL2Code('9533'), '9500');
  assert.equal(resolveIcbL2Code('0533'), '0500');
  assert.equal(resolveIcbL2Code(1757), '1700');
});

test('normalizeSsiIndustry harmonizes SSI and VNDirect industry labels into canonical SSI ICB names', () => {
  assert.deepEqual(normalizeSsiIndustry('Ngân hàng', '8300'), {
    icbCode: '8300',
    industry: 'Ngân hàng',
  });
  assert.deepEqual(normalizeSsiIndustry('Dịch vụ bán lẻ', null), {
    icbCode: '5300',
    industry: 'Bán lẻ',
  });
  assert.deepEqual(normalizeSsiIndustry('Tài nguyên', '1700'), {
    icbCode: '1700',
    industry: 'Tài nguyên Cơ bản',
  });
  assert.deepEqual(normalizeSsiIndustry('Công nghệ', '9500'), {
    icbCode: '9500',
    industry: 'Công nghệ Thông tin',
  });
  assert.deepEqual(normalizeSsiIndustry('Dịch vụ tiện ích', '7500'), {
    icbCode: '7500',
    industry: 'Điện, nước & xăng dầu khí đốt',
  });
  assert.deepEqual(normalizeSsiIndustry('Chứng khoán', null), {
    icbCode: '8700',
    industry: 'Dịch vụ tài chính',
  });
});

test('normalizeSsiExchange normalizes HSX/HOSE, HNX, UPCOM aliases', () => {
  assert.equal(normalizeSsiExchange('hsx'), 'HOSE');
  assert.equal(normalizeSsiExchange('HOSE'), 'HOSE');
  assert.equal(normalizeSsiExchange('HNX'), 'HNX');
  assert.equal(normalizeSsiExchange('upcom'), 'UPCOM');
  assert.equal(normalizeSsiExchange('INVALID'), null);
});

test('classifySsiStock keeps true SSI industry even for penny stocks and flags isPenny', () => {
  const fpt = classifySsiStock({
    symbol: 'FPT',
    companyName: 'CTCP FPT',
    exchange: 'HSX',
    icbCode: '9533',
    industryName: 'Công nghệ',
    refPrice: 130.5,
  });
  assert.ok(fpt);
  assert.equal(fpt.exchange, 'HOSE');
  assert.equal(fpt.industry, 'Công nghệ Thông tin');
  assert.equal(fpt.isPenny, false);

  const hqc = classifySsiStock({
    symbol: 'HQC',
    companyName: 'CTCP TV-TM-DV Địa Ốc Hoàng Quân',
    exchange: 'HOSE',
    icbCode: '8633',
    industryName: 'Bất động sản',
    refPrice: 3.4,
  });
  assert.ok(hqc);
  assert.equal(hqc.industry, 'Bất động sản');
  assert.equal(hqc.isPenny, true);

  // Invalid 4-letter warrant/ETF rejected
  assert.equal(
    classifySsiStock({ symbol: 'CFPT2401', exchange: 'HOSE', industryName: 'Công nghệ' }),
    null
  );
});

test('selectCatalogSymbols filters consistently by exchange, SSI industry, and Penny flag', () => {
  const stocks: Record<string, ClassifiedStockMeta> = {
    FPT: classifySsiStock({ symbol: 'FPT', exchange: 'HOSE', icbCode: '9500', refPrice: 130 })!,
    SSI: classifySsiStock({ symbol: 'SSI', exchange: 'HOSE', icbCode: '8700', refPrice: 25 })!,
    HQC: classifySsiStock({ symbol: 'HQC', exchange: 'HOSE', icbCode: '8600', refPrice: 3.2 })!,
    CEO: classifySsiStock({ symbol: 'CEO', exchange: 'HNX', icbCode: '8600', refPrice: 14 })!,
    BSR: classifySsiStock({ symbol: 'BSR', exchange: 'UPCOM', icbCode: '0500', refPrice: 21 })!,
  };

  assert.deepEqual(selectCatalogSymbols(stocks, { exchange: 'HOSE', excludePenny: true }), [
    'FPT',
    'SSI',
  ]);
  assert.deepEqual(selectCatalogSymbols(stocks, { exchange: 'ALL', industry: 'Bất động sản' }), [
    'CEO',
    'HQC',
  ]);
  assert.deepEqual(selectCatalogSymbols(stocks, { exchange: 'ALL', industry: 'Penny' }), ['HQC']);
  assert.equal(buildIndustryMapFromCatalog(stocks).SSI, 'Dịch vụ tài chính');
});
