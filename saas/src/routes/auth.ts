import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
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

// ── HTML templates ────────────────────────────────────────────

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
  `;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export { router as authRouter };
