import { Router, type Request, type Response } from 'express';
import { getUserSettings, hasApiKeysConfigured } from '../db.js';
import {
  getBotStatus, getLastDecisions, getLastErrors,
} from '../bot-manager.js';

const router = Router();

// ── GET / ─────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const status = getBotStatus(userId);
  const configured = hasApiKeysConfigured(userId);
  const settings = getUserSettings(userId);
  const decisions = getLastDecisions(userId, 20) as DecisionEntry[];
  const errors = getLastErrors(userId, 5);

  res.send(dashboardHtml({ userId, status, configured, settings, decisions, errors }));
});

// ── Types ─────────────────────────────────────────────────────

interface DecisionEntry {
  timestamp: number;
  cycle: number;
  futuresPrice: number;
  futuresDec: { action: string; confidence: number; reason: string };
  spotDec: { action: string; confidence: number; reason: string };
  fng: number;
  session: string;
  accumulatedProfit: number;
}

// ── HTML Dashboard ────────────────────────────────────────────

function dashboardHtml(params: {
  userId: string;
  status: ReturnType<typeof getBotStatus>;
  configured: boolean;
  settings: ReturnType<typeof getUserSettings>;
  decisions: DecisionEntry[];
  errors: string[];
}): string {
  const { status, configured, settings, decisions, errors } = params;
  const p = status.profitState;
  const s = status.strategyState;

  const uptimeStr = status.uptimeSeconds !== undefined
    ? formatUptime(status.uptimeSeconds)
    : '—';

  const profitPct = p
    ? Math.min((p.accumulatedProfit / (settings?.profit_threshold ?? 100)) * 100, 100).toFixed(1)
    : '0';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — BTC Dual Bot</title>
  <style>${dashboardStyles()}</style>
</head>
<body>
  ${navbar()}
  <div class="container">

    ${!configured ? `
    <div class="alert warning">
      ⚠️ Aún no has configurado tus API keys.
      <a href="/settings?welcome=1">Configurar ahora →</a>
    </div>` : ''}

    <!-- Status bar -->
    <div class="status-bar">
      <div class="status-item">
        <span class="label">Estado</span>
        <span class="value ${status.running ? 'green' : 'red'}">
          ${status.running ? '● Corriendo' : '● Detenido'}
        </span>
      </div>
      <div class="status-item">
        <span class="label">Uptime</span>
        <span class="value">${uptimeStr}</span>
      </div>
      <div class="status-item">
        <span class="label">Modo</span>
        <span class="value ${settings?.dry_run !== false ? 'yellow' : 'red'}">
          ${settings?.dry_run !== false ? 'DRY RUN' : '⚡ LIVE'}
        </span>
      </div>
      <div class="status-item">
        <span class="label">Estrategia</span>
        <span class="value">${esc(s?.name ?? '—')}</span>
      </div>
      <div class="status-controls">
        ${status.running
          ? `<button onclick="botAction('/api/bot/restart')" class="btn-yellow">↺ Restart</button>
             <button onclick="botAction('/api/bot/stop')" class="btn-red">■ Stop</button>`
          : configured
            ? `<button onclick="botAction('/api/bot/start')" class="btn-green">▶ Start</button>`
            : `<a href="/settings" class="btn-gray">Configurar</a>`}
      </div>
    </div>

    <!-- Profit cards -->
    <div class="cards">
      <div class="card">
        <div class="card-label">Profit acumulado</div>
        <div class="card-value">${p ? `$${p.accumulatedProfit.toFixed(2)}` : '$0.00'}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${profitPct}%"></div>
        </div>
        <div class="card-sub">${profitPct}% de $${settings?.profit_threshold ?? 100} umbral</div>
      </div>
      <div class="card">
        <div class="card-label">BTC acumulado (total)</div>
        <div class="card-value btc">${p?.totalBtcAccumulated ?? '0.00000000'} BTC</div>
        <div class="card-sub">${p?.totalDistributions ?? 0} distribuciones</div>
      </div>
      <div class="card">
        <div class="card-label">USDT en Flexible Earn</div>
        <div class="card-value">$${p?.totalUsdtInEarn ?? '0.00'}</div>
        <div class="card-sub">Generando APY</div>
      </div>
      <div class="card">
        <div class="card-label">Capital reinvertido</div>
        <div class="card-value">$${p?.totalReinvested ?? '0.00'}</div>
        <div class="card-sub">En Futures</div>
      </div>
    </div>

    <!-- Last decisions -->
    <div class="section">
      <h3>📊 Últimas decisiones</h3>
      ${decisions.length === 0
        ? '<p class="empty">Sin decisiones aún. El bot registrará aquí cada ciclo.</p>'
        : `<table>
          <thead>
            <tr><th>Hora</th><th>Ciclo</th><th>BTC Price</th><th>Futures</th><th>Spot</th><th>F&G</th><th>Profit acc.</th></tr>
          </thead>
          <tbody>
            ${[...decisions].reverse().map(d => `
            <tr>
              <td>${new Date(d.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</td>
              <td>#${d.cycle}</td>
              <td>$${Math.round(d.futuresPrice).toLocaleString()}</td>
              <td><span class="action ${d.futuresDec.action.toLowerCase()}">${d.futuresDec.action}</span> ${d.futuresDec.confidence}%</td>
              <td><span class="action ${d.spotDec.action.toLowerCase()}">${d.spotDec.action}</span></td>
              <td>${d.fng}</td>
              <td>$${d.accumulatedProfit.toFixed(2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
    </div>

    <!-- Errors -->
    ${errors.length > 0 ? `
    <div class="section errors-section">
      <h3>🚨 Últimos errores</h3>
      ${errors.map(e => `<div class="error-line">${esc(e)}</div>`).join('')}
    </div>` : ''}

    <!-- Last log line -->
    ${status.lastLogLine ? `
    <div class="section">
      <h3>📋 Último log</h3>
      <div class="log-line">${esc(status.lastLogLine)}</div>
    </div>` : ''}

  </div>

  <script>
    async function botAction(url) {
      try {
        const r = await fetch(url, { method: 'POST' });
        const j = await r.json();
        if (j.ok) setTimeout(() => location.reload(), 1500);
        else alert('Error: ' + j.error);
      } catch(e) { alert('Error de red'); }
    }
    // Auto-refresh cada 30s
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function navbar(): string {
  return `<nav>
    <div class="nav-brand">🤖 BTC Dual Bot</div>
    <div class="nav-links">
      <a href="/" class="active">Dashboard</a>
      <a href="/settings">Configuración</a>
      <a href="/logout">Salir</a>
    </div>
  </nav>`;
}

function dashboardStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0d1117; color: #c9d1d9; }
    nav { background: #161b22; border-bottom: 1px solid #30363d;
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.75rem 1.5rem; }
    .nav-brand { font-weight: 700; font-size: 1.1rem; color: #f0f6fc; }
    .nav-links a { color: #8b949e; text-decoration: none; margin-left: 1.5rem; font-size: 0.875rem; }
    .nav-links a:hover, .nav-links a.active { color: #f0f6fc; }
    .container { max-width: 1100px; margin: 1.5rem auto; padding: 0 1.5rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1.25rem; font-size: 0.875rem; }
    .alert.warning { background: #3d2e1f; border: 1px solid #d29922; color: #d29922; }
    .alert.warning a { color: #d29922; font-weight: 600; }
    .status-bar { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
                  padding: 1rem 1.25rem; display: flex; align-items: center; gap: 2rem;
                  flex-wrap: wrap; margin-bottom: 1.25rem; }
    .status-item { display: flex; flex-direction: column; gap: 0.25rem; }
    .label { font-size: 0.75rem; color: #6e7681; text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 0.95rem; font-weight: 600; color: #c9d1d9; }
    .value.green { color: #3fb950; }
    .value.red { color: #f85149; }
    .value.yellow { color: #d29922; }
    .status-controls { margin-left: auto; display: flex; gap: 0.5rem; }
    .btn-green, .btn-red, .btn-yellow, .btn-gray { padding: 0.4rem 0.9rem; border: none;
      border-radius: 6px; font-size: 0.875rem; cursor: pointer; text-decoration: none; }
    .btn-green { background: #238636; color: #fff; }
    .btn-red { background: #b91c1c; color: #fff; }
    .btn-yellow { background: #9a6700; color: #fff; }
    .btn-gray { background: #30363d; color: #c9d1d9; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
             gap: 1rem; margin-bottom: 1.5rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; }
    .card-label { font-size: 0.75rem; color: #6e7681; text-transform: uppercase; margin-bottom: 0.5rem; }
    .card-value { font-size: 1.4rem; font-weight: 700; color: #f0f6fc; margin-bottom: 0.5rem; }
    .card-value.btc { font-size: 1.1rem; color: #f7931a; }
    .card-sub { font-size: 0.8rem; color: #6e7681; }
    .progress-bar { height: 4px; background: #21262d; border-radius: 2px; margin: 0.5rem 0; }
    .progress-fill { height: 100%; background: #238636; border-radius: 2px; transition: width 0.3s; }
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
               padding: 1.25rem; margin-bottom: 1rem; }
    .section h3 { font-size: 0.95rem; color: #f0f6fc; margin-bottom: 1rem; }
    .empty { color: #6e7681; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { color: #6e7681; font-weight: 600; padding: 0.4rem 0.5rem; text-align: left;
         border-bottom: 1px solid #21262d; }
    td { padding: 0.45rem 0.5rem; border-bottom: 1px solid #161b22; color: #c9d1d9; }
    tr:hover td { background: #1c2128; }
    .action { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .action.long { background: #1f4022; color: #3fb950; }
    .action.short { background: #3d1f1f; color: #f85149; }
    .action.hold, .action.wait { background: #21262d; color: #8b949e; }
    .action.close { background: #3d2e1f; color: #d29922; }
    .action.buy_dip { background: #1a2d3d; color: #58a6ff; }
    .errors-section { border-color: #f8514940; }
    .error-line { font-size: 0.8rem; color: #f85149; padding: 0.25rem 0;
                  border-bottom: 1px solid #21262d; font-family: monospace; }
    .log-line { font-size: 0.8rem; font-family: monospace; color: #8b949e; }
  `;
}

export { router as dashboardRouter };
