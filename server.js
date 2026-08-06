// Express Web Server and API
const express = require('express');
const path = require('path');
const { botState, loadState, saveState, runTick, closePosition } = require('./live_trader');
const { backtestPortfolio, optimizePortfolio, USD_INR_RATE } = require('./backtester');
const { POPULAR_TICKERS } = require('./strategies');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

loadState();

let tickInterval = setInterval(async () => {
  try {
    if (botState.isRunning) {
      await runTick();
    }
  } catch (err) {
    console.error(`[SERVER] Error in tick interval: ${err.message}`);
  }
}, 5000);

app.get('/api/state', (req, res) => {
  res.json({
    botState,
    allTickers: POPULAR_TICKERS
  });
});

app.post('/api/toggle', (req, res) => {
  const { isRunning } = req.body;
  if (typeof isRunning === 'boolean') {
    botState.isRunning = isRunning;
    saveState();
    res.json({ success: true, isRunning: botState.isRunning });
  } else {
    res.status(400).json({ error: 'Invalid isRunning status' });
  }
});

app.post('/api/settings', (req, res) => {
  const { capitalInINR, apiConfig, tradingWindow, strategyConfig, fees } = req.body;

  if (capitalInINR !== undefined) botState.capitalInINR = parseFloat(capitalInINR);
  if (apiConfig) botState.apiConfig = { ...botState.apiConfig, ...apiConfig };
  if (tradingWindow) botState.tradingWindow = { ...botState.tradingWindow, ...tradingWindow };
  if (strategyConfig) botState.strategyConfig = { ...botState.strategyConfig, ...strategyConfig };
  if (fees) botState.fees = { ...botState.fees, ...fees };

  saveState();
  res.json({ success: true, botState });
});

app.post('/api/backtest', async (req, res) => {
  try {
    const {
      tickers,
      startDate,
      endDate,
      startingCapitalInINR,
      strategyName,
      strategyParams,
      riskManagement,
      tradingWindow,
      useRealApiData,
      granularity
    } = req.body;

    const result = await backtestPortfolio({
      tickers: tickers || ["BTC-USD", "ETH-USD"],
      startDate,
      endDate,
      startingCapitalInINR: parseFloat(startingCapitalInINR) || 10000,
      strategyName: strategyName || 'EMA',
      strategyParams: strategyParams || {},
      riskManagement: riskManagement || { stopLossPct: 1.0, takeProfitPct: 2.5 },
      tradingWindow: tradingWindow || { startHour: 10, endHour: 16 },
      useRealApiData: !!useRealApiData,
      granularity: parseInt(granularity) || 300
    });

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/optimize', async (req, res) => {
  try {
    const { tickers, startDate, endDate, startingCapitalInINR, tradingWindow } = req.body;

    const bestResult = await optimizePortfolio({
      tickers: tickers || ["BTC-USD", "ETH-USD"],
      startDate,
      endDate,
      startingCapitalInINR: parseFloat(startingCapitalInINR) || 10000,
      tradingWindow: tradingWindow || { startHour: 10, endHour: 16 }
    });

    res.json({ success: true, bestResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual_trade', (req, res) => {
  try {
    const { ticker, type, entryPrice } = req.body;
    if (!ticker || !type || !entryPrice) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const price = parseFloat(entryPrice);
    const allocCapitalINR = botState.capitalInINR * 0.2;
    if (allocCapitalINR < 100) {
      return res.status(400).json({ error: 'Insufficient capital' });
    }

    const allocUSD = allocCapitalINR / botState.usdInrRate;
    const entryFeeUSD = allocUSD * (botState.fees.exchangeFeePct / 100);
    const netUSD = allocUSD - entryFeeUSD;
    const size = netUSD / price;

    const newPos = {
      ticker,
      type: type.toUpperCase(),
      entryTime: Date.now(),
      entryPrice: price,
      size,
      entryCostINR: allocCapitalINR,
      entryFeeINR: entryFeeUSD * botState.usdInrRate,
      currentPrice: price,
      unrealizedPnl: 0
    };

    botState.activePositions.push(newPos);
    botState.capitalInINR -= allocCapitalINR;
    saveState();

    res.json({ success: true, botState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual_close', async (req, res) => {
  try {
    const { ticker } = req.body;
    const pos = botState.activePositions.find(p => p.ticker === ticker);
    if (!pos) {
      return res.status(404).json({ error: 'No active position found' });
    }

    await closePosition(pos, 'MANUAL_CLOSE_OVERRIDE');
    res.json({ success: true, botState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  const { startingCapitalInINR } = req.body;
  const resetCapital = parseFloat(startingCapitalInINR) || 10000;

  botState.capitalInINR = resetCapital;
  botState.startingCapitalInINR = resetCapital;
  botState.activePositions = [];
  botState.tradeHistory = [];
  saveState();

  res.json({ success: true, botState });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`[SERVER] Intraday Trading Dashboard running on http://localhost:${PORT}`);
});

module.exports = server;
