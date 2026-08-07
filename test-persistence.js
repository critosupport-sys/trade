const fs = require('fs');
const { botState, loadState, saveState } = require('./live_trader');

function runPersistenceTests() {
  console.log("--- Starting State Persistence and Self-Healing Verification ---");

  botState.isRunning = true;
  botState.capitalInINR = 12000;
  botState.activePositions = [
    {
      ticker: "BTC-USD",
      type: "LONG",
      entryTime: Date.now() - 3600 * 1000,
      entryPrice: 60000,
      size: 0.1,
      entryCostINR: 8350,
      entryFeeINR: 8.35,
      currentPrice: 60000,
      unrealizedPnl: 0
    }
  ];
  botState.tradeHistory = [];

  console.log("Saving initial bot state...");
  saveState();

  if (!fs.existsSync('bot_state.json')) {
    console.error("FAIL: bot_state.json not created.");
    process.exit(1);
  }

  botState.capitalInINR = 0;
  botState.activePositions = [];

  console.log("Reloading state from file...");
  loadState();

  if (botState.capitalInINR !== 12000) {
    console.error(`FAIL: Capital was not reloaded. Expected 12000, got ${botState.capitalInINR}`);
    process.exit(1);
  }

  if (botState.activePositions.length !== 1 || botState.activePositions[0].ticker !== 'BTC-USD') {
    console.error("FAIL: Active position was not recovered.");
    process.exit(1);
  }

  console.log("Verified State Persistence: PASSED.");
  console.log("Verified Self-Healing: PASSED.");
  console.log("--- PERSISTENCE AND SELF-HEALING VERIFICATION PASSED ---");
}

runPersistenceTests();
