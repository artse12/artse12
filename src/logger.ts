import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OracleDecision } from './oracle.js';
import type { FearAndGreed, GeminiNews, WhaleActivity, SessionContext } from './market-context.js';
import type { ProfitState } from './profit-manager.js';
import type { StrategyState } from './strategy-manager.js';
import type { Position } from './bingx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');

// ── ANSI colors ───────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

function ensureLogs(): void {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

function appendJsonl(file: string, entry: unknown): void {
  ensureLogs();
  fs.appendFileSync(path.join(LOGS_DIR, file), JSON.stringify(entry) + '\n');
}

function actionColor(action: string): string {
  switch (action) {
    case 'LONG': return C.green;
    case 'SHORT': return C.red;
    case 'CLOSE': return C.yellow;
    case 'BUY_DIP': return C.cyan;
    case 'HOLD': case 'WAIT': return C.gray;
    default: return C.white;
  }
}

function progressBar(current: number, max: number, width = 20): string {
  const pct = Math.min(current / max, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return '░'.repeat(empty) + C.green + '█'.repeat(filled) + C.reset;
}

// ── Logger ────────────────────────────────────────────────────

export const logger = {

  banner(dryRun: boolean): void {
    const mode = dryRun
      ? `${C.yellow}${C.bold} DRY RUN ${C.reset}`
      : `${C.bgRed}${C.bold} LIVE TRADING ${C.reset}`;
    console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════╗
║      BTC DUAL BOT — BINGX v2                 ║
║  Futures · Spot DCA · Flexible Earn          ║
╚══════════════════════════════════════════════╝${C.reset}
  Modo: ${mode}
  Oracle: ${C.magenta}claude-opus-4-5${C.reset}
  Segunda opinión: ${C.blue}gemini-2.0-flash${C.reset}
`);
  },

  start(): void {
    console.log(`${C.gray}[${ts()}]${C.reset} Bot iniciado. Comenzando primer ciclo...`);
  },

  cycle(params: {
    cycleNum: number;
    futuresPrice: number;
    spotPrice: number;
    futuresBalance: number;
    spotBalance: number;
    position: Position | null;
    futuresDec: OracleDecision;
    spotDec: OracleDecision;
    fng: FearAndGreed;
    geminiNews: GeminiNews;
    whaleActivity: WhaleActivity;
    sessionCtx: SessionContext;
    profitState: ProfitState;
    strategy: StrategyState;
    ind: { rsi5m: number; rsi1h: number; atr: number };
  }): void {
    const {
      cycleNum, futuresPrice, futuresBalance, spotBalance,
      position, futuresDec, spotDec, fng, geminiNews,
      whaleActivity, sessionCtx, profitState, strategy,
    } = params;

    const nextOpen = sessionCtx.nextOpenLabel && sessionCtx.minutesToNextOpen
      ? ` · próx. ${sessionCtx.nextOpenLabel} en ${Math.floor(sessionCtx.minutesToNextOpen / 60)}h ${sessionCtx.minutesToNextOpen % 60}min`
      : '';

    const profitPct = Math.min(profitState.accumulatedProfit / 100 * 100, 100);

    console.log(`
${C.dim}──────────────────────────────────────────────────────────${C.reset}
${C.gray}[${ts()}]${C.reset} ciclo ${C.bold}#${cycleNum}${C.reset} · sesión ${C.cyan}${sessionCtx.session}${C.reset}${nextOpen}
${C.dim}──────────────────────────────────────────────────────────${C.reset}
BTC ${C.bold}$${futuresPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}${C.reset} | Futures ${C.yellow}$${futuresBalance.toFixed(2)} USDT${C.reset} | Spot USDT: ${C.yellow}$${spotBalance.toFixed(2)}${C.reset} | Earn: ${C.blue}$${profitState.totalUsdtInEarn}${C.reset}
${position ? `${C.magenta}POSICIÓN: ${position.side} ${position.qty} BTC @ $${position.entryPrice.toFixed(0)} | PnL: $${position.unrealizedPnl.toFixed(2)}${C.reset}` : ''}
${C.bold}CONTEXTO:${C.reset}
  Fear & Greed:   ${fng.value >= 75 ? C.red : fng.value <= 25 ? C.green : C.yellow}${fng.value} — ${fng.label}${C.reset} (ayer ${fng.yesterday} ${fng.trend})
  Noticias macro: ${geminiNews.headline.slice(0, 60)} ${geminiNews.impact > 0 ? C.green + '+' + geminiNews.impact : geminiNews.impact < 0 ? C.red + geminiNews.impact : C.gray + '0'}${C.reset}/2
  Whale neta 2h:  ${whaleActivity.netFlow < 0 ? C.green : whaleActivity.netFlow > 0 ? C.red : C.gray}${whaleActivity.netFlow > 0 ? '+' : ''}${whaleActivity.netFlow} BTC (${whaleActivity.signal})${C.reset}
  Estrategia:     ${C.magenta}${strategy.name}${C.reset}

${C.bold}DECISIONES:${C.reset}
  FUTURES → ${actionColor(futuresDec.action)}${C.bold}${futuresDec.action.padEnd(5)}${C.reset} ${futuresDec.confidence}% | "${futuresDec.reason}"
  SPOT    → ${actionColor(spotDec.action)}${C.bold}${spotDec.action.padEnd(5)}${C.reset} ${spotDec.confidence}% | "${spotDec.reason}"

${C.bold}PROFIT:${C.reset}  $${profitState.accumulatedProfit.toFixed(2)} / $100.00 (${profitPct.toFixed(1)}%) ${progressBar(profitState.accumulatedProfit, 100)}
BTC acumulado: ${C.cyan}${profitState.totalBtcAccumulated}${C.reset} | En Earn: ${C.blue}$${profitState.totalUsdtInEarn}${C.reset}
${C.dim}──────────────────────────────────────────────────────────${C.reset}`);

    // Append to decisions.jsonl
    appendJsonl('decisions.jsonl', {
      timestamp: Date.now(),
      cycle: cycleNum,
      futuresPrice,
      futuresDec,
      spotDec,
      fng: fng.value,
      session: sessionCtx.session,
      accumulatedProfit: profitState.accumulatedProfit,
    });
  },

  dryRun(futuresDec: OracleDecision, spotDec: OracleDecision): void {
    const fColor = actionColor(futuresDec.action);
    const sColor = actionColor(spotDec.action);
    console.log(
      `${C.yellow}[DRY RUN]${C.reset} Futures: ${fColor}${futuresDec.action}${C.reset} | Spot: ${sColor}${spotDec.action}${C.reset} (sin ejecución real)`
    );
  },

  info(msg: string): void {
    console.log(`${C.gray}[${ts()}]${C.reset} ${msg}`);
  },

  warn(msg: string): void {
    console.log(`${C.yellow}[${ts()}] ⚠ ${msg}${C.reset}`);
    ensureLogs();
    fs.appendFileSync(path.join(LOGS_DIR, 'errors.log'), `[${new Date().toISOString()}] WARN: ${msg}\n`);
  },

  error(err: Error): void {
    console.error(`${C.red}[${ts()}] ✗ ERROR: ${err.message}${C.reset}`);
    if (err.stack) console.error(`${C.gray}${err.stack}${C.reset}`);
    ensureLogs();
    fs.appendFileSync(
      path.join(LOGS_DIR, 'errors.log'),
      `[${new Date().toISOString()}] ERROR: ${err.message}\n${err.stack ?? ''}\n`
    );
  },

  distribution(params: {
    total: number;
    reinject: number;
    spotBtc: number;
    earn: number;
    btcBought: string;
    totalBtc: string;
    totalEarn: string;
    futuresBalance: number;
  }): void {
    const { total, reinject, spotBtc, earn, btcBought, totalBtc, totalEarn, futuresBalance } = params;
    console.log(`
${C.green}${C.bold}╔══════════════════════════════════════════════════╗
║  DISTRIBUCIÓN AUTOMÁTICA DE PROFIT               ║
╠══════════════════════════════════════════════════╣
║  Profit total:        $${total.toFixed(2).padEnd(10)} USDT               ║
║  → Futures (30%):     $${reinject.toFixed(2).padEnd(10)} (queda en cuenta)   ║
║  → Spot BTC (40%):    $${spotBtc.toFixed(2).padEnd(10)} → ${btcBought} BTC      ║
║  → Flexible Earn(30%):$${earn.toFixed(2).padEnd(10)} USDT               ║
╠══════════════════════════════════════════════════╣
║  BTC total acumulado: ${totalBtc} BTC               ║
║  USDT en Earn:        $${totalEarn.padEnd(10)} USDT               ║
║  Capital Futures:     $${futuresBalance.toFixed(2).padEnd(10)} USDT               ║
╚══════════════════════════════════════════════════╝${C.reset}`);
  },
};
