import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { UserSettings } from './db.js';

// ── Config ────────────────────────────────────────────────────
const BOT_DIST_PATH = process.env.BOT_DIST_PATH ?? path.resolve('dist');
const BOT_DATA_PATH = process.env.BOT_DATA_PATH ?? path.resolve('data');
const USERS_DATA_PATH = process.env.USERS_DATA_PATH ?? path.resolve('data/users');

// ── Types ─────────────────────────────────────────────────────

export interface BotStatus {
  running: boolean;
  pid?: number;
  startedAt?: number;
  uptimeSeconds?: number;
  lastLogLine?: string;
  profitState?: ProfitState;
  strategyState?: StrategyState;
  configured: boolean;
}

interface ProfitState {
  accumulatedProfit: number;
  totalBtcAccumulated: string;
  totalUsdtInEarn: string;
  totalDistributions: number;
  lastDistributionAt: number | null;
  totalReinvested: string;
}

interface StrategyState {
  version: number;
  name: string;
  params: { directional_bias: string; conf_futures_min: number };
  description: string;
}

// ── Process registry ──────────────────────────────────────────

interface ProcessEntry {
  process: ChildProcess;
  startedAt: number;
  userId: string;
}

const processes = new Map<string, ProcessEntry>();

// ── User directory helpers ────────────────────────────────────

function userDir(userId: string): string {
  return path.join(USERS_DATA_PATH, userId);
}

function ensureUserDirs(userId: string): void {
  const base = userDir(userId);
  ['logs', 'cache'].forEach(d => fs.mkdirSync(path.join(base, d), { recursive: true }));

  // Copy static data files if not present
  const dataFiles = ['wallets-of-interest.json', 'events-calendar.json', 'whale-labels.json'];
  for (const f of dataFiles) {
    const dest = path.join(base, 'data', f);
    const src = path.join(BOT_DATA_PATH, f);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.mkdirSync(path.join(base, 'data'), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Initialize state files if missing
  const profitStatePath = path.join(base, 'profit-state.json');
  if (!fs.existsSync(profitStatePath)) {
    fs.writeFileSync(profitStatePath, JSON.stringify({
      accumulatedProfit: 0, totalCycles: 0, lastDistributionAt: null,
      totalDistributions: 0, totalBtcAccumulated: '0.00000000',
      totalUsdtInEarn: '0.00000000', totalReinvested: '0.00000000',
    }, null, 2));
  }

  const stratStatePath = path.join(base, 'strategy-state.json');
  if (!fs.existsSync(stratStatePath)) {
    fs.writeFileSync(stratStatePath, JSON.stringify({
      version: 1, name: 'Balanced neutral', activeSince: 0,
      lastEvalAt: null,
      params: { conf_futures_min: 65, conf_spot_min: 70, rsi_long_min: 40,
                rsi_long_max: 65, vol_min: 1.2, directional_bias: 'neutral' },
      description: 'Estrategia inicial conservadora.',
      rationale: 'Inicio del bot. Sin historial de trades.',
    }, null, 2));
  }
}

// ── Build env for user bot ────────────────────────────────────

function buildBotEnv(userId: string, settings: UserSettings): NodeJS.ProcessEnv {
  const base = userDir(userId);
  return {
    ...process.env,
    // API keys (decrypted — only exist in memory)
    ANTHROPIC_API_KEY: settings.anthropic_api_key,
    BINGX_API_KEY: settings.bingx_api_key,
    BINGX_API_SECRET: settings.bingx_api_secret,
    GEMINI_API_KEY: settings.gemini_api_key,
    WHALE_ALERT_API_KEY: settings.whale_alert_api_key,
    TELEGRAM_BOT_TOKEN: settings.telegram_bot_token,
    TELEGRAM_CHAT_ID: settings.telegram_chat_id,
    // Bot settings
    DRY_RUN: settings.dry_run ? 'true' : 'false',
    INTERVAL_MINUTES: String(settings.interval_minutes),
    FUTURES_RISK_PCT: String(settings.futures_risk_pct),
    PROFIT_THRESHOLD_USDT: String(settings.profit_threshold),
    // Paths — override to user-specific directory
    BOT_USER_DIR: base,
    // Override resolved paths inside the bot by setting HOME-like env vars
    // The bot reads these in its own path resolution
  };
}

// ── Public API ────────────────────────────────────────────────

export function spawnBot(userId: string, settings: UserSettings): void {
  if (processes.has(userId)) {
    console.log(`[BotManager] Bot ${userId} ya está corriendo`);
    return;
  }

  if (!settings.anthropic_api_key) {
    console.log(`[BotManager] Bot ${userId} sin API key de Anthropic configurada — no se inicia`);
    return;
  }

  ensureUserDirs(userId);
  const base = userDir(userId);
  const logFile = path.join(base, 'logs', 'bot.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const botEnv = buildBotEnv(userId, settings);

  const child = spawn('node', [path.join(BOT_DIST_PATH, 'index.js')], {
    cwd: base,        // el bot usa __dirname relativo para encontrar logs/, cache/, data/
    env: botEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  child.on('exit', (code, signal) => {
    console.log(`[BotManager] Bot ${userId} terminó (code=${code} signal=${signal})`);
    processes.delete(userId);
    logStream.end();

    // Auto-restart si no fue kill intencional
    if (signal !== 'SIGTERM' && code !== 0) {
      console.log(`[BotManager] Reiniciando bot ${userId} en 10s...`);
      setTimeout(() => spawnBot(userId, settings), 10_000);
    }
  });

  child.on('error', err => {
    console.error(`[BotManager] Error en bot ${userId}:`, err);
    processes.delete(userId);
    logStream.end();
  });

  processes.set(userId, { process: child, startedAt: Date.now(), userId });
  console.log(`[BotManager] Bot ${userId} iniciado (PID ${child.pid})`);
}

export function stopBot(userId: string): void {
  const entry = processes.get(userId);
  if (!entry) return;
  entry.process.kill('SIGTERM');
  processes.delete(userId);
  console.log(`[BotManager] Bot ${userId} detenido`);
}

export function restartBot(userId: string, settings: UserSettings): void {
  stopBot(userId);
  setTimeout(() => spawnBot(userId, settings), 1000);
}

export function getBotStatus(userId: string): BotStatus {
  const entry = processes.get(userId);
  const base = userDir(userId);
  const configured = fs.existsSync(path.join(base, 'logs'));

  // Read profit state
  let profitState: ProfitState | undefined;
  try {
    profitState = JSON.parse(
      fs.readFileSync(path.join(base, 'profit-state.json'), 'utf8')
    ) as ProfitState;
  } catch { /* no data yet */ }

  // Read strategy state
  let strategyState: StrategyState | undefined;
  try {
    strategyState = JSON.parse(
      fs.readFileSync(path.join(base, 'strategy-state.json'), 'utf8')
    ) as StrategyState;
  } catch { /* no data yet */ }

  // Last log line
  let lastLogLine: string | undefined;
  try {
    const logPath = path.join(base, 'logs', 'bot.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      lastLogLine = lines.at(-1)?.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI
    }
  } catch { /* no log */ }

  if (!entry) {
    return { running: false, configured, profitState, strategyState, lastLogLine };
  }

  const uptimeSeconds = Math.round((Date.now() - entry.startedAt) / 1000);
  return {
    running: true,
    pid: entry.process.pid,
    startedAt: entry.startedAt,
    uptimeSeconds,
    lastLogLine,
    profitState,
    strategyState,
    configured,
  };
}

export function getLastDecisions(userId: string, limit = 20): unknown[] {
  const base = userDir(userId);
  const logPath = path.join(base, 'logs', 'decisions.jsonl');
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, 'utf8')
      .trim().split('\n').filter(Boolean)
      .slice(-limit);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function getLastErrors(userId: string, limit = 10): string[] {
  const base = userDir(userId);
  const logPath = path.join(base, 'logs', 'errors.log');
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, 'utf8')
      .trim().split('\n').filter(Boolean);
    return lines.slice(-limit);
  } catch { return []; }
}

// Auto-start all configured bots on SaaS startup
export function startAll(
  users: Array<{ id: string }>,
  getSettings: (userId: string) => UserSettings | null,
): void {
  let started = 0;
  for (const user of users) {
    const settings = getSettings(user.id);
    if (settings?.anthropic_api_key) {
      spawnBot(user.id, settings);
      started++;
    }
  }
  console.log(`[BotManager] ${started} bots iniciados al arrancar`);
}
