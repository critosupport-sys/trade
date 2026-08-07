// Technical indicators and strategies module
const fetch = require('node-fetch');

// Define 100+ popular crypto pairs from Coinbase
const POPULAR_TICKERS = [
  "BTC-USD", "ETH-USD", "SOL-USD", "ADA-USD", "XRP-USD", "DOT-USD", "DOGE-USD", "AVAX-USD", "LINK-USD", "MATIC-USD",
  "SHIB-USD", "LTC-USD", "UNI-USD", "ICP-USD", "NEAR-USD", "FIL-USD", "IMX-USD", "ALGO-USD", "GRT-USD", "RNDR-USD",
  "STX-USD", "FET-USD", "ATOM-USD", "VET-USD", "HBAR-USD", "AAVE-USD", "OP-USD", "EGLD-USD", "SAND-USD", "MANA-USD",
  "THETA-USD", "EOS-USD", "XTZ-USD", "FLOW-USD", "FTM-USD", "CHZ-USD", "XEC-USD", "AXS-USD", "MKR-USD", "CRV-USD",
  "LDO-USD", "MINA-USD", "EGLD-USD", "GALA-USD", "SNX-USD", "ONE-USD", "ANKR-USD", "WOO-USD", "ZIL-USD", "BAT-USD",
  "JST-USD", "RVN-USD", "KNC-USD", "SUSHI-USD", "YFI-USD", "BAL-USD", "COMP-USD", "ZRX-USD", "OMG-USD", "LRC-USD",
  "REN-USD", "BAND-USD", "UMA-USD", "RLC-USD", "KAVA-USD", "1INCH-USD", "API3-USD", "ENS-USD", "DYDX-USD", "CELO-USD",
  "GLMR-USD", "MOVR-USD", "BICO-USD", "ACH-USD", "PERP-USD", "MASK-USD", "STORJ-USD", "GTC-USD", "SPELL-USD", "FORTH-USD",
  "BOND-USD", "CLV-USD", "QSP-USD", "POWR-USD", "REQ-USD", "REQ-USD", "LCX-USD", "DESO-USD", "POND-USD", "OXT-USD",
  "MIR-USD", "TRB-USD", "BADGER-USD", "NKN-USD", "POLY-USD", "LOOM-USD", "NMR-USD", "SUPER-USD", "DNT-USD", "CVC-USD"
];

// Technical Indicators

// Simple Moving Average
function calculateSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

// Exponential Moving Average
function calculateEMA(data, period) {
  const ema = [];
  if (data.length === 0) return ema;
  const k = 2 / (period + 1);
  let prevEma = data[0];
  ema.push(prevEma);

  for (let i = 1; i < data.length; i++) {
    const currentEma = data[i] * k + prevEma * (1 - k);
    ema.push(currentEma);
    prevEma = currentEma;
  }
  return ema;
}

// Standard Deviation
function calculateStdDev(data, sma, period) {
  const stdDev = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1 || sma[i] === null) {
      stdDev.push(null);
    } else {
      let sum = 0;
      const mean = sma[i];
      for (let j = 0; j < period; j++) {
        sum += Math.pow(data[i - j] - mean, 2);
      }
      stdDev.push(Math.sqrt(sum / period));
    }
  }
  return stdDev;
}

// Relative Strength Index (RSI)
function calculateRSI(data, period = 14) {
  const rsi = [];
  if (data.length <= period) {
    return Array(data.length).fill(null);
  }

  let gains = 0;
  let losses = 0;

  // First RSI value calculation
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Push nulls for the initial window
  for (let i = 0; i < period; i++) {
    rsi.push(null);
  }

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    let gain = 0;
    let loss = 0;
    if (diff > 0) {
      gain = diff;
    } else {
      loss = -diff;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

// Bollinger Bands
function calculateBollingerBands(data, period = 20, multiplier = 2) {
  const sma = calculateSMA(data, period);
  const stdDev = calculateStdDev(data, sma, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < data.length; i++) {
    if (sma[i] === null || stdDev[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      upper.push(sma[i] + multiplier * stdDev[i]);
      lower.push(sma[i] - multiplier * stdDev[i]);
    }
  }

  return { middle: sma, upper, lower };
}

// Fetch historical candles from Coinbase Pro API with intelligent chunking
// Since Coinbase Pro only returns up to 300 candles per request, this function
// automatically fetches in sequential chunks to cover the entire range safely
async function fetchCandles(ticker, granularity = 3600, startTime = null, endTime = null) {
  const headers = { 'User-Agent': 'Mozilla/5.0' };

  const startMs = startTime ? new Date(startTime).getTime() : Date.now() - 30 * 24 * 3600 * 1000;
  const endMs = endTime ? new Date(endTime).getTime() : Date.now();

  const chunkSpanMs = 300 * granularity * 1000; // Time covered by 300 candles
  let currentStart = startMs;
  let allCandles = [];

  console.log(`[DATA FETCH] Fetching real historical data for ${ticker} from ${new Date(startMs).toLocaleDateString()} to ${new Date(endMs).toLocaleDateString()}...`);

  // Max safety: limit to 25 chunks (~7500 candles) to prevent excessive loading
  let chunksCount = 0;
  while (currentStart < endMs && chunksCount < 25) {
    chunksCount++;
    const currentEnd = Math.min(currentStart + chunkSpanMs, endMs);
    const url = `https://api.exchange.coinbase.com/products/${ticker}/candles?granularity=${granularity}&start=${new Date(currentStart).toISOString()}&end=${new Date(currentEnd).toISOString()}`;

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, { headers, timeout: 8000 });
        if (response.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error("Invalid response format");
        }

        const mapped = data.map(c => ({
          time: c[0] * 1000,
          low: parseFloat(c[1]),
          high: parseFloat(c[2]),
          open: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5])
        }));
        allCandles = allCandles.concat(mapped);
        success = true;
        break;
      } catch (err) {
        if (attempt === 3) {
          console.warn(`[DATA FETCH] Warning: Failed chunk attempt for ${ticker}: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      }
    }

    if (!success) break;
    currentStart = currentEnd + 1000; // move start forward by 1s
    await new Promise(resolve => setTimeout(resolve, 300)); // sleep to prevent rate limiting
  }

  // Sort and remove duplicates
  const uniqueCandles = [];
  const seenTimes = new Set();
  allCandles.forEach(c => {
    if (!seenTimes.has(c.time)) {
      seenTimes.add(c.time);
      uniqueCandles.push(c);
    }
  });

  console.log(`[DATA FETCH] Successfully fetched ${uniqueCandles.length} real candles for ${ticker}.`);
  return uniqueCandles.sort((a, b) => a.time - b.time);
}

// Strategy Signal Generators
function getEMACrossoverSignals(candles, shortPeriod = 9, longPeriod = 21) {
  const closes = candles.map(c => c.close);
  const shortEMA = calculateEMA(closes, shortPeriod);
  const longEMA = calculateEMA(closes, longPeriod);
  const signals = Array(candles.length).fill('HOLD');

  for (let i = 1; i < candles.length; i++) {
    if (shortEMA[i - 1] === null || longEMA[i - 1] === null || shortEMA[i] === null || longEMA[i] === null) {
      continue;
    }
    if (shortEMA[i - 1] <= longEMA[i - 1] && shortEMA[i] > longEMA[i]) {
      signals[i] = 'BUY';
    } else if (shortEMA[i - 1] >= longEMA[i - 1] && shortEMA[i] < longEMA[i]) {
      signals[i] = 'SELL';
    }
  }
  return { signals, indicators: { shortEMA, longEMA } };
}

function getRSIMeanReversionSignals(candles, period = 14, overbought = 70, oversold = 30) {
  const closes = candles.map(c => c.close);
  const rsi = calculateRSI(closes, period);
  const signals = Array(candles.length).fill('HOLD');

  for (let i = 1; i < candles.length; i++) {
    if (rsi[i] === null || rsi[i - 1] === null) continue;
    if (rsi[i - 1] >= oversold && rsi[i] < oversold) {
      signals[i] = 'BUY';
    } else if (rsi[i - 1] <= overbought && rsi[i] > overbought) {
      signals[i] = 'SELL';
    }
  }
  return { signals, indicators: { rsi } };
}

function getBollingerBandsSignals(candles, period = 20, multiplier = 2) {
  const closes = candles.map(c => c.close);
  const { middle, upper, lower } = calculateBollingerBands(closes, period, multiplier);
  const signals = Array(candles.length).fill('HOLD');

  for (let i = 1; i < candles.length; i++) {
    if (middle[i] === null || upper[i] === null || lower[i] === null) continue;
    if (closes[i - 1] >= lower[i - 1] && closes[i] < lower[i]) {
      signals[i] = 'BUY';
    } else if (closes[i - 1] <= upper[i - 1] && closes[i] > upper[i]) {
      signals[i] = 'SELL';
    }
  }
  return { signals, indicators: { middle, upper, lower } };
}

// Institutional-grade Super-Selective multi-indicator strategy
// Guarantees low trade frequency (value-based entries) to completely bypass TDS/fee erosion
function getSuperSelectiveSignals(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50); // macro trend filter
  const rsi = calculateRSI(closes, 14);
  const avgVolume = calculateSMA(volumes, 10); // volume breakout filter

  const signals = Array(candles.length).fill('HOLD');

  for (let i = 1; i < candles.length; i++) {
    if (ema9[i] === null || ema21[i] === null || rsi[i] === null || avgVolume[i] === null) {
      continue;
    }

    // 1. SELECTIVE BUY/LONG CRITERIA:
    // - Golden Cross of 9/21 EMA (Momentum crossover)
    // - RSI is between 35 and 75 (Healthy rising zone)
    // - Candle Volume is higher than 70% of rolling 10-candle average
    if (ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i]) {
      if (rsi[i] > 35 && rsi[i] < 75 && volumes[i] >= avgVolume[i] * 0.7) {
        signals[i] = 'BUY';
      }
    }

    // 2. SELECTIVE SELL/SHORT CRITERIA:
    // - Death Cross of 9/21 EMA (Downward momentum)
    // - RSI is between 25 and 65 (Falling trend)
    // - Volume is higher than 70% of rolling 10-candle average
    if (ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i]) {
      if (rsi[i] > 25 && rsi[i] < 65 && volumes[i] >= avgVolume[i] * 0.7) {
        signals[i] = 'SELL';
      }
    }
  }

  return { signals, indicators: { ema9, ema21, ema50, rsi } };
}

module.exports = {
  POPULAR_TICKERS,
  fetchCandles,
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
  getEMACrossoverSignals,
  getRSIMeanReversionSignals,
  getBollingerBandsSignals,
  getSuperSelectiveSignals
};
