/* Cooperative proposal worker build 20260920-365 */
let stopped=false,paused=false,initialized=false,workerIndex=0,currentJob=null,detailAckResolve=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pausePoint(){while(paused&&!stopped)await sleep(40)}
function flush(job,type){if(!job.items.length)return;postMessage(type==='stage'?{type:'stageItems',jobId:job.jobId,items:job.items.splice(0),passed:job.passed}:{type:'confirmedItems',jobId:job.jobId,confirmed:job.items.splice(0),passed:job.passed})}
async function run(m){stopped=false;self.coopEnemies=m.enemies;self.coopDecks=m.decks;self.coopVisibleRows=m.visibleRows;self.coopDetailMode=!!m.detailMode;self.coopProposalTargetDecks=m.targetDecks;self.coopProposalEnemySecondFixed=!!m.enemySecondFixed;self.COOP_DAMAGE_BASE=m.constants.damageBase;self.coopProposalDamageScale=Number(m.constants.damageScale??1);self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();let job={jobId:m.jobId,prefixIds:m.prefixIds||[],candidateIds:m.candidateIds||[],items:[],checked:0,passed:0,last:performance.now(),index:0},lastYield=performance.now();currentJob=job;
if(m.type==='stage'){let total=job.prefixIds.length*job.candidateIds.length;while(job.index<total&&!stopped){await pausePoint();if(stopped)break;let stop=Math.min(total,job.index+250);for(;job.index<stop&&!stopped;job.index++){let prefixIndex=Math.floor(job.index/job.candidateIds.length),candidateIndex=job.index%job.candidateIds.length,ids=job.prefixIds[prefixIndex].slice();ids[m.slot]=job.candidateIds[candidateIndex];let deck=ids.map(coopFindCharacter),item=coopProposalPrefixLayerEvaluation(deck,m.slot,m.targetDecks);if(item){job.items.push({ids:coopProposalDeckIds(item.deck)});job.passed++}job.checked++}if(job.items.length>=3000)flush(job,'stage');let now=performance.now();if(job.checked%1000===0||now-job.last>=300){postMessage({type:'progress',jobId:job.jobId,checked:job.checked,passed:job.passed,confirmed:job.passed});job.last=now}if(now-lastYield>=40){await sleep(0);lastYield=performance.now()}}if(!stopped){flush(job,'stage');postMessage({type:'stageDone',jobId:job.jobId,checked:job.checked,passed:job.passed,items:[]})}}
else{let total=job.candidateIds.length;while(job.index<total&&!stopped){await pausePoint();if(stopped)break;let stop=Math.min(total,job.index+100);for(;job.index<stop&&!stopped;job.index++){let ids=job.candidateIds[job.index],deck=ids.map(coopFindCharacter);if(coopProposalWorks(deck,m.targetDecks)){job.items.push({ids:ids.slice(),repeats:m.targetDecks,overkillRate:0});job.passed++}job.checked++}if(job.items.length>=3000)flush(job,'start');let now=performance.now();if(job.checked%1000===0||now-job.last>=300){postMessage({type:'progress',jobId:job.jobId,checked:job.checked,passed:job.passed,confirmed:job.passed});job.last=now}if(now-lastYield>=40){await sleep(0);lastYield=performance.now()}}if(!stopped){flush(job,'start');postMessage({type:'done',jobId:job.jobId,checked:job.checked,passed:job.passed,confirmed:[]})}}currentJob=null}

async function runDetailStage(m){
 stopped=false;paused=!!m.paused;currentJob={jobId:m.jobId};
 self.coopEnemies=m.enemies;self.coopDecks=m.decks;self.coopVisibleRows=m.visibleRows;
 self.coopDetailMode=!!m.detailMode;self.coopProposalTargetDecks=m.targetDecks;
 self.coopProposalEnemySecondFixed=!!m.enemySecondFixed;self.COOP_DAMAGE_BASE=m.constants.damageBase;
 self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();
 let checked=0,passed=0,items=[],lastYield=performance.now(),lastProgress=lastYield;
 async function send(){if(!items.length)return;const batch=items;items=[];await new Promise(resolve=>{detailAckResolve=resolve;postMessage({type:'detailItems',jobId:m.jobId,items:batch,checked,passed})});detailAckResolve=null}
 try{
  for(let index=m.start;index<m.end&&!stopped;index++){
   if(index%64===0){await pausePoint();if(stopped)break}
   const ids=m.prefixIds[Math.floor(index/m.candidateIds.length)].slice();ids[m.slot]=m.candidateIds[index%m.candidateIds.length];
   const deck=ids.map(coopFindCharacter),item=coopProposalPrefixLayerEvaluation(deck,m.slot,m.targetDecks);
   // Earlier layers passed under this exact prefix; future slots cannot act on earlier layers.
   if(item&&(m.slot!==4||!coopProposalHasDuplicateInCompletedDeck(deck,m.targetDecks))){passed++;if(!m.countOnly)items.push({ids})}
   checked++;if(items.length>=128)await send();
   const now=performance.now();if(now-lastProgress>=150){postMessage({type:'detailProgress',jobId:m.jobId,checked,passed});lastProgress=now}
   if(now-lastYield>=24){await sleep(0);lastYield=performance.now()}
  }
  if(!stopped){await send();currentJob=null;postMessage({type:'detailDone',jobId:m.jobId,checked,passed})}
 }finally{currentJob=null;detailAckResolve=null}
}

async function coopDetailDepthFirstCount(pools,totalDecks,checkpoint){
 const deck=Array(5).fill(null),indices=Array(5).fill(0),checked=Array(5).fill(0),passed=Array(5).fill(0);
 let slot=0,operations=0;
 while(slot>=0){
  if(indices[slot]>=pools[slot].length){indices[slot]=0;deck[slot]=null;slot--;continue}
  const character=pools[slot][indices[slot]++];deck[slot]=character;
  for(let later=slot+1;later<5;later++)deck[later]=null;
  checked[slot]++;operations++;
  const item=coopProposalPrefixLayerEvaluation(deck,slot,totalDecks);
  if(item&&(slot!==4||!coopProposalHasDuplicateInCompletedDeck(deck,totalDecks))){
   passed[slot]++;if(!Number.isSafeInteger(passed[slot]))throw new Error('確定撃破件数が安全な整数範囲を超えました');
   if(slot<4){slot++;indices[slot]=0}
  }
  if(operations%128===0){
   // These maps only cache deterministic results. Clearing does not drop candidates.
   if(coopProposalOrderCache.size>4096)coopProposalOrderCache.clear();
   if(coopProposalManualCertainCache.size>4096)coopProposalManualCertainCache.clear();
   await checkpoint({checked:checked.slice(),passed:passed.slice(),operations});
  }
 }
 await checkpoint({checked:checked.slice(),passed:passed.slice(),operations},true);
 return {count:passed[4],stages:checked.map((total,i)=>({slot:i+1,total,checked:total,passed:passed[i],workers:1}))};
}

let detailCountContext=null;
async function runDetailCount(m){
 if(!detailCountContext||detailCountContext.contextId!==m.contextId)throw new Error('個別評価の共通データが未準備です');
 stopped=false;paused=!!m.paused;currentJob={jobId:m.jobId};
 self.coopEnemies=detailCountContext.enemies;self.coopDecks=m.decks.map(row=>row.map(coopFindCharacter));
 self.coopVisibleRows=m.targetDecks;self.coopDetailMode=true;self.coopProposalTargetDecks=m.targetDecks;
 self.coopProposalEnemySecondFixed=!!detailCountContext.enemySecondFixed;self.COOP_DAMAGE_BASE=detailCountContext.damageBase;
 self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();
 const pools=detailCountContext.pools.map((pool,slot)=>m.fixedSlots[slot]?[null]:pool);
 let lastYield=performance.now(),lastProgress=lastYield;
 try{
  const result=await coopDetailDepthFirstCount(pools,m.targetDecks,async(stats,final=false)=>{
   const now=performance.now();
   if(final||now-lastProgress>=250){postMessage({type:'detailCountProgress',jobId:m.jobId,...stats});lastProgress=now}
   if(final||paused||now-lastYield>=24){await sleep(0);await pausePoint();lastYield=performance.now()}
   if(stopped)throw new Error('計算を停止しました');
  });
  if(!stopped){currentJob=null;postMessage({type:'detailCountDone',jobId:m.jobId,...result})}
 }finally{currentJob=null;self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear()}
}

self.onmessage=e=>{let m=e.data||{};if(m.type==='detailAck'){if(currentJob?.jobId===m.jobId&&detailAckResolve)detailAckResolve();return}if(m.type==='pause'){paused=true;return}if(m.type==='resume'){paused=false;return}if(m.type==='cancel'){stopped=true;paused=false;if(detailAckResolve)detailAckResolve();return}try{if(m.type==='init'){self.chars=m.chars||[];workerIndex=m.workerIndex||0;self.ATTRS=m.constants.ATTRS;self.MATCH=m.constants.MATCH;self.COOP_LAYER_MULTIPLIERS=m.constants.layerMultipliers;self.COOP_DAMAGE_BASE=m.constants.damageBase;self.coopProposalDamageScale=Number(m.constants.damageScale??1);self.COOP_SLOTS=5;self.COOP_MAX_ROWS=5;self.coopProposalExpiredMemo=new Map();self.coopProposalOrderCache=new Map();self.coopProposalManualCertainCache=new Map();(0,eval)(m.engineSource);self.characterById=new Map(self.chars.map(c=>[coopCharacterKey(c),c]));self.coopFindCharacter=key=>self.characterById.get(String(key))||null;initialized=true;postMessage({type:'initialized',workerIndex});return}if(m.type==='compactNode'){self.coopDecks=m.decks.map(row=>row.map(coopFindCharacter));self.coopVisibleRows=m.targetDecks;self.coopDetailMode=m.detailMode;self.coopEnemies=m.enemies;self.coopProposalEnemySecondFixed=m.enemySecondFixed;self.COOP_DAMAGE_BASE=m.damageBase;self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();const passed=!!coopProposalPrefixLayerEvaluationRaw(m.ids.map(coopFindCharacter),m.slot,m.targetDecks);postMessage({type:'compactNodeDone',jobId:m.jobId,passed});return;}if(m.type==='detailLayerNode'){self.coopDecks=m.decks.map(row=>row.map(coopFindCharacter));self.coopVisibleRows=m.targetDecks;self.coopDetailMode=true;self.coopEnemies=m.enemies;self.coopProposalEnemySecondFixed=m.enemySecondFixed;self.COOP_DAMAGE_BASE=m.damageBase;self.coopProposalOrderCache.clear();self.coopProposalManualCertainCache.clear();const passed=!!coopProposalPrefixLayerEvaluationRaw(m.ids.map(coopFindCharacter),m.slot,m.targetDecks);postMessage({type:'detailCountDone',jobId:m.jobId,passed});return;}if(m.type==='detailCountContext'){self.coopProposalExpiredMemo.clear();detailCountContext={...m,pools:m.poolIds.map(ids=>[...new Set(ids)].map(coopFindCharacter))};return}if(m.type==='detailCount'){if(!initialized||currentJob)return;runDetailCount(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error?.stack||error)}));return}if(m.type==='detailStage'){if(!initialized||currentJob)return;runDetailStage(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error?.stack||error)}));return}if(!initialized||!['start','stage'].includes(m.type)||currentJob)return;run(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)}))}catch(error){postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)})}};
