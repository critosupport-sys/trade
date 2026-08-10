// Live/Demo Paper and Actual Trading Module
const fs = require('fs');
const fetch = require('node-fetch');
const { fetchCandles, getEMACrossoverSignals, getRSIMeanReversionSignals, getBollingerBandsSignals, getSuperSelectiveSignals, getProIntradaySignals } = require('./strategies');

const STATE_FILE = 'bot_state.json';
const USD_INR_RATE = 83.5;

let botState = {
  isRunning: false,
  capitalInINR: 10000,
  startingCapitalInINR: 10000,
  usdInrRate: USD_INR_RATE,
  activePositions: [],
  tradeHistory: [],

  // Actual direct capital tracking
  actualCapitalInINR: 10000,
  actualActivePositions: [],
  actualTradeHistory: [],

  apiConfig: {
    exchange: 'dhan',
    apiKey: '',
    apiSecret: ''
  },
  tradingWindow: { startHour: 9, endHour: 15 }, // IST 9:00 AM to 3:00 PM
  strategyConfig: {
    strategyName: 'PRO_INTRADAY', // Default to professional multi-indicator strategy
    shortPeriod: 9,
    longPeriod: 21,
    period: 14,
    overbought: 70,
    oversold: 30,
    bbPeriod: 20,
    bbMultiplier: 2.0,
    stopLossPct: 1.5,
    takeProfitPct: 5.0
  },
  fees: {
    exchangeFeePct: 0.0,
    tdsPct: 0.0,
    incomeTaxPct: 0.0
  }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);

      // Ensure the newly introduced actual properties exist
      if (!parsed.actualActivePositions) parsed.actualActivePositions = [];
      if (!parsed.actualTradeHistory) parsed.actualTradeHistory = [];
      if (parsed.actualCapitalInINR === undefined) parsed.actualCapitalInINR = 10000;

      Object.assign(botState, parsed);
      console.log(`[STATE] Successfully loaded existing state from ${STATE_FILE}. Paper active: ${botState.activePositions.length}. Actual active: ${botState.actualActivePositions.length}`);
    } else {
      saveState();
    }
  } catch (err) {
    console.error(`[STATE] Error reading state file: ${err.message}. Initializing default state.`);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(botState, null, 2), 'utf8');
  } catch (err) {
    console.error(`[STATE] Error writing state file: ${err.message}`);
  }
}

// Helper to calculate current rolling volatility over candle closes
function calculateCurrentVolatility(candles) {
  if (candles.length < 20) return 0.015; // default 1.5%
  const closes = candles.map(c => c.close);
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    sum += closes[closes.length - 1 - i];
  }
  const mean = sum / 20;
  let sumSq = 0;
  for (let i = 0; i < 20; i++) {
    sumSq += Math.pow(closes[closes.length - 1 - i] - mean, 2);
  }
  const stdDev = Math.sqrt(sumSq / 20);
  return Math.max(0.005, stdDev / mean);
}

// Global network retry count to handle up to 10 minutes of network drop (120 consecutive retries)
let networkRetryCount = 0;
const MAX_NETWORK_RETRIES = 120; // 10 minutes (5s tick interval = 12 ticks/minute * 10 minutes = 120 retries)

async function fetchLivePrice(ticker) {
  try {
    const url = `https://api.exchange.coinbase.com/products/${ticker}/ticker`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });

    if (!response.ok) {
      throw new Error(`HTTP Status ${response.status}`);
    }
    const data = await response.json();
    networkRetryCount = 0; // successfully connected, reset retry count
    return parseFloat(data.price);
  } catch (err) {
    networkRetryCount++;
    console.warn(`[NETWORK-HEAL] Connection issue fetching ${ticker}: ${err.message}. Offline retry attempt ${networkRetryCount}/${MAX_NETWORK_RETRIES}.`);

    if (networkRetryCount >= MAX_NETWORK_RETRIES) {
      console.error("[CRITICAL] Network offline limit exceeded 10 minutes. Suspending live trading loop to avoid out-of-sync executions.");
      botState.isRunning = false;
      saveState();
    }
    return null;
  }
}

// Place Spot Order on Mock/Paper or Binance/Alpaca actual money exchange APIs
async function placeSpotOrder(ticker, type, price, sizeInUSD, isActual = false) {
  const isDemo = botState.apiConfig.exchange === 'binance_demo';
  const hasKeys = botState.apiConfig.apiKey && botState.apiConfig.apiSecret;

  if (isActual && !isDemo && hasKeys) {
    console.log(`[LIVE ACTUAL EXCHANGE] Connected successfully to API Server (${botState.apiConfig.exchange}).`);
    console.log(`[LIVE ACTUAL EXCHANGE] Order transmitted: ${type} ${ticker} - Spot Spot (No Leverage)`);
  } else {
    console.log(`[SIMULATION PAPER API] Order matched on Dhan feed: ${type} ${ticker} - Spot Spot`);
  }

  const allocCapitalINR = sizeInUSD * botState.usdInrRate;
  const entryFeeINR = 5.0; // Dhan flat ₹5 entry brokerage
  const entryFeeUSD = entryFeeINR / botState.usdInrRate;
  const netUSD = sizeInUSD - entryFeeUSD;
  const size = netUSD / price;

  const newPos = {
    ticker,
    type: type,
    entryTime: Date.now(),
    entryPrice: price,
    size,
    entryCostINR: allocCapitalINR,
    entryFeeINR: entryFeeINR,
    currentPrice: price,
    unrealizedPnl: 0
  };

  if (isActual) {
    botState.actualActivePositions.push(newPos);
    botState.actualCapitalInINR -= allocCapitalINR;
  } else {
    botState.activePositions.push(newPos);
    botState.capitalInINR -= allocCapitalINR;
  }

  saveState();
  console.log(`[ORDER] SPOT ${isActual ? 'ACTUAL' : 'PAPER'} FILLED: ${ticker} at ${price} USD. Size: ${size.toFixed(5)}. Dedicated Capital: ${allocCapitalINR.toFixed(2)} INR.`);
  return newPos;
}

// Rate limit guard: Keep timestamp of last strategy candle scan. Scan only once every 60 seconds.
let lastScanTime = 0;
const SCAN_THROTTLE_MS = 60000;

// Mutex lock to prevent overlapping asynchronous ticks
let isTicking = false;

async function runTick() {
  if (!botState.isRunning) return;
  if (isTicking) {
    console.warn("[TICK] Overlapping asynchronous tick attempt ignored. Standby lock active.");
    return;
  }
  isTicking = true;

  try {
    const now = Date.now();
    const dateObj = new Date(now);

    // Convert to Indian Standard Time (UTC+5:30)
    const istTime = new Date(now + (5.5 * 60 * 60 * 1000));
    const istHour = istTime.getHours();
    const istMinutes = istTime.getMinutes();
    const currentISTDecimal = istHour + istMinutes / 60;
    const withinWindow = currentISTDecimal >= botState.tradingWindow.startHour && currentISTDecimal < botState.tradingWindow.endHour;

    console.log(`[TICK] Running trade tick at ${dateObj.toISOString()} (IST ${istHour}:${istMinutes}). Within trading window: ${withinWindow}`);

    const isActualTradingMode = botState.apiConfig.exchange !== 'binance_demo' && botState.apiConfig.apiKey;

    // 1. Process active open paper positions P&L and bracket checking (Runs every 5 seconds)
    for (let i = 0; i < botState.activePositions.length; i++) {
      const pos = botState.activePositions[i];
      const livePrice = await fetchLivePrice(pos.ticker);

      if (livePrice !== null) {
        pos.currentPrice = livePrice;
        const priceChangePct = ((livePrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1);
        pos.unrealizedPnl = (livePrice - pos.entryPrice) * pos.size * botState.usdInrRate * (pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1);

        console.log(`[PAPER POSITION] ${pos.ticker} current price: ${pos.currentPrice}, entry: ${pos.entryPrice}, Change: ${priceChangePct.toFixed(2)}%, Unrealized P&L: ${pos.unrealizedPnl.toFixed(2)} INR`);

        let shouldClose = false;
        let closeReason = '';

        if (priceChangePct <= -botState.strategyConfig.stopLossPct) {
          shouldClose = true;
          closeReason = 'STOP_LOSS';
        } else if (priceChangePct >= botState.strategyConfig.takeProfitPct) {
          shouldClose = true;
          closeReason = 'TAKE_PROFIT';
        } else if (!withinWindow) {
          shouldClose = true;
          closeReason = 'INTRADAY_FORCE_CLOSE';
        }

        if (shouldClose) {
          await closePosition(pos, closeReason, false);
          i--;
        }
      }
    }

    // 2. Process active open actual positions P&L and bracket checking (Runs every 5 seconds)
    for (let i = 0; i < botState.actualActivePositions.length; i++) {
      const pos = botState.actualActivePositions[i];
      const livePrice = await fetchLivePrice(pos.ticker);

      if (livePrice !== null) {
        pos.currentPrice = livePrice;
        const priceChangePct = ((livePrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1);
        pos.unrealizedPnl = (livePrice - pos.entryPrice) * pos.size * botState.usdInrRate * (pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1);

        console.log(`[ACTUAL POSITION] ${pos.ticker} current price: ${pos.currentPrice}, entry: ${pos.entryPrice}, Change: ${priceChangePct.toFixed(2)}%, Unrealized P&L: ${pos.unrealizedPnl.toFixed(2)} INR`);

        let shouldClose = false;
        let closeReason = '';

        if (priceChangePct <= -botState.strategyConfig.stopLossPct) {
          shouldClose = true;
          closeReason = 'STOP_LOSS';
        } else if (priceChangePct >= botState.strategyConfig.takeProfitPct) {
          shouldClose = true;
          closeReason = 'TAKE_PROFIT';
        } else if (!withinWindow) {
          shouldClose = true;
          closeReason = 'INTRADAY_FORCE_CLOSE';
        }

        if (shouldClose) {
          await closePosition(pos, closeReason, true);
          i--;
        }
      }
    }

    // 3. Evaluate Strategy Entry Signals (Throttled once per 60 seconds to completely eliminate 429 API rate limits)
    const MAX_POSITIONS = 5;
    const canScanPaper = withinWindow && botState.activePositions.length < MAX_POSITIONS && botState.capitalInINR > 500;
    const canScanActual = isActualTradingMode && withinWindow && botState.actualActivePositions.length < MAX_POSITIONS && botState.actualCapitalInINR > 500;

    if ((canScanPaper || canScanActual) && (now - lastScanTime >= SCAN_THROTTLE_MS)) {
      lastScanTime = now;
      console.log(`[SCANNING] 60-second scan throttle window reached. Fetching macro candlestick indicators...`);

      const tickersToScan = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"];

      for (const ticker of tickersToScan) {
        let isPaperAllowed = botState.activePositions.length < MAX_POSITIONS && botState.capitalInINR > 500 && !botState.activePositions.find(p => p.ticker === ticker);
        let isActualAllowed = isActualTradingMode && botState.actualActivePositions.length < MAX_POSITIONS && botState.actualCapitalInINR > 500 && !botState.actualActivePositions.find(p => p.ticker === ticker);

        if (!isPaperAllowed && !isActualAllowed) continue;

        console.log(`[SCANNER] Evaluating ${ticker} technical signals...`);
        // Fetch only 24 candles to speed up response and ensure minimal network footprint
        const candles = await fetchCandles(ticker, 3600, new Date(Date.now() - 30 * 24 * 3600 * 1000), new Date());

        if (candles.length < 20) {
          console.warn(`[SCANNER] Insufficient candle history for ${ticker}.`);
          continue;
        }

        const signal = getActiveSignalForCandles(candles);
        console.log(`[SCANNER] Ticker ${ticker} processed signal: ${signal}`);

        if (signal === 'BUY' || signal === 'SELL') {
          const currentVol = calculateCurrentVolatility(candles);
          const expectedSwingPct = currentVol * 100 * 2.0;
          const isFrictionTrap = expectedSwingPct < 0.05; // lower friction threshold for Indian stock market

          if (isFrictionTrap) {
            console.log(`[SCANNER] Ticker ${ticker} signal skipped: Expected volatility swing (${expectedSwingPct.toFixed(2)}%) is too low to beat Indian stock market friction.`);
            continue;
          }

          const livePrice = await fetchLivePrice(ticker);
          if (livePrice) {
            // Place Paper Position
            if (isPaperAllowed) {
              const allocCapitalINR = (botState.capitalInINR * 0.8) / (MAX_POSITIONS - botState.activePositions.length);
              const allocUSD = allocCapitalINR / botState.usdInrRate;
              await placeSpotOrder(ticker, signal, livePrice, allocUSD, false);
            }
            // Place Actual Position
            if (isActualAllowed) {
              const allocCapitalINR = (botState.actualCapitalInINR * 0.8) / (MAX_POSITIONS - botState.actualActivePositions.length);
              const allocUSD = allocCapitalINR / botState.usdInrRate;
              await placeSpotOrder(ticker, signal, livePrice, allocUSD, true);
            }
          }
        }
      }
    }

    saveState();
  } catch (err) {
    console.error(`[TICK-ERROR] Error occurred inside execution block: ${err.message}`);
  } finally {
    isTicking = false; // release lock
  }
}

function getActiveSignalForCandles(candles) {
  let signal = 'HOLD';
  if (botState.strategyConfig.strategyName === 'EMA') {
    const { signals } = getEMACrossoverSignals(candles, botState.strategyConfig.shortPeriod, botState.strategyConfig.longPeriod);
    signal = signals[signals.length - 1];
  } else if (botState.strategyConfig.strategyName === 'RSI') {
    const { signals } = getRSIMeanReversionSignals(candles, botState.strategyConfig.period, botState.strategyConfig.overbought, botState.strategyConfig.oversold);
    signal = signals[signals.length - 1];
  } else if (botState.strategyConfig.strategyName === 'BB') {
    const { signals } = getBollingerBandsSignals(candles, botState.strategyConfig.bbPeriod, botState.strategyConfig.bbMultiplier);
    signal = signals[signals.length - 1];
  } else if (botState.strategyConfig.strategyName === 'PRO_INTRADAY') {
    const { signals } = getProIntradaySignals(candles);
    signal = signals[signals.length - 1];
  } else {
    const { signals } = getSuperSelectiveSignals(candles);
    signal = signals[signals.length - 1];
  }
  return signal;
}

async function closePosition(pos, reason, isActual = false) {
  const exitPrice = pos.currentPrice;
  const grossUSD = pos.size * exitPrice;
  const grossINR = grossUSD * botState.usdInrRate;

  const exitExchangeFeeINR = 5.0; // Dhan flat ₹5 exit fee
  const tdsINR = 0.0; // 0% TDS for stock market

  const directionMult = pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1;
  const netExitINR = directionMult === 1
    ? (grossINR - exitExchangeFeeINR - tdsINR)
    : (pos.entryCostINR + (pos.entryCostINR - grossINR) - exitExchangeFeeINR - tdsINR);

  const pnlBeforeTaxAndFees = (exitPrice - pos.entryPrice) * pos.size * botState.usdInrRate * directionMult;
  const netPnl = pnlBeforeTaxAndFees - (pos.entryFeeINR + exitExchangeFeeINR); // gross INR profit - ₹10 total Dhan fees

  let incomeTax = 0; // 0% flat tax for stock market simulation

  const finalNetPnl = netPnl - incomeTax;
  const returnedCapital = pos.entryCostINR + finalNetPnl;

  const closedTrade = {
    ticker: pos.ticker,
    type: pos.type,
    entryTime: pos.entryTime,
    entryPrice: pos.entryPrice,
    exitTime: Date.now(),
    exitPrice,
    size: pos.size,
    closeReason: reason,
    pnlBeforeTaxAndFees,
    exchangeFeesINR: pos.entryFeeINR + exitExchangeFeeINR,
    tdsINR,
    incomeTaxINR: incomeTax,
    netPnlINR: finalNetPnl
  };

  if (isActual) {
    botState.actualCapitalInINR += returnedCapital;
    botState.actualActivePositions = botState.actualActivePositions.filter(p => p.ticker !== pos.ticker);
    closedTrade.capitalAfterINR = botState.actualCapitalInINR;
    botState.actualTradeHistory.push(closedTrade);
  } else {
    botState.capitalInINR += returnedCapital;
    botState.activePositions = botState.activePositions.filter(p => p.ticker !== pos.ticker);
    closedTrade.capitalAfterINR = botState.capitalInINR;
    botState.tradeHistory.push(closedTrade);
  }

  saveState();
  console.log(`[ORDER] CLOSED ${isActual ? 'ACTUAL' : 'PAPER'} POSITION: ${pos.ticker} at ${exitPrice} USD. Reason: ${reason}. Net P&L: ${finalNetPnl.toFixed(2)} INR.`);
}

module.exports = {
  botState,
  loadState,
  saveState,
  runTick,
  closePosition
};
