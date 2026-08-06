# Premium Crypto Intraday Algo Bot & Backtesting Dashboard

An extremely robust, institutional-grade automated trading bot and responsive light-themed dashboard optimized for Indian crypto traders. It features automatic parameter optimization, customizable 6-hour trading windows, multi-asset portfolio capital allocation, strict risk management, state persistence with self-healing, and realistic Indian tax/fee calculations.

---

## 🌟 Key Features

1. **Customizable 6-Hour Intraday Trading Window**:
   - Strictly opens and closes positions within the user-specified daily window (e.g., 10:00 to 16:00 UTC).
   - Prevents overnight exposure and avoids emotional or panic-driven manual exit decisions.

2. **Multi-Asset Capital Allocation (80% Capital Rule)**:
   - Allocates up to 80% of total capital across 100+ top cryptocurrency spot tickers concurrently.
   - Divides capital dynamically to trade multiple high-value opportunities simultaneously without over-exposing reserves.

3. **Premium Strategy Suite**:
   - **EMA Crossover**: Custom-tuned short/long EMA periods (e.g., 9 vs 21) capturing momentum.
   - **RSI Mean Reversion**: Spots extreme overbought/oversold levels.
   - **Bollinger Bands**: Trades range breakout and reversion.

4. **Institutional Risk Management Bracket**:
   - Custom Stop-Loss and Take-Profit guardrails applied to every trade.
   - Automatic intraday forced liquidation before daily trading window closes.

5. **Realistic Indian Crypto Taxation & Fee Simulator**:
   - **Flat 30% Income Tax**: Calculated strictly per profitable trade with *zero* loss offsetting (fully compliant with Indian Section 115BBH rules).
   - **1% TDS on Sells**: Automatically deducted from every exit transaction volume.
   - **0.1% Exchange Fees**: Calculated on both Entry and Exit.
   - Displays real P&L before and after all taxes/fees.

6. **Self-Healing State Recovery**:
   - Saves current session state (balances, open positions, history) in real-time to `bot_state.json`.
   - Heals and resumes instantly after network drops or bot restarts, maintaining accurate positions.

7. **One-Click Windows Start Execution**:
   - Double-click `start.bat` to run the complete environment instantly, install packages, and launch the responsive UI.

---

## 📂 Project Structure

```
├── public/
│   └── index.html      # Responsive light-themed dashboard UI (HTML5, Tailwind, Chart.js)
├── strategies.js       # Core indicators, candle fetchers, and technical strategy signals
├── backtester.js       # Multi-asset backtester, tax engine, and strategy optimization
├── live_trader.js      # Live/Demo paper trading loop, state management, and self-healing
├── server.js           # Express.js REST API server serving the dashboard
├── start.bat           # Double-click startup script for Windows users
├── build-zip.js        # Script to package the source files into bot_project.zip
├── README.md           # This general documentation file
├── HOW_TO_USE.md       # Detailed guide on operating and configuring the system
└── test-*.js           # Integration test suites for strategies, backtester, and state persistence
```

---

## 🚀 Quickstart Guide

### Option A: Windows (Double-Click)
1. Double-click the **`start.bat`** file.
2. It will automatically install packages and open **`http://localhost:3000`** in your browser.

### Option B: Linux / macOS / Terminal
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the Express server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to **`http://localhost:3000`**.

---

## 🧪 Running Integration Tests

Verify that all systems are operational by running:
```bash
npm test
```
This runs technical indicator verification, realistic backtesting simulation with Indian taxes, and state persistence/self-healing validation. All tests must pass cleanly.
