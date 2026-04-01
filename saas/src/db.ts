import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { encrypt, safeDecrypt } from './crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../saas.db');

// ── Types ─────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  is_active: number;
}

export interface UserSettings {
  user_id: string;
  bingx_api_key: string;
  bingx_api_secret: string;
  anthropic_api_key: string;
  gemini_api_key: string;
  whale_alert_api_key: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  dry_run: boolean;
  interval_minutes: number;
  futures_risk_pct: number;
  profit_threshold: number;
  updated_at: number | null;
}

// ── DB singleton ──────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

// ── Migrations ────────────────────────────────────────────────

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bingx_api_key_enc TEXT DEFAULT '',
      bingx_api_secret_enc TEXT DEFAULT '',
      anthropic_api_key_enc TEXT DEFAULT '',
      gemini_api_key_enc TEXT DEFAULT '',
      whale_alert_api_key_enc TEXT DEFAULT '',
      telegram_bot_token_enc TEXT DEFAULT '',
      telegram_chat_id TEXT DEFAULT '',
      dry_run INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 5,
      futures_risk_pct REAL NOT NULL DEFAULT 0.02,
      profit_threshold REAL NOT NULL DEFAULT 100,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
}

// ── User queries ──────────────────────────────────────────────

export function createUser(id: string, email: string, passwordHash: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(id, email.toLowerCase(), passwordHash, Date.now());

  // Create default settings
  db.prepare(`
    INSERT INTO user_settings (user_id) VALUES (?)
  `).run(id);
}

export function getUserByEmail(email: string): User | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .get(email.toLowerCase()) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
    .get(id) as User | undefined;
}

export function getAllActiveUsers(): User[] {
  return getDb()
    .prepare('SELECT * FROM users WHERE is_active = 1')
    .all() as User[];
}

export function emailExists(email: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.toLowerCase());
  return row !== undefined;
}

// ── Settings queries ──────────────────────────────────────────

interface RawSettings {
  user_id: string;
  bingx_api_key_enc: string;
  bingx_api_secret_enc: string;
  anthropic_api_key_enc: string;
  gemini_api_key_enc: string;
  whale_alert_api_key_enc: string;
  telegram_bot_token_enc: string;
  telegram_chat_id: string;
  dry_run: number;
  interval_minutes: number;
  futures_risk_pct: number;
  profit_threshold: number;
  updated_at: number | null;
}

export function getUserSettings(userId: string): UserSettings | null {
  const row = getDb()
    .prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .get(userId) as RawSettings | undefined;

  if (!row) return null;

  return {
    user_id: row.user_id,
    bingx_api_key: safeDecrypt(row.bingx_api_key_enc),
    bingx_api_secret: safeDecrypt(row.bingx_api_secret_enc),
    anthropic_api_key: safeDecrypt(row.anthropic_api_key_enc),
    gemini_api_key: safeDecrypt(row.gemini_api_key_enc),
    whale_alert_api_key: safeDecrypt(row.whale_alert_api_key_enc),
    telegram_bot_token: safeDecrypt(row.telegram_bot_token_enc),
    telegram_chat_id: row.telegram_chat_id,
    dry_run: row.dry_run === 1,
    interval_minutes: row.interval_minutes,
    futures_risk_pct: row.futures_risk_pct,
    profit_threshold: row.profit_threshold,
    updated_at: row.updated_at,
  };
}

export function updateUserSettings(
  userId: string,
  data: Partial<Omit<UserSettings, 'user_id' | 'updated_at'>>,
): void {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (data.bingx_api_key !== undefined) {
    updates.push('bingx_api_key_enc = ?');
    values.push(data.bingx_api_key ? encrypt(data.bingx_api_key) : '');
  }
  if (data.bingx_api_secret !== undefined) {
    updates.push('bingx_api_secret_enc = ?');
    values.push(data.bingx_api_secret ? encrypt(data.bingx_api_secret) : '');
  }
  if (data.anthropic_api_key !== undefined) {
    updates.push('anthropic_api_key_enc = ?');
    values.push(data.anthropic_api_key ? encrypt(data.anthropic_api_key) : '');
  }
  if (data.gemini_api_key !== undefined) {
    updates.push('gemini_api_key_enc = ?');
    values.push(data.gemini_api_key ? encrypt(data.gemini_api_key) : '');
  }
  if (data.whale_alert_api_key !== undefined) {
    updates.push('whale_alert_api_key_enc = ?');
    values.push(data.whale_alert_api_key ? encrypt(data.whale_alert_api_key) : '');
  }
  if (data.telegram_bot_token !== undefined) {
    updates.push('telegram_bot_token_enc = ?');
    values.push(data.telegram_bot_token ? encrypt(data.telegram_bot_token) : '');
  }
  if (data.telegram_chat_id !== undefined) {
    updates.push('telegram_chat_id = ?');
    values.push(data.telegram_chat_id);
  }
  if (data.dry_run !== undefined) {
    updates.push('dry_run = ?');
    values.push(data.dry_run ? 1 : 0);
  }
  if (data.interval_minutes !== undefined) {
    updates.push('interval_minutes = ?');
    values.push(data.interval_minutes);
  }
  if (data.futures_risk_pct !== undefined) {
    updates.push('futures_risk_pct = ?');
    values.push(Math.min(0.02, Math.max(0.005, data.futures_risk_pct)));
  }
  if (data.profit_threshold !== undefined) {
    updates.push('profit_threshold = ?');
    values.push(data.profit_threshold);
  }

  if (updates.length === 0) return;

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(userId);

  db.prepare(`
    UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?
  `).run(...values);
}

export function hasApiKeysConfigured(userId: string): boolean {
  const row = getDb()
    .prepare('SELECT anthropic_api_key_enc FROM user_settings WHERE user_id = ?')
    .get(userId) as { anthropic_api_key_enc: string } | undefined;
  return !!(row?.anthropic_api_key_enc);
}
