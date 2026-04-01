// ── Telegram Notifications ────────────────────────────────────
// Usa fetch nativo de Node 20 — sin dependencias extra.
// Los tokens vienen como parámetros o desde process.env.

const TELEGRAM_API = 'https://api.telegram.org';

export async function sendAlert(
  message: string,
  token?: string,
  chatId?: string,
): Promise<void> {
  const botToken = token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chat) return; // silencioso si no está configurado

  try {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: message,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] Error HTTP ${res.status}: ${err}`);
    }
  } catch (err) {
    // No lanzar error — las notificaciones son best-effort
    console.error('[Telegram] sendAlert fallido (silencioso):', err);
  }
}

// ── Formatters ────────────────────────────────────────────────

export function formatDistribution(params: {
  total: number;
  reinject: number;
  spotBtc: number;
  earn: number;
  btcBought: string;
  totalBtcAccumulated: string;
  totalUsdtInEarn: string;
}): string {
  const { total, reinject, spotBtc, earn, btcBought, totalBtcAccumulated, totalUsdtInEarn } = params;
  return (
    `💰 <b>Distribución de Profit</b>\n\n` +
    `Total: <b>$${total.toFixed(2)} USDT</b>\n` +
    `→ Futures (30%): $${reinject.toFixed(2)}\n` +
    `→ Spot BTC (40%): $${spotBtc.toFixed(2)} → ${btcBought} BTC\n` +
    `→ Earn (30%): $${earn.toFixed(2)} USDT\n\n` +
    `<b>BTC acumulado total:</b> ${totalBtcAccumulated} BTC\n` +
    `<b>USDT en Earn:</b> $${totalUsdtInEarn}`
  );
}

export function formatDailySummary(params: {
  cycleNum: number;
  accumulatedProfit: number;
  totalBtcAccumulated: string;
  totalUsdtInEarn: string;
  totalDistributions: number;
  strategyName: string;
  lastAction: string;
  btcPrice: number;
}): string {
  const {
    cycleNum, accumulatedProfit, totalBtcAccumulated,
    totalUsdtInEarn, totalDistributions, strategyName, lastAction, btcPrice,
  } = params;
  return (
    `📊 <b>Resumen Diario — BTC Dual Bot</b>\n\n` +
    `BTC precio: <b>$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b>\n` +
    `Ciclos hoy: ${cycleNum}\n` +
    `Profit acumulado: <b>$${accumulatedProfit.toFixed(2)} USDT</b>\n` +
    `BTC acumulado: <b>${totalBtcAccumulated} BTC</b>\n` +
    `USDT en Earn: <b>$${totalUsdtInEarn}</b>\n` +
    `Distribuciones: ${totalDistributions}\n\n` +
    `Estrategia: ${strategyName}\n` +
    `Última decisión: ${lastAction}`
  );
}

export function formatError(message: string): string {
  return `🚨 <b>Error en Bot</b>\n\n<code>${message.slice(0, 500)}</code>`;
}
