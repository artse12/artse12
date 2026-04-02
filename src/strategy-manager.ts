import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BOT_ROOT_DIR ?? path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'strategy-state.json');
const TRADES_LOG = path.join(ROOT, 'logs', 'futures-trades.jsonl');
const HISTORY_LOG = path.join(ROOT, 'logs', 'strategy-history.jsonl');

// ── Types ─────────────────────────────────────────────────────

export interface StrategyParams {
  conf_futures_min: number;
  conf_spot_min: number;
  rsi_long_min: number;
  rsi_long_max: number;
  vol_min: number;
  directional_bias: 'LONG' | 'SHORT' | 'neutral';
}

export interface StrategyState {
  version: number;
  name: string;
  activeSince: number;
  lastEvalAt: number | null;
  params: StrategyParams;
  description: string;
  rationale: string;
}

interface TradeRecord {
  timestamp: number;
  side: 'LONG' | 'SHORT';
  pnl: number;
  trend: string;
}

// ── Param constraints ─────────────────────────────────────────
const PARAM_LIMITS = {
  conf_futures_min: { min: 60, max: 85 },
  conf_spot_min: { min: 65, max: 90 },
  rsi_long_min: { min: 30, max: 50 },
  rsi_long_max: { min: 55, max: 70 },
  vol_min: { min: 1.0, max: 2.5 },
};

function clampParam(key: keyof typeof PARAM_LIMITS, value: number): number {
  const { min, max } = PARAM_LIMITS[key];
  return Math.max(min, Math.min(max, value));
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function ensureLogsDir(): void {
  const logsDir = path.join(ROOT, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
}

// ── StrategyManager ───────────────────────────────────────────

export class StrategyManager {
  private state: StrategyState;
  private client = new Anthropic();

  constructor() {
    this.state = this._load();
    if (this.state.activeSince === 0) {
      this.state.activeSince = Date.now();
      atomicWrite(STATE_PATH, this.state);
    }
  }

  private _load(): StrategyState {
    try {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as StrategyState;
    } catch {
      const defaults: StrategyState = {
        version: 1,
        name: 'Balanced neutral',
        activeSince: Date.now(),
        lastEvalAt: null,
        params: {
          conf_futures_min: 65,
          conf_spot_min: 70,
          rsi_long_min: 40,
          rsi_long_max: 65,
          vol_min: 1.2,
          directional_bias: 'neutral',
        },
        description: 'Estrategia inicial conservadora sin sesgo direccional.',
        rationale: 'Inicio del bot. Sin historial de trades para analizar.',
      };
      atomicWrite(STATE_PATH, defaults);
      return defaults;
    }
  }

  getCurrent(): StrategyState {
    return { ...this.state };
  }

  async evaluateAndAdapt(): Promise<void> {
    ensureLogsDir();

    // Read last 50 trades
    let trades: TradeRecord[] = [];
    try {
      if (fs.existsSync(TRADES_LOG)) {
        const lines = fs.readFileSync(TRADES_LOG, 'utf8')
          .trim().split('\n').filter(Boolean);
        trades = lines
          .slice(-50)
          .map(l => JSON.parse(l) as TradeRecord);
      }
    } catch {
      console.error('[StrategyManager] Error leyendo trades log');
    }

    if (trades.length < 5) {
      console.log('[StrategyManager] Insuficientes trades para evaluar (< 5). Manteniendo estrategia actual.');
      return;
    }

    // Calculate metrics
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl < 0).length;
    const winRate = ((wins / trades.length) * 100).toFixed(1);

    const totalProfit = trades.filter(t => t.pnl > 0).reduce((a, b) => a + b.pnl, 0);
    const totalLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, b) => a + b.pnl, 0));
    const profitFactor = totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : 'N/A';
    const avgProfit = wins > 0 ? (totalProfit / wins).toFixed(2) : '0';
    const avgLoss = losses > 0 ? (totalLoss / losses).toFixed(2) : '0';

    // Max drawdown (simplified: max consecutive loss)
    let maxDrawdown = 0;
    let runningLoss = 0;
    for (const t of trades) {
      if (t.pnl < 0) {
        runningLoss += Math.abs(t.pnl);
        maxDrawdown = Math.max(maxDrawdown, runningLoss);
      } else {
        runningLoss = 0;
      }
    }

    // Dominant trend
    const trendCounts: Record<string, number> = {};
    for (const t of trades) {
      if (t.trend) trendCounts[t.trend] = (trendCounts[t.trend] ?? 0) + 1;
    }
    const dominantTrend = Object.entries(trendCounts).sort((a, b) => b[1] - a[1])[0];
    const trendPct = dominantTrend
      ? ((dominantTrend[1] / trades.length) * 100).toFixed(0)
      : '0';

    const prompt = `Rendimiento últimos ${trades.length} ciclos:
trades=${trades.length}, wins=${wins}, losses=${losses}
winRate=${winRate}%, profitFactor=${profitFactor}
avgProfit=$${avgProfit}, avgLoss=$${avgLoss}
maxDrawdown=$${maxDrawdown.toFixed(2)}
tendencia dominante: ${dominantTrend?.[0] ?? 'sin datos'} (${trendPct}% de los ciclos)

Estrategia actual:
${JSON.stringify(this.state.params, null, 2)}

Responde SOLO este JSON (sin markdown):
{
  "name": "nombre descriptivo max 50 chars",
  "description": "descripción max 200 chars",
  "rationale": "razonamiento de cambios max 300 chars",
  "params": {
    "conf_futures_min": 60-85,
    "conf_spot_min": 65-90,
    "rsi_long_min": 30-50,
    "rsi_long_max": 55-70,
    "vol_min": 1.0-2.5,
    "directional_bias": "LONG" o "SHORT" o "neutral"
  }
}`;

    try {
      const msg = await this.client.messages.create({
        model: (process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6') as string,
        max_tokens: 800,
        temperature: 0,
        system:
          'Eres el arquitecto de estrategia de un bot de trading BTC conservador. ' +
          'Analiza el rendimiento histórico y ajusta parámetros para mejorar resultados. ' +
          'NUNCA puedes: superar leverage 3x, superar risk 2%, cambiar la lógica de retiro. ' +
          'Solo ajustas umbrales de confianza, rangos RSI, volumen mínimo y sesgo. ' +
          'Responde SOLO JSON válido.',
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const parsed = this._extractJson<{
        name: string; description: string; rationale: string; params: StrategyParams;
      }>(text);

      if (!parsed) {
        console.error('[StrategyManager] Respuesta de Claude no válida:', text);
        return;
      }

      // Clamp all params to safe ranges
      const safeParams: StrategyParams = {
        conf_futures_min: clampParam('conf_futures_min', parsed.params.conf_futures_min),
        conf_spot_min: clampParam('conf_spot_min', parsed.params.conf_spot_min),
        rsi_long_min: clampParam('rsi_long_min', parsed.params.rsi_long_min),
        rsi_long_max: clampParam('rsi_long_max', parsed.params.rsi_long_max),
        vol_min: clampParam('vol_min', parsed.params.vol_min),
        directional_bias: ['LONG', 'SHORT', 'neutral'].includes(parsed.params.directional_bias)
          ? parsed.params.directional_bias
          : 'neutral',
      };

      const newState: StrategyState = {
        version: this.state.version + 1,
        name: parsed.name.slice(0, 50),
        activeSince: Date.now(),
        lastEvalAt: Date.now(),
        params: safeParams,
        description: parsed.description.slice(0, 200),
        rationale: parsed.rationale.slice(0, 300),
      };

      // Append to history before saving new state
      ensureLogsDir();
      const historyEntry = {
        timestamp: Date.now(),
        previousStrategy: this.state,
        newStrategy: newState,
        metrics: { winRate, profitFactor, avgProfit, avgLoss, maxDrawdown, trades: trades.length },
      };
      fs.appendFileSync(HISTORY_LOG, JSON.stringify(historyEntry) + '\n');

      this.state = newState;
      atomicWrite(STATE_PATH, this.state);

      console.log(`[StrategyManager] Estrategia actualizada → "${newState.name}" (v${newState.version})`);
      console.log(`[StrategyManager] ${newState.rationale}`);

    } catch (err) {
      console.error('[StrategyManager] Error en evaluateAndAdapt:', err);
    }
  }

  private _extractJson<T>(text: string): T | null {
    try { return JSON.parse(text) as T; } catch { /* empty */ }
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* empty */ }
    }
    return null;
  }
}
