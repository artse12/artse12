import type { Candle } from './bingx.js';

// ── EMA ───────────────────────────────────────────────────────
export function EMA(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => 0);
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(0);

  // Seed with simple mean of first `period` values
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  result[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── RSI (Wilder's smoothing) ──────────────────────────────────
export function RSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD ──────────────────────────────────────────────────────
export interface MACDResult {
  value: number;
  signal: number;
  histogram: number;
}

export function MACD(closes: number[]): MACDResult {
  if (closes.length < 35) {
    return { value: 0, signal: 0, histogram: 0 };
  }
  const ema12 = EMA(closes, 12);
  const ema26 = EMA(closes, 26);

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = EMA(macdLine.slice(25), 9); // signal from where ema26 is valid

  const lastMacd = macdLine.at(-1) ?? 0;
  const lastSignal = signalLine.at(-1) ?? 0;

  return {
    value: lastMacd,
    signal: lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

// ── ATR (Wilder's smoothing) ──────────────────────────────────
export function ATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  // Initial ATR = simple mean of first `period` TRs
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;

  // Wilder's smoothing
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ── Relative Volume ───────────────────────────────────────────
export function relativeVolume(volumes: number[], period = 20): number {
  if (volumes.length < period + 1) return 1;
  const recent = volumes.at(-1) ?? 0;
  const prev = volumes.slice(-period - 1, -1);
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  return avg === 0 ? 1 : recent / avg;
}

// ── Trend Regime (based on 1h candles) ───────────────────────
export interface TrendRegime {
  trend1h: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  trend4h: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  trendDaily: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  ema20_1h: number;
  ema50_1h: number;
  ema20_4h: number;
  ema20_daily: number;
  ema50_daily: number;
}

function classifyTrend(emaFast: number, emaSlow: number): 'ALCISTA' | 'BAJISTA' | 'LATERAL' {
  const pct = Math.abs(emaFast - emaSlow) / emaSlow;
  if (pct < 0.002) return 'LATERAL'; // within 0.2% = lateral
  return emaFast > emaSlow ? 'ALCISTA' : 'BAJISTA';
}

export function trendRegime(candles1h: Candle[]): TrendRegime {
  const closes = candles1h.map(c => c.close);

  // 1h trend
  const ema20_1hArr = EMA(closes, 20);
  const ema50_1hArr = EMA(closes, 50);
  const ema20_1h = ema20_1hArr.at(-1) ?? 0;
  const ema50_1h = ema50_1hArr.at(-1) ?? 0;

  // 4h proxy: sample every 4th candle
  const closes4h = closes.filter((_, i) => i % 4 === 0);
  const ema20_4hArr = EMA(closes4h, 20);
  const ema50_4hArr = EMA(closes4h, 50);
  const ema20_4h = ema20_4hArr.at(-1) ?? 0;
  const ema50_4h = ema50_4hArr.at(-1) ?? 0;

  // Daily proxy: sample every 24th candle
  const closesDaily = closes.filter((_, i) => i % 24 === 0);
  const ema20_dailyArr = EMA(closesDaily, 20);
  const ema50_dailyArr = EMA(closesDaily, 50);
  const ema20_daily = ema20_dailyArr.at(-1) ?? 0;
  const ema50_daily = ema50_dailyArr.at(-1) ?? 0;

  return {
    trend1h: classifyTrend(ema20_1h, ema50_1h),
    trend4h: classifyTrend(ema20_4h, ema50_4h),
    trendDaily: classifyTrend(ema20_daily, ema50_daily),
    ema20_1h,
    ema50_1h,
    ema20_4h,
    ema20_daily,
    ema50_daily,
  };
}
