import React, { useEffect, useState } from 'react';
import { Clock3, PauseCircle, PlayCircle } from 'lucide-react';
import { useTrading } from '../context/TradingContext';

const format=(ms:number)=>{const sec=Math.floor(ms/1000);const d=Math.floor(sec/86400);const h=Math.floor((sec%86400)/3600);const m=Math.floor((sec%3600)/60);const s=sec%60;return d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m ${s}s`;};
export const BotRuntimeCard:React.FC=()=>{
  const {botRunning,botRuntimeMs,botSessionStartedAt,language}=useTrading();
  const [worker,setWorker]=useState<{running?:boolean;enabled?:boolean;uptimeMs?:number;paper?:boolean}|null>(null);
  useEffect(()=>{let alive=true;const load=async()=>{try{const r=await fetch('/api/worker/status');const d=await r.json();if(alive)setWorker(d);}catch{}};load();const id=setInterval(load,5000);return()=>{alive=false;clearInterval(id)};},[]);
  const browserMs=botRuntimeMs+(botRunning&&botSessionStartedAt?Date.now()-botSessionStartedAt:0);
  const isWorker=worker?.enabled&&worker.running;
  const current=isWorker?(worker?.uptimeMs||0):browserMs;
  const running=isWorker||botRunning;
  return <div className="bg-[#121824] border border-slate-800/80 rounded-xl p-3 shadow-md">
    <div className="flex items-center justify-between text-slate-400 text-xs mb-1"><span>{language==='ar'?'مدة تشغيل البوت':'Bot Runtime'}</span><Clock3 className="w-3.5 h-3.5 text-cyan-400"/></div>
    <div className="text-lg font-bold font-mono text-white">{format(current)}</div>
    <div className={`text-[10px] mt-1 flex items-center gap-1 ${running?'text-emerald-400':'text-slate-500'}`}>{running?<PlayCircle className="w-3 h-3"/>:<PauseCircle className="w-3 h-3"/>}{running?(isWorker?(language==='ar'?'Worker على السيرفر يعمل':'Server worker running'):(language==='ar'?'واجهة البوت تعمل':'Dashboard bot running')):(language==='ar'?'متوقف':'Paused')}</div>
    {isWorker&&<div className="text-[9px] text-slate-500 mt-1">{worker?.paper?'PAPER WORKER':'REAL WORKER'}</div>}
  </div>;
};
