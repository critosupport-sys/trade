// Strategy verification test script
const {
  fetchCandles,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
  getEMACrossoverSignals,
  getRSIMeanReversionSignals,
  getBollingerBandsSignals
} = require('./strategies');

async function runTests() {
  console.log("--- Starting Strategy and Technical Indicator Verification ---");
  const ticker = "BTC-USD";
  const granularity = 3600;
  const now = new Date();
  const past24h = new Date(now.getTime() - 48 * 3600 * 1000);

  console.log(`Fetching historical candles for ${ticker}...`);
  const candles = await fetchCandles(ticker, granularity, past24h, now);
  console.log(`Successfully fetched ${candles.length} candles.`);

  if (candles.length === 0) {
    console.error("FAIL: Failed to fetch candles.");
    process.exit(1);
  }

  const closes = candles.map(c => c.close);

  console.log("Verifying EMA calculation...");
  const ema9 = calculateEMA(closes, 9);
  if (ema9.length !== closes.length) {
    console.error("FAIL: EMA array length mismatch.");
    process.exit(1);
  }

  console.log("Verifying RSI calculation...");
  const rsi14 = calculateRSI(closes, 14);
  if (rsi14.length !== closes.length) {
    console.error("FAIL: RSI array length mismatch.");
    process.exit(1);
  }

  console.log("Verifying Bollinger Bands...");
  const bb = calculateBollingerBands(closes, 20, 2);
  if (bb.middle.length !== closes.length || bb.upper.length !== closes.length || bb.lower.length !== closes.length) {
    console.error("FAIL: BB length mismatch.");
    process.exit(1);
  }

  console.log("Verifying Signal Generators...");
  const emaSignals = getEMACrossoverSignals(candles, 9, 21);
  const rsiSignals = getRSIMeanReversionSignals(candles, 14, 70, 30);
  const bbSignals = getBollingerBandsSignals(candles, 20, 2);

  console.log(`EMA signals generated: ${emaSignals.signals.filter(s => s !== 'HOLD').length}`);
  console.log(`RSI signals generated: ${rsiSignals.signals.filter(s => s !== 'HOLD').length}`);
  console.log(`BB signals generated: ${bbSignals.signals.filter(s => s !== 'HOLD').length}`);

  console.log("--- STRATEGY AND INDICATOR VERIFICATION PASSED SUCCESSFULLY ---");
}

runTests().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
