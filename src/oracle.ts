import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import type { Position } from './bingx.js';
import type { MACDResult, TrendRegime } from './indicators.js';
import type { FearAndGreed, GeminiNews, WhaleActivity, WalletStatus, SessionContext } from './market-context.js';
import type { StrategyState } from './strategy-manager.js';

// ── Types ─────────────────────────────────────────────────────

export interface OracleDecision {
  action: 'LONG' | 'SHORT' | 'HOLD' | 'CLOSE' | 'BUY_DIP' | 'WAIT';
  confidence: number;
  reason: string;
}

export interface FuturesContext {
  price: number;
  ind: {
    rsi5m: number;
    rsi15m: number;
    rsi1h: number;
    rsi4h: number;
    ema20: number;
    ema50: number;
    atr: number;
    macd: MACDResult;
    relVol5m: number;
    relVol: number;
    regime: TrendRegime;
  };
  position: Position | null;
  balance: number;
  fng: FearAndGreed;
  geminiNews: GeminiNews;
  whaleActivity: WhaleActivity;
  walletsStatus: WalletStatus[];
  sessionCtx: SessionContext;
  strategy: StrategyState;
}

export interface SpotContext {
  price: number;
  ind: {
    rsi1h: number;
    rsi4h: number;
    ema20: number;
    ema50: number;
    relVol: number;
  };
  balance: number;
  dipBuys: number;
  fng: FearAndGreed;
  whaleActivity: WhaleActivity;
  walletsStatus: WalletStatus[];
  strategy: StrategyState;
}

// ── Oracle ────────────────────────────────────────────────────

const FUTURES_MAX_DIP_BUYS = parseInt(process.env.SPOT_MAX_DIP_BUYS ?? '3', 10);
const SPOT_MIN_USDT_RESERVE = parseFloat(process.env.SPOT_MIN_USDT_RESERVE ?? '50');

const client = new Anthropic();

function extractJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* failed */ }
    }
    return null;
  }
}

function walletSummary(wallets: WalletStatus[]): string {
  return wallets.map(w => `${w.name}: ${w.status}`).join('\n');
}

export class Oracle {

  async decideFutures(ctx: FuturesContext): Promise<OracleDecision> {
    const { price, ind, position, balance, fng, geminiNews, whaleActivity,
            walletsStatus, sessionCtx, strategy } = ctx;
    const ts = new Date().toISOString();

    const userPrompt = `BTC-USDT Perpetual — ciclo ${ts}

══ PRECIO Y POSICIÓN ══
Precio futures: $${price.toFixed(0)}
Posición: ${position ? `${position.side} ${position.qty} BTC @ $${position.entryPrice.toFixed(0)} (PnL: $${position.unrealizedPnl.toFixed(2)})` : 'NINGUNA'}
Balance futures: $${balance.toFixed(2)} USDT

══ RÉGIMEN DE MERCADO ══
Tendencia diaria: ${ind.regime.trendDaily} (EMA20 $${ind.regime.ema20_daily.toFixed(0)} vs EMA50 $${ind.regime.ema50_daily.toFixed(0)})
Tendencia 4h: ${ind.regime.trend4h}
Tendencia 1h: ${ind.regime.trend1h}
Sesión actual: ${sessionCtx.session} · ${new Date().toUTCString().slice(17, 22)} UTC
${sessionCtx.eventAlert ? sessionCtx.eventAlert : ''}

══ INDICADORES TÉCNICOS ══
5m  → RSI: ${ind.rsi5m.toFixed(1)} | Vol relativo: ${ind.relVol5m.toFixed(2)}x
15m → RSI: ${ind.rsi15m.toFixed(1)} | MACD val:${ind.macd.value.toFixed(2)} señal:${ind.macd.signal.toFixed(2)} hist:${ind.macd.histogram.toFixed(2)}
1h  → EMA20: $${ind.ema20.toFixed(0)} | EMA50: $${ind.ema50.toFixed(0)} | ATR: $${ind.atr.toFixed(0)}

══ SENTIMIENTO ══
Fear & Greed: ${fng.value} — ${fng.label} (ayer: ${fng.yesterday} ${fng.trend})

══ NOTICIAS MACRO ══
${geminiNews.headline}
Impacto estimado: ${geminiNews.impact > 0 ? '+' : ''}${geminiNews.impact}/2
Categoría: ${geminiNews.category}

══ ACTIVIDAD WHALE ══
${whaleActivity.summary}
Net exchange flow: ${whaleActivity.netFlow > 0 ? '+' : ''}${whaleActivity.netFlow} BTC
Señal whale: ${whaleActivity.signal}

══ WALLETS DE INTERÉS ══
${walletSummary(walletsStatus)}

══ ESTRATEGIA ACTIVA ══
${strategy.name}
Sesgo: ${strategy.params.directional_bias}
RSI entrada LONG: ${strategy.params.rsi_long_min}–${strategy.params.rsi_long_max}
Confianza mínima: ${strategy.params.conf_futures_min}
Vol mínimo: ${strategy.params.vol_min}x

Responde SOLO este JSON (sin markdown, sin texto extra):
{"action":"LONG" o "SHORT" o "HOLD" o "CLOSE","confidence":0-100,"reason":"string máx 80 chars"}`;

    try {
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 500,
        temperature: 0,
        system:
          'Eres un trader algorítmico de BTC Perpetual Futures. ' +
          'Decisiones conservadoras basadas en confluencia de indicadores. ' +
          'Tienes acceso a datos técnicos, macro, sentimiento y on-chain. ' +
          'En duda siempre HOLD. Responde solo JSON válido, sin texto extra.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const parsed = extractJson<OracleDecision>(text);
      if (parsed?.action && typeof parsed.confidence === 'number') {
        return parsed;
      }
    } catch (err) {
      console.error('[Oracle] decideFutures error:', err);
    }

    return { action: 'HOLD', confidence: 0, reason: 'Error en oracle o respuesta inválida' };
  }

  async decideSpot(ctx: SpotContext): Promise<OracleDecision> {
    const { price, ind, balance, dipBuys, fng, whaleActivity, walletsStatus, strategy } = ctx;
    const ts = new Date().toISOString();

    const distEma20 = ind.ema20 > 0
      ? (((ind.ema20 - price) / ind.ema20) * 100).toFixed(2)
      : '0';
    const distEma50 = ind.ema50 > 0
      ? (((ind.ema50 - price) / ind.ema50) * 100).toFixed(2)
      : '0';

    const etfWallets = walletsStatus.filter(w => w.type === 'institutional');
    const etfSummary = etfWallets.map(w => `${w.name}: ${w.status}`).join(', ') || 'sin datos';

    const budget = Math.max(0, (balance - SPOT_MIN_USDT_RESERVE) *
      parseFloat(process.env.SPOT_DIP_BUDGET_PCT ?? '0.10'));

    const userPrompt = `BTC/USDT Spot — evaluación dip ${ts}

Precio: $${price.toFixed(0)}
Distancia a EMA20 (1h): ${distEma20}% ${parseFloat(distEma20) > 0 ? 'bajo' : 'sobre'}
Distancia a EMA50 (1h): ${distEma50}% ${parseFloat(distEma50) > 0 ? 'bajo' : 'sobre'}
RSI 1h: ${ind.rsi1h.toFixed(1)} | RSI 4h: ${ind.rsi4h.toFixed(1)}
Volumen relativo: ${ind.relVol.toFixed(2)}x
Compras DIP sin recover: ${dipBuys}/${FUTURES_MAX_DIP_BUYS}
Budget disponible: $${budget.toFixed(2)} USDT

Fear & Greed: ${fng.value} — ${fng.label}
Señal whale: ${whaleActivity.signal}
Wallets ETF institucionales: ${etfSummary}

Responde SOLO este JSON (sin markdown, sin texto extra):
{"action":"BUY_DIP" o "WAIT","confidence":0-100,"reason":"string máx 80 chars"}`;

    try {
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        temperature: 0,
        system:
          'Eres un acumulador estratégico de BTC a largo plazo. ' +
          'Solo compras dips con confluencia clara de sobreventa. ' +
          'Tienes contexto macro y de ballenas para tomar mejores decisiones. ' +
          'En duda, WAIT. Solo JSON.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const parsed = extractJson<OracleDecision>(text);
      if (parsed?.action && typeof parsed.confidence === 'number') {
        return parsed;
      }
    } catch (err) {
      console.error('[Oracle] decideSpot error:', err);
    }

    return { action: 'WAIT', confidence: 0, reason: 'Error en oracle o respuesta inválida' };
  }
}
