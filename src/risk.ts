import 'dotenv/config';
import type { SessionContext } from './market-context.js';
import type { StrategyState } from './strategy-manager.js';

// ── Config ────────────────────────────────────────────────────
const FUTURES_RISK_PCT = parseFloat(process.env.FUTURES_RISK_PCT ?? '0.02');
const FUTURES_MAX_LEVERAGE = parseInt(process.env.FUTURES_MAX_LEVERAGE ?? '3', 10);
const FUTURES_ATR_MULTIPLIER = parseFloat(process.env.FUTURES_ATR_MULTIPLIER ?? '1.5');
const FUTURES_RR_RATIO = parseFloat(process.env.FUTURES_RR_RATIO ?? '2.0');
const SPOT_DIP_BUDGET_PCT = parseFloat(process.env.SPOT_DIP_BUDGET_PCT ?? '0.10');
const SPOT_MAX_DIP_BUYS = parseInt(process.env.SPOT_MAX_DIP_BUYS ?? '3', 10);
const SPOT_MIN_USDT_RESERVE = parseFloat(process.env.SPOT_MIN_USDT_RESERVE ?? '50');
const EARN_MIN_APY = parseFloat(process.env.EARN_MIN_APY ?? '2.0');

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

export class RiskManager {

  // ── Futures sizing ──────────────────────────────────────────

  calcFuturesSize(params: {
    price: number;
    atr: number;
    balance: number;
    sessionCtx: Pick<SessionContext, 'isHighVolatility' | 'isDefensiveMode'>;
  }): number {
    const { price, atr, balance, sessionCtx } = params;

    // Effective risk pct: reduce in defensive mode
    let riskPct = FUTURES_RISK_PCT;
    if (sessionCtx.isDefensiveMode) riskPct = Math.min(riskPct, 0.01);

    const riskUSDT = balance * riskPct;
    const stopDistUSDT = price * (atr / price) * FUTURES_ATR_MULTIPLIER;
    if (stopDistUSDT <= 0) return 0;

    let positionUSDT = (riskUSDT / stopDistUSDT) * price;
    let qty = positionUSDT / price;

    // Reduce 50% in high volatility windows
    if (sessionCtx.isHighVolatility) qty *= 0.5;

    // Floor to 3 decimal places (BTC min lot)
    qty = Math.floor(qty * 1000) / 1000;
    return qty;
  }

  calcSL(entry: number, atr: number, side: 'LONG' | 'SHORT'): number {
    const dist = atr * FUTURES_ATR_MULTIPLIER;
    return side === 'LONG' ? entry - dist : entry + dist;
  }

  calcTP(entry: number, atr: number, side: 'LONG' | 'SHORT'): number {
    const dist = atr * FUTURES_ATR_MULTIPLIER * FUTURES_RR_RATIO;
    return side === 'LONG' ? entry + dist : entry - dist;
  }

  // ── Spot budget ─────────────────────────────────────────────

  calcDipBudget(spotBalance: number): number {
    const available = Math.max(0, spotBalance - SPOT_MIN_USDT_RESERVE);
    return available * SPOT_DIP_BUDGET_PCT;
  }

  // ── Session helpers ─────────────────────────────────────────
  // (These are delegated to SessionContext from market-context.ts)
  // Kept here as convenience re-exports for clarity in index.ts

  isHighVolatilityWindow(sessionCtx: SessionContext): boolean {
    return sessionCtx.isHighVolatility;
  }

  isDefensiveMode(sessionCtx: SessionContext): boolean {
    return sessionCtx.isDefensiveMode;
  }

  // ── Validations ─────────────────────────────────────────────

  validateFutures(params: {
    balance: number;
    confidence: number;
    strategy: StrategyState;
  }): ValidationResult {
    const { balance, confidence, strategy } = params;

    if (balance < 50) {
      return { valid: false, reason: `Balance futures insuficiente ($${balance.toFixed(2)} < $50)` };
    }
    if (confidence < strategy.params.conf_futures_min) {
      return {
        valid: false,
        reason: `Confianza insuficiente (${confidence}% < ${strategy.params.conf_futures_min}%)`,
      };
    }
    if (FUTURES_MAX_LEVERAGE > 3) {
      return { valid: false, reason: 'Leverage supera el máximo permitido (3x)' };
    }
    return { valid: true, reason: 'OK' };
  }

  validateSpot(params: {
    balance: number;
    dipBuys: number;
    confidence: number;
    strategy: StrategyState;
  }): ValidationResult {
    const { balance, dipBuys, confidence, strategy } = params;

    if (balance < 20 + SPOT_MIN_USDT_RESERVE) {
      return {
        valid: false,
        reason: `Balance spot insuficiente ($${balance.toFixed(2)} < $${20 + SPOT_MIN_USDT_RESERVE})`,
      };
    }
    if (dipBuys >= SPOT_MAX_DIP_BUYS) {
      return {
        valid: false,
        reason: `Máximo de dip buys sin recovery alcanzado (${dipBuys}/${SPOT_MAX_DIP_BUYS})`,
      };
    }
    if (confidence < strategy.params.conf_spot_min) {
      return {
        valid: false,
        reason: `Confianza insuficiente para spot (${confidence}% < ${strategy.params.conf_spot_min}%)`,
      };
    }
    return { valid: true, reason: 'OK' };
  }

  validateEarn(params: { amount: number; currentApy: number }): ValidationResult {
    const { amount, currentApy } = params;

    if (amount < 10) {
      return { valid: false, reason: `Monto earn muy pequeño ($${amount.toFixed(2)} < $10)` };
    }
    if (currentApy < EARN_MIN_APY) {
      return {
        valid: false,
        reason: `APY insuficiente (${currentApy.toFixed(2)}% < ${EARN_MIN_APY}%) → redirigir a Spot`,
      };
    }
    return { valid: true, reason: 'OK' };
  }
}
