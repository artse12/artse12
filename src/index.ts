import 'dotenv/config';
import { logger } from './logger.js';
import { sendAlert, formatDailySummary } from './telegram.js';
import { BingXClient } from './bingx.js';
import { MarketContext } from './market-context.js';
import { Oracle } from './oracle.js';
import { OracleGemini } from './oracle-gemini.js';
import { RiskManager } from './risk.js';
import { ProfitManager } from './profit-manager.js';
import { StrategyManager } from './strategy-manager.js';
import {
  RSI, EMA, MACD, ATR, relativeVolume, trendRegime,
} from './indicators.js';
import type { Candle } from './bingx.js';

// ── Env ──────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN !== 'false';
const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINUTES ?? '5', 10);
const STRATEGY_EVAL_INTERVAL = parseInt(process.env.STRATEGY_EVAL_INTERVAL ?? '50', 10);
const FUTURES_MAX_LEVERAGE = parseInt(process.env.FUTURES_MAX_LEVERAGE ?? '3', 10);

function validateEnv(): void {
  const required = ['ANTHROPIC_API_KEY'];
  if (!DRY_RUN) {
    required.push('BINGX_API_KEY', 'BINGX_API_SECRET');
  }
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`\n[ERROR] Variables de entorno faltantes: ${missing.join(', ')}`);
    console.error('Copia .env.example a .env y rellena los valores.\n');
    process.exit(1);
  }
}

// ── Singleton instances ───────────────────────────────────────
const bingx = new BingXClient();
const marketContext = new MarketContext();
const oracle = new Oracle();
const oracleGemini = new OracleGemini();
const riskManager = new RiskManager();
const profitManager = new ProfitManager(bingx);
const strategyManager = new StrategyManager();

// ── Cycle state ───────────────────────────────────────────────
const botState = { totalCycles: 0 };

// ── Main cycle ────────────────────────────────────────────────
async function runCycle(): Promise<void> {
  botState.totalCycles++;

  // 1. Fetch all data in parallel
  const [
    spotCandles5m, spotCandles15m, spotCandles1h,
    futuresCandles5m, futuresCandles15m, futuresCandles1h,
    position, spotBalance, futuresBalance,
    fng, geminiNews, whaleActivity,
    walletsStatus, sessionCtx,
  ] = await Promise.all([
    bingx.getCandles('spot', '5m'),
    bingx.getCandles('spot', '15m'),
    bingx.getCandles('spot', '1h', 100),
    bingx.getCandles('futures', '5m'),
    bingx.getCandles('futures', '15m'),
    bingx.getCandles('futures', '1h', 100),
    bingx.getPosition(),
    bingx.getSpotBalance(),
    bingx.getFuturesBalance(),
    marketContext.getFearAndGreed(),
    marketContext.getGeminiNews(),
    marketContext.getWhaleActivity(),
    marketContext.getWalletsOfInterest(),
    marketContext.getSessionContext(),
  ]);

  const strategy = strategyManager.getCurrent();

  // 2. Calculate indicators
  const fClosures5m = futuresCandles5m.map((c: Candle) => c.close);
  const fClosures15m = futuresCandles15m.map((c: Candle) => c.close);
  const fClosures1h = futuresCandles1h.map((c: Candle) => c.close);
  const sClosures1h = spotCandles1h.map((c: Candle) => c.close);

  const ema20Arr = EMA(fClosures1h, 20);
  const ema50Arr = EMA(fClosures1h, 50);
  const macdResult = MACD(fClosures15m);
  const regime = trendRegime(futuresCandles1h);

  const ind = {
    rsi5m: RSI(fClosures5m),
    rsi15m: RSI(fClosures15m),
    rsi1h: RSI(fClosures1h),
    rsi4h: RSI(sClosures1h),
    ema20: ema20Arr.at(-1) ?? 0,
    ema50: ema50Arr.at(-1) ?? 0,
    atr: ATR(futuresCandles1h),
    macd: macdResult,
    relVol5m: relativeVolume(futuresCandles5m.map((c: Candle) => c.volume)),
    relVol: relativeVolume(spotCandles1h.map((c: Candle) => c.volume)),
    regime,
  };

  const futuresPrice = futuresCandles1h.at(-1)?.close ?? 0;
  const spotPrice = spotCandles1h.at(-1)?.close ?? 0;

  // 3. Oracle decisions in parallel
  const [futuresDec, spotDec] = await Promise.all([
    oracle.decideFutures({
      price: futuresPrice,
      ind,
      position,
      balance: futuresBalance,
      fng,
      geminiNews,
      whaleActivity,
      walletsStatus,
      sessionCtx,
      strategy,
    }),
    oracle.decideSpot({
      price: spotPrice,
      ind,
      balance: spotBalance,
      dipBuys: profitManager.getDipBuys(),
      fng,
      whaleActivity,
      walletsStatus,
      strategy,
    }),
  ]);

  // 4. Gemini second opinion if high confidence
  let finalFuturesDec = futuresDec;
  if (futuresDec.confidence >= 80 && !DRY_RUN) {
    try {
      const geminiOpinion = await oracleGemini.secondOpinion({
        price: futuresPrice,
        ind,
        position,
        balance: futuresBalance,
        fng,
        geminiNews,
        whaleActivity,
        walletsStatus,
        sessionCtx,
        strategy,
      });
      const divergence = Math.abs(futuresDec.confidence - geminiOpinion.confidence);
      if (divergence > 30 || futuresDec.action !== geminiOpinion.action) {
        logger.warn(
          `Discrepancia Claude (${futuresDec.action} ${futuresDec.confidence}%) ` +
          `vs Gemini (${geminiOpinion.action} ${geminiOpinion.confidence}%) → HOLD forzado`
        );
        finalFuturesDec = {
          action: 'HOLD',
          confidence: 50,
          reason: 'Discrepancia entre oracles',
        };
      }
    } catch (err) {
      logger.warn(`Gemini second opinion fallido: ${err}. Continuando con Claude.`);
    }
  }

  // 5. Log cycle
  logger.cycle({
    cycleNum: botState.totalCycles,
    futuresPrice,
    spotPrice,
    futuresBalance,
    spotBalance,
    position,
    futuresDec: finalFuturesDec,
    spotDec,
    fng,
    geminiNews,
    whaleActivity,
    sessionCtx,
    profitState: profitManager.getState(),
    strategy,
    ind,
  });

  // 6. Execute
  if (!DRY_RUN) {
    await executeFutures(finalFuturesDec, {
      ind,
      futuresBalance,
      futuresPrice,
      sessionCtx,
    });
    await executeSpot(spotDec, { spotBalance, spotPrice });
  } else {
    logger.dryRun(finalFuturesDec, spotDec);
  }

  // 7. Strategy re-evaluation
  if (botState.totalCycles % STRATEGY_EVAL_INTERVAL === 0) {
    logger.info(`[Strategy] Evaluando y adaptando estrategia (ciclo ${botState.totalCycles})...`);
    await strategyManager.evaluateAndAdapt();
  }

  // 8. Daily Telegram summary (every 288 cycles ≈ 24h at 5min intervals)
  const dailyInterval = Math.round(24 * 60 / INTERVAL_MINUTES);
  if (botState.totalCycles % dailyInterval === 0 && botState.totalCycles > 0) {
    const ps = profitManager.getState();
    const strat = strategyManager.getCurrent();
    await sendAlert(formatDailySummary({
      cycleNum: botState.totalCycles,
      accumulatedProfit: ps.accumulatedProfit,
      totalBtcAccumulated: ps.totalBtcAccumulated,
      totalUsdtInEarn: ps.totalUsdtInEarn,
      totalDistributions: ps.totalDistributions,
      strategyName: strat.name,
      lastAction: finalFuturesDec.action,
      btcPrice: futuresPrice,
    })).catch(() => {});
  }
}

async function executeFutures(
  dec: { action: string; confidence: number; reason: string },
  ctx: {
    ind: { atr: number; rsi5m: number; regime: { trend1h: string } };
    futuresBalance: number;
    futuresPrice: number;
    sessionCtx: { isHighVolatility: boolean; isDefensiveMode: boolean };
  }
): Promise<void> {
  const { action, confidence } = dec;
  const strategy = strategyManager.getCurrent();

  if (action === 'HOLD') return;

  // Validate confidence
  if (confidence < strategy.params.conf_futures_min) {
    logger.info(`[Futures] Confianza insuficiente (${confidence}% < ${strategy.params.conf_futures_min}%) → HOLD`);
    return;
  }

  const position = await bingx.getPosition();

  if (action === 'CLOSE' && position) {
    await bingx.closePosition(position.side);
    const pnl = position.unrealizedPnl;
    if (pnl !== undefined) {
      await profitManager.checkAndDistribute(pnl);
    }
    return;
  }

  if ((action === 'LONG' || action === 'SHORT') && !position) {
    const validation = riskManager.validateFutures({
      balance: ctx.futuresBalance,
      confidence,
      strategy,
    });
    if (!validation.valid) {
      logger.warn(`[Futures] Validación fallida: ${validation.reason}`);
      return;
    }

    const qty = riskManager.calcFuturesSize({
      price: ctx.futuresPrice,
      atr: ctx.ind.atr,
      balance: ctx.futuresBalance,
      sessionCtx: ctx.sessionCtx,
    });
    const sl = riskManager.calcSL(ctx.futuresPrice, ctx.ind.atr, action);
    const tp = riskManager.calcTP(ctx.futuresPrice, ctx.ind.atr, action);

    if (qty < 0.001) {
      logger.warn(`[Futures] Cantidad calculada muy pequeña (${qty} BTC) → omitiendo`);
      return;
    }

    await bingx.openPosition({ side: action, qty, sl, tp });
    logger.info(`[Futures] Posición abierta: ${action} ${qty} BTC @ $${ctx.futuresPrice} | SL $${sl.toFixed(0)} | TP $${tp.toFixed(0)}`);
  }
}

async function executeSpot(
  dec: { action: string; confidence: number; reason: string },
  ctx: { spotBalance: number; spotPrice: number }
): Promise<void> {
  if (dec.action !== 'BUY_DIP') return;

  const strategy = strategyManager.getCurrent();
  if (dec.confidence < strategy.params.conf_spot_min) {
    logger.info(`[Spot] Confianza insuficiente (${dec.confidence}% < ${strategy.params.conf_spot_min}%) → WAIT`);
    return;
  }

  const validation = riskManager.validateSpot({
    balance: ctx.spotBalance,
    dipBuys: profitManager.getDipBuys(),
    confidence: dec.confidence,
    strategy,
  });
  if (!validation.valid) {
    logger.warn(`[Spot] Validación fallida: ${validation.reason}`);
    return;
  }

  const budget = riskManager.calcDipBudget(ctx.spotBalance);
  if (budget < 10) {
    logger.warn(`[Spot] Budget demasiado pequeño ($${budget.toFixed(2)}) → WAIT`);
    return;
  }

  await bingx.buyBtcSpot(budget);
  profitManager.incrementDipBuys();
  logger.info(`[Spot] BTC comprado con $${budget.toFixed(2)} USDT @ $${ctx.spotPrice}`);
}

// ── Main ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.banner(DRY_RUN);
  validateEnv();

  if (!DRY_RUN) {
    await bingx.setLeverage(FUTURES_MAX_LEVERAGE);
    logger.info(`[Init] Leverage establecido a ${FUTURES_MAX_LEVERAGE}x`);
  }

  logger.info(`[Init] Bot iniciado. Ciclos cada ${INTERVAL_MINUTES} min. DRY_RUN=${DRY_RUN}`);
  logger.start();

  while (true) {
    try {
      await runCycle();
    } catch (err) {
      logger.error(err instanceof Error ? err : new Error(String(err)));
    }
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MINUTES * 60 * 1000));
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
