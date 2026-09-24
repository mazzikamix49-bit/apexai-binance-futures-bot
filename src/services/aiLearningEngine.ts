import { AILearningState, ClosedTrade, FuturesSymbolInfo } from '../types/trading';

const STORAGE_KEY = 'apex_ai_learning_state';

const DEFAULT_STATE: AILearningState = {
  trainingGeneration: 1,
  trainingIterations: 0,
  accuracyRate: 0,
  observedTrades: 0,
  observedWins: 0,
  observedLosses: 0,
  weights: { volatilityBreakout: 0.22, volumeSurge: 0.18, rsiMomentum: 0.15, trendAlignment: 0.25, orderbookImbalance: 0.10, supportResistanceBounce: 0.10 },
  recentLogs: [],
  evolutionHistory: [],
};

export class AILearningEngine {
  private state: AILearningState;
  constructor(){ this.state=this.loadState(); }
  private loadState():AILearningState{
    try { const s=localStorage.getItem(STORAGE_KEY); if(s) return {...DEFAULT_STATE,...JSON.parse(s)}; } catch(e){ console.error(e); }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  public saveState(){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(this.state));}catch(e){console.error(e);} }
  public getState(){return {...this.state};}
  public resetToDefault(){this.state=JSON.parse(JSON.stringify(DEFAULT_STATE));this.saveState();return this.getState();}

  // No synthetic/random learning. Model statistics are derived only from observed closed trades.
  public runAutonomousBackgroundTraining(_pairs:FuturesSymbolInfo[], _language:'ar'|'en'){
    this.state.trainingIterations += 1;
    if(this.state.trainingIterations % 100 === 0) this.state.trainingGeneration += 1;
    if(this.state.observedTrades > 0){
      this.state.accuracyRate=Number(((this.state.observedWins/this.state.observedTrades)*100).toFixed(2));
      this.state.evolutionHistory.push({iteration:this.state.trainingIterations,winRate:this.state.accuracyRate,lossPenalty:Number((this.state.observedLosses/this.state.observedTrades).toFixed(3))});
      if(this.state.evolutionHistory.length>30)this.state.evolutionHistory.shift();
    }
    this.saveState(); return this.getState();
  }

  public recordTradeFeedback(trade:ClosedTrade, language:'ar'|'en'){
    this.state.trainingIterations += 1;
    this.state.observedTrades += 1;
    if(trade.wasWinning)this.state.observedWins += 1; else this.state.observedLosses += 1;
    this.state.accuracyRate=Number(((this.state.observedWins/this.state.observedTrades)*100).toFixed(2));
    const lr=trade.wasWinning?0.01:-0.01;
    this.state.weights.trendAlignment=Math.min(.45,Math.max(.10,this.state.weights.trendAlignment+lr));
    this.state.weights.volatilityBreakout=Math.min(.35,Math.max(.08,this.state.weights.volatilityBreakout+(trade.exitReason==='STOP_LOSS'?-lr:lr*.25)));
    const isAr=language==='ar';
    this.state.recentLogs.unshift({id:`trade-${Date.now()}`,timestamp:Date.now(),symbol:trade.symbol,action:trade.wasWinning?'OBSERVED_WIN':'OBSERVED_LOSS',outcome:trade.wasWinning?'WIN':'LOSS',detail:isAr?`تم تسجيل نتيجة فعلية للصفقة ${trade.symbol}: ${trade.pnl.toFixed(2)}$؛ الدقة المحسوبة من ${this.state.observedTrades} صفقة فعلية.`:`Observed ${trade.symbol}: ${trade.pnl.toFixed(2)} USD; accuracy is now calculated from ${this.state.observedTrades} real closed trades.`});
    this.state.recentLogs=this.state.recentLogs.slice(0,25); this.saveState(); return this.getState();
  }

  public calculateDynamicPlan(symbolInfo:FuturesSymbolInfo|undefined, side:'LONG'|'SHORT', entryPrice:number, pricePrecision=2, language:'ar'|'en'='ar'){
    const isLong=side==='LONG';
    const atrPct=symbolInfo?.atrPercent && symbolInfo.atrPercent>0 ? symbolInfo.atrPercent : 0.8;
    const slPercent=Math.min(2.5,Math.max(0.45,atrPct*1.35));
    const tp1Percent=slPercent*1.15, tp2Percent=slPercent*2, tp3Percent=slPercent*3;
    const round=(v:number)=>Number(v.toFixed(Math.max(pricePrecision,entryPrice>500?2:entryPrice>1?4:6)));
    const stopLossPrice=round(isLong?entryPrice*(1-slPercent/100):entryPrice*(1+slPercent/100));
    const tp1Price=round(isLong?entryPrice*(1+tp1Percent/100):entryPrice*(1-tp1Percent/100));
    const tp2Price=round(isLong?entryPrice*(1+tp2Percent/100):entryPrice*(1-tp2Percent/100));
    const tp3Price=round(isLong?entryPrice*(1+tp3Percent/100):entryPrice*(1-tp3Percent/100));
    const rationale=language==='ar'?`خطة مبنية على ATR الحقيقي: SL ${slPercent.toFixed(2)}%، TP1 ${tp1Percent.toFixed(2)}%، TP2 ${tp2Percent.toFixed(2)}%، TP3 ${tp3Percent.toFixed(2)}%.`:`ATR-based plan: SL ${slPercent.toFixed(2)}%, TP1 ${tp1Percent.toFixed(2)}%, TP2 ${tp2Percent.toFixed(2)}%, TP3 ${tp3Percent.toFixed(2)}%.`;
    return {slPercent,tp1Percent,tp2Percent,tp3Percent,stopLossPrice,tp1Price,tp2Price,tp3Price,riskRewardRatio:`1:${(tp2Percent/slPercent).toFixed(1)}`,rationale};
  }

  public filterHighProbabilityCandidates(tickers:FuturesSymbolInfo[],openSymbols:Set<string>,minConfidence:number){
    return tickers.filter(t=>t.price>0&&!openSymbols.has(t.symbol)&&t.aiScore>=minConfidence&&t.aiRecommendedSignal!=='HOLD').sort((a,b)=>b.aiScore-a.aiScore);
  }
}
export const aiEngine=new AILearningEngine();
