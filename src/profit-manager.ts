import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import type { BingXClient } from './bingx.js';
import { RiskManager } from './risk.js';
import { sendAlert, formatDistribution } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'profit-state.json');
const LOG_PATH = path.join(ROOT, 'logs', 'distributions.jsonl');
const DRY_RUN = process.env.DRY_RUN !== 'false';

// ── Types ─────────────────────────────────────────────────────

export interface ProfitState {
  accumulatedProfit: number;
  totalCycles: number;
  lastDistributionAt: number | null;
  totalDistributions: number;
  totalBtcAccumulated: string;
  totalUsdtInEarn: string;
  totalReinvested: string;
}

// ── Config ────────────────────────────────────────────────────
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD_USDT ?? '100');
const PROFIT_REINJECT_PCT = parseFloat(process.env.PROFIT_REINJECT_PCT ?? '0.30');
const PROFIT_SPOT_PCT = parseFloat(process.env.PROFIT_SPOT_PCT ?? '0.40');
const PROFIT_EARN_PCT = parseFloat(process.env.PROFIT_EARN_PCT ?? '0.30');
const EARN_MIN_APY = parseFloat(process.env.EARN_MIN_APY ?? '2.0');

// ── Atomic write helper ───────────────────────────────────────
function atomicWrite(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function ensureLogsDir(): void {
  const logsDir = path.join(ROOT, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
}

function appendLog(entry: unknown): void {
  ensureLogsDir();
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

// ── ProfitManager ─────────────────────────────────────────────

export class ProfitManager {
  private state: ProfitState;
  private dipBuys = 0;
  private riskManager = new RiskManager();

  constructor(private bingx: BingXClient) {
    this.state = this._loadState();
  }

  private _loadState(): ProfitState {
    try {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as ProfitState;
    } catch {
      return {
        accumulatedProfit: 0,
        totalCycles: 0,
        lastDistributionAt: null,
        totalDistributions: 0,
        totalBtcAccumulated: '0.00000000',
        totalUsdtInEarn: '0.00000000',
        totalReinvested: '0.00000000',
      };
    }
  }

  private _save(): void {
    atomicWrite(STATE_PATH, this.state);
  }

  getState(): ProfitState {
    return { ...this.state };
  }

  getDipBuys(): number {
    return this.dipBuys;
  }

  incrementDipBuys(): void {
    this.dipBuys++;
  }

  resetDipBuys(): void {
    this.dipBuys = 0;
  }

  async checkAndDistribute(tradeProfit: number): Promise<void> {
    if (tradeProfit === 0) return;

    this.state.accumulatedProfit += tradeProfit;
    this._save();

    if (this.state.accumulatedProfit < PROFIT_THRESHOLD) return;

    const total = this.state.accumulatedProfit;
    const reinject = total * PROFIT_REINJECT_PCT;
    const spotBtcUsdt = total * PROFIT_SPOT_PCT;
    const earnUsdt = total * PROFIT_EARN_PCT;

    if (DRY_RUN) {
      console.log('\n' + [
        '╔══════════════════════════════════════════════════╗',
        '║  [DRY RUN] DISTRIBUCIÓN SIMULADA DE PROFIT       ║',
        '╠══════════════════════════════════════════════════╣',
        `║  Profit total:        $${total.toFixed(2).padStart(10)} USDT               ║`,
        `║  → Futures (30%):     $${reinject.toFixed(2).padStart(10)} (queda en cuenta)   ║`,
        `║  → Spot BTC (40%):    $${spotBtcUsdt.toFixed(2).padStart(10)} USDT                ║`,
        `║  → Flexible Earn(30%):$${earnUsdt.toFixed(2).padStart(10)} USDT                ║`,
        '╚══════════════════════════════════════════════════╝',
      ].join('\n'));

      this.state.accumulatedProfit = 0;
      this._save();
      return;
    }

    // 1. Buy BTC Spot with spotBtcUsdt
    let btcBought = '0.00000000';
    try {
      await this.bingx.transferFuturesToSpot(spotBtcUsdt);
      btcBought = await this.bingx.buyBtcSpot(spotBtcUsdt);
      console.log(`[ProfitManager] Comprado ${btcBought} BTC spot con $${spotBtcUsdt.toFixed(2)}`);
    } catch (err) {
      console.error('[ProfitManager] Error comprando BTC spot:', err);
    }

    // 2. Deposit to Earn (or redirect to Spot if APY too low)
    let earnDeposited = 0;
    let earnRedirectedToSpot = false;
    try {
      const currentApy = await this.bingx.getEarnApy('USDT');
      const validation = this.riskManager.validateEarn({ amount: earnUsdt, currentApy });

      if (validation.valid) {
        await this.bingx.depositToEarn('USDT', earnUsdt);
        earnDeposited = earnUsdt;
        console.log(`[ProfitManager] Depositado $${earnUsdt.toFixed(2)} en Flexible Earn (APY ${currentApy.toFixed(2)}%)`);
      } else {
        console.log(`[ProfitManager] ⚠ APY earn insuficiente (${currentApy.toFixed(2)}%) → redirigiendo $${earnUsdt.toFixed(2)} a Spot BTC`);
        await this.bingx.transferFuturesToSpot(earnUsdt);
        const extraBtc = await this.bingx.buyBtcSpot(earnUsdt);
        btcBought = (parseFloat(btcBought) + parseFloat(extraBtc)).toFixed(8);
        earnRedirectedToSpot = true;
      }
    } catch (err) {
      console.error('[ProfitManager] Error en Earn:', err);
    }

    // 3. reinject stays in Futures automatically

    // Log distribution
    const distEntry = {
      timestamp: Date.now(),
      total,
      reinject,
      spotBtcUsdt,
      earnUsdt: earnDeposited,
      earnRedirectedToSpot,
      btcBought,
      distributions: this.state.totalDistributions + 1,
    };
    appendLog(distEntry);

    // Print distribution box
    console.log('\n' + [
      '╔══════════════════════════════════════════════════╗',
      '║  DISTRIBUCIÓN AUTOMÁTICA DE PROFIT               ║',
      '╠══════════════════════════════════════════════════╣',
      `║  Profit total:        $${total.toFixed(2).padStart(10)} USDT               ║`,
      `║  → Futures (30%):     $${reinject.toFixed(2).padStart(10)} (queda en cuenta)   ║`,
      `║  → Spot BTC (40%):    $${spotBtcUsdt.toFixed(2).padStart(10)} → ${btcBought} BTC      ║`,
      `║  → Flexible Earn(30%):$${earnDeposited.toFixed(2).padStart(10)} USDT${earnRedirectedToSpot ? ' (→ Spot)' : ''}               ║`,
      '╠══════════════════════════════════════════════════╣',
      `║  BTC total acumulado: ${(parseFloat(this.state.totalBtcAccumulated) + parseFloat(btcBought)).toFixed(8)} BTC               ║`,
      `║  USDT en Earn:        $${(parseFloat(this.state.totalUsdtInEarn) + earnDeposited).toFixed(2).padStart(10)} USDT               ║`,
      '╚══════════════════════════════════════════════════╝',
    ].join('\n'));

    // Update state
    this.state.accumulatedProfit = 0;
    this.state.lastDistributionAt = Date.now();
    this.state.totalDistributions++;
    this.state.totalBtcAccumulated = (
      parseFloat(this.state.totalBtcAccumulated) + parseFloat(btcBought)
    ).toFixed(8);
    this.state.totalUsdtInEarn = (
      parseFloat(this.state.totalUsdtInEarn) + earnDeposited
    ).toFixed(2);
    this.state.totalReinvested = (
      parseFloat(this.state.totalReinvested) + reinject
    ).toFixed(2);
    this._save();

    // Telegram notification
    await sendAlert(formatDistribution({
      total,
      reinject,
      spotBtc: spotBtcUsdt,
      earn: earnDeposited,
      btcBought,
      totalBtcAccumulated: this.state.totalBtcAccumulated,
      totalUsdtInEarn: this.state.totalUsdtInEarn,
    })).catch(() => {});

    // Reset dip buy counter after distribution (new cycle)
    this.resetDipBuys();
  }
}
