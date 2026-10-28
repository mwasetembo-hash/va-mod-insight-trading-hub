# Va Mod Insight Trading Hub

The user pasted the complete HTML source of their prototype "Nexus Trading Hub | Advanced Strategy Engine" (produced in a Qwen chat, linked from https://tradinghub.dtnexusapp.com/ style architecture + Va-Mod volume engine). Build it as the user's real web app with these user decisions from this chat: (1) the indicator must have a NEW NAME and GOLD & PURPLE colors instead of the prototype's blue/green/red — name it "Va-Mod Insight Engine" for the indicator and "Va-Mod Trading Hub" for the app, with a deep purple + gold palette (gold #FFD700-family accents on dark purple backgrounds); (2) full hub scope like DT Nexus; (3) demo-first: connect to a Deriv DEMO/virtual account by default, with a clearly labeled switch to live only if the user later chooses. The user enters their own Deriv API token inside the app (token format validation, never hardcoded); never display or log the token in plaintext after saving.

THE USER'S PASTED PROTOTYPE (replicate its layout, views, settings and behavior, then upgrade it):

Header: "NEXUS TRADING HUB / DT Nexus Architecture + Va-Mod Volume Engine", live Deriv API connection status pill, and an "API & App Config" modal with fields for Deriv App ID, Deriv API Token (password field), FCS API Key, Odds API Key, saved to browser storage, plus a security warning banner about never sharing the token.

Left sidebar (strategy settings, DT Nexus replica): Base Stake ($) default 0.35; Profit Target ($) default 1.00; Target Timeframe select (60 min / 15 min / 5 min / 1 Tick); Primary Strategy select (Classic: Differs → Over 2 → Under 7 / Over-Under Only / Differs Only / Even-Odd); Over Barrier (2) and Under Barrier (7) inputs; Risk Mode Martingale panel: multiplier 3.75, max levels 3, start after loss #1, stop after max levels YES, stop loss OFF; big ACTIVATE/STOP STRATEGY toggle button; footer line "Duration: 1 Tick | Execution: Fast | Source: Digit Edge".

Center: floating "Indicator Engine" panel (indicator name input, bullish color, bearish color, POC/highlight color pickers, "Apply & Rebrand" button) that recolors the candlestick and volume chart live; a LightweightCharts candlestick + volume chart area; and a bottom Sessions Ledger table (Time, Symbol, Type, Stake, Result, Net Profit) with a Clear button.

Right sidebar: Market Profile (Va-Mod) cards for Point of Control (POC), Value Area High (VAH), Value Area Low (VAL); Digit Frequency panel for the last 100 ticks (digits 0-9 as bars with hot-digit highlighting); System Status block (Connection, Next Signal, Current MG Level, Total Profit).

Behavior in the prototype to upgrade to REAL: the prototype only simulates trading (random win/loss at 55% win rate, mock POC/VAH/VAL, mock digit frequency, mock chart data). In the real app, wire an actual Deriv WebSocket client (wss://ws.derivws.com/websockets/v3?app_id=APP_ID, authorize with the saved token, subscribe to ticks, fetch active symbols incl. Volatility indices and frxXAUUSD, read real balance, place real digit contracts Over/Under/Differs/Even-Odd with 1-tick duration, handle proposal/buy/contract updates and reconnects) and compute POC/VAH/VAL and digit frequency from REAL incoming ticks. The martingale engine (multiplier ×3.75, max 3 levels, reset on win, stop after max levels, ledger entries, hourly profit target progress) must run on real trade results. Keep the simulated engine available as a "Demo Mode" toggle so the user can preview behavior before connecting a token, clearly labeled as simulation. When no real market data is available, show real Deriv synthetic-index data once connected; never pass fake data off as live.

The user's strategy definitions to preserve exactly: Classic phase cycle Differs → Over 2 → Under 7; martingale ×3.75 starting after loss #1; max 3 martingale levels then stop; Over 2 / Under 7 barriers; 1-tick duration; $0.35 base stake; $1.00 hourly target.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://va-mod-insight-trading-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2bb1dce1-a111-41eb-aeea-4802a2c7027c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
