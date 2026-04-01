// PM2 ecosystem config — alternativa a Docker para VPS simples
// Uso: pm2 start ecosystem.config.cjs
// Requisito: Node.js 20+ instalado en el servidor

module.exports = {
  apps: [
    {
      // ── SaaS Platform ──────────────────────────────────────
      name: 'btc-saas',
      script: 'node',
      args: 'saas/dist/server.js',
      cwd: '/opt/btc-saas',
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: '10s',
      env_file: '/opt/btc-saas/.env',
      out_file: '/opt/btc-saas/data/saas-out.log',
      error_file: '/opt/btc-saas/data/saas-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        BOT_DIST_PATH: '/opt/btc-saas/dist',
        BOT_DATA_PATH: '/opt/btc-saas/data',
        USERS_DATA_PATH: '/opt/btc-saas/data/users',
      },
    },
  ],
};

// Setup inicial con PM2:
//   npm install -g pm2
//   npm ci && npm run build
//   cd saas && npm ci && npm run build && cd ..
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup    ← auto-arranque al reiniciar el servidor
