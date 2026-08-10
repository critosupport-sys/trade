const { backtestPortfolio } = require('./backtester');

async function runJuneJuly2026Backtest() {
  console.log("================================================================================");
  console.log("       INDIAN STOCK MARKET INTRADAY BACKTEST: JUNE & JULY 2026 (9 AM - 3 PM)");
  console.log("================================================================================");

  const startingCapital = 10000; // also support checking ₹100,000 as requested
  const tickers = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"];

  console.log(`\n--- RUNNING BACKTEST FOR CAPITAL: ₹${startingCapital.toLocaleString()} ---`);
  const result10k = await backtestPortfolio({
    tickers,
    startDate: "2026-06-01",
    endDate: "2026-07-31",
    startingCapitalInINR: startingCapital,
    strategyName: "PRO_INTRADAY",
    riskManagement: { stopLossPct: 1.5, takeProfitPct: 5.0 },
    tradingWindow: { startHour: 9.0, endHour: 15.0 },
    useRealApiData: false,
    granularity: 900
  });

  console.log(`- Net Profit achieved: ₹${result10k.netProfitInINR.toFixed(2)} (${((result10k.netProfitInINR / startingCapital) * 100).toFixed(2)}% Return)`);
  console.log(`- Final capital value: ₹${result10k.finalCapitalInINR.toFixed(2)}`);
  console.log(`- Total Trades executed: ${result10k.totalTrades} (${result10k.winningTrades} Wins / ${result10k.losingTrades} Losses)`);
  console.log(`- Trade Win Rate: ${result10k.winRate.toFixed(2)}%`);
  console.log(`- Daily Win Rate: ${result10k.dailyWinRate.toFixed(2)}%`);
  console.log(`- Total Dhan Brokerage Paid: ₹${result10k.totalExchangeFeesPaidInINR.toFixed(2)}`);

  const startingCapitalLarge = 100000;
  console.log(`\n--- RUNNING BACKTEST FOR CAPITAL: ₹${startingCapitalLarge.toLocaleString()} ---`);
  const result100k = await backtestPortfolio({
    tickers,
    startDate: "2026-06-01",
    endDate: "2026-07-31",
    startingCapitalInINR: startingCapitalLarge,
    strategyName: "PRO_INTRADAY",
    riskManagement: { stopLossPct: 1.5, takeProfitPct: 5.0 },
    tradingWindow: { startHour: 9.0, endHour: 15.0 },
    useRealApiData: false,
    granularity: 900
  });

  console.log(`- Net Profit achieved: ₹${result100k.netProfitInINR.toFixed(2)} (${((result100k.netProfitInINR / startingCapitalLarge) * 100).toFixed(2)}% Return)`);
  console.log(`- Final capital value: ₹${result100k.finalCapitalInINR.toFixed(2)}`);
  console.log(`- Total Trades executed: ${result100k.totalTrades} (${result100k.winningTrades} Wins / ${result100k.losingTrades} Losses)`);
  console.log(`- Trade Win Rate: ${result100k.winRate.toFixed(2)}%`);
  console.log(`- Daily Win Rate: ${result100k.dailyWinRate.toFixed(2)}%`);
  console.log(`- Total Dhan Brokerage Paid: ₹${result100k.totalExchangeFeesPaidInINR.toFixed(2)}`);

  console.log("\n================================================================================");
  console.log("                         DAILY TRADE LOG BREAKDOWN");
  console.log("================================================================================");

  result100k.dailyPnLList.forEach(day => {
    const status = day.netPnlInINR >= 0 ? "PROFIT" : "LOSS  ";
    console.log(`Date: ${day.date} | Net P&L: ₹${day.netPnlInINR.toFixed(2).padStart(8)} | Status: ${status} | Trades: ${day.tradeCount}`);
  });

  console.log("================================================================================");
}

runJuneJuly2026Backtest().catch(console.error);
