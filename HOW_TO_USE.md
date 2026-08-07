# Crypto Intraday Algo Bot & Dashboard Operation Manual

This guide provides step-by-step instructions on operating, backtesting, and configuring the multi-page Intraday Trading Bot.

---

## 📊 1. Legit Backtesting Engine (Page 1)

The **Legit Backtesting Engine** uses real historical OHLC candle data (from the free Coinbase API or a high-fidelity market simulator if rate limits are hit) to verify how the strategies would have performed over custom timeframes.

### Step-by-Step Backtest:
1. Open the dashboard and make sure you are on the **Legit Backtesting Engine** tab.
2. **Backtest Capital**: Input your desired trading capital in Rupees (INR).
3. **Custom Date Range**: Choose your historical window. We recommend a 6-month period.
4. **Select Strategy**: Choose between *Super Selective*, *EMA Crossover*, *RSI Mean Reversion*, or *Bollinger Bands*.
5. **Set Bracket Orders**:
   - **Stop-Loss (%)**: Maximum loss percentage per trade before automatic exit (e.g., `2.0%`).
   - **Take-Profit (%)**: Profit target percentage per trade (e.g., `8.0%`).
6. **Resolution**: Select `1 Hour` (recommended) or `15 Minutes` for accurate intraday signal generation.
7. **Trading Window**: Set the hours (e.g. `10` to `16` UTC) during which the bot is allowed to search for entries. All trades are forced closed before the end of the 6th hour.
8. **Click "Run Backtest"**: The system will fetch data and process the simulation. Detailed line charts of your capital growth, high-level metrics, tax summaries, and an interactive ledger showing every executed trade will be rendered!

### Strategy Auto-Optimization Mode:
- Click **"Auto-Optimize Strategy Config"** to trigger the optimization engine.
- The bot will try multiple combinations of technical strategies, moving average periods, time resolutions, and stop-loss/take-profit brackets.
- It selects the exact parameter combination that maximizes profitable days (aiming for `>80%` win rate) and automatically updates the dashboard configuration fields.

---

## 📈 2. Live Paper Trading (Page 2)

The **Live Paper Trading** tab runs a real-time trading simulator loop that scans top markets (BTC, ETH, SOL, etc.) and paper-trades in the live market using demo funds.

### Running Automated Trades:
1. Click the **"START ALGO BOT"** button at the top-right corner.
2. The bot's status will change to a flashing green **"ACTIVE ALGO BOT"** indicator.
3. Every 5 seconds, the bot will pull live prices from the exchange and check if any strategy signals are triggered inside your active trading window hours.
4. When a signal triggers, the bot allocates **80% of its current balance** to open a trade.
5. In the **Active Open Positions** panel, you will see your open positions, entry prices, sizes, and **real-time updating unrealized P&L in Rupees (INR)**.
6. If the live price moves against your position by the Stop-Loss limit or goes up to your Take-Profit target, the bot will instantly execute a sell order and book the trade.
7. Closed trades are written to the trade history table, and your capital balance is updated.

---

## 💼 3. Live Actual Trading (Page 3)

The **Live Actual Trading** tab executes real orders with your actual trading balance using exchange credentials.

### Setting Up Actual Money:
1. Ensure your keys are entered in the settings panel.
2. Under the Live Actual Trading tab, click **"START LIVE ACTUAL ALGO"**.
3. It uses the exact same risk profiles and 6-hour window rules as the paper setup but executes the orders on your real account.
4. Includes manual liquidated triggers to close positions instantly in emergencies.

---

## ⚙️ 4. Control Settings & APIs

Use the **Control Settings & API Key** page to manage connection keys, tax rates, and parameters:
- **Brokerage Selector**: Choose between standard Binance Demo, Alpaca Paper/Live, or Binance Live API keys.
- **API and Secret Keys**: Input your exchange credentials. If Binance Demo is selected, you don't need real keys; the bot will safely operate in demo mode.
- **Taxes & Fees**:
  - Customize the Flat Capital Gains Tax (defaults to `30%` per Indian Section 115BBH rules).
  - Customize the TDS on Sells (defaults to `1%`).
  - Customize exchange fee (defaults to `0.1%` maker/taker fee).

---

## 🔌 5. Self-Healing & Reconnection Logic

Network drops can occur when running automated trading bots. Our platform includes **advanced self-healing mechanisms**:
1. **Network Drop Tolerance**: If your internet connection goes down, the bot's live loop will log warnings but will *not* crash. It will attempt to reconnect on every 5-second tick.
2. **Crash & Reboot Protection**: The bot writes its state (balances, open trades, keys, and history) to `bot_state.json` on every state change.
3. **Automatic Restoration**: If the bot process is stopped, restarted, or the computer reboots, simply restart the bot using `start.bat`. On startup, it will parse `bot_state.json` and restore all active positions and capital exactly where it left off, avoiding loss of tracking.
