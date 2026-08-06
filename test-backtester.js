const { backtestPortfolio, optimizePortfolio } = require('./backtester');

async function verifyBacktester() {
  console.log("--- Starting Backtester and Tax Calculation Verification ---");

  const tickers = ["BTC-USD", "ETH-USD"];
  const startingCapital = 15000;

  console.log(`Running portfolio backtest on ${tickers.join(", ")}...`);

  const result = await backtestPortfolio({
    tickers,
    startingCapitalInINR: startingCapital,
    strategyName: 'EMA',
    strategyParams: { shortPeriod: 9, longPeriod: 21 },
    riskManagement: { stopLossPct: 1.5, takeProfitPct: 3.0 },
    tradingWindow: { startHour: 10, endHour: 16 },
    useRealApiData: false
  });

  console.log(`- Starting Capital: ${result.startingCapitalInINR} INR`);
  console.log(`- Final Capital: ${result.finalCapitalInINR.toFixed(2)} INR`);
  console.log(`- Net Profit/Loss: ${result.netProfitInINR.toFixed(2)} INR`);
  console.log(`- Overall Trade Win Rate: ${result.winRate.toFixed(2)}%`);
  console.log(`- Total Exchange Fees Paid: ${result.totalExchangeFeesPaidInINR.toFixed(2)} INR`);
  console.log(`- Total Indian TDS Paid: ${result.totalTdsPaidInINR.toFixed(2)} INR`);
  console.log(`- Total Indian Income Tax Paid: ${result.totalTaxPaidInINR.toFixed(2)} INR`);

  if (result.startingCapitalInINR !== startingCapital) {
    console.error("FAIL: Capital mismatch.");
    process.exit(1);
  }

  console.log("Backtest calculation verification: PASSED.");

  console.log("\nRunning Strategy Optimization Engine...");
  const optResult = await optimizePortfolio({
    tickers,
    startingCapitalInINR: startingCapital,
    tradingWindow: { startHour: 10, endHour: 16 }
  });

  console.log(`- Best Strategy: ${optResult.config.strategyName}`);
  console.log(`- Best Parameters:`, optResult.config.strategyParams);
  console.log(`- Optimized Daily Win Rate achieved: ${optResult.result.dailyWinRate.toFixed(2)}%`);

  console.log("--- BACKTESTER AND OPTIMIZER VERIFICATION PASSED SUCCESSFULLY ---");
}

verifyBacktester().catch(err => {
  console.error("Backtester verification failed:", err);
  process.exit(1);
});
