# Crypto Intraday Algo Bot & Dashboard Operation Manual

This guide provides step-by-step instructions on operating, backtesting, and configuring the Intraday Trading Bot and Dashboard.

---

## 📊 1. Backtesting Engine Guide

The **Legit Backtesting Engine** uses real historical OHLC candle data (from the free Coinbase API or a high-fidelity market regime momentum simulator if rate limits are hit) to verify how the strategies would have performed over custom timeframes.

### Step-by-Step Backtest:
1. Open the dashboard and make sure you are on the **Legit Backtesting Engine** tab.
2. **Backtest Capital**: Input your desired trading capital in Rupees (INR). The engine converts it dynamically using the live rate (e.g. ₹83.50 per USD). It can handle any amount, such as ₹10,000, ₹50,000, or ₹1,00,000.
3. **Custom Date Range**: Choose your historical window. We recommend a 6-month period (e.g., from Feb 2026 to Aug 2026).
4. **Select Strategy**: Choose between *EMA Crossover*, *RSI Mean Reversion*, or *Bollinger Bands*.
5. **Set Bracket Orders**:
   - **Stop-Loss (%)**: Maximum loss percentage per trade before automatic exit (e.g., `1.0%`).
   - **Take-Profit (%)**: Profit target percentage per trade (e.g., `2.5%`).
6. **Resolution**: Select `5 Minutes` or `15 Minutes` for accurate intraday signal generation.
7. **Trading Window**: Set the hours (e.g. `10` to `16` UTC) during which the bot is allowed to search for entries. All trades are forced closed before the end of the 6th hour.
8. **Click "Run Backtest"**: The system will fetch data and process the simulation. A detailed line chart of your capital growth, high-level metrics, tax summaries, and an interactive ledger showing every executed trade will be rendered!

### Strategy Auto-Optimization Mode:
- Click **"Auto-Optimize Strategy Config"** to trigger the optimization engine.
- The bot will try multiple combinations of technical strategies, moving average periods, and stop-loss/take-profit brackets.
- It selects the exact parameter combination that maximizes profitable days (aiming for `>80%` win rate) and automatically updates the dashboard configuration fields.

---

## 📈 2. Live / Demo Paper Trading

The **Live / Demo Paper Trading** tab runs a real-time trading simulator loop that scans top markets (BTC, ETH, SOL, etc.) and paper-trades in the live market using demo funds.

### Running Automated Trades:
1. Click the **"START ALGO BOT"** button at the top-right corner.
2. The bot's status will change to a flashing green **"ACTIVE ALGO BOT"** indicator.
3. Every 5 seconds, the bot will pull live prices from the exchange and check if any strategy signals are triggered inside your active trading window hours.
4. When a BUY signal triggers, the bot allocates **80% of its current balance** (split among available spots up to 5 concurrent positions) to open a trade.
5. In the **Active Open Positions** panel, you will see your open positions, entry prices, sizes, and **real-time updating unrealized P&L in Rupees (INR)**.
6. If the live price moves against your position by the Stop-Loss limit or goes up to your Take-Profit target, the bot will instantly execute a sell order and book the trade.
7. Closed trades are written to the trade history table, and your capital balance is updated.

### Manual Overrides:
- **Submit Manual Paper Order**: Use the manual execution card to test or place arbitrary paper trades instantly by picking a token, direction, and entering a entry price.
- **Force Close Position**: Click **"FORCE CLOSE"** on any active position card to exit that trade instantly at the current price and book the profit/loss immediately.
- **Reset Logs & Capital**: Click **"Reset Capital & Logs"** to restore your demo account balance to ₹10,000 and clear active histories.

---

## ⚙️ 3. Settings & Credentials

Use the **Control Settings & API Key** page to manage connection keys, tax rates, and parameters:
- **Brokerage Selector**: Choose between standard Binance Demo, Alpaca Paper/Live, or Binance Live API keys.
- **API and Secret Keys**: Input your exchange credentials. If Binance Demo is selected, you don't need real keys; the bot will safely operate in demo mode.
- **Taxes & Fees**:
  - Customize the Flat Capital Gains Tax (defaults to `30%` per Indian Section 115BBH rules).
  - Customize the TDS on Sells (defaults to `1%`).
  - Customize exchange fee (defaults to `0.1%` maker/taker fee).

---

## 🔌 4. Self-Healing & Reconnection Logic

Network drops can occur when running automated trading bots. Our platform includes **advanced self-healing mechanisms**:
1. **Network Drop Tolerance**: If your internet connection goes down, the bot's live loop will log warnings but will *not* crash. It will attempt to reconnect on every 5-second tick.
2. **Crash & Reboot Protection**: The bot writes its state (balances, open trades, keys, and history) to `bot_state.json` on every state change.
3. **Automatic Restoration**: If the bot process is stopped, restarted, or the computer reboots, simply restart the bot using `start.bat`. On startup, it will parse `bot_state.json` and restore all active positions and capital exactly where it left off, avoiding loss of tracking.
