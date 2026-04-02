# 🤖 BTC Dual Bot — BingX v2

Bot de trading algorítmico 24/7 para BingX con oracle de IA (Claude Sonnet).
Opera en tres modos simultáneos con gestión de riesgo estricta.

## Modos de operación

| Modo | Descripción | Límites |
|------|-------------|---------|
| **Futures** | Captura tendencias long/short | Máx 3x leverage, 2% riesgo/trade |
| **Spot** | Acumula BTC real comprando dips | Nunca vende, DCA inteligente |
| **Earn** | Aparca % del profit en BingX Flexible Earn | Solo si APY ≥ 2% |

## Distribución automática de profit
Cuando el profit acumulado alcanza el umbral configurado:
- **30%** se reinvierte en Futures
- **40%** compra BTC Spot
- **30%** va a BingX Flexible Earn

## Oracle de IA
- **Principal**: Claude Sonnet — decisiones con indicadores técnicos, sentimiento y datos on-chain
- **Segunda opinión**: Gemini 2.0 Flash — noticias macro, validación si confianza ≥ 80%
- **Auto-adaptación**: ajusta parámetros de estrategia cada 50 ciclos

## Fuentes de datos en tiempo real
- Fear & Greed Index
- Noticias macro (Gemini + Google Search)
- Actividad ballenas (Whale Alert)
- Wallets institucionales BTC (Mempool.space)
- Contexto de sesión (Wall Street, Asia, Londres)

## Indicadores técnicos
RSI · EMA 20/50/200 · MACD · ATR · Volumen relativo · Régimen de tendencia 1h/4h/D

## SaaS Multi-usuario
- Dashboard web con estado del bot en tiempo real
- Instancias aisladas por usuario con API keys propias
- Key Anthropic compartida del servidor o propia por usuario
- Login con email/contraseña o Google OAuth
- Alertas Telegram: distribución de profit, errores, resumen diario

## Stack

```
Node.js 20 · TypeScript · Express.js · SQLite · Docker · Nginx · Lets Encrypt
```

## Requisitos
- BingX API key (permisos: Read + Trade, sin Withdrawal)
- Anthropic API key (Claude Sonnet)
- Gemini API key (gratuito en aistudio.google.com)
- VPS Ubuntu 22.04 (mínimo 2 vCPU / 4 GB RAM)

## Deploy en VPS

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/artse12/btc-dual-bot-bingx/main/deploy.sh)
```

Instala automáticamente: Docker, Nginx, SSL (Lets Encrypt), firewall UFW.

## Variables de entorno principales

```env
ADMIN_EMAIL=tu@email.com
ANTHROPIC_API_KEY=sk-ant-...
BINGX_API_KEY=...
BINGX_API_SECRET=...
ENCRYPTION_KEY=...
SESSION_SECRET=...
```

Ver `.env.example` para configuración completa.

## Reglas inamovibles
- Leverage máximo: **3x**
- Riesgo máximo por trade: **2%** del balance
- El BTC acumulado en Spot **nunca se vende**
- DRY_RUN=true por defecto — activar live trading explícitamente
