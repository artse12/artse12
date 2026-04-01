import { Router, type Request, type Response } from 'express';
import { getUserSettings, updateUserSettings, hasApiKeysConfigured } from '../db.js';
import { getBotStatus, spawnBot, stopBot } from '../bot-manager.js';

const router = Router();

// ── GET /settings ─────────────────────────────────────────────
router.get('/settings', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const settings = getUserSettings(userId);
  const status = getBotStatus(userId);
  const welcome = req.query.welcome === '1';
  const saved = req.session?.flashSuccess;
  delete req.session.flashSuccess;
  const error = req.session?.flashError;
  delete req.session.flashError;

  res.send(settingsHtml({ settings, status, welcome, saved, error }));
});

// ── POST /settings ────────────────────────────────────────────
router.post('/settings', async (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const body = req.body as Record<string, string>;

  try {
    updateUserSettings(userId, {
      bingx_api_key: body.bingx_api_key?.trim() || undefined,
      bingx_api_secret: body.bingx_api_secret?.trim() || undefined,
      anthropic_api_key: body.anthropic_api_key?.trim() || undefined,
      gemini_api_key: body.gemini_api_key?.trim() || undefined,
      whale_alert_api_key: body.whale_alert_api_key?.trim() || undefined,
      telegram_bot_token: body.telegram_bot_token?.trim() || undefined,
      telegram_chat_id: body.telegram_chat_id?.trim() || undefined,
      dry_run: body.dry_run === '1',
      interval_minutes: parseInt(body.interval_minutes ?? '5', 10),
      futures_risk_pct: parseFloat(body.futures_risk_pct ?? '0.02'),
      profit_threshold: parseFloat(body.profit_threshold ?? '100'),
    });

    req.session.flashSuccess = 'Configuración guardada correctamente.';

    // Si el bot está corriendo, reiniciar para que tome los nuevos valores
    const status = getBotStatus(userId);
    if (status.running) {
      const newSettings = getUserSettings(userId);
      if (newSettings?.anthropic_api_key) {
        stopBot(userId);
        setTimeout(() => {
          if (newSettings) spawnBot(userId, newSettings);
        }, 1500);
      }
    }
  } catch (err) {
    req.session.flashError = `Error al guardar: ${String(err)}`;
  }

  res.redirect('/settings');
});

// ── POST /settings/start ──────────────────────────────────────
router.post('/settings/start', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  if (!hasApiKeysConfigured(userId)) {
    req.session.flashError = 'Configura tu ANTHROPIC_API_KEY antes de iniciar el bot.';
    res.redirect('/settings');
    return;
  }
  const settings = getUserSettings(userId);
  if (settings) spawnBot(userId, settings);
  res.redirect('/');
});

// ── POST /settings/stop ───────────────────────────────────────
router.post('/settings/stop', (req: Request, res: Response) => {
  stopBot(req.session!.userId!);
  res.redirect('/');
});

// ── HTML ──────────────────────────────────────────────────────

function mask(val: string): string {
  if (!val) return '';
  if (val.length <= 8) return '••••••••';
  return val.slice(0, 4) + '••••••••' + val.slice(-4);
}

function settingsHtml(params: {
  settings: ReturnType<typeof getUserSettings>;
  status: ReturnType<typeof getBotStatus>;
  welcome: boolean;
  saved?: string;
  error?: string;
}): string {
  const { settings, status, welcome, saved, error } = params;
  const s = settings;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuración — BTC Dual Bot</title>
  <style>${pageStyles()}</style>
</head>
<body>
  ${navbar()}
  <div class="container">
    ${welcome ? '<div class="alert success">¡Cuenta creada! Configura tus API keys para empezar.</div>' : ''}
    ${saved ? `<div class="alert success">${esc(saved)}</div>` : ''}
    ${error ? `<div class="alert error">${esc(error)}</div>` : ''}

    <div class="section-header">
      <h2>⚙️ Configuración</h2>
      <div class="bot-controls">
        ${status.running
          ? `<span class="badge running">● Corriendo</span>
             <form method="POST" action="/settings/stop" style="display:inline">
               <button type="submit" class="btn-danger">Detener bot</button>
             </form>`
          : `<span class="badge stopped">● Detenido</span>
             <form method="POST" action="/settings/start" style="display:inline">
               <button type="submit" class="btn-green">Iniciar bot</button>
             </form>`}
      </div>
    </div>

    <form method="POST" action="/settings">
      <div class="card">
        <h3>🔑 API Keys de Exchange</h3>
        <div class="field-group">
          <div class="field">
            <label>BingX API Key</label>
            <input type="password" name="bingx_api_key"
              placeholder="${s?.bingx_api_key ? mask(s.bingx_api_key) : 'Introducir clave...'}">
            <small>Permisos: Read + Trade (sin Withdrawal)</small>
          </div>
          <div class="field">
            <label>BingX API Secret</label>
            <input type="password" name="bingx_api_secret"
              placeholder="${s?.bingx_api_secret ? '••••••••••••••••' : 'Introducir secret...'}">
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🤖 API Keys de IA</h3>
        <div class="field-group">
          <div class="field">
            <label>Anthropic API Key <span class="required">*</span></label>
            <input type="password" name="anthropic_api_key"
              placeholder="${s?.anthropic_api_key ? mask(s.anthropic_api_key) : 'sk-ant-...'}">
            <small>Oracle principal (Claude). Obligatorio.</small>
          </div>
          <div class="field">
            <label>Gemini API Key</label>
            <input type="password" name="gemini_api_key"
              placeholder="${s?.gemini_api_key ? mask(s.gemini_api_key) : 'AIza... (opcional)'}">
            <small>Segunda opinión + noticias macro. Gratuito.</small>
          </div>
          <div class="field">
            <label>Whale Alert API Key</label>
            <input type="password" name="whale_alert_api_key"
              placeholder="${s?.whale_alert_api_key ? mask(s.whale_alert_api_key) : 'Opcional'}">
            <small>Monitoreo de ballenas. Tier gratuito disponible.</small>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>📱 Notificaciones Telegram</h3>
        <div class="field-group">
          <div class="field">
            <label>Bot Token</label>
            <input type="password" name="telegram_bot_token"
              placeholder="${s?.telegram_bot_token ? mask(s.telegram_bot_token) : 'Crear bot en @BotFather'}">
          </div>
          <div class="field">
            <label>Chat ID</label>
            <input type="text" name="telegram_chat_id"
              value="${s?.telegram_chat_id ?? ''}"
              placeholder="Tu chat ID numérico">
            <small>Obtener con @userinfobot</small>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>⚠️ Configuración de Trading</h3>
        <div class="field-group">
          <div class="field">
            <label>Modo</label>
            <select name="dry_run">
              <option value="1" ${s?.dry_run !== false ? 'selected' : ''}>DRY RUN (simulación — recomendado para empezar)</option>
              <option value="0" ${s?.dry_run === false ? 'selected' : ''}>LIVE TRADING (real — ¡cuidado!)</option>
            </select>
          </div>
          <div class="field">
            <label>Intervalo entre ciclos (minutos)</label>
            <input type="number" name="interval_minutes" min="1" max="60"
              value="${s?.interval_minutes ?? 5}">
            <small>5 min = más preciso, más caro en tokens. 15 min = -67% coste.</small>
          </div>
          <div class="field">
            <label>Risk por trade (% del balance)</label>
            <input type="number" name="futures_risk_pct" min="0.005" max="0.02" step="0.005"
              value="${s?.futures_risk_pct ?? 0.02}">
            <small>Máximo: 0.02 (2%). Recomendado para empezar: 0.01.</small>
          </div>
          <div class="field">
            <label>Umbral de distribución de profit ($)</label>
            <input type="number" name="profit_threshold" min="10" max="10000"
              value="${s?.profit_threshold ?? 100}">
            <small>Distribuir 30/40/30 cuando el profit acumulado alcance este valor.</small>
          </div>
        </div>
      </div>

      <button type="submit" class="btn-primary">💾 Guardar configuración</button>
    </form>
  </div>
  <script>
    // Confirmar antes de activar live trading
    document.querySelector('form[action="/settings"]').addEventListener('submit', function(e) {
      const mode = document.querySelector('[name="dry_run"]').value;
      if (mode === '0') {
        if (!confirm('⚠️ ¿Seguro que quieres activar LIVE TRADING con dinero real?')) {
          e.preventDefault();
        }
      }
    });
  </script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function navbar(): string {
  return `<nav>
    <div class="nav-brand">🤖 BTC Dual Bot</div>
    <div class="nav-links">
      <a href="/">Dashboard</a>
      <a href="/settings">Configuración</a>
      <a href="/logout">Salir</a>
    </div>
  </nav>`;
}

function pageStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0d1117; color: #c9d1d9; min-height: 100vh; }
    nav { background: #161b22; border-bottom: 1px solid #30363d;
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.75rem 1.5rem; }
    .nav-brand { font-weight: 700; font-size: 1.1rem; color: #f0f6fc; }
    .nav-links a { color: #8b949e; text-decoration: none; margin-left: 1.5rem; font-size: 0.875rem; }
    .nav-links a:hover { color: #f0f6fc; }
    .container { max-width: 900px; margin: 2rem auto; padding: 0 1.5rem; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h2 { font-size: 1.4rem; color: #f0f6fc; }
    .bot-controls { display: flex; align-items: center; gap: 0.75rem; }
    .badge { font-size: 0.8rem; padding: 0.3rem 0.7rem; border-radius: 999px; }
    .badge.running { background: #1f4022; color: #3fb950; }
    .badge.stopped { background: #3d1f1f; color: #f85149; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
            padding: 1.5rem; margin-bottom: 1.25rem; }
    .card h3 { font-size: 1rem; color: #f0f6fc; margin-bottom: 1.25rem; }
    .field-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.4rem; }
    label { font-size: 0.8rem; color: #8b949e; }
    .required { color: #f85149; }
    input, select { padding: 0.55rem 0.8rem; background: #0d1117; border: 1px solid #30363d;
                    border-radius: 6px; color: #c9d1d9; font-size: 0.95rem; transition: border-color 0.2s; }
    input:focus, select:focus { outline: none; border-color: #58a6ff; }
    small { font-size: 0.75rem; color: #6e7681; }
    .btn-primary { padding: 0.7rem 2rem; background: #238636; color: #fff; border: none;
                   border-radius: 6px; font-size: 1rem; cursor: pointer; margin-top: 0.5rem; }
    .btn-primary:hover { background: #2ea043; }
    .btn-green { padding: 0.45rem 1rem; background: #238636; color: #fff; border: none;
                 border-radius: 6px; font-size: 0.875rem; cursor: pointer; }
    .btn-danger { padding: 0.45rem 1rem; background: #b91c1c; color: #fff; border: none;
                  border-radius: 6px; font-size: 0.875rem; cursor: pointer; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
    .alert.success { background: #1f4022; border: 1px solid #3fb950; color: #3fb950; }
    .alert.error { background: #3d1f1f; border: 1px solid #f85149; color: #f85149; }
  `;
}

export { router as settingsRouter };
