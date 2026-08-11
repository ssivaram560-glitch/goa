# Goa Bot — Setup Instructions

This project is a copy of the [ssivaram560-glitch/goa](https://github.com/ssivaram560-glitch/goa) repository, with one bug fixed so that `bot.js` actually runs (see "Bug Fixed" section below).

## Files

| File | Purpose |
| --- | --- |
| `bot.js` | Main Telegram bot (2,238 lines) — commands, autobet, profit tracking, login |
| `captcha-solver-free.js` | Captcha login solver module (pixel comparison + Puppeteer drag) |
| `bet-amounts.js` | Martingale bet amount rules |
| `level-rules.js` | Level progression rules |
| `pattern-rules.js` | Win Go pattern rules |
| `profit-stats.js` | Profit statistics helpers |
| `bot_data.json` | Persistent state: user tokens, autobet configs, keys, stats |
| `package.json` | Dependencies and start script |

## How to Run

```bash
# 1. Install Node.js 18+ if you don't have it (https://nodejs.org)
# 2. Install dependencies
npm install

# 3. Start the bot
npm start
# (or directly:)
node bot.js
```

## Configuration (lines ~238-260 of bot.js)

- `BOT_TOKEN` — your Telegram bot token. Currently it falls back to a hardcoded token; for your own bot set it as an environment variable:

  ```bash
  export BOT_TOKEN="your-telegram-bot-token"
  node bot.js
  ```

- `OWNER_ID` / `OWNER_IDS` — Telegram user IDs with owner access.
- `PORT` — keep-alive HTTP server port (default `5000`).
- `RENDER_URL` — set this if you deploy on Render/another cloud host.

## Bug Fixed

The original `bot.js` declared `captchaLogin` **twice**:

1. Line 9: `const { captchaLogin } = require('./captcha-solver-free');`
2. Lines 234–744: an inlined duplicate copy of the same function.

This caused a crash on startup:

> SyntaxError: Identifier 'captchaLogin' has already been declared

The duplicate inlined block (lines 234–744, the old copy of `captcha-solver-free.js`) was removed, and the project now uses the up-to-date `captcha-solver-free.js` module as the single source of truth. The `require` on line 9 now works correctly, and `bot.js` loads and starts without errors.

## Verification Performed

- `node --check bot.js` — syntax OK
- `node --check captcha-solver-free.js` — syntax OK
- Full module load test with a mocked Telegram API — bot starts and prints "✅ SIVA BOT running..."
- Confirmed all exports used by `bot.js` (`captchaLogin`, `solveCaptcha`, `solveGapPosition`, etc.) exist in `captcha-solver-free.js`

## Notes

- The captcha login uses **Puppeteer in headless mode** (`headless: true`). If you run it on Windows and want a visible Chrome window, edit the `puppeteer.launch` options in `captcha-solver-free.js`.
- `bot_data.json` is created/updated automatically at runtime — do not delete it while the bot is running.
- This bot interacts with a real-money betting platform. Using it to place bets involves financial risk — that part is entirely at your own discretion and responsibility.
