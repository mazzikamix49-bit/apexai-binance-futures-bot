# ApexAI — safe deployment

## What changed
- Removed synthetic/random AI accuracy and random order-book data.
- Added real multi-timeframe analysis using Binance 1h/15m/5m candles.
- Added RSI, EMA trend, ATR, ADX, volume ratio, risk/reward gating.
- Added risk-based position sizing, cooldowns, correlated-position limits and ATR limits.
- Added realistic fee accounting in paper P&L.
- Added outcome-based AI statistics: displayed accuracy is based only on observed closed trades.
- Added Profit Factor, Expectancy, Max Drawdown and Bot Runtime cards.
- Added a persistent server-side worker for VPS/VM hosting.
- Added `/api/health` and `/api/worker/status`.

## Important architecture note
The React page is not a 24/7 trading process. Browser timers/localStorage are suitable for UI paper trading, not unattended execution.
For continuous execution, run the persistent worker on a VPS/VM. Keep the Vercel site as the dashboard if desired.

## Safe first run
1. Keep `WORKER_PAPER_MODE=true`.
2. Keep `BINANCE_TESTNET=true`.
3. Run on a persistent VM and verify `/api/worker/status`.
4. Let paper mode collect a meaningful sample before considering real execution.
5. For real mode, use a Binance API key restricted to Futures trading and do not enable withdrawals. Store secrets as VPS environment variables, not in the browser.

## VPS option
Oracle Cloud currently advertises Always Free compute resources, including an Ampere A1 option with up to 2 OCPUs and 12 GB RAM equivalent, subject to account/home-region capacity. See Oracle's Always Free documentation.

Render Free is not suitable for an unattended trading worker because free web services can spin down after 15 minutes without inbound traffic and can restart; it is better for demos/testing.

## Docker
```bash
cp .env.example .env
mkdir -p data
docker compose up -d --build
```

For real mode, set `WORKER_PAPER_MODE=false`, `BINANCE_TESTNET=false`, and provide the API credentials only after the paper system has been validated.
