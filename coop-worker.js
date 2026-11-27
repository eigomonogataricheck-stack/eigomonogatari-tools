/* Cooperative proposal worker build 20261127-wasm2 (WASM優先 + JSフォールバック) */
let stopped=false,paused=false,initialized=false,workerIndex=0,currentJob=null;
let useWasm=false,wasmCoop=null,keyToIdx=new Map(),savedEngineSource=null,savedConstants=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pausePoint(){while(paused&&!stopped)await sleep(40)}
function flush(job,type){if(!job.items.length)return;postMessage(type==='stage'?{type:'stageItems',jobId:job.jobId,items:job.items.splice(0),passed:job.passed}:{type:'confirmedItems',jobId:job.jobId,confirmed:job.items.splice(0),passed:job.passed})}
function rejectedCompletedDeck(deck,targetDecks){return coopProposalHasDuplicateInCompletedDeck(deck,targetDecks)}
function charKey(c){return String(c?.id??c?.details?.id??c?.name??'')}
function packState(m){
  const constants=m.constants||{};
  return JSON.stringify({
    enemies:(m.enemies||[]).slice(0,15).map(e=>({key:charKey(e?.character),hp:Math.max(0,Number(e?.hp)||0),attribute:String(e?.attribute||'火')})),
    decks:(m.decks||[]).slice(0,5).map(row=>Array.from({length:5},(_,s)=>{const c=row?.[s];return c?charKey(c):null})),
    deckPowers:(m.deckPowers||[]).slice(0,5).map(row=>Array.from({length:5},(_,s)=>Math.max(0,Number(row?.[s])||0))),
    visibleRows:Math.max(1,Math.min(5,Number(m.visibleRows)||1)),
    detailMode:!!m.detailMode,
    targetDecks:Math.max(1,Math.min(5,Number(m.targetDecks)||4)),
    enemySecondFixed:!!m.enemySecondFixed,
    damageBase:Number(constants.damageBase??0.81),
    detailCalcActive:false
  });
}
function ensureJsEngine(){
  if(typeof self.coopProposalPrefixLayerEvaluation==='function')return;
  if(!savedEngineSource||!savedConstants)throw new Error('JS engine source unavailable');
  self.ATTRS=savedConstants.ATTRS;self.MATCH=savedConstants.MATCH;self.COOP_LAYER_MULTIPLIERS=savedConstants.layerMultipliers;self.COOP_DAMAGE_BASE=savedConstants.damageBase;self.coopProposalDamageScale=Number(savedConstants.damageScale??1);self.COOP_SLOTS=5;self.COOP_MAX_ROWS=5;self.coopProposalOrderCache=new Map();self.coopProposalManualCertainCache=new Map();self.coopValidSkillEffectsCache=new Map();(0,eval)(savedEngineSource);self.characterById=new Map(self.chars.map(c=>[coopCharacterKey(c),c]));self.coopFindCharacter=key=>self.characterById.get(String(key))||null;
}
async function run(m){
  stopped=false;
  let job={jobId:m.jobId,prefixIds:m.prefixIds||[],candidateIds:m.candidateIds||[],items:[],checked:0,passed:0,last:performance.now(),index:0},lastYield=performance.now();
  currentJob=job;
  if(m.type==='expand'){
    let checked=0,generated=0,items=[],last=performance.now();
    const flushExpand=()=>{if(items.length)postMessage({type:'expandItems',jobId:m.jobId,items:items.splice(0),checked,generated})};
    for(const task of m.tasks||[]){
      const n2=task.choices?.[2]?.length||0,n1=task.choices?.[1]?.length||0;
      for(let index=Number(task.start)||0,end=Number(task.end)||0;index<end&&!stopped;index++){
        await pausePoint();if(stopped)break;let rest=index,i2=rest%n2;rest=Math.floor(rest/n2);let i1=rest%n1,i0=Math.floor(rest/n1),ids=task.baseIds.slice();ids[0]=task.choices[0][i0];ids[1]=task.choices[1][i1];ids[2]=task.choices[2][i2];items.push({sourceIndex:task.sourceIndex,ids});checked++;generated++;if(items.length>=1000)flushExpand();let now=performance.now();if(checked%1000===0||now-last>=300){postMessage({type:'expandProgress',jobId:m.jobId,checked,generated});last=now}
      }
      if(stopped)break;
    }
    if(!stopped){flushExpand();postMessage({type:'expandDone',jobId:m.jobId,checked,generated})}
  }else if(m.type==='stage'&&useWasm&&wasmCoop){
    wasmCoop.set_state(packState(m));
    const pairs=m.pairs||[],total=pairs.length,slot=m.slot,targetDecks=m.targetDecks,BATCH=512;
    const prefixBuf=new Int32Array(BATCH*5),candBuf=new Int32Array(BATCH);
    while(job.index<total&&!stopped){
      await pausePoint();if(stopped)break;
      const stop=Math.min(total,job.index+BATCH),count=stop-job.index;
      for(let k=0;k<count;k++){
        const pair=pairs[job.index+k],pids=pair.prefixIds||[],base=k*5;
        for(let s=0;s<5;s++){const id=pids[s]?String(pids[s]):'';prefixBuf[base+s]=id&&keyToIdx.has(id)?keyToIdx.get(id):-1}
        const cid=pair.candidateId?String(pair.candidateId):'';
        candBuf[k]=cid&&keyToIdx.has(cid)?keyToIdx.get(cid):-1;
      }
      const passedRel=wasmCoop.eval_stage_batch_idx(prefixBuf.subarray(0,count*5),candBuf.subarray(0,count),slot,targetDecks);
      for(let p=0;p<passedRel.length;p++){
        const pair=pairs[job.index+passedRel[p]];
        if(!m.countOnly){const ids=(pair.prefixIds||[]).slice();while(ids.length<5)ids.push('');ids[slot]=pair.candidateId?String(pair.candidateId):'';job.items.push({ids})}
        job.passed++;
      }
      job.index=stop;job.checked=stop;
      if(!m.countOnly&&job.items.length>=3000)flush(job,'stage');
      let now=performance.now();
      if(job.checked===total||job.checked%1000<BATCH||now-job.last>=300){postMessage({type:'progress',jobId:m.jobId,checked:job.checked,passed:job.passed,confirmed:job.passed});job.last=now}
      if(now-lastYield>=40){await sleep(0);lastYield=performance.now()}
    }
    if(!stopped){if(!m.countOnly)flush(job,'stage');postMessage({type:'stageDone',jobId:m.jobId,checked:job.checked,passed:job.passed,items:[]})}
  }else{
    ensureJsEngine();
    self.coopEnemies=m.enemies;self.coopDecks=m.decks;self.coopDeckPowers=(m.deckPowers||[]).map(row=>(row||[]).map(value=>Math.max(0,Number(value)||0)));self.coopVisibleRows=m.visibleRows;self.coopDetailMode=!!m.detailMode;self.coopProposalTargetDecks=m.targetDecks;self.coopProposalEnemySecondFixed=!!m.enemySecondFixed;const constants=m.constants||{};self.COOP_DAMAGE_BASE=Number(constants.damageBase??self.COOP_DAMAGE_BASE);self.coopProposalDamageScale=Number(constants.damageScale??self.coopProposalDamageScale??1);self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();
    if(m.type==='stage')job.pairs=(m.pairs||[]).map(pair=>({prefixIds:pair.prefixIds||[],candidateId:pair.candidateId,prefixDeck:(pair.prefixIds||[]).map(coopFindCharacter),candidate:coopFindCharacter(pair.candidateId)}));
    if(m.type==='detailPrefix'){
      const idsList=m.prefixIds||[],decks=idsList.map(ids=>ids.map(coopFindCharacter)),total=decks.length,passedKeys=[];
      while(job.index<total&&!stopped){
        await pausePoint();if(stopped)break;const stop=Math.min(total,job.index+128);
        for(;job.index<stop&&!stopped;job.index++){const ids=idsList[job.index],item=coopProposalPrefixLayerEvaluation(decks[job.index],m.slot,m.targetDecks);if(item){passedKeys.push(ids.slice(0,m.slot+1).map(String).join('\u0001'));job.passed++}job.checked++}
        const now=performance.now();if(job.checked===total||now-job.last>=250){postMessage({type:'detailPrefixProgress',jobId:m.jobId,checked:job.checked,passed:job.passed});job.last=now}
        if(now-lastYield>=50){await sleep(0);lastYield=performance.now()}
      }
      if(!stopped)postMessage({type:'detailPrefixDone',jobId:m.jobId,checked:job.checked,passed:job.passed,passedKeys});
    }else if(m.type==='detailCount'){
      const idsList=m.deckIds||[],decks=idsList.map(ids=>ids.map(coopFindCharacter)),total=decks.length;
      while(job.index<total&&!stopped){
        await pausePoint();if(stopped)break;const stop=Math.min(total,job.index+64);
        for(;job.index<stop&&!stopped;job.index++){if(coopProposalWorks(decks[job.index],m.targetDecks))job.passed++;job.checked++}
        const now=performance.now();if(job.checked===total||now-job.last>=250){postMessage({type:'detailCountProgress',jobId:m.jobId,checked:job.checked,passed:job.passed});job.last=now}
        if(now-lastYield>=50){await sleep(0);lastYield=performance.now()}
      }
      if(!stopped)postMessage({type:'detailCountDone',jobId:m.jobId,checked:job.checked,passed:job.passed});
    }else if(m.type==='stage'){
      let total=job.pairs.length;
      while(job.index<total&&!stopped){
        await pausePoint();if(stopped)break;let stop=Math.min(total,job.index+250);
        for(;job.index<stop&&!stopped;job.index++){let pair=job.pairs[job.index],ids=pair.prefixIds.slice(),deck=pair.prefixDeck.slice();ids[m.slot]=pair.candidateId;deck[m.slot]=pair.candidate;let item=coopProposalPrefixLayerEvaluation(deck,m.slot,m.targetDecks);if(item){if(!m.countOnly)job.items.push({ids:coopProposalDeckIds(item.deck)});job.passed++}job.checked++}
        if(!m.countOnly&&job.items.length>=3000)flush(job,'stage');
        let now=performance.now();if(job.checked%1000===0||now-job.last>=300){postMessage({type:'progress',jobId:m.jobId,checked:job.checked,passed:job.passed,confirmed:job.passed});job.last=now}
        if(now-lastYield>=40){await sleep(0);lastYield=performance.now()}
      }
      if(!stopped){if(!m.countOnly)flush(job,'stage');postMessage({type:'stageDone',jobId:m.jobId,checked:job.checked,passed:job.passed,items:[]})}
    }else{
      let total=job.candidateIds.length;
      while(job.index<total&&!stopped){
        await pausePoint();if(stopped)break;let stop=Math.min(total,job.index+100);
        for(;job.index<stop&&!stopped;job.index++){let ids=job.candidateIds[job.index],deck=ids.map(coopFindCharacter);if(coopProposalWorks(deck,m.targetDecks)){job.items.push({ids:ids.slice(),repeats:m.targetDecks,overkillRate:0});job.passed++}job.checked++}
        if(job.items.length>=3000)flush(job,'start');
        let now=performance.now();if(job.checked%1000===0||now-job.last>=300){postMessage({type:'progress',jobId:m.jobId,checked:job.checked,passed:job.passed,confirmed:job.passed});job.last=now}
        if(now-lastYield>=40){await sleep(0);lastYield=performance.now()}
      }
      if(!stopped){flush(job,'start');postMessage({type:'done',jobId:m.jobId,checked:job.checked,passed:job.passed,confirmed:[]})}
    }
  }
  currentJob=null;
}
self.onmessage=async e=>{
  let m=e.data||{};
  if(m.type==='pause'){paused=true;return}
  if(m.type==='resume'){paused=false;return}
  if(m.type==='cancel'){stopped=true;paused=false;return}
  try{
    if(m.type==='init'){
      self.chars=m.chars||[];workerIndex=m.workerIndex||0;savedEngineSource=m.engineSource||null;savedConstants=m.constants||null;
      useWasm=false;
      try{
        if(typeof WebAssembly!=='object')throw new Error('WebAssembly未対応');
        if(typeof wasm_bindgen!=='function')importScripts('wasm/rcoop_wasm.js?v=20261127-wasm2');
        const res=await fetch('wasm/rcoop_wasm_bg.wasm?v=20261127-wasm2');
        if(!res.ok)throw new Error('WASM取得失敗 HTTP '+res.status);
        await wasm_bindgen(res);
        if(wasmCoop){try{wasmCoop.free()}catch(_){}}
        wasmCoop=new wasm_bindgen.CoopWasm(JSON.stringify(self.chars));
        const keys=JSON.parse(wasmCoop.char_keys_json());
        keyToIdx=new Map();for(let i=0;i<keys.length;i++)keyToIdx.set(keys[i],i);
        useWasm=true;
      }catch(wasmErr){
        useWasm=false;
        console.warn('coop-worker WASM読込失敗、JS版へフォールバックします:',wasmErr);
        ensureJsEngine();
      }
      initialized=true;
      postMessage({type:'initialized',workerIndex,wasm:useWasm});
      return;
    }
    if(!initialized||!['start','stage','expand','detailCount','detailPrefix'].includes(m.type)||currentJob)return;
    run(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)}));
  }catch(error){
    postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)});
  }
};