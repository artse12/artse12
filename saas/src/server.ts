import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import ConnectSQLite from 'connect-sqlite3';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllActiveUsers, getUserSettings, getUserByEmail, createUser } from './db.js';
import { startAll } from './bot-manager.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { settingsRouter } from './routes/settings.js';
import { apiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Session store ─────────────────────────────────────────────
const SQLiteStore = ConnectSQLite(session);

// ── App ───────────────────────────────────────────────────────
const app = express();

app.set('trust proxy', 1); // Trust Nginx

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(ROOT) }) as session.Store,
  secret: process.env.SESSION_SECRET ?? 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  },
}));

// ── Google OAuth strategy (only if credentials configured) ────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
  }, async (_at, _rt, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Google no devolvió email'));
      let user = getUserByEmail(email);
      if (!user) {
        const id = randomUUID();
        const hash = await bcrypt.hash(randomUUID(), 12); // random unusable password
        createUser(id, email, hash);
        user = getUserByEmail(email)!;
      }
      return done(null, user);
    } catch (err) {
      return done(err as Error);
    }
  }));
}

app.use(passport.initialize());

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') { next(); return; }
  if (req.session?.userId) { next(); return; }
  res.redirect('/login');
}

// ── Routes ────────────────────────────────────────────────────
app.use(authRouter); // /login, /register, /logout (no require auth)

app.use(requireAuth);

app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/', dashboardRouter);
app.use(settingsRouter);
app.use('/api', apiRouter);

// ── 404 ───────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).send('<h2>404 — Página no encontrada</h2><a href="/">Volver al inicio</a>');
});

// ── Error handler ─────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[SaaS] Error:', err);
  res.status(500).send('<h2>Error interno</h2><a href="/">Volver al inicio</a>');
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 BTC Dual Bot SaaS corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);

  // Auto-start all configured user bots
  try {
    const users = getAllActiveUsers();
    startAll(users, (userId) => getUserSettings(userId));
  } catch (err) {
    console.error('[SaaS] Error al iniciar bots:', err);
  }
});

// ── Session type extension ────────────────────────────────────
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    flashError?: string;
    flashSuccess?: string;
  }
}
