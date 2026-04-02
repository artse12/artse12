import crypto from 'crypto';
import 'dotenv/config';

// ── Types ─────────────────────────────────────────────────────
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Position {
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  status: string;
}

export interface EarnProduct {
  productId: string;
  asset: string;
  apy: number;
  minAmount: number;
}

// ── Config ────────────────────────────────────────────────────
const BASE_URL = 'https://open-api.bingx.com';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const API_KEY = process.env.BINGX_API_KEY ?? '';
const API_SECRET = process.env.BINGX_API_SECRET ?? '';

// ── HMAC signing ──────────────────────────────────────────────
function sign(params: Record<string, string | number>): string {
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  const toSign = sorted + `&timestamp=${Date.now()}`;
  return crypto.createHmac('sha256', API_SECRET).update(toSign).digest('hex');
}

function buildSignedQuery(params: Record<string, string | number>): string {
  const timestamp = Date.now();
  const withTs: Record<string, string | number> = { ...params, timestamp };
  const sorted = Object.keys(withTs)
    .sort()
    .map(k => `${k}=${withTs[k]}`)
    .join('&');
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(sorted)
    .digest('hex');
  return `${sorted}&signature=${signature}`;
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = Object.keys(params).length
    ? '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    : '';
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    headers: { 'X-BX-APIKEY': API_KEY },
  });
  if (!res.ok) throw new Error(`BingX GET ${path} → ${res.status} ${res.statusText}`);
  const json = await res.json() as { code: number; data: T; msg?: string };
  if (json.code !== 0) throw new Error(`BingX API error: ${json.msg ?? json.code}`);
  return json.data;
}

async function getAuth<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = '?' + buildSignedQuery(params);
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    headers: { 'X-BX-APIKEY': API_KEY },
  });
  if (!res.ok) throw new Error(`BingX GET ${path} → ${res.status} ${res.statusText}`);
  const json = await res.json() as { code: number; data: T; msg?: string };
  if (json.code !== 0) throw new Error(`BingX API error: ${json.msg ?? json.code}`);
  return json.data;
}

async function postAuth<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = '?' + buildSignedQuery(params);
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    method: 'POST',
    headers: {
      'X-BX-APIKEY': API_KEY,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`BingX POST ${path} → ${res.status} ${res.statusText}`);
  const json = await res.json() as { code: number; data: T; msg?: string };
  if (json.code !== 0) throw new Error(`BingX API error: ${json.msg ?? json.code}`);
  return json.data;
}

// ── BingX Client ──────────────────────────────────────────────
export class BingXClient {

  // ── Market data (no auth) ───────────────────────────────────

  async getCandles(
    mode: 'spot' | 'futures',
    interval: '5m' | '15m' | '1h' = '1h',
    limit = 100,
  ): Promise<Candle[]> {
    if (DRY_RUN) return this._mockCandles(limit);

    if (mode === 'spot') {
      type RawSpot = [string, string, string, string, string, string];
      const data = await get<RawSpot[]>(
        '/openApi/spot/v2/market/kline',
        { symbol: 'BTC-USDT', interval, limit },
      );
      return data.map(c => ({
        timestamp: parseInt(c[0], 10),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
    } else {
      type RawFutures = { open: string; high: string; low: string; close: string; volume: string; time: number };
      const data = await get<RawFutures[]>(
        '/openApi/swap/v3/quote/klines',
        { symbol: 'BTC-USDT', interval, limit },
      );
      return data.map(c => ({
        timestamp: c.time,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
      }));
    }
  }

  async getSpotPrice(): Promise<number> {
    if (DRY_RUN) return 83000 + Math.random() * 1000 - 500;
    const data = await get<{ price: string }>(
      '/openApi/spot/v1/ticker/price',
      { symbol: 'BTC-USDT' },
    );
    return parseFloat(data.price);
  }

  async getFuturesPrice(): Promise<number> {
    if (DRY_RUN) return 83050 + Math.random() * 1000 - 500;
    const data = await get<{ price: string }>(
      '/openApi/swap/v2/quote/price',
      { symbol: 'BTC-USDT' },
    );
    return parseFloat(data.price);
  }

  // ── Account (auth required) ─────────────────────────────────

  async getSpotBalance(): Promise<number> {
    if (DRY_RUN) return 150 + Math.random() * 50;
    type BalanceData = { balances: Array<{ asset: string; free: string }> };
    const data = await getAuth<BalanceData>('/openApi/spot/v1/account/balance');
    const usdt = data.balances.find(b => b.asset === 'USDT');
    return parseFloat(usdt?.free ?? '0');
  }

  async getFuturesBalance(): Promise<number> {
    if (DRY_RUN) return 487 + Math.random() * 20;
    type FuturesBalance = { balance: { balance: string } };
    const data = await getAuth<FuturesBalance>('/openApi/swap/v2/user/balance');
    return parseFloat(data.balance.balance);
  }

  async getPosition(): Promise<Position | null> {
    if (DRY_RUN) return null;
    type PositionData = Array<{
      positionSide: string;
      positionAmt: string;
      avgPrice: string;
      unrealizedProfit: string;
      leverage: string;
    }>;
    const data = await getAuth<PositionData>(
      '/openApi/swap/v2/user/positions',
      { symbol: 'BTC-USDT' },
    );
    const open = data.find(p => parseFloat(p.positionAmt) !== 0);
    if (!open) return null;
    return {
      side: open.positionSide === 'LONG' ? 'LONG' : 'SHORT',
      qty: Math.abs(parseFloat(open.positionAmt)),
      entryPrice: parseFloat(open.avgPrice),
      unrealizedPnl: parseFloat(open.unrealizedProfit),
      leverage: parseInt(open.leverage, 10),
    };
  }

  // ── Futures orders ──────────────────────────────────────────

  async setLeverage(leverage: number): Promise<void> {
    if (DRY_RUN) return;
    await postAuth('/openApi/swap/v2/trade/leverage', {
      symbol: 'BTC-USDT',
      side: 'LONG',
      leverage,
    });
    await postAuth('/openApi/swap/v2/trade/leverage', {
      symbol: 'BTC-USDT',
      side: 'SHORT',
      leverage,
    });
  }

  async openPosition(params: {
    side: 'LONG' | 'SHORT';
    qty: number;
    sl: number;
    tp: number;
  }): Promise<OrderResult> {
    if (DRY_RUN) {
      return {
        orderId: `DRY_${Date.now()}`,
        symbol: 'BTC-USDT',
        side: params.side,
        qty: params.qty,
        price: 83000,
        status: 'FILLED',
      };
    }
    const positionSide = params.side;
    const orderSide = params.side === 'LONG' ? 'BUY' : 'SELL';
    return await postAuth<OrderResult>('/openApi/swap/v2/trade/order', {
      symbol: 'BTC-USDT',
      side: orderSide,
      positionSide,
      type: 'MARKET',
      quantity: params.qty,
      stopLoss: JSON.stringify({ type: 'STOP_MARKET', stopPrice: params.sl, workingType: 'MARK_PRICE' }),
      takeProfit: JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: params.tp, workingType: 'MARK_PRICE' }),
    });
  }

  async closePosition(side: 'LONG' | 'SHORT'): Promise<OrderResult> {
    if (DRY_RUN) {
      return {
        orderId: `DRY_CLOSE_${Date.now()}`,
        symbol: 'BTC-USDT',
        side,
        qty: 0,
        price: 83000,
        status: 'FILLED',
      };
    }
    const orderSide = side === 'LONG' ? 'SELL' : 'BUY';
    return await postAuth<OrderResult>('/openApi/swap/v2/trade/order', {
      symbol: 'BTC-USDT',
      side: orderSide,
      positionSide: side,
      type: 'MARKET',
      quantity: 0,
      reduceOnly: 'true',
    });
  }

  // ── Spot orders ─────────────────────────────────────────────

  async buyBtcSpot(usdtAmount: number): Promise<string> {
    if (DRY_RUN) {
      const mockPrice = 83000;
      const btcBought = (usdtAmount / mockPrice).toFixed(8);
      return btcBought;
    }
    type SpotOrder = { executedQty: string; cummulativeQuoteQty: string };
    const data = await postAuth<SpotOrder>('/openApi/spot/v1/trade/order', {
      symbol: 'BTC-USDT',
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: usdtAmount,
    });
    return data.executedQty;
  }

  // ── Internal transfer ───────────────────────────────────────

  async transferFuturesToSpot(usdtAmount: number): Promise<void> {
    if (DRY_RUN) return;
    await postAuth('/openApi/api/v3/asset/transfer', {
      type: 'FUTURES_UMFUTURE_TO_MAIN',
      asset: 'USDT',
      amount: usdtAmount,
    });
  }

  // ── Flexible Earn ───────────────────────────────────────────

  async getEarnProducts(): Promise<EarnProduct[]> {
    if (DRY_RUN) {
      return [{ productId: 'USDT_FLEXIBLE_001', asset: 'USDT', apy: 5.2, minAmount: 10 }];
    }
    type ProductList = { products: Array<{ productId: string; asset: string; apyRate: string; minPurchaseAmount: string }> };
    const data = await getAuth<ProductList>('/openApi/earn/v1/product/list', {
      productType: 'FLEXIBLE',
    });
    return data.products.map(p => ({
      productId: p.productId,
      asset: p.asset,
      apy: parseFloat(p.apyRate) * 100,
      minAmount: parseFloat(p.minPurchaseAmount),
    }));
  }

  async getEarnApy(asset: string): Promise<number> {
    const products = await this.getEarnProducts();
    const product = products.find(p => p.asset === asset);
    return product?.apy ?? 0;
  }

  async getEarnProductId(asset: string): Promise<string | null> {
    const products = await this.getEarnProducts();
    return products.find(p => p.asset === asset)?.productId ?? null;
  }

  async depositToEarn(asset: string, amount: number): Promise<void> {
    if (DRY_RUN) return;
    const productId = await this.getEarnProductId(asset);
    if (!productId) throw new Error(`No Earn product found for ${asset}`);
    await postAuth('/openApi/earn/v1/subscribe', { productId, amount, asset });
  }

  async redeemFromEarn(asset: string, amount: number): Promise<void> {
    if (DRY_RUN) return;
    const productId = await this.getEarnProductId(asset);
    if (!productId) throw new Error(`No Earn product found for ${asset}`);
    await postAuth('/openApi/earn/v1/redeem', { productId, amount, asset });
  }

  async getEarnPosition(): Promise<{ asset: string; amount: number; interest: number } | null> {
    if (DRY_RUN) return { asset: 'USDT', amount: 31.20, interest: 0.15 };
    type EarnPosition = { positions: Array<{ asset: string; amount: string; interest: string }> };
    const data = await getAuth<EarnPosition>('/openApi/earn/v1/position');
    const pos = data.positions.find(p => p.asset === 'USDT');
    if (!pos) return null;
    return {
      asset: pos.asset,
      amount: parseFloat(pos.amount),
      interest: parseFloat(pos.interest),
    };
  }

  // ── Mock helpers ────────────────────────────────────────────

  private _mockCandles(limit: number): Candle[] {
    const candles: Candle[] = [];
    let price = 83000;
    const now = Date.now();
    for (let i = limit; i >= 0; i--) {
      const change = (Math.random() - 0.48) * 200;
      price = Math.max(70000, price + change);
      const open = price;
      const close = price + (Math.random() - 0.5) * 100;
      const high = Math.max(open, close) + Math.random() * 50;
      const low = Math.min(open, close) - Math.random() * 50;
      candles.push({
        timestamp: now - i * 5 * 60 * 1000,
        open,
        high,
        low,
        close,
        volume: 100 + Math.random() * 500,
      });
    }
    return candles;
  }
}
