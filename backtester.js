// Backtesting Engine Module
const { fetchCandles, getEMACrossoverSignals, getRSIMeanReversionSignals, getBollingerBandsSignals, getSuperSelectiveSignals, getProIntradaySignals } = require('./strategies');

const USD_INR_RATE = 83.5;

// Check if timestamp is within Indian Trading Window (9:00 AM to 3:00 PM IST)
// Indian Standard Time is UTC+5:30. 9:00 AM IST is 3:30 AM UTC, 3:00 PM IST is 9:30 AM UTC.
function isWithinTradingWindow(timestamp, startHour = 9, endHour = 15) {
  const date = new Date(timestamp);
  // Convert UTC time to IST (UTC + 5:30)
  const utcTime = date.getTime();
  const istTime = new Date(utcTime + (5.5 * 60 * 60 * 1000));
  // Use getUTCHours and getUTCMinutes to be environment-agnostic (ignores local host timezone offset)
  const istHour = istTime.getUTCHours();
  const istMinutes = istTime.getUTCMinutes();

  const currentISTDecimal = istHour + istMinutes / 60;
  return currentISTDecimal >= startHour && currentISTDecimal < endHour;
}

// Helper to calculate percentage standard deviation over rolling closes to measure volatility
function getRollingVolatility(closes, index, period = 20) {
  if (index < period) return 0.015; // default 1.5% volatility
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[index - i];
  }
  const mean = sum / period;
  let sumSq = 0;
  for (let i = 0; i < period; i++) {
    sumSq += Math.pow(closes[index - i] - mean, 2);
  }
  const stdDev = Math.sqrt(sumSq / period);
  return Math.max(0.005, stdDev / mean);
}

function backtestAsset({
  ticker,
  candles,
  startingCapital,
  strategyName,
  strategyParams = {},
  riskManagement = { stopLossPct: 2.0, takeProfitPct: 8.0 },
  fees = { exchangeFeePct: 0.1, tdsPct: 1.0, incomeTaxPct: 30.0 },
  tradingWindow = { startHour: 9, endHour: 15 } // IST 9 AM to 3 PM
}) {
  if (!candles || candles.length === 0) {
    return { trades: [], finalCapital: startingCapital, netProfit: 0 };
  }

  let signalsResult;
  if (strategyName === 'EMA') {
    signalsResult = getEMACrossoverSignals(candles, strategyParams.shortPeriod || 9, strategyParams.longPeriod || 21);
  } else if (strategyName === 'RSI') {
    signalsResult = getRSIMeanReversionSignals(candles, strategyParams.period || 14, strategyParams.overbought || 70, strategyParams.oversold || 30);
  } else if (strategyName === 'BB') {
    signalsResult = getBollingerBandsSignals(candles, strategyParams.period || 20, strategyParams.multiplier || 2);
  } else if (strategyName === 'PRO_INTRADAY') {
    signalsResult = getProIntradaySignals(candles);
  } else {
    signalsResult = getSuperSelectiveSignals(candles);
  }

  const { signals } = signalsResult;
  const closes = candles.map(c => c.close);
  const trades = [];
  let capital = startingCapital;
  let activePosition = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];
    const timestamp = candle.time;

    // Calculate volatility-adaptive stop loss & take profit brackets dynamically
    const currentVol = getRollingVolatility(closes, i, 20);
    const adaptiveSL = Math.max(0.6, Math.min(2.5, currentVol * 100 * 0.8)); // dynamic SL (0.6% to 2.5%)
    const adaptiveTP = Math.max(1.5, Math.min(6.5, adaptiveSL * 2.5));      // dynamic TP (1.5% to 6.5%)

    const slLimit = riskManagement.stopLossPct !== undefined ? riskManagement.stopLossPct : adaptiveSL;
    const tpLimit = riskManagement.takeProfitPct !== undefined ? riskManagement.takeProfitPct : adaptiveTP;

    if (activePosition) {
      const currentPrice = candle.close;
      const directionMult = activePosition.type === 'LONG' || activePosition.type === 'BUY' ? 1 : -1;
      const priceChangePct = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100 * directionMult;

      let shouldExit = false;
      let exitReason = '';

      if (priceChangePct <= -slLimit) {
        shouldExit = true;
        exitReason = 'STOP_LOSS';
      } else if (priceChangePct >= tpLimit) {
        shouldExit = true;
        exitReason = 'TAKE_PROFIT';
      } else if (!isWithinTradingWindow(timestamp, tradingWindow.startHour, tradingWindow.endHour)) {
        shouldExit = true;
        exitReason = 'INTRADAY_FORCE_CLOSE';
      } else if ((activePosition.type === 'LONG' || activePosition.type === 'BUY') && signal === 'SELL') {
        shouldExit = true;
        exitReason = 'OPPOSING_SIGNAL';
      } else if (activePosition.type === 'SHORT' && signal === 'BUY') {
        shouldExit = true;
        exitReason = 'OPPOSING_SIGNAL';
      }

      if (shouldExit) {
        const exitPrice = currentPrice;
        // Dhan brokerage app flat rate: ₹5 buy, ₹5 sell. Thus entry and exit are ₹5 each.
        // Let's convert ₹5 to USD using USD_INR_RATE
        const flatExitFeeUSD = 5 / USD_INR_RATE;

        // Dhan brokerage fee is flat ₹5 per order.
        // 0% TDS, 0% Crypto tax (since this is stock market)
        const pnlBeforeTaxAndFeesINR = (exitPrice - activePosition.entryPrice) * activePosition.size * directionMult * USD_INR_RATE;
        const netPnlINR = pnlBeforeTaxAndFeesINR - 10; // ₹10 total round-trip brokerage (₹5 entry + ₹5 exit)

        const finalNetPnlUSD = netPnlINR / USD_INR_RATE;
        capital += (activePosition.entryCost + finalNetPnlUSD);

        trades.push({
          ticker,
          type: activePosition.type,
          entryTime: activePosition.entryTime,
          entryPrice: activePosition.entryPrice,
          exitTime: timestamp,
          exitPrice,
          size: activePosition.size,
          exitReason,
          pnlBeforeTaxAndFees: pnlBeforeTaxAndFeesINR / USD_INR_RATE,
          exchangeFees: 10 / USD_INR_RATE,
          tds: 0,
          incomeTax: 0,
          netPnl: finalNetPnlUSD,
          capitalAfter: capital
        });

        activePosition = null;
      }
    }

    if (!activePosition && isWithinTradingWindow(timestamp, tradingWindow.startHour, tradingWindow.endHour)) {
      // Friction-Aware Adaptive Filter: For Dhan flat ₹10 stock trades, friction is extremely low
      const expectedSwingPct = currentVol * 100 * 2.0;
      const isFrictionTrap = expectedSwingPct < 0.05;

      if (!isFrictionTrap) {
        if (signal === 'BUY') {
          const entryPrice = candle.close;
          const flatEntryFeeUSD = 5 / USD_INR_RATE; // ₹5 flat entry fee
          const netAllocated = capital - flatEntryFeeUSD;
          const size = netAllocated / entryPrice;

          activePosition = {
            ticker,
            type: 'LONG',
            entryTime: timestamp,
            entryPrice,
            size,
            entryCost: capital,
            entryExchangeFee: flatEntryFeeUSD
          };

          capital = 0;
        } else if (signal === 'SELL') {
          const entryPrice = candle.close;
          const flatEntryFeeUSD = 5 / USD_INR_RATE; // ₹5 flat entry fee
          const netAllocated = capital - flatEntryFeeUSD;
          const size = netAllocated / entryPrice;

          activePosition = {
            ticker,
            type: 'SHORT',
            entryTime: timestamp,
            entryPrice,
            size,
            entryCost: capital,
            entryExchangeFee: flatEntryFeeUSD
          };

          capital = 0;
        }
      }
    }
  }

  if (activePosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const directionMult = activePosition.type === 'LONG' || activePosition.type === 'BUY' ? 1 : -1;

    const pnlBeforeTaxAndFeesINR = (exitPrice - activePosition.entryPrice) * activePosition.size * directionMult * USD_INR_RATE;
    const netPnlINR = pnlBeforeTaxAndFeesINR - 10; // ₹10 total round-trip brokerage (₹5 entry + ₹5 exit)

    const finalNetPnlUSD = netPnlINR / USD_INR_RATE;
    capital += (activePosition.entryCost + finalNetPnlUSD);

    trades.push({
      ticker,
      type: activePosition.type,
      entryTime: activePosition.entryTime,
      entryPrice: activePosition.entryPrice,
      exitTime: lastCandle.time,
      exitPrice,
      size: activePosition.size,
      exitReason: 'FORCE_BACKTEST_END',
      pnlBeforeTaxAndFees: pnlBeforeTaxAndFeesINR / USD_INR_RATE,
      exchangeFees: 10 / USD_INR_RATE,
      tds: 0,
      incomeTax: 0,
      netPnl: finalNetPnlUSD,
      capitalAfter: capital
    });
  }

  return {
    trades,
    finalCapital: capital,
    netProfit: capital - startingCapital,
    winRate: trades.length > 0 ? (trades.filter(t => t.netPnl > 0).length / trades.length) * 100 : 0
  };
}

function generateSimulatedCandles(ticker, days = 180, granularity = 3600) {
  const candles = [];
  const now = Date.now();
  const candleMs = granularity * 1000;
  const numCandles = Math.floor((days * 24 * 3600 * 1000) / candleMs);

  // Use a fully deterministic seed base to ensure all optimized parameters are compared on the exact same price curves
  let seed = 123456;
  for (let i = 0; i < ticker.length; i++) {
    seed += ticker.charCodeAt(i);
  }
  const random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  // Base prices for 50+ Nifty Indian Stocks
  let price = 100.0;
  if (ticker === "RELIANCE") price = 2500.0;
  else if (ticker === "TCS") price = 3800.0;
  else if (ticker === "INFY") price = 1500.0;
  else if (ticker === "HDFCBANK") price = 1600.0;
  else if (ticker === "ICICIBANK") price = 1100.0;
  else if (ticker === "SBIN") price = 750.0;
  else if (ticker === "TATAMOTORS") price = 950.0;
  else if (ticker === "ITC") price = 430.0;
  else if (ticker === "LT") price = 3400.0;
  else if (ticker === "BHARTIARTL") price = 1200.0;
  else {
    // Generate deterministic stock price based on ticker name
    let codeSum = 0;
    for (let j = 0; j < ticker.length; j++) codeSum += ticker.charCodeAt(j);
    price = 100 + (codeSum % 900);
  }

  // Convert prices from INR to simulated coinbase-compatible USD internally
  price = price / USD_INR_RATE;

  let timestamp = now - numCandles * candleMs;

  let currentTrend = 0.00015; // slightly higher bullish momentum for high-quality Indian blue chips
  let trendDuration = 0;

  for (let i = 0; i < numCandles; i++) {
    if (trendDuration <= 0) {
      const isBull = random() < 0.75; // Strong Indian bull market momentum in 2026
      currentTrend = (isBull ? 0.0022 : -0.0007) * (0.5 + random());
      trendDuration = 15 + Math.floor(random() * 30);
    }
    trendDuration--;

    const volatility = 0.0015; // realistic stock volatility
    const noise = volatility * (random() - 0.5);
    const pctChange = currentTrend + noise;

    const open = price;
    const close = Math.max(0.01, price * (1 + pctChange));
    const high = Math.max(open, close) * (1 + random() * 0.001);
    const low = Math.min(open, close) * (1 - random() * 0.001);
    const volume = 100000 + random() * 5000000;

    candles.push({
      time: timestamp,
      open,
      high,
      low,
      close,
      volume
    });

    price = close;
    timestamp += candleMs;
  }
  return candles;
}

async function backtestPortfolio({
  tickers = ["RELIANCE", "TCS", "INFY", "HDFCBANK"],
  startDate = null,
  endDate = null,
  startingCapitalInINR = 10000,
  strategyName = 'PRO_INTRADAY', // Default to professional multi-indicator strategy
  strategyParams = {},
  riskManagement = { stopLossPct: 1.5, takeProfitPct: 5.0 }, // Optimal brackets for Indian Stocks
  fees = { exchangeFeePct: 0, tdsPct: 0, incomeTaxPct: 0 }, // Dhan Flat ₹10 brokerage handled in asset backtester
  tradingWindow = { startHour: 9.0, endHour: 15.0 }, // IST 9:00 AM to 3:00 PM
  useRealApiData = true, // Default to true to pull authentic stock market rates from NSE via Yahoo API
  granularity = 3600
}) {
  const allCandlesByTicker = {};
  const signalsByTicker = {};

  for (const ticker of tickers) {
    let candles = [];
    if (useRealApiData) {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const end = endDate ? new Date(endDate) : new Date();
      candles = await fetchCandles(ticker, granularity, start, end);

      if (!candles || candles.length === 0) {
        throw new Error(`[CRITICAL] Failed to fetch real candle data for ${ticker} from the live stock market API. Simulation fallback is completely disabled.`);
      }
    } else {
      // Use simulator only for fast offline test suites (where useRealApiData: false is explicitly set)
      const days = startDate ? Math.ceil((new Date(endDate || Date.now()) - new Date(startDate)) / (24 * 3600 * 1000)) : 180;
      candles = generateSimulatedCandles(ticker, days, granularity);
    }

    allCandlesByTicker[ticker] = candles;

    // Generate signals for this asset
    let signalsResult;
    if (strategyName === 'EMA') {
      signalsResult = getEMACrossoverSignals(candles, strategyParams.shortPeriod || 9, strategyParams.longPeriod || 21);
    } else if (strategyName === 'RSI') {
      signalsResult = getRSIMeanReversionSignals(candles, strategyParams.period || 14, strategyParams.overbought || 70, strategyParams.oversold || 30);
    } else if (strategyName === 'BB') {
      signalsResult = getBollingerBandsSignals(candles, strategyParams.period || 20, strategyParams.multiplier || 2);
    } else if (strategyName === 'PRO_INTRADAY') {
      signalsResult = getProIntradaySignals(candles);
    } else {
      signalsResult = getSuperSelectiveSignals(candles);
    }
    signalsByTicker[ticker] = signalsResult.signals;
  }

  // Find all unique timestamps sorted chronologically
  const tsSet = new Set();
  for (const ticker of tickers) {
    allCandlesByTicker[ticker].forEach(c => tsSet.add(c.time));
  }
  const timestamps = Array.from(tsSet).sort((a, b) => a - b);

  // Map each ticker's candles/signals by timestamp for instant lookup
  const tickerDataByTs = {};
  for (const ticker of tickers) {
    tickerDataByTs[ticker] = {};
    const candles = allCandlesByTicker[ticker];
    const signals = signalsByTicker[ticker];
    for (let i = 0; i < candles.length; i++) {
      tickerDataByTs[ticker][candles[i].time] = {
        candle: candles[i],
        signal: signals[i],
        index: i,
        closes: candles.map(c => c.close)
      };
    }
  }

  const startingCapitalInUSD = startingCapitalInINR / USD_INR_RATE;
  let liquidCapitalUSD = startingCapitalInUSD;
  const activePositions = []; // array of { ticker, type, entryTime, entryPrice, size, entryCostUSD }
  const allTrades = [];

  const maxConcurrentTrades = 3;
  const tradeAllocationPct = 0.30; // Allocate 30% of total portfolio value per trade

  // Daily trade counter to enforce strict maximum 5 trades per calendar day
  const dailyTradeCounts = {};

  // Chronological simulation loop
  for (const ts of timestamps) {
    // Determine the calendar date in Indian Standard Time (UTC+5.5 hours)
    const istDate = new Date(ts + (5.5 * 3600 * 1000));
    const dateStr = istDate.getUTCFullYear() + "-" +
                    String(istDate.getUTCMonth() + 1).padStart(2, '0') + "-" +
                    String(istDate.getUTCDate()).padStart(2, '0');

    if (!dailyTradeCounts[dateStr]) {
      dailyTradeCounts[dateStr] = 0;
    }

    // 1. Calculate current total portfolio equity
    let activePositionsValueUSD = 0;
    for (const pos of activePositions) {
      const data = tickerDataByTs[pos.ticker][ts];
      if (data) {
        const currentPrice = data.candle.close;
        const directionMult = pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1;
        const priceChangePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * directionMult;
        activePositionsValueUSD += pos.entryCostUSD + (currentPrice - pos.entryPrice) * pos.size * directionMult;
      } else {
        activePositionsValueUSD += pos.entryCostUSD;
      }
    }
    const currentEquityUSD = liquidCapitalUSD + activePositionsValueUSD;

    // 2. First, check active positions for exits (Stop Loss, Take Profit, or Force Close)
    for (let i = activePositions.length - 1; i >= 0; i--) {
      const pos = activePositions[i];
      const data = tickerDataByTs[pos.ticker][ts];
      if (!data) continue;

      const currentPrice = data.candle.close;
      const directionMult = pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1;
      const priceChangePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * directionMult;

      // Volatility-adaptive limits if not explicitly overridden
      const currentVol = getRollingVolatility(data.closes, data.index, 20);
      const adaptiveSL = Math.max(0.6, Math.min(2.5, currentVol * 100 * 0.8));
      const adaptiveTP = Math.max(1.5, Math.min(6.5, adaptiveSL * 2.5));

      const slLimit = riskManagement.stopLossPct !== undefined ? riskManagement.stopLossPct : adaptiveSL;
      const tpLimit = riskManagement.takeProfitPct !== undefined ? riskManagement.takeProfitPct : adaptiveTP;

      let shouldExit = false;
      let exitReason = '';

      if (priceChangePct <= -slLimit) {
        shouldExit = true;
        exitReason = 'STOP_LOSS';
      } else if (priceChangePct >= tpLimit) {
        shouldExit = true;
        exitReason = 'TAKE_PROFIT';
      } else if (!isWithinTradingWindow(ts, tradingWindow.startHour, tradingWindow.endHour)) {
        shouldExit = true;
        exitReason = 'INTRADAY_FORCE_CLOSE';
      } else if ((pos.type === 'LONG' || pos.type === 'BUY') && data.signal === 'SELL') {
        shouldExit = true;
        exitReason = 'OPPOSING_SIGNAL';
      } else if (pos.type === 'SHORT' && data.signal === 'BUY') {
        shouldExit = true;
        exitReason = 'OPPOSING_SIGNAL';
      }

      if (shouldExit) {
        const exitPrice = currentPrice;
        const pnlBeforeTaxAndFeesINR = (exitPrice - pos.entryPrice) * pos.size * directionMult * USD_INR_RATE;
        // Flat Dhan app rate: ₹10 round-trip brokerage (₹5 buy, ₹5 sell)
        const netPnlINR = pnlBeforeTaxAndFeesINR - 10;
        const netPnlUSD = netPnlINR / USD_INR_RATE;

        liquidCapitalUSD += (pos.entryCostUSD + netPnlUSD);

        allTrades.push({
          ticker: pos.ticker,
          type: pos.type,
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: ts,
          exitPrice,
          size: pos.size,
          exitReason,
          pnlBeforeTaxAndFees: pnlBeforeTaxAndFeesINR / USD_INR_RATE,
          exchangeFees: 10 / USD_INR_RATE,
          tds: 0,
          incomeTax: 0,
          netPnl: netPnlUSD,
          capitalAfter: liquidCapitalUSD * USD_INR_RATE
        });

        activePositions.splice(i, 1);
      }
    }

    // 3. Second, check for new entries if space is available (up to maxConcurrentTrades) and we haven't hit our daily maximum of 5 trades
    if (activePositions.length < maxConcurrentTrades && isWithinTradingWindow(ts, tradingWindow.startHour, tradingWindow.endHour) && dailyTradeCounts[dateStr] < 5) {
      for (const ticker of tickers) {
        if (activePositions.length >= maxConcurrentTrades) break;
        if (dailyTradeCounts[dateStr] >= 5) break;
        // Avoid opening duplicate positions on the same asset
        if (activePositions.some(p => p.ticker === ticker)) continue;

        const data = tickerDataByTs[ticker][ts];
        if (!data || data.signal === 'HOLD') continue;

        // Friction-Aware Adaptive Filter
        const currentVol = getRollingVolatility(data.closes, data.index, 20);
        const expectedSwingPct = currentVol * 100 * 2.0;
        if (expectedSwingPct < 0.05) continue;

        // Calculate dynamic capital allocation size
        const targetAllocatedUSD = currentEquityUSD * tradeAllocationPct;
        const actualAllocationUSD = Math.min(targetAllocatedUSD, liquidCapitalUSD - (5 / USD_INR_RATE)); // reserve flat ₹5 entry fee

        if (actualAllocationUSD > (100 / USD_INR_RATE)) { // require minimum ₹100 trade allocation
          const entryPrice = data.candle.close;
          const flatEntryFeeUSD = 5 / USD_INR_RATE;
          const netAllocatedUSD = actualAllocationUSD - flatEntryFeeUSD;
          const size = netAllocatedUSD / entryPrice;

          liquidCapitalUSD -= actualAllocationUSD;

          activePositions.push({
            ticker,
            type: data.signal === 'BUY' ? 'LONG' : 'SHORT',
            entryTime: ts,
            entryPrice,
            size,
            entryCostUSD: actualAllocationUSD
          });

          // Increment daily trade counter
          dailyTradeCounts[dateStr]++;
        }
      }
    }
  }

  // Clean up any remaining open positions at the end of backtest simulation
  if (activePositions.length > 0) {
    const finalTs = timestamps[timestamps.length - 1];
    for (const pos of activePositions) {
      const data = tickerDataByTs[pos.ticker][finalTs];
      if (!data) continue;

      const exitPrice = data.candle.close;
      const directionMult = pos.type === 'LONG' || pos.type === 'BUY' ? 1 : -1;
      const pnlBeforeTaxAndFeesINR = (exitPrice - pos.entryPrice) * pos.size * directionMult * USD_INR_RATE;
      const netPnlINR = pnlBeforeTaxAndFeesINR - 10;
      const netPnlUSD = netPnlINR / USD_INR_RATE;

      liquidCapitalUSD += (pos.entryCostUSD + netPnlUSD);

      allTrades.push({
        ticker: pos.ticker,
        type: pos.type,
        entryTime: pos.entryTime,
        entryPrice: pos.entryPrice,
        exitTime: finalTs,
        exitPrice,
        size: pos.size,
        exitReason: 'FORCE_BACKTEST_END',
        pnlBeforeTaxAndFees: pnlBeforeTaxAndFeesINR / USD_INR_RATE,
        exchangeFees: 10 / USD_INR_RATE,
        tds: 0,
        incomeTax: 0,
        netPnl: netPnlUSD,
        capitalAfter: liquidCapitalUSD * USD_INR_RATE
      });
    }
    activePositions.length = 0;
  }

  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  const dailyPnL = {};
  let totalFeesPaidUSD = 0;
  let totalTdsPaidUSD = 0;
  let totalTaxPaidUSD = 0;
  let totalGrossProfitUSD = 0;

  for (const trade of allTrades) {
    const dayStr = new Date(trade.exitTime).toISOString().slice(0, 10);
    if (!dailyPnL[dayStr]) dailyPnL[dayStr] = { netPnl: 0, beforeTaxPnL: 0, count: 0 };
    dailyPnL[dayStr].netPnl += trade.netPnl;
    dailyPnL[dayStr].beforeTaxPnL += trade.pnlBeforeTaxAndFees;
    dailyPnL[dayStr].count += 1;

    totalFeesPaidUSD += trade.exchangeFees;
    totalTdsPaidUSD += trade.tds;
    totalTaxPaidUSD += trade.incomeTax;
    totalGrossProfitUSD += trade.pnlBeforeTaxAndFees;
  }

  const daysList = Object.keys(dailyPnL).sort();
  const profitableDays = daysList.filter(day => dailyPnL[day].netPnl > 0).length;
  const dailyWinRate = daysList.length > 0 ? (profitableDays / daysList.length) * 100 : 0;

  const finalCapitalInINR = liquidCapitalUSD * USD_INR_RATE;
  const netProfitInINR = finalCapitalInINR - startingCapitalInINR;

  return {
    startingCapitalInINR,
    finalCapitalInINR,
    netProfitInINR,
    netProfitInUSD: liquidCapitalUSD - startingCapitalInUSD,
    usdInrRate: USD_INR_RATE,
    totalTrades: allTrades.length,
    winningTrades: allTrades.filter(t => t.netPnl > 0).length,
    losingTrades: allTrades.filter(t => t.netPnl <= 0).length,
    winRate: allTrades.length > 0 ? (allTrades.filter(t => t.netPnl > 0).length / allTrades.length) * 100 : 0,
    dailyWinRate,
    profitableDaysCount: profitableDays,
    totalDaysCount: daysList.length,
    totalExchangeFeesPaidInINR: totalFeesPaidUSD * USD_INR_RATE,
    totalTdsPaidInINR: totalTdsPaidUSD * USD_INR_RATE,
    totalTaxPaidInINR: totalTaxPaidUSD * USD_INR_RATE,
    totalGrossProfitInINR: totalGrossProfitUSD * USD_INR_RATE,
    trades: allTrades,
    dailyPnLList: daysList.map(day => ({
      date: day,
      netPnlInINR: dailyPnL[day].netPnl * USD_INR_RATE,
      beforeTaxPnLInINR: dailyPnL[day].beforeTaxPnL * USD_INR_RATE,
      tradeCount: dailyPnL[day].count
    }))
  };
}

// Complete sweep across strategies, parameters, time resolution intervals, stop losses, and take profit targets
async function optimizePortfolio({
  tickers = ["RELIANCE", "TCS", "INFY", "HDFCBANK"],
  startDate = null,
  endDate = null,
  startingCapitalInINR = 10000,
  tradingWindow = { startHour: 9.0, endHour: 15.0 }
}) {
  const strategiesToTry = [
    { name: 'PRO_INTRADAY', params: {}, sl: 1.0, tp: 3.5, g: 3600 },
    { name: 'PRO_INTRADAY', params: {}, sl: 1.5, tp: 5.0, g: 3600 },
    { name: 'PRO_INTRADAY', params: {}, sl: 2.0, tp: 6.5, g: 3600 },
    { name: 'SELECTIVE', params: {}, sl: 1.5, tp: 5.0, g: 3600 },

    // Sweep Short & Long EMAs (from 5 to 35 and 12 to 50)
    { name: 'EMA', params: { shortPeriod: 5, longPeriod: 12 }, sl: 1.0, tp: 3.5, g: 3600 },
    { name: 'EMA', params: { shortPeriod: 9, longPeriod: 21 }, sl: 1.5, tp: 5.0, g: 3600 },
    { name: 'EMA', params: { shortPeriod: 12, longPeriod: 26 }, sl: 1.5, tp: 5.5, g: 3600 },
    { name: 'EMA', params: { shortPeriod: 20, longPeriod: 50 }, sl: 2.0, tp: 6.0, g: 3600 },

    // Sweep RSI Boundaries (Oversold 25-30, Overbought 70-75)
    { name: 'RSI', params: { period: 14, overbought: 70, oversold: 30 }, sl: 1.2, tp: 4.0, g: 3600 },
    { name: 'RSI', params: { period: 10, overbought: 75, oversold: 25 }, sl: 1.5, tp: 5.0, g: 3600 },

    // Sweep Bollinger Band Multipliers (1.5 to 2.5)
    { name: 'BB', params: { period: 20, multiplier: 1.8 }, sl: 1.2, tp: 4.0, g: 3600 },
    { name: 'BB', params: { period: 20, multiplier: 2.0 }, sl: 1.5, tp: 5.0, g: 3600 },
    { name: 'BB', params: { period: 15, multiplier: 2.2 }, sl: 2.0, tp: 6.0, g: 3600 }
  ];

  let bestResult = null;
  let bestScore = -Infinity;

  for (const config of strategiesToTry) {
    const result = await backtestPortfolio({
      tickers,
      startDate,
      endDate,
      startingCapitalInINR,
      strategyName: config.name,
      strategyParams: config.params,
      riskManagement: { stopLossPct: config.sl, takeProfitPct: config.tp },
      tradingWindow,
      useRealApiData: false, // use deterministic simulated candles for swifter sweeps
      granularity: config.g
    });

    // Score based on maximizing daily profitable rate (priority target > 80%) and final net returns
    const winRateScore = result.dailyWinRate;
    const returnScore = result.netProfitInINR > 0 ? (result.netProfitInINR / startingCapitalInINR) * 100 : -100;
    const score = (winRateScore * 10) + returnScore;

    if (score > bestScore) {
      bestScore = score;
      bestResult = {
        config: {
          strategyName: config.name,
          strategyParams: config.params,
          riskManagement: { stopLossPct: config.sl, takeProfitPct: config.tp },
          granularity: config.g
        },
        result
      };
    }
  }

  return bestResult;
}

module.exports = {
  backtestPortfolio,
  optimizePortfolio,
  USD_INR_RATE
};
