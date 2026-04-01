import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const DATA_DIR = path.join(ROOT, 'data');

// ── Types ─────────────────────────────────────────────────────

export interface FearAndGreed {
  value: number;
  label: string;
  yesterday: number;
  trend: '↑' | '↓' | '→';
}

export interface GeminiNews {
  headline: string;
  impact: -2 | -1 | 0 | 1 | 2;
  category: 'macro' | 'regulatory' | 'onchain' | 'institutional' | 'none';
  summary: string;
}

export interface WhaleActivity {
  transactions: number;
  netFlow: number;
  signal: 'ACUMULACIÓN' | 'DISTRIBUCIÓN' | 'NEUTRAL';
  summary: string;
}

export interface WalletStatus {
  name: string;
  address: string;
  type: 'accumulator' | 'institutional' | 'distribution_risk';
  status: string;
  hasNewActivity: boolean;
}

export interface SessionContext {
  session: 'ASIÁTICA' | 'EUROPEA' | 'AMERICANA' | 'OVERLAP';
  utcHour: number;
  sessionNote: string;
  isHighVolatility: boolean;
  isDefensiveMode: boolean;
  minutesToNextOpen: number | null;
  eventAlert: string | null;
  nextOpenLabel: string | null;
}

// ── Cache helpers ─────────────────────────────────────────────

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache<T>(file: string, ttlMs: number): T | null {
  const p = path.join(CACHE_DIR, file);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { timestamp: number; data: T };
    if (Date.now() - raw.timestamp < ttlMs) return raw.data;
  } catch {
    // invalid cache
  }
  return null;
}

function writeCache<T>(file: string, data: T): void {
  ensureCacheDir();
  fs.writeFileSync(
    path.join(CACHE_DIR, file),
    JSON.stringify({ timestamp: Date.now(), data }, null, 2),
  );
}

// ── Fear & Greed ──────────────────────────────────────────────

const FNG_TTL = 24 * 60 * 60 * 1000; // 24h

function fngLabel(value: number): string {
  if (value <= 24) return 'Extreme Fear';
  if (value <= 44) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 74) return 'Greed';
  return 'Extreme Greed';
}

export class MarketContext {

  async getFearAndGreed(): Promise<FearAndGreed> {
    const cached = readCache<FearAndGreed>('fng-cache.json', FNG_TTL);
    if (cached) return cached;

    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=2');
      const json = await res.json() as { data: Array<{ value: string }> };
      const current = parseInt(json.data[0].value, 10);
      const prev = json.data[1] ? parseInt(json.data[1].value, 10) : current;
      const trend = current > prev ? '↑' : current < prev ? '↓' : '→';
      const result: FearAndGreed = {
        value: current,
        label: fngLabel(current),
        yesterday: prev,
        trend,
      };
      writeCache('fng-cache.json', result);
      return result;
    } catch {
      // Fallback: neutral
      return { value: 50, label: 'Neutral', yesterday: 50, trend: '→' };
    }
  }

  // ── Gemini News ─────────────────────────────────────────────

  async getGeminiNews(): Promise<GeminiNews> {
    const cached = readCache<GeminiNews>('gemini-news-cache.json', 60 * 60 * 1000);
    if (cached) return cached;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { headline: 'Gemini API key no configurada', impact: 0, category: 'none', summary: 'Sin datos' };
    }

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction:
          'Eres un analista de noticias macro para un bot de trading BTC. ' +
          'Busca noticias de la última hora que puedan afectar al precio de BTC. ' +
          'Responde SOLO JSON válido sin texto extra.',
      });

      const prompt =
        'Últimas noticias relevantes para BTC ahora mismo. ' +
        'Responde SOLO este JSON (sin markdown, sin texto extra):\n' +
        '{"headline":"resumen de 1 frase de la noticia más importante",' +
        '"impact":-2 o -1 o 0 o 1 o 2,' +
        '"category":"macro" o "regulatory" o "onchain" o "institutional" o "none",' +
        '"summary":"max 60 chars"}\n' +
        'Si no hay noticias relevantes: impact=0, category="none"';

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const parsed = extractJson<GeminiNews>(text);
      if (parsed) {
        writeCache('gemini-news-cache.json', parsed);
        return parsed;
      }
    } catch (err) {
      console.error('[MarketContext] Gemini news error:', err);
    }

    return { headline: 'Sin noticias relevantes', impact: 0, category: 'none', summary: 'Error o sin datos' };
  }

  // ── Whale Activity ──────────────────────────────────────────

  async getWhaleActivity(): Promise<WhaleActivity> {
    const cached = readCache<WhaleActivity>('whale-cache.json', 5 * 60 * 1000);
    if (cached) return cached;

    const apiKey = process.env.WHALE_ALERT_API_KEY;
    const minValue = parseInt(process.env.WHALE_ALERT_MIN_VALUE ?? '5000000', 10);

    if (!apiKey) {
      return {
        transactions: 0,
        netFlow: 0,
        signal: 'NEUTRAL',
        summary: 'Whale Alert API key no configurada',
      };
    }

    try {
      const url =
        `https://api.whale-alert.io/v1/transactions` +
        `?api_key=${apiKey}&min_value=${minValue}&currency=bitcoin&limit=10`;
      const res = await fetch(url);
      const json = await res.json() as {
        transactions?: Array<{
          from: { owner_type?: string; owner?: string };
          to: { owner_type?: string; owner?: string };
          amount: number;
        }>;
      };

      const txs = json.transactions ?? [];
      let inflow = 0;
      let outflow = 0;

      for (const tx of txs) {
        const fromExchange = tx.from.owner_type === 'exchange';
        const toExchange = tx.to.owner_type === 'exchange';

        // Skip internal exchange transfers (noise)
        if (fromExchange && toExchange) continue;

        if (toExchange) inflow += tx.amount;
        else if (fromExchange) outflow += tx.amount;
      }

      const netFlow = inflow - outflow;
      const signal: WhaleActivity['signal'] =
        netFlow > 100 ? 'DISTRIBUCIÓN' : netFlow < -100 ? 'ACUMULACIÓN' : 'NEUTRAL';

      const result: WhaleActivity = {
        transactions: txs.length,
        netFlow: Math.round(netFlow),
        signal,
        summary:
          `Transacciones: ${txs.length} | ` +
          `Net exchange flow: ${netFlow > 0 ? '+' : ''}${Math.round(netFlow)} BTC | ` +
          `Señal: ${signal}`,
      };
      writeCache('whale-cache.json', result);
      return result;
    } catch (err) {
      console.error('[MarketContext] Whale Alert error:', err);
      return { transactions: 0, netFlow: 0, signal: 'NEUTRAL', summary: 'Error al obtener datos whale' };
    }
  }

  // ── Wallets of Interest ─────────────────────────────────────

  async getWalletsOfInterest(): Promise<WalletStatus[]> {
    const wallets: Array<{
      name: string;
      address: string;
      type: 'accumulator' | 'institutional' | 'distribution_risk';
    }> = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallets-of-interest.json'), 'utf8'));

    type WalletCache = Record<string, { lastTxid: string; lastChecked: number }>;
    const cachePath = path.join(CACHE_DIR, 'wallets-cache.json');
    let walletCache: WalletCache = {};
    if (fs.existsSync(cachePath)) {
      try { walletCache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as WalletCache; } catch { /* empty */ }
    }

    const results: WalletStatus[] = [];
    const TTL = 5 * 60 * 1000;

    for (const wallet of wallets) {
      const cached = walletCache[wallet.address];
      if (cached && Date.now() - cached.lastChecked < TTL) {
        results.push({
          name: wallet.name,
          address: wallet.address,
          type: wallet.type,
          status: 'sin movimiento reciente',
          hasNewActivity: false,
        });
        continue;
      }

      try {
        const res = await fetch(`https://mempool.space/api/address/${wallet.address}/txs`);
        const txs = await res.json() as Array<{ txid: string }>;
        const latestTxid = txs[0]?.txid ?? '';
        const hasNew = cached?.lastTxid !== undefined && latestTxid !== cached.lastTxid && latestTxid !== '';

        walletCache[wallet.address] = { lastTxid: latestTxid, lastChecked: Date.now() };

        results.push({
          name: wallet.name,
          address: wallet.address,
          type: wallet.type,
          status: hasNew ? `⚠ MOVIMIENTO DETECTADO (${latestTxid.slice(0, 8)}...)` : 'sin movimiento',
          hasNewActivity: hasNew,
        });
      } catch {
        results.push({
          name: wallet.name,
          address: wallet.address,
          type: wallet.type,
          status: 'error al consultar',
          hasNewActivity: false,
        });
      }
    }

    ensureCacheDir();
    fs.writeFileSync(cachePath, JSON.stringify(walletCache, null, 2));
    return results;
  }

  // ── Session Context ─────────────────────────────────────────

  getSessionContext(): SessionContext {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const utcMinTotal = utcHour * 60 + utcMin;

    // Session windows (UTC)
    const sessions: Array<{ name: SessionContext['session']; start: number; end: number }> = [
      { name: 'ASIÁTICA', start: 60, end: 540 },    // 01:00–09:00
      { name: 'EUROPEA', start: 480, end: 960 },    // 08:00–16:00
      { name: 'AMERICANA', start: 810, end: 1320 }, // 13:30–22:00
    ];

    let session: SessionContext['session'] = 'ASIÁTICA';
    for (const s of sessions) {
      if (utcMinTotal >= s.start && utcMinTotal < s.end) {
        session = s.name;
        break;
      }
    }
    // Overlap Asia/Europa
    if (utcMinTotal >= 480 && utcMinTotal < 540) session = 'OVERLAP';

    // High volatility windows: 30min before/after key opens
    const keyOpens = [
      { label: 'Wall Street', minuteUTC: 810 },  // 13:30
      { label: 'Cierre Wall St', minuteUTC: 1260 }, // 21:00
      { label: 'Apertura Asia', minuteUTC: 60 },  // 01:00
    ];

    let isHighVolatility = false;
    let minutesToNextOpen: number | null = null;
    let nextOpenLabel: string | null = null;
    let sessionNote = 'modo normal';

    for (const ko of keyOpens) {
      const diff = ko.minuteUTC - utcMinTotal;
      if (Math.abs(diff) <= 30) {
        isHighVolatility = true;
        sessionNote = `⚠ ventana alta volatilidad (±30min de ${ko.label})`;
        break;
      }
      // Find the next upcoming open
      if (diff > 0 && (minutesToNextOpen === null || diff < minutesToNextOpen)) {
        minutesToNextOpen = diff;
        nextOpenLabel = ko.label;
      }
    }

    // Check economic events
    let isDefensiveMode = false;
    let eventAlert: string | null = null;
    try {
      const events: Array<{ date: string; time: string; timezone: string; event: string; impact: string }> =
        JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'events-calendar.json'), 'utf8'));

      for (const ev of events) {
        if (ev.impact !== 'high') continue;
        const evDate = new Date(`${ev.date}T${ev.time}:00Z`);
        const diffMs = evDate.getTime() - Date.now();
        const diffH = diffMs / (1000 * 60 * 60);
        if (diffH >= -2 && diffH <= 2) {
          isDefensiveMode = true;
          eventAlert = `⚠ EVENTO HIGH: "${ev.event}" (${diffH > 0 ? `en ${Math.round(diffH * 60)}min` : 'hace ' + Math.round(-diffH * 60) + 'min'})`;
          break;
        }
      }
    } catch { /* no events file */ }

    return {
      session,
      utcHour,
      sessionNote: eventAlert ?? sessionNote,
      isHighVolatility: isHighVolatility || isDefensiveMode,
      isDefensiveMode,
      minutesToNextOpen,
      eventAlert,
      nextOpenLabel,
    };
  }
}

// ── JSON extractor helper ─────────────────────────────────────
function extractJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* failed */ }
    }
    return null;
  }
}
