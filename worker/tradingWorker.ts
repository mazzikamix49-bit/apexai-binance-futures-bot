import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { analyzeMarket } from '../src/services/marketAnalysisService';
import { FuturesSymbolInfo } from '../src/types/trading';

const statePath = path.resolve(process.env.WORKER_STATE_FILE || './worker-state.json');
const key = process.env.BINANCE_API_KEY || '';
const secret = process.env.BINANCE_API_SECRET || '';
const testnet = process.env.BINANCE_TESTNET === 'true';
const paper = process.env.WORKER_PAPER_MODE !== 'false';
const base = testnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';

const intervalMs = Math.max(5000, Number(process.env.WORKER_SCAN_INTERVAL_MS || 30000));
const riskPct = Number(process.env.WORKER_RISK_PER_TRADE_PCT || 0.35);
const leverage = Math.min(20, Math.max(1, Number(process.env.WORKER_LEVERAGE || 5)));
const maxPositions = Math.max(1, Number(process.env.WORKER_MAX_POSITIONS || 2));
const minConfidence = Number(process.env.WORKER_MIN_CONFIDENCE || 78);
const maxAtr = Number(process.env.WORKER_MAX_ATR_PCT || 3.5);
const minRR = Number(process.env.WORKER_MIN_RR || 1.5);
const feeBps = Number(process.env.WORKER_FEE_BPS || 4);

interface WPos {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  qty: number;
  margin: number;
  leverage: number;
  sl: number;
  tp: number;
  openedAt: number;
  paper: boolean;
}

interface WState {
  startedAt: number;
  lastTick: number;
  positions: WPos[];
  closed: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
  net: number;
}

let state: WState = {
  startedAt: Date.now(),
  lastTick: 0,
  positions: [],
  closed: 0,
  wins: 0,
  losses: 0,
  grossProfit: 0,
  grossLoss: 0,
  net: 0,
};

try {
  if (fs.existsSync(statePath)) {
    state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
  }
} catch (e) {
  console.error('[worker] could not load state:', e);
}

function save() {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[worker] state save failed:', e);
  }
}

function sign(q: string) {
  return crypto.createHmac('sha256', secret).update(q).digest('hex');
}

async function publicJson(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${text}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function signed(pathname: string, params: Record<string, string | number> = {}, method = 'GET') {
  if (!key || !secret) throw new Error('BINANCE_API_KEY/BINANCE_API_SECRET missing');
  const p = new URLSearchParams();
  Object.entries({ ...params, timestamp: Date.now(), recvWindow: 60000 }).forEach(([k, v]) => p.set(k, String(v)));
  const qs = p.toString();
  const url = `${base}${pathname}?${qs}&signature=${sign(qs)}`;
  const r = await fetch(url, { method, headers: { 'X-MBX-APIKEY': key, Accept: 'application/json' } });
  const text = await r.text();
  let d: any;
  try { d = JSON.parse(text); } catch { d = { msg: text }; }
  if (!r.ok) throw new Error(d.msg || `Binance ${r.status}`);
  return d;
}

async function place(symbol: string, side: 'BUY' | 'SELL', qty: number, reduceOnly = false) {
  return signed('/fapi/v1/order', { symbol, side, type: 'MARKET', quantity: qty, reduceOnly }, 'POST');
}

async function account() {
  return signed('/fapi/v2/account');
}

function roundStep(q: number, step: number) {
  if (!Number.isFinite(q) || !Number.isFinite(step) || step <= 0) return 0;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  const rounded = Math.floor(q / step) * step;
  return Number(rounded.toFixed(decimals));
}

async function tickers(): Promise<any[]> {
  const data = await publicJson(`${base}/fapi/v1/ticker/24hr`);
  if (!Array.isArray(data)) throw new Error('Binance ticker response was not an array');
  return data;
}

async function runOnce() {
  state.lastTick = Date.now();
  console.log('[worker] scan started');

  const raw = await tickers();
  const pairs = raw
    .filter(x => x.symbol?.endsWith('USDT') && Number(x.quoteVolume) > 10000000)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 10);

  console.log(`[worker] selected ${pairs.length} USDT futures pairs: ${pairs.map(x => x.symbol).join(', ')}`);

  const infos: FuturesSymbolInfo[] = pairs.map(x => ({
    symbol: x.symbol,
    baseAsset: x.symbol.replace('USDT', ''),
    quoteAsset: 'USDT',
    pricePrecision: 4,
    quantityPrecision: 3,
    minQty: 0.001,
    stepSize: 0.001,
    tickSize: 0.0001,
    minNotional: 5,
    price: Number(x.lastPrice),
    priceChangePercent: Number(x.priceChangePercent),
    volume24h: Number(x.volume),
    quoteVolume24h: Number(x.quoteVolume),
    high24h: Number(x.highPrice),
    low24h: Number(x.lowPrice),
    rsi14: 50,
    trend: 'NEUTRAL',
    aiScore: 0,
    aiRecommendedSignal: 'HOLD',
  } as any));

  // Manage existing paper positions first.
  for (const p of [...state.positions]) {
    const pair = infos.find(x => x.symbol === p.symbol);
    if (!pair) continue;

    const price = pair.price;
    const pnlPct = p.side === 'LONG' ? (price - p.entry) / p.entry : (p.entry - price) / p.entry;
    const pnl = p.margin * pnlPct * p.leverage;
    const hit = p.side === 'LONG'
      ? price <= p.sl || price >= p.tp
      : price >= p.sl || price <= p.tp;

    if (hit) {
      if (!p.paper) {
        await place(p.symbol, p.side === 'LONG' ? 'SELL' : 'BUY', p.qty, true);
      }

      const fee = p.margin * p.leverage * 2 * feeBps / 10000;
      const net = pnl - fee;
      state.closed++;
      state.net += net;

      if (net >= 0) {
        state.wins++;
        state.grossProfit += net;
      } else {
        state.losses++;
        state.grossLoss += Math.abs(net);
      }

      state.positions = state.positions.filter(x => x !== p);
      save();
      console.log(`[worker] CLOSED ${p.symbol} ${p.side} net=${net.toFixed(4)}`);
    }
  }

  if (state.positions.length >= maxPositions) {
    console.log(`[worker] max positions reached (${state.positions.length}/${maxPositions})`);
    return;
  }

  const open = new Set(state.positions.map(p => p.symbol));
  const scanPairs = infos.filter(p => !open.has(p.symbol)).slice(0, 6);
  console.log(`[worker] analyzing ${scanPairs.length} pairs: ${scanPairs.map(p => p.symbol).join(', ')}`);

  const analyses = await Promise.all(
    scanPairs.map(async p => {
      try {
        const result = await analyzeMarket(p.symbol, p, testnet);
        console.log(
          `[worker] ${p.symbol}: side=${result?.side ?? 'NONE'} confidence=${result?.confidence ?? 'N/A'} RR=${result?.riskReward ?? 'N/A'} ATR=${result?.atrPercent ?? 'N/A'}`
        );
        return result;
      } catch (err) {
        console.error(`[worker] ${p.symbol} analysis failed:`, err);
        return null;
      }
    })
  );

  const candidates = analyses
    .filter(a => a && a.side && a.confidence >= minConfidence && a.atrPercent <= maxAtr && a.riskReward >= minRR)
    .sort((a, b) => (b!.confidence + b!.riskReward * 5) - (a!.confidence + a!.riskReward * 5));

  const a = candidates[0];
  if (!a) {
    console.log('[worker] no trade candidate passed filters');
    return;
  }

  const pair = infos.find(x => x.symbol === a.symbol);
  if (!pair || !a.stopLossPrice || !a.tp2Price || !a.price) return;

  const equity = paper ? 1000 : Number((await account()).totalMarginBalance) || 0;
  const stopPct = Math.abs((a.stopLossPrice - a.price) / a.price) * 100;
  const margin = Math.max(
    1,
    Math.min(25, equity * (riskPct / 100) / Math.max(0.001, (stopPct / 100) * leverage))
  );

  const qty = roundStep((margin * leverage) / a.price, pair.stepSize || 0.001);
  if (qty < (pair.minQty || 0.001)) {
    console.log(`[worker] ${a.symbol} skipped: quantity ${qty} below minimum ${pair.minQty}`);
    return;
  }

  if (!paper) {
    await signed('/fapi/v1/leverage', { symbol: a.symbol, leverage }, 'POST');
    await place(a.symbol, a.side === 'LONG' ? 'BUY' : 'SELL', qty, false);
  }

  state.positions.push({
    symbol: a.symbol,
    side: a.side!,
    entry: a.price,
    qty,
    margin,
    leverage,
    sl: a.stopLossPrice,
    tp: a.tp2Price,
    openedAt: Date.now(),
    paper,
  });
  save();

  console.log(
    `[worker] OPENED ${paper ? 'PAPER' : 'REAL'} ${a.symbol} ${a.side} entry=${a.price} qty=${qty} SL=${a.stopLossPrice} TP=${a.tp2Price} confidence=${a.confidence}`
  );
}

let busy = false;

export function workerStatus() {
  return {
    ...state,
    enabled: true,
    running: true,
    paper,
    testnet,
    uptimeMs: Date.now() - state.startedAt,
    profitFactor: state.grossLoss
      ? state.grossProfit / state.grossLoss
      : state.grossProfit > 0 ? Infinity : 0,
  };
}

export function startWorker() {
  if (!paper && (!key || !secret)) {
    console.error('[worker] Real mode requested but Binance credentials are missing');
    return;
  }

  console.log(`[worker] started ${paper ? 'PAPER' : 'REAL'} mode; testnet=${testnet}; interval=${intervalMs}ms`);

  const loop = async () => {
    if (busy) {
      console.log('[worker] previous scan still running; skipping overlapping tick');
      return;
    }

    busy = true;
    try {
      await runOnce();
    } catch (e) {
      console.error('[worker] scan error:', e);
    } finally {
      busy = false;
    }
  };

  void loop();
  setInterval(() => void loop(), intervalMs);
}
