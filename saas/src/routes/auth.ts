import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import passport from 'passport';
import type { User } from '../db.js';
import { createUser, getUserByEmail, emailExists } from '../db.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

// ── GET /login ────────────────────────────────────────────────
router.get('/login', (req: Request, res: Response) => {
  if (req.session?.userId) {
    res.redirect('/');
    return;
  }
  const error = req.session?.flashError;
  delete req.session.flashError;
  res.send(loginHtml(error));
});

// ── POST /login ───────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    req.session.flashError = 'Email y contraseña requeridos';
    res.redirect('/login');
    return;
  }

  const user = getUserByEmail(email);
  if (!user) {
    req.session.flashError = 'Credenciales incorrectas';
    res.redirect('/login');
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    req.session.flashError = 'Credenciales incorrectas';
    res.redirect('/login');
    return;
  }

  req.session.userId = user.id;
  res.redirect('/');
});

// ── GET /register ─────────────────────────────────────────────
router.get('/register', (req: Request, res: Response) => {
  if (req.session?.userId) {
    res.redirect('/');
    return;
  }
  const error = req.session?.flashError;
  delete req.session.flashError;
  res.send(registerHtml(error));
});

// ── POST /register ────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, password2 } = req.body as {
    email?: string; password?: string; password2?: string;
  };

  if (!email || !password || !password2) {
    req.session.flashError = 'Todos los campos son requeridos';
    res.redirect('/register');
    return;
  }

  if (password.length < 8) {
    req.session.flashError = 'La contraseña debe tener al menos 8 caracteres';
    res.redirect('/register');
    return;
  }

  if (password !== password2) {
    req.session.flashError = 'Las contraseñas no coinciden';
    res.redirect('/register');
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    req.session.flashError = 'Email inválido';
    res.redirect('/register');
    return;
  }

  if (emailExists(email)) {
    req.session.flashError = 'Ya existe una cuenta con ese email';
    res.redirect('/register');
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = randomUUID();
  createUser(id, email, hash);

  req.session.userId = id;
  res.redirect('/settings?welcome=1');
});

// ── GET /logout ───────────────────────────────────────────────
router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ── Google OAuth (only active when GOOGLE_CLIENT_ID is set) ───
router.get('/auth/google',
  passport.authenticate('google', { scope: ['email', 'profile'], session: false })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  (req: Request, res: Response) => {
    const user = req.user as User;
    req.session.userId = user.id;
    res.redirect('/');
  }
);

// ── HTML templates ────────────────────────────────────────────

const googleEnabled = !!process.env.GOOGLE_CLIENT_ID;

function googleButton(): string {
  if (!googleEnabled) return '';
  return `
    <div class="divider"><span>o</span></div>
    <a href="/auth/google" class="btn-google">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
      </svg>
      Continuar con Google
    </a>`;
}

function loginHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — BTC Dual Bot</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="auth-container">
    <h1>🤖 BTC Dual Bot</h1>
    <h2>Iniciar sesión</h2>
    ${error ? `<div class="alert error">${escHtml(error)}</div>` : ''}
    <form method="POST" action="/login">
      <div class="field">
        <label>Email</label>
        <input type="email" name="email" required autofocus>
      </div>
      <div class="field">
        <label>Contraseña</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit">Entrar</button>
    </form>
    ${googleButton()}
    <p class="link">¿Sin cuenta? <a href="/register">Crear cuenta</a></p>
  </div>
</body>
</html>`;
}

function registerHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Registro — BTC Dual Bot</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="auth-container">
    <h1>🤖 BTC Dual Bot</h1>
    <h2>Crear cuenta</h2>
    ${error ? `<div class="alert error">${escHtml(error)}</div>` : ''}
    <form method="POST" action="/register">
      <div class="field">
        <label>Email</label>
        <input type="email" name="email" required autofocus>
      </div>
      <div class="field">
        <label>Contraseña (mín. 8 caracteres)</label>
        <input type="password" name="password" required minlength="8">
      </div>
      <div class="field">
        <label>Confirmar contraseña</label>
        <input type="password" name="password2" required>
      </div>
      <button type="submit">Crear cuenta</button>
    </form>
    ${googleButton()}
    <p class="link">¿Ya tienes cuenta? <a href="/login">Iniciar sesión</a></p>
  </div>
</body>
</html>`;
}

function baseStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0d1117; color: #c9d1d9; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; }
    .auth-container { background: #161b22; border: 1px solid #30363d;
                      border-radius: 12px; padding: 2rem; width: 100%; max-width: 380px; }
    h1 { text-align: center; font-size: 1.5rem; color: #f0f6fc; margin-bottom: 0.5rem; }
    h2 { text-align: center; font-size: 1rem; color: #8b949e; margin-bottom: 1.5rem; }
    .alert { padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
    .alert.error { background: #3d1f1f; border: 1px solid #f85149; color: #f85149; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.875rem; color: #8b949e; margin-bottom: 0.4rem; }
    input { width: 100%; padding: 0.6rem 0.8rem; background: #0d1117;
            border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;
            font-size: 1rem; transition: border-color 0.2s; }
    input:focus { outline: none; border-color: #58a6ff; }
    button { width: 100%; padding: 0.7rem; background: #238636; color: #fff;
             border: none; border-radius: 6px; font-size: 1rem;
             cursor: pointer; margin-top: 0.5rem; transition: background 0.2s; }
    button:hover { background: #2ea043; }
    .link { text-align: center; margin-top: 1rem; font-size: 0.875rem; color: #8b949e; }
    .link a { color: #58a6ff; text-decoration: none; }
    .link a:hover { text-decoration: underline; }
    .divider { display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0; color: #484f58; font-size: 0.8rem; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #30363d; }
    .btn-google { display: flex; align-items: center; justify-content: center; gap: 0.6rem;
                  width: 100%; padding: 0.65rem; background: #f8f9fa; color: #3c4043;
                  border: 1px solid #dadce0; border-radius: 6px; font-size: 0.95rem;
                  text-decoration: none; transition: background 0.2s; cursor: pointer; margin-top: 0.25rem; }
    .btn-google:hover { background: #e8eaed; }
  `;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export { router as authRouter };
