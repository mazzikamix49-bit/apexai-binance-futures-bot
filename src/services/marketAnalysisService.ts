import { BinanceService } from './binanceService';
import { FuturesSymbolInfo, TradeDirection } from '../types/trading';

type Candle = { time:number; open:number; high:number; low:number; close:number; volume:number; quoteVolume:number; tradesCount:number };

export interface MarketAnalysis {
  symbol: string;
  price: number;
  side: TradeDirection | null;
  score: number;
  confidence: number;
  riskScore: 'LOW' | 'MEDIUM' | 'HIGH';
  rsi14: number;
  atrPercent: number;
  adx: number;
  volumeRatio: number;
  trend1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend5m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  support: number;
  resistance: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  riskReward: number;
  rationale: string;
}

const avg = (a:number[]) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const ema = (values:number[], period:number) => {
  if (values.length < period) return avg(values);
  const k = 2/(period+1);
  let e = avg(values.slice(0, period));
  for (let i=period;i<values.length;i++) e = values[i]*k + e*(1-k);
  return e;
};
const rsi = (values:number[], period=14) => {
  if (values.length <= period) return 50;
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){ const d=values[i]-values[i-1]; if(d>=0) gains+=d; else losses-=d; }
  let ag=gains/period, al=losses/period;
  for(let i=period+1;i<values.length;i++){ const d=values[i]-values[i-1]; ag=(ag*(period-1)+Math.max(d,0))/period; al=(al*(period-1)+Math.max(-d,0))/period; }
  if(al===0) return 100;
  return 100 - 100/(1+ag/al);
};
const atr = (c:Candle[], period=14) => {
  if(c.length<period+1) return 0;
  const tr:number[]=[];
  for(let i=1;i<c.length;i++) tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close)));
  return avg(tr.slice(-period));
};
const adx = (c:Candle[], period=14) => {
  if(c.length < period*2+1) return 0;
  const trs:number[]=[]; const plus:number[]=[]; const minus:number[]=[];
  for(let i=1;i<c.length;i++){
    const up=c[i].high-c[i-1].high; const down=c[i-1].low-c[i].low;
    plus.push(up>down && up>0?up:0); minus.push(down>up && down>0?down:0);
    trs.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
  }
  const dx:number[]=[];
  for(let i=period;i<trs.length;i++){
    const t=avg(trs.slice(i-period+1,i+1))||1;
    const p=100*avg(plus.slice(i-period+1,i+1))/t;
    const m=100*avg(minus.slice(i-period+1,i+1))/t;
    dx.push(100*Math.abs(p-m)/Math.max(1,p+m));
  }
  return avg(dx.slice(-period));
};
const trend = (c:Candle[]): 'BULLISH'|'BEARISH'|'NEUTRAL' => {
  if(c.length<60) return 'NEUTRAL';
  const closes=c.map(x=>x.close); const e21=ema(closes,21); const e50=ema(closes,50); const p=closes.at(-1)!;
  if(p>e21 && e21>e50) return 'BULLISH';
  if(p<e21 && e21<e50) return 'BEARISH';
  return 'NEUTRAL';
};

export async function analyzeMarket(symbol: string, pair: FuturesSymbolInfo, isTestnet=false): Promise<MarketAnalysis|null> {
  const [h1,m15,m5] = await Promise.all([
    BinanceService.fetchKlines(symbol,'1h',120,isTestnet),
    BinanceService.fetchKlines(symbol,'15m',120,isTestnet),
    BinanceService.fetchKlines(symbol,'5m',120,isTestnet),
  ]);
  if(h1.length<60 || m15.length<60 || m5.length<60) return null;

  const closes=m15.map((x:Candle)=>x.close);
  const current=closes.at(-1)!;
  const r=rsi(closes,14);
  const a=atr(m15,14); const atrPct=current ? a/current*100 : 0;
  const d=adx(m15,14);
  const volAvg=avg(m15.slice(-21,-1).map((x:Candle)=>x.volume));
  const volumeRatio=volAvg?m15.at(-1)!.volume/volAvg:1;
  const t1=trend(h1), t15=trend(m15), t5=trend(m5);

  const bullish = t1==='BULLISH' && t15==='BULLISH' && t5!=='BEARISH';
  const bearish = t1==='BEARISH' && t15==='BEARISH' && t5!=='BULLISH';
  const momentumLong = r>=52 && r<=72;
  const momentumShort = r>=28 && r<=48;
  const trendPoints = (bullish||bearish)?30:0;
  const momentumPoints = (bullish&&momentumLong)||(bearish&&momentumShort)?18:0;
  const volumePoints = Math.min(15, Math.max(0,(volumeRatio-0.8)*15));
  const adxPoints = Math.min(15, Math.max(0,(d-18)*0.7));
  const volatilityPoints = atrPct>=0.25 && atrPct<=3 ? 10 : atrPct<0.1 ? 0 : 5;
  const structurePoints = (bullish&&current>ema(closes,21))||(bearish&&current<ema(closes,21))?12:0;
  const score=Math.min(100,Math.round(trendPoints+momentumPoints+volumePoints+adxPoints+volatilityPoints+structurePoints));

  let side:TradeDirection|null = bullish ? 'LONG' : bearish ? 'SHORT' : null;
  if(score<72) side=null;
  if(side==='LONG' && !momentumLong) side=null;
  if(side==='SHORT' && !momentumShort) side=null;

  const recent=m15.slice(-40);
  const support=Math.min(...recent.map((x:Candle)=>x.low));
  const resistance=Math.max(...recent.map((x:Candle)=>x.high));
  const riskDistance=Math.max(a*1.35, current*0.0035);
  const stopLossPrice=side==='LONG'?current-riskDistance:side==='SHORT'?current+riskDistance:current;
  const r1=Math.max(riskDistance*1.15,current*0.004);
  const r2=Math.max(riskDistance*2,current*0.007);
  const r3=Math.max(riskDistance*3,current*0.011);
  const tp1Price=side==='LONG'?current+r1:side==='SHORT'?current-r1:current;
  const tp2Price=side==='LONG'?current+r2:side==='SHORT'?current-r2:current;
  const tp3Price=side==='LONG'?current+r3:side==='SHORT'?current-r3:current;
  const riskReward=riskDistance?Math.abs(tp2Price-current)/riskDistance:0;
  const confidence=Math.min(96,Math.max(50,score + (d>=25?4:0) + (volumeRatio>=1.3?3:0)));
  const riskScore=atrPct>4?'HIGH':atrPct>2.5?'MEDIUM':'LOW';
  const rationale=`MTF ${t1}/${t15}/${t5}; RSI ${r.toFixed(1)}; ADX ${d.toFixed(1)}; volume ${volumeRatio.toFixed(2)}x; ATR ${atrPct.toFixed(2)}%.`;

  return {symbol,price:current,side,score,confidence,riskScore,rsi14:r,atrPercent:atrPct,adx:d,volumeRatio,trend1h:t1,trend15m:t15,trend5m:t5,support,resistance,stopLossPrice,tp1Price,tp2Price,tp3Price,riskReward,rationale};
}
