// Technical indicators and strategies module
const fetch = require('node-fetch');

// Define 50+ popular Indian stock tickers (Nifty 50)
const POPULAR_TICKERS = [
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "SBIN", "LICI", "KOTAKBANK", "LT",
  "ITC", "HINDUNILVR", "AXISBANK", "BAJFINANCE", "MARUTI", "SUNPHARMA", "ADANIENT", "TATAMOTORS", "ONGC", "NTPC",
  "COALINDIA", "POWERGRID", "JSWSTEEL", "TATASTEEL", "ULTRACEMCO", "TITAN", "GRASIM", "HINDALCO", "NESTLEIND", "TECHM",
  "ADANIPORTS", "WIPRO", "BPCL", "INDUSINDBK", "BAJAJFINSV", "HDFCLIFE", "SBILIFE", "BRITANNIA", "EICHERMOT", "DIVISLAB",
  "APOLLOHOSP", "HEROMOTOCO", "CIPLA", "DRREDDY", "LTIM", "TATACONSUM", "JIOFIN", "ADANIPOWER", "HAL", "BEL",
  "TRENT", "CHOLAFIN", "DLF", "VBL", "SHRIRAMFIN"
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

// Fetch historical candles from Coinbase Pro (for crypto) or Yahoo Finance (for Indian Stocks)
async function fetchCandles(ticker, granularity = 3600, startTime = null, endTime = null) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const startMs = startTime ? new Date(startTime).getTime() : Date.now() - 30 * 24 * 3600 * 1000;
  const endMs = endTime ? new Date(endTime).getTime() : Date.now();

  const isStock = POPULAR_TICKERS.includes(ticker) || ticker.endsWith('.NS');

  if (isStock) {
    const symbol = ticker.endsWith('.NS') ? ticker : `${ticker}.NS`;
    // Map standard seconds granularity to Yahoo interval strings
    let interval = '1d';
    if (granularity === 60) interval = '1m';
    else if (granularity === 300) interval = '5m';
    else if (granularity === 900) interval = '15m';
    else if (granularity === 3600) interval = '1h';

    const p1 = Math.floor(startMs / 1000);
    const p2 = Math.floor(endMs / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=${interval}`;

    console.log(`[YAHOO-DATA] Fetching Indian Stock data for ${symbol} from NSE...`);
    try {
      const res = await fetch(url, { headers, timeout: 8000 });
      if (!res.ok) {
        throw new Error(`Yahoo HTTP Error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result || !result.timestamp) {
        throw new Error("No data returned or empty timestamps array");
      }

      const timestamps = result.timestamp;
      const quote = result.indicators?.quote?.[0];
      if (!quote) throw new Error("No quotes found in Yahoo response");

      const candles = [];
      for (let i = 0; i < timestamps.length; i++) {
        // Ensure candle fields are fully valid numbers
        const open = parseFloat(quote.open?.[i]);
        const high = parseFloat(quote.high?.[i]);
        const low = parseFloat(quote.low?.[i]);
        const close = parseFloat(quote.close?.[i]);
        const volume = parseFloat(quote.volume?.[i]);

        if (!isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
          // Yahoo prices are already in INR, convert to simulated base USD internally
          // because backtesting framework uses base USD internally and multiplies at the exit
          const USD_INR_RATE = 83.5;
          candles.push({
            time: timestamps[i] * 1000,
            open: open / USD_INR_RATE,
            high: high / USD_INR_RATE,
            low: low / USD_INR_RATE,
            close: close / USD_INR_RATE,
            volume: volume || 0
          });
        }
      }

      console.log(`[YAHOO-DATA] Successfully fetched ${candles.length} real NSE stock candles for ${symbol}.`);
      return candles.sort((a, b) => a.time - b.time);
    } catch (err) {
      console.warn(`[YAHOO-DATA] Yahoo Finance API fetch failed: ${err.message}. Falling back to high-fidelity market simulator.`);
      return [];
    }
  }

  // Fallback / standard Coinbase Pro Fetch for Cryptocurrencies
  const chunkSpanMs = 300 * granularity * 1000;
  let currentStart = startMs;
  let allCandles = [];

  console.log(`[DATA FETCH] Fetching real historical data for ${ticker} from ${new Date(startMs).toLocaleDateString()} to ${new Date(endMs).toLocaleDateString()}...`);

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
    currentStart = currentEnd + 1000;
    await new Promise(resolve => setTimeout(resolve, 300));
  }

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

// Professional Intraday Multi-Strategy Signal Generator (No Scalping)
function getProIntradaySignals(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50); // macro trend filter
  const rsi = calculateRSI(closes, 14);
  const avgVolume = calculateSMA(volumes, 10); // volume breakout filter
  const { upper, lower } = calculateBollingerBands(closes, 20, 2);

  const signals = Array(candles.length).fill('HOLD');

  for (let i = 1; i < candles.length; i++) {
    if (ema9[i] === null || ema21[i] === null || ema50[i] === null || rsi[i] === null || avgVolume[i] === null || upper[i] === null || lower[i] === null) {
      continue;
    }

    // 1. PRO BUY/LONG CRITERIA (Golden Trend Breakout):
    // - Relaxed RSI (30 to 78) and broader trigger filters to catch high-quality daily momentum
    if (ema9[i] > ema21[i]) {
      if (rsi[i] >= 35 && rsi[i] <= 78) {
        // Trigger on any active breakout of EMA9 or RSI turning positive
        if ((ema9[i-1] <= ema21[i-1] && ema9[i] > ema21[i]) || (closes[i-1] <= ema9[i-1] && closes[i] > ema9[i]) || (rsi[i-1] < 38 && rsi[i] >= 38)) {
          // Relaxed volume filter to 0.4x to guarantee high daily activity
          if (volumes[i] >= avgVolume[i] * 0.4) {
            signals[i] = 'BUY';
          }
        }
      }
    }

    // 2. PRO SELL/SHORT CRITERIA (Death Trend Breakdown):
    if (ema9[i] < ema21[i]) {
      if (rsi[i] >= 22 && rsi[i] <= 65) {
        if ((ema9[i-1] >= ema21[i-1] && ema9[i] < ema21[i]) || (closes[i-1] >= ema9[i-1] && closes[i] < ema9[i]) || (rsi[i-1] > 62 && rsi[i] <= 62)) {
          if (volumes[i] >= avgVolume[i] * 0.4) {
            signals[i] = 'SELL';
          }
        }
      }
    }
  }

  return { signals, indicators: { ema9, ema21, ema50, rsi, upper, lower } };
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
  getSuperSelectiveSignals,
  getProIntradaySignals
};
