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

self.onmessage=e=>{let m=e.data||{};if(m.type==='detailAck'){if(currentJob?.jobId===m.jobId&&detailAckResolve)detailAckResolve();return}if(m.type==='pause'){paused=true;return}if(m.type==='resume'){paused=false;return}if(m.type==='cancel'){stopped=true;paused=false;if(detailAckResolve)detailAckResolve();return}try{if(m.type==='init'){self.chars=m.chars||[];workerIndex=m.workerIndex||0;self.ATTRS=m.constants.ATTRS;self.MATCH=m.constants.MATCH;self.COOP_LAYER_MULTIPLIERS=m.constants.layerMultipliers;self.COOP_DAMAGE_BASE=m.constants.damageBase;self.coopProposalDamageScale=Number(m.constants.damageScale??1);self.COOP_SLOTS=5;self.COOP_MAX_ROWS=5;self.coopProposalOrderCache=new Map();self.coopProposalManualCertainCache=new Map();(0,eval)(m.engineSource);self.characterById=new Map(self.chars.map(c=>[coopCharacterKey(c),c]));self.coopFindCharacter=key=>self.characterById.get(String(key))||null;initialized=true;postMessage({type:'initialized',workerIndex});return}if(m.type==='detailStage'){if(!initialized||currentJob)return;runDetailStage(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error?.stack||error)}));return}if(!initialized||!['start','stage'].includes(m.type)||currentJob)return;run(m).catch(error=>postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)}))}catch(error){postMessage({type:'error',jobId:m.jobId,message:String(error&&error.stack||error)})}};
