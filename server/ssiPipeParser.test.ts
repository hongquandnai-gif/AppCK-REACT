import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSsiPipeTick } from './ssiPipeParser.ts';

const SAMPLE_HOSE_FPT =
  'MAIN|S#FPT|45700|35100|45650|16900|45600|40500|||||||||||||||45750|3200|45800|30900|45850|33400|||||||||||||||45750|200|46900|hose|44050|44860.02|1245675|55392181750|1762730|78819905000|750|1.67|6333700|284129920000||||48150|41850|45000||||451813390|s|N||||0|1885727648|VSDFPTXX||44900|||||||||||||||||||||44900|120700|-100|-0.22|1795400099928|1795404227718';

const SAMPLE_ODD_LOT_FPT =
  'ODD_LOT|S#FPT|45750|29|45700|321|45650|135|||||||||||||||45850|10|45900|25|45950|10|||||||||||||||45750|32|46400|hose|44150|44988|1245675|55392181750|1762730|78819905000|750|1.67|24174|1087539950||||48150|41850|45000||||451813390|s|N||||0|1885727648|VSDFPTXX||45000|||||||||||||||||||||45000|3693|0|0|1795400099061|1795404227694';

const SAMPLE_HNX_CEO =
  'MAIN|S#CEO|11400|156500|11300|214800|11200|412400|11100|233400|11000|634900|10900|86600|10800|169200|10700|86600|10600|66300|10500|146000|11500|71800|11600|122000|11700|320600|11800|380500|11900|352200|12000|469800|12100|324900|12200|395500|12300|238700|12400|66800|11500|1000|11600|hnx|11200|11392.25|23500|266710000|800|9200000|0|0|1322000|15061030000||||12600|10400|11500||||514681739|s|N||||0|0|VSDCEOXX||11500|||||||||||||||||||||11500|0|0|0|1795400099000|1795404227700';

const SAMPLE_UPCOM_VEA =
  'MAIN|S#VEA|30200|5000|30100|4000|30000|9000|||||||||||||||30300|2000|30400|3000|30500|4000|||||||||||||||30300|500|30400|upcom|30200|30290|0|0|0|0|0|0|85600|2590900000||||34800|25800|30300||||1328800000|s|N||||0|0|VSDVEAXX||30300|||||||||||||||||||||30300|0|0|0|1795400099000|1795404227700';

test('parseSsiPipeTick parses HOSE MAIN frames with exact OHLC, volume, and value_bil', () => {
  const tick = parseSsiPipeTick(SAMPLE_HOSE_FPT);
  assert.ok(tick);
  assert.equal(tick.symbol, 'FPT');
  assert.equal(tick.exchange, 'HOSE');
  assert.equal(tick.last, 45.75);
  assert.equal(tick.open, 44.9);
  assert.equal(tick.high, 46.9);
  assert.equal(tick.low, 44.05);
  assert.equal(tick.ref, 45);
  assert.equal(tick.delta, 0.75);
  assert.equal(tick.pct, 1.67);
  assert.equal(tick.volume, 6333700);
  assert.equal(tick.lastVol, 200);
  assert.equal(tick.value_bil, 284.13);
});

test('parseSsiPipeTick ignores ODD_LOT frames so odd-lot volume never corrupts main board', () => {
  assert.equal(parseSsiPipeTick(SAMPLE_ODD_LOT_FPT), null);
});

test('parseSsiPipeTick parses HNX and UPCOM MAIN frames accurately', () => {
  const ceo = parseSsiPipeTick(SAMPLE_HNX_CEO);
  assert.ok(ceo);
  assert.equal(ceo.symbol, 'CEO');
  assert.equal(ceo.exchange, 'HNX');
  assert.equal(ceo.last, 11.5);
  assert.equal(ceo.volume, 1322000);
  assert.equal(ceo.value_bil, 15.061);

  const vea = parseSsiPipeTick(SAMPLE_UPCOM_VEA);
  assert.ok(vea);
  assert.equal(vea.symbol, 'VEA');
  assert.equal(vea.exchange, 'UPCOM');
  assert.equal(vea.last, 30.3);
  assert.equal(vea.volume, 85600);
  assert.equal(vea.value_bil, 2.591);
});

test('parseSsiPipeTick rejects non-MAIN or empty matched price frames', () => {
  assert.equal(parseSsiPipeTick('Subscribed stockRealtimeByListV2'), null);
  const zeroPrice = SAMPLE_HOSE_FPT.split('|');
  zeroPrice[42] = '0';
  assert.equal(parseSsiPipeTick(zeroPrice.join('|')), null);
});
