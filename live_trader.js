// Live/Demo Paper Trading Module
const fs = require('fs');
const fetch = require('node-fetch');
const { fetchCandles, getEMACrossoverSignals, getRSIMeanReversionSignals, getBollingerBandsSignals } = require('./strategies');

const STATE_FILE = 'bot_state.json';
const USD_INR_RATE = 83.5;

let botState = {
  isRunning: false,
  capitalInINR: 10000,
  startingCapitalInINR: 10000,
  usdInrRate: USD_INR_RATE,
  activePositions: [],
  tradeHistory: [],
  apiConfig: {
    exchange: 'binance_demo',
    apiKey: '',
    apiSecret: ''
  },
  tradingWindow: { startHour: 10, endHour: 16 },
  strategyConfig: {
    strategyName: 'EMA',
    shortPeriod: 9,
    longPeriod: 21,
    period: 14,
    overbought: 70,
    oversold: 30,
    bbPeriod: 20,
    bbMultiplier: 2.0,
    stopLossPct: 1.0,
    takeProfitPct: 2.5
  },
  fees: {
    exchangeFeePct: 0.1,
    tdsPct: 1.0,
    incomeTaxPct: 30.0
  }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      Object.assign(botState, parsed);
      console.log(`[STATE] Successfully loaded existing state from ${STATE_FILE}. Active positions: ${botState.activePositions.length}`);
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

async function fetchLivePrice(ticker) {
  try {
    const url = `https://api.exchange.coinbase.com/products/${ticker}/ticker`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();
    return parseFloat(data.price);
  } catch (err) {
    console.warn(`[PRICE] Warn: Could not fetch real-time price for ${ticker}, fallback to simulated flux.`);
    return null;
  }
}

async function runTick() {
  if (!botState.isRunning) return;

  const now = new Date();
  const currentHour = now.getUTCHours();
  const withinWindow = currentHour >= botState.tradingWindow.startHour && currentHour < botState.tradingWindow.endHour;

  console.log(`[TICK] Running trade tick at ${now.toISOString()}. Hours: ${currentHour} UTC. Within trading window: ${withinWindow}`);

  for (let i = 0; i < botState.activePositions.length; i++) {
    const pos = botState.activePositions[i];
    const livePrice = await fetchLivePrice(pos.ticker);

    if (livePrice !== null) {
      pos.currentPrice = livePrice;
      const priceChangePct = ((livePrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.type === 'LONG' ? 1 : -1);
      pos.unrealizedPnl = (livePrice - pos.entryPrice) * pos.size * botState.usdInrRate;

      console.log(`[POSITION] ${pos.ticker} current price: ${pos.currentPrice}, entry: ${pos.entryPrice}, Change: ${priceChangePct.toFixed(2)}%, Unrealized P&L: ${pos.unrealizedPnl.toFixed(2)} INR`);

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
        await closePosition(pos, closeReason);
        i--;
      }
    } else {
      console.warn(`[TICK] Network issue: Could not fetch live price for ${pos.ticker}. Will retry next tick.`);
    }
  }

  const MAX_POSITIONS = 5;
  if (withinWindow && botState.activePositions.length < MAX_POSITIONS && botState.capitalInINR > 500) {
    const tickersToScan = ["BTC-USD", "ETH-USD", "SOL-USD", "ADA-USD", "DOT-USD"];

    for (const ticker of tickersToScan) {
      if (botState.activePositions.find(p => p.ticker === ticker)) continue;
      if (botState.activePositions.length >= MAX_POSITIONS) break;

      console.log(`[SCAN] Evaluating ${ticker} signals...`);
      const candles = await fetchCandles(ticker, 300, new Date(Date.now() - 4 * 3600 * 1000), new Date());

      if (candles.length < 20) {
        console.warn(`[SCAN] Insufficient candles for ${ticker}.`);
        continue;
      }

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
      }

      console.log(`[SCAN] ${ticker} signal: ${signal}`);

      if (signal === 'BUY') {
        const livePrice = await fetchLivePrice(ticker);
        if (livePrice) {
          const allocCapitalINR = (botState.capitalInINR * 0.8) / (MAX_POSITIONS - botState.activePositions.length);
          const allocUSD = allocCapitalINR / botState.usdInrRate;
          const entryFeeUSD = allocUSD * (botState.fees.exchangeFeePct / 100);
          const netUSD = allocUSD - entryFeeUSD;
          const size = netUSD / livePrice;

          const newPos = {
            ticker,
            type: 'LONG',
            entryTime: Date.now(),
            entryPrice: livePrice,
            size,
            entryCostINR: allocCapitalINR,
            entryFeeINR: entryFeeUSD * botState.usdInrRate,
            currentPrice: livePrice,
            unrealizedPnl: 0
          };

          botState.activePositions.push(newPos);
          botState.capitalInINR -= allocCapitalINR;
          saveState();

          console.log(`[ORDER] BUY ORDER FILLED: ${ticker} at ${livePrice} USD. Position size: ${size}. Dedicated capital: ${allocCapitalINR.toFixed(2)} INR`);
        }
      }
    }
  }

  saveState();
}

async function closePosition(pos, reason) {
  const exitPrice = pos.currentPrice;
  const grossUSD = pos.size * exitPrice;
  const exitExchangeFeeUSD = grossUSD * (botState.fees.exchangeFeePct / 100);
  const tdsUSD = grossUSD * (botState.fees.tdsPct / 100);

  const grossINR = grossUSD * botState.usdInrRate;
  const exitExchangeFeeINR = exitExchangeFeeUSD * botState.usdInrRate;
  const tdsINR = tdsUSD * botState.usdInrRate;

  const netExitINR = grossINR - exitExchangeFeeINR - tdsINR;
  const pnlBeforeTaxAndFees = (exitPrice - pos.entryPrice) * pos.size * botState.usdInrRate;
  const netPnl = netExitINR - pos.entryCostINR;

  let incomeTax = 0;
  if (netPnl > 0) {
    incomeTax = netPnl * (botState.fees.incomeTaxPct / 100);
  }

  const finalNetPnl = netPnl - incomeTax;
  const returnedCapital = pos.entryCostINR + finalNetPnl;

  botState.capitalInINR += returnedCapital;
  botState.activePositions = botState.activePositions.filter(p => p.ticker !== pos.ticker);

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
    netPnlINR: finalNetPnl,
    capitalAfterINR: botState.capitalInINR
  };

  botState.tradeHistory.push(closedTrade);
  saveState();

  console.log(`[ORDER] CLOSED POSITION: ${pos.ticker} at ${exitPrice} USD. Reason: ${reason}. Net P&L: ${finalNetPnl.toFixed(2)} INR.`);
}

module.exports = {
  botState,
  loadState,
  saveState,
  runTick,
  closePosition
};
