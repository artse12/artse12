import 'dotenv/config';
import type { FuturesContext, OracleDecision } from './oracle.js';

// ── Gemini Oracle ─────────────────────────────────────────────
// Responsabilidades:
// 1. getNewsContext()     → ya integrado en market-context.ts (Gemini 2.5 Flash + search)
// 2. secondOpinion()     → segunda opinión cuando Claude tiene confidence >= 80%

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

export class OracleGemini {

  async secondOpinion(ctx: FuturesContext): Promise<OracleDecision> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { action: 'HOLD', confidence: 50, reason: 'Gemini API key no configurada' };
    }

    const { price, ind, position, balance, fng, geminiNews, whaleActivity,
            walletsStatus, sessionCtx, strategy } = ctx;
    const ts = new Date().toISOString();

    const contextPrompt = `BTC-USDT Perpetual — segunda opinión ${ts}

Precio futures: $${price.toFixed(0)}
Posición: ${position ? `${position.side} ${position.qty} BTC @ $${position.entryPrice.toFixed(0)}` : 'NINGUNA'}
Balance futures: $${balance.toFixed(2)} USDT

Régimen: ${ind.regime.trend1h} (1h) | ${ind.regime.trend4h} (4h) | ${ind.regime.trendDaily} (Daily)
Sesión: ${sessionCtx.session}

RSI 5m: ${ind.rsi5m.toFixed(1)} | RSI 15m: ${ind.rsi15m.toFixed(1)} | RSI 1h: ${ind.rsi1h.toFixed(1)}
EMA20: $${ind.ema20.toFixed(0)} | EMA50: $${ind.ema50.toFixed(0)} | ATR: $${ind.atr.toFixed(0)}
MACD hist: ${ind.macd.histogram.toFixed(2)}
Vol relativo: ${ind.relVol5m.toFixed(2)}x

Fear & Greed: ${fng.value} — ${fng.label}
Noticias: ${geminiNews.headline} (impacto ${geminiNews.impact})
Whale signal: ${whaleActivity.signal} | Net flow: ${whaleActivity.netFlow} BTC

Wallets:
${walletsStatus.map(w => `${w.name}: ${w.status}`).join('\n')}

Estrategia activa: ${strategy.name}
Sesgo: ${strategy.params.directional_bias}
Confianza mínima: ${strategy.params.conf_futures_min}

Responde SOLO este JSON (sin markdown, sin texto extra):
{"action":"LONG" o "SHORT" o "HOLD" o "CLOSE","confidence":0-100,"reason":"máx 80 chars"}`;

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction:
          'Eres un trader algorítmico de BTC. Analiza los datos y decide. ' +
          'Responde SOLO JSON válido, sin texto extra.',
      });

      const result = await model.generateContent(contextPrompt);
      const text = result.response.text().trim();
      const parsed = extractJson<OracleDecision>(text);
      if (parsed?.action && typeof parsed.confidence === 'number') {
        return parsed;
      }
    } catch (err) {
      console.error('[OracleGemini] secondOpinion error:', err);
    }

    return { action: 'HOLD', confidence: 50, reason: 'Error en Gemini second opinion' };
  }
}
