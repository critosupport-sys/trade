// Backtesting Engine Module
const { fetchCandles, getEMACrossoverSignals, getRSIMeanReversionSignals, getBollingerBandsSignals, getSuperSelectiveSignals } = require('./strategies');

const USD_INR_RATE = 83.5;

function isWithinTradingWindow(timestamp, startHour, endHour) {
  const date = new Date(timestamp);
  const hour = date.getUTCHours();
  return hour >= startHour && hour < endHour;
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
  tradingWindow = { startHour: 0, endHour: 24 }
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
        const grossValue = activePosition.size * exitPrice;

        const exitExchangeFee = grossValue * (fees.exchangeFeePct / 100);
        const tdsFee = grossValue * (fees.tdsPct / 100);
        const exitNetValue = grossValue - exitExchangeFee - tdsFee;

        // Correct Symmetric Short P&L Calculations
        const pnlBeforeTaxAndFees = (exitPrice - activePosition.entryPrice) * activePosition.size * directionMult;

        const netPnl = directionMult === 1
          ? (exitNetValue - activePosition.entryCost)
          : ((activePosition.entryPrice - exitPrice) * activePosition.size - exitExchangeFee - tdsFee - activePosition.entryExchangeFee);

        let incomeTax = 0;
        if (netPnl > 0) {
          incomeTax = netPnl * (fees.incomeTaxPct / 100);
        }

        const finalNetPnl = netPnl - incomeTax;
        capital += (activePosition.entryCost + finalNetPnl);

        trades.push({
          ticker,
          type: activePosition.type,
          entryTime: activePosition.entryTime,
          entryPrice: activePosition.entryPrice,
          exitTime: timestamp,
          exitPrice,
          size: activePosition.size,
          exitReason,
          pnlBeforeTaxAndFees,
          exchangeFees: activePosition.entryExchangeFee + exitExchangeFee,
          tds: tdsFee,
          incomeTax,
          netPnl: finalNetPnl,
          capitalAfter: capital
        });

        activePosition = null;
      }
    }

    if (!activePosition && isWithinTradingWindow(timestamp, tradingWindow.startHour, tradingWindow.endHour)) {
      if (signal === 'BUY') {
        const entryPrice = candle.close;
        const entryExchangeFee = capital * (fees.exchangeFeePct / 100);
        const netAllocated = capital - entryExchangeFee;
        const size = netAllocated / entryPrice;

        activePosition = {
          ticker,
          type: 'LONG',
          entryTime: timestamp,
          entryPrice,
          size,
          entryCost: capital,
          entryExchangeFee
        };

        capital = 0;
      } else if (signal === 'SELL') {
        // Profitable Short Selling (Symmetric Short Trades)
        const entryPrice = candle.close;
        const entryExchangeFee = capital * (fees.exchangeFeePct / 100);
        const netAllocated = capital - entryExchangeFee;
        const size = netAllocated / entryPrice;

        activePosition = {
          ticker,
          type: 'SHORT',
          entryTime: timestamp,
          entryPrice,
          size,
          entryCost: capital,
          entryExchangeFee
        };

        capital = 0;
      }
    }
  }

  if (activePosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const grossValue = activePosition.size * exitPrice;

    const exitExchangeFee = grossValue * (fees.exchangeFeePct / 100);
    const tdsFee = grossValue * (fees.tdsPct / 100);
    const exitNetValue = grossValue - exitExchangeFee - tdsFee;

    const directionMult = activePosition.type === 'LONG' || activePosition.type === 'BUY' ? 1 : -1;
    const pnlBeforeTaxAndFees = (exitPrice - activePosition.entryPrice) * activePosition.size * directionMult;

    const netPnl = directionMult === 1
      ? (exitNetValue - activePosition.entryCost)
      : ((activePosition.entryPrice - exitPrice) * activePosition.size - exitExchangeFee - tdsFee - activePosition.entryExchangeFee);

    let incomeTax = 0;
    if (netPnl > 0) {
      incomeTax = netPnl * (fees.incomeTaxPct / 100);
    }
    const finalNetPnl = netPnl - incomeTax;
    capital += (activePosition.entryCost + finalNetPnl);

    trades.push({
      ticker,
      type: activePosition.type,
      entryTime: activePosition.entryTime,
      entryPrice: activePosition.entryPrice,
      exitTime: lastCandle.time,
      exitPrice,
      size: activePosition.size,
      exitReason: 'FORCE_BACKTEST_END',
      pnlBeforeTaxAndFees,
      exchangeFees: activePosition.entryExchangeFee + exitExchangeFee,
      tds: tdsFee,
      incomeTax,
      netPnl: finalNetPnl,
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

  let price = ticker.startsWith("BTC") ? 60000 : ticker.startsWith("ETH") ? 3000 : ticker.startsWith("SOL") ? 140 : 1.0;
  let timestamp = now - numCandles * candleMs;

  let currentTrend = 0.0001;
  let trendDuration = 0;

  for (let i = 0; i < numCandles; i++) {
    if (trendDuration <= 0) {
      const isBull = random() < 0.65;
      currentTrend = (isBull ? 0.0012 : -0.001) * (0.5 + random());
      trendDuration = 20 + Math.floor(random() * 40);
    }
    trendDuration--;

    const volatility = ticker.startsWith("BTC") || ticker.startsWith("ETH") ? 0.001 : 0.0025;
    const noise = volatility * (random() - 0.5);
    const pctChange = currentTrend + noise;

    const open = price;
    const close = Math.max(0.01, price * (1 + pctChange));
    const high = Math.max(open, close) * (1 + random() * 0.0015);
    const low = Math.min(open, close) * (1 - random() * 0.0015);
    const volume = 10000 + random() * 1000000;

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
  tickers = ["BTC-USD", "ETH-USD", "SOL-USD"],
  startDate = null,
  endDate = null,
  startingCapitalInINR = 10000,
  strategyName = 'SELECTIVE', // Default to super selective high-gain macro trend strategy
  strategyParams = {},
  riskManagement = { stopLossPct: 2.0, takeProfitPct: 8.0 }, // Dynamic baseline (2% stop loss, 8% take profit target)
  fees = { exchangeFeePct: 0.1, tdsPct: 1.0, incomeTaxPct: 30.0 },
  tradingWindow = { startHour: 0, endHour: 24 },
  useRealApiData = true,
  granularity = 3600 // default to 1h for noise-free selective intraday
}) {
  const allCandlesByTicker = {};

  for (const ticker of tickers) {
    let candles = [];
    if (useRealApiData) {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const end = endDate ? new Date(endDate) : new Date();
      candles = await fetchCandles(ticker, granularity, start, end);
    }

    if (candles.length === 0) {
      const days = startDate ? Math.ceil((new Date(endDate || Date.now()) - new Date(startDate)) / (24 * 3600 * 1000)) : 180;
      candles = generateSimulatedCandles(ticker, days, granularity);
    }
    allCandlesByTicker[ticker] = candles;
  }

  const startingCapitalInUSD = startingCapitalInINR / USD_INR_RATE;
  let capitalInUSD = startingCapitalInUSD;

  const tradeableCapitalRatio = 0.8;
  const portfolioAllocatedUSD = capitalInUSD * tradeableCapitalRatio;
  const reserveCapitalUSD = capitalInUSD * (1 - tradeableCapitalRatio);
  const capitalPerTickerUSD = portfolioAllocatedUSD / tickers.length;

  let allTrades = [];
  let finalPortfolioValueUSD = reserveCapitalUSD;

  for (const ticker of tickers) {
    const candles = allCandlesByTicker[ticker];
    const result = backtestAsset({
      ticker,
      candles,
      startingCapital: capitalPerTickerUSD,
      strategyName,
      strategyParams,
      riskManagement,
      fees,
      tradingWindow
    });

    allTrades = allTrades.concat(result.trades);
    finalPortfolioValueUSD += result.finalCapital;
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

  const finalCapitalInINR = finalPortfolioValueUSD * USD_INR_RATE;
  const netProfitInINR = finalCapitalInINR - startingCapitalInINR;

  return {
    startingCapitalInINR,
    finalCapitalInINR,
    netProfitInINR,
    netProfitInUSD: finalPortfolioValueUSD - startingCapitalInUSD,
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
  tickers = ["BTC-USD", "ETH-USD", "SOL-USD"],
  startDate = null,
  endDate = null,
  startingCapitalInINR = 10000,
  tradingWindow = { startHour: 0, endHour: 24 }
}) {
  const strategiesToTry = [
    { name: 'SELECTIVE', params: {}, sl: 2.0, tp: 8.0, g: 3600 },
    { name: 'SELECTIVE', params: {}, sl: 1.5, tp: 6.0, g: 3600 },
    { name: 'EMA', params: { shortPeriod: 9, longPeriod: 21 }, sl: 1.0, tp: 2.5, g: 900 },
    { name: 'EMA', params: { shortPeriod: 5, longPeriod: 15 }, sl: 1.2, tp: 3.0, g: 900 },
    { name: 'RSI', params: { period: 14, overbought: 70, oversold: 30 }, sl: 1.5, tp: 3.5, g: 900 },
    { name: 'RSI', params: { period: 10, overbought: 75, oversold: 25 }, sl: 1.0, tp: 4.0, g: 300 },
    { name: 'BB', params: { period: 20, multiplier: 2.0 }, sl: 1.5, tp: 3.0, g: 900 },
    { name: 'BB', params: { period: 15, multiplier: 1.8 }, sl: 1.2, tp: 2.5, g: 300 }
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
