/* Detailed cooperative proposal calculation, build 20261009-detail-9.
 * Intermediate prefixes are streamed to IndexedDB, never truncated.
 * Normal proposal rules and the existing usage aggregator are reused.
 */
let coopDetailInitialTurnExpansion=false;
let coopDetailCalculationActive=false,coopDetailUsageSummary=null,coopDetailView=null;
let coopDetailDatabase=null,coopDetailViewToken=0;
const coopDetailRuns=new Set();
const COOP_DETAIL_BATCH=128,COOP_DETAIL_PAGE=10;
function coopDetailClearView(){
  coopDetailUsageSummary=null;coopDetailView=null;coopDetailViewToken++;coopProposalDisplayLimit=10;
  document.getElementById('coopDetailPager')?.remove();
  document.getElementById('coopDetailResultToggle')?.remove();
  const all=$('coopProposalShowAll');if(all){all.hidden=false;all.onclick=()=>{coopProposalShowAllDecks=!coopProposalShowAllDecks;renderCoopProposalDecks(coopProposalAll)}}
  const select=$('coopProposalDisplayLimit');if(select)select.onchange=e=>{coopProposalDisplayLimit=Number(e.target.value)||10;renderCoopProposalDecks(coopProposalAll)};
  const controls=document.querySelector('#coopProposalBody .coop-proposal-controls');if(controls)controls.hidden=false;
}
function coopDetailOpenDatabase(){
  if(coopDetailDatabase)return Promise.resolve(coopDetailDatabase);
  if(typeof indexedDB==='undefined')return Promise.reject(new Error('詳細計算にはIndexedDBが必要です。保存機能が利用できないため計算を開始できません。'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('eigoCoopDetailedCalculationV1',1);
    request.onupgradeneeded=()=>{let store=request.result.createObjectStore('records',{keyPath:'key'});store.createIndex('ranking',['phase','order','deckKey'])};
    request.onerror=()=>reject(new Error('詳細計算の保存領域を開けません: '+(request.error?.message||'')));
    request.onblocked=()=>reject(new Error('別のタブが詳細計算の保存領域を使用しています。'));
    request.onsuccess=()=>{coopDetailDatabase=request.result;coopDetailDatabase.onversionchange=()=>{coopDetailDatabase.close();coopDetailDatabase=null};resolve(coopDetailDatabase)};
  });
}
function coopDetailRange(phase,after=null){
  const prefix=phase+'\u0001';
  return IDBKeyRange.bound(after||prefix,prefix+'\uffff',!!after,false);
}
function coopDetailTransaction(db,action){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite');
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(new Error('詳細計算の保存に失敗しました。容量不足・保存権限を確認してください。計算は未完了です: '+(tx.error?.message||'')));
    tx.onerror=()=>{};
    try{action(tx.objectStore('records'))}catch(error){tx.abort();reject(error)}
  });
}
async function coopDetailPut(db,phase,items){
  if(!items.length)return;
  await coopDetailTransaction(db,store=>{for(let item of items){const ids=item.ids.map(String),deckKey=coopProposalDeckKey(ids);store.put({key:phase+'\u0001'+deckKey,phase,deckKey,ids,order:Number.isFinite(item.initialOrder)?item.initialOrder:-Number(item.detailCertainCount||0),detailCertainCount:item.detailCertainCount,placement:item.placement,unplaceable:!!item.unplaceable,stages:item.stages})}});
}
function coopDetailRead(db,phase,after=null,limit=COOP_DETAIL_BATCH){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readonly'),out=[];
    const request=tx.objectStore('records').openCursor(coopDetailRange(phase,after));
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const cursor=request.result;if(!cursor||out.length>=limit){resolve(out);return}out.push(cursor.value);if(out.length>=limit)resolve(out);else cursor.continue()};
  });
}
function coopDetailCount(db,phase){
  return new Promise((resolve,reject)=>{const request=db.transaction('records','readonly').objectStore('records').count(coopDetailRange(phase));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
}
async function coopDetailDelete(db,phase){await coopDetailTransaction(db,store=>store.delete(coopDetailRange(phase)))}
async function coopDetailWalk(db,phase,visit){
  let after=null;
  while(true){await coopWaitIfProposalPaused();const rows=await coopDetailRead(db,phase,after);if(!rows.length)break;for(let row of rows){await coopWaitIfProposalPaused();await visit(row)}after=rows[rows.length-1].key;await coopYield()}
}
function coopDetailMergeUsage(summary,items){
  // Reuse the same aggregator as the existing usage display, one bounded batch at a time.
  const data=coopProposalUsageData(items);
  summary.finalItems.length+=data.finalItems.length;
  for(let slot=0;slot<COOP_SLOTS;slot++)for(let [id,entry] of data.counts[slot]){
    const existing=summary.counts[slot].get(id);
    if(existing)existing.count+=entry.count;else summary.counts[slot].set(id,{character:entry.character,count:entry.count});
  }
}
function coopDetailTopIds(summary){
  return summary.counts.map(map=>new Set([...map.entries()].sort((a,b)=>b[1].count-a[1].count||coopCharacterCost(b[1].character)-coopCharacterCost(a[1].character)||Number(a[0])-Number(b[0])).slice(0,10).map(([id])=>String(id))));
}
function coopDetailIsTopDeck(ids,topIds,needs){return ids.length===COOP_SLOTS&&ids.every((id,slot)=>!needs[slot]||topIds[slot].has(String(id)))}
function coopDetailCanPlace(rows,row,slot,character){
  if(!character)return false;
  const id=coopCharacterKey(character),current=rows[row][slot];
  if(current)return coopCharacterKey(current)===id;
  if(rows[row].some(c=>coopCharacterKey(c)===id))return false;
  if(coopProposalIsLegendary(character)&&rows[row].some(coopProposalIsLegendary))return false;
  return true;
}
function coopDetailPlace(base,ids){
  const candidate=ids.map(coopFindCharacter);
  let best=null;
  // Compare every primary row; ties use the first row. A remainder row receives at most one character.
  for(let primary=0;primary<base.length;primary++){
    const rows=base.map(row=>row.slice()),placed=new Set(),placements=[];
    for(let slot=0;slot<COOP_SLOTS;slot++)if(candidate[slot]&&coopDetailCanPlace(rows,primary,slot,candidate[slot])){
      rows[primary][slot]=candidate[slot];placed.add(slot);placements.push({row:primary,slot,id:ids[slot]});
    }
    const primaryCount=placed.size,left=Array.from({length:COOP_SLOTS},(_,i)=>i).filter(slot=>candidate[slot]&&!placed.has(slot));
    // Backtracking is bounded by five slots/rows and avoids greedy placement failures.
    function distribute(index,usedRows){
      if(index===left.length)return true;
      const slot=left[index];
      for(let row=0;row<rows.length;row++){
        if(row===primary||usedRows.has(row)||!coopDetailCanPlace(rows,row,slot,candidate[slot]))continue;
        const previous=rows[row][slot];rows[row][slot]=candidate[slot];usedRows.add(row);placements.push({row,slot,id:ids[slot]});
        if(distribute(index+1,usedRows))return true;
        placements.pop();usedRows.delete(row);rows[row][slot]=previous;
      }
      return false;
    }
    if(distribute(0,new Set())&&(!best||primaryCount>best.primaryCount))best={rows,primary,primaryCount,placements};
  }
  return best;
}
const COOP_DETAIL_WORKER_MAX=16;
function coopDetailWorkerCount(total){return Math.max(1,Math.min(COOP_DETAIL_WORKER_MAX,Number(navigator.hardwareConcurrency)||2,total))}
function coopDetailWorkerJob(worker,message,onProgress,save){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>{worker.removeEventListener('message',receive);worker.removeEventListener('error',failure);worker._coopReject=null};
  const fail=error=>{if(settled)return;settled=true;cleanup();reject(error)};
  const failure=e=>fail(new Error(e.message||'Worker error'));
  const receive=e=>{
   const m=e.data||{};if(m.jobId!==message.jobId||settled)return;
   if(m.type==='detailItems')save(m.items).then(()=>{if(!settled){onProgress(m);worker.postMessage({type:'detailAck',jobId:m.jobId})}},fail);
   else if(m.type==='detailProgress')onProgress(m);
   else if(m.type==='detailDone'){settled=true;onProgress(m);cleanup();resolve(m)}
   else if(m.type==='error')fail(new Error(m.message));
  };
  worker._coopReject=fail;worker.addEventListener('message',receive);worker.addEventListener('error',failure);worker.postMessage(message);
 });
}
async function coopDetailSearch(db,run,pools,totalDecks,{countOnly=false,label='\u8a73\u7d30\u8a08\u7b97'}={}){
 let previous=run+':seed',previousCount=1;const phases=[previous],stageHistory=[];
 const configuredWorkers=typeof Worker==='undefined'?0:coopDetailWorkerCount(Number.MAX_SAFE_INTEGER);
 if(configuredWorkers)await coopEnsureProposalWorkerPool(configuredWorkers);
 await coopDetailPut(db,previous,[{ids:Array(COOP_SLOTS).fill('')}]);
 try{
  for(let slot=0;slot<COOP_SLOTS;slot++){
   const phase=run+':slot'+slot,pool=[...new Map((pools[slot]||[]).map(c=>[coopCharacterKey(c),c])).values()],total=previousCount*pool.length;
   phases.push(phase);let checked=0,passed=0,after=null,peakWorkers=0;
   if(!Number.isSafeInteger(total))throw new Error('\u7d44\u307f\u5408\u308f\u305b\u6570\u304c\u5b89\u5168\u306a\u6574\u6570\u7bc4\u56f2\u3092\u8d85\u3048\u3066\u3044\u307e\u3059');
   if(!await coopProposalConfirmMillion(total,slot))throw new Error('\u8a08\u7b97\u3092\u505c\u6b62\u3057\u307e\u3057\u305f');
   coopProposalProgressCoverage=pools.map(p=>p.filter(Boolean).length);
   const candidateIds=pool.map(coopCharacterKey),stageTimes=[];
   const paint=()=>coopSetProposalProgress(`${label} / ${slot+1}\u67a0\u76ee / \u69cb\u6210\u5c55\u958b ${checked.toLocaleString()} / ${total.toLocaleString()}\u7d44 / 準備済みWorker ${configuredWorkers}`,true,checked,total,passed,configuredWorkers);
   paint();
   while(total){
    await coopWaitIfProposalPaused();const rows=await coopDetailRead(db,previous,after);if(!rows.length)break;after=rows[rows.length-1].key;
    const prefixIds=rows.map(row=>row.ids),blockTotal=prefixIds.length*pool.length;
    if(typeof Worker==='undefined'){
     let pending=[],lastYield=performance.now();
     for(let index=0;index<blockTotal;index++){
      await coopWaitIfProposalPaused();const ids=prefixIds[Math.floor(index/pool.length)].slice();ids[slot]=candidateIds[index%pool.length];
      const deck=ids.map(coopFindCharacter),item=coopProposalPrefixLayerEvaluation(deck,slot,totalDecks);checked++;
      if(item&&(slot!==4||!coopProposalHasDuplicateInCompletedDeck(deck,totalDecks))){passed++;if(!(countOnly&&slot===4))pending.push({ids})}
      if(pending.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,phase,pending);pending=[]}
      if(performance.now()-lastYield>=24){paint();await coopYield();lastYield=performance.now()}
     }
     if(pending.length)await coopDetailPut(db,phase,pending);
    }else{
     const count=coopDetailWorkerCount(blockTotal),workers=await coopEnsureProposalWorkerPool(coopDetailWorkerCount(Number.MAX_SAFE_INTEGER));await coopWaitIfProposalPaused();
     const checkedBefore=checked,passedBefore=passed,checkedBy=Array(count).fill(0),passedBy=Array(count).fill(0);
     peakWorkers=Math.max(peakWorkers,count);const enemies=coopWorkerEnemies(),decks=coopWorkerDecks();let busy=count;
     const jobs=Array.from({length:count},(_,i)=>{
      const worker=workers[i],jobId=++coopProposalWorkerJobSequence,start=Math.floor(blockTotal*i/count),end=Math.floor(blockTotal*(i+1)/count),started=performance.now();
      const progress=m=>{checkedBy[i]=m.checked;passedBy[i]=m.passed;checked=checkedBefore+checkedBy.reduce((a,b)=>a+b,0);passed=passedBefore+passedBy.reduce((a,b)=>a+b,0);paint(busy)};
      return coopDetailWorkerJob(worker,{type:'detailStage',jobId,prefixIds,candidateIds,start,end,slot,countOnly:countOnly&&slot===4,paused:coopProposalPaused,enemies,decks,visibleRows:coopVisibleRows,detailMode:coopDetailMode,targetDecks:totalDecks,enemySecondFixed:coopProposalEnemySecondFixed,constants:{damageBase:coopFixedDamageMultiplier()}},progress,items=>coopDetailPut(db,phase,items)).then(result=>{busy--;stageTimes[i]=(stageTimes[i]||0)+performance.now()-started;return result});
     });
     try{await Promise.all(jobs)}catch(error){coopTerminateProposalWorkerPool();throw error}
    }
    paint();await coopYield();
   }
   await coopDetailDelete(db,previous);stageHistory.push({slot:slot+1,total,checked,passed,workers:peakWorkers});
   coopProposalRecordWorkerHistory(slot,total,passed,stageTimes);if(coopProposalScaleHistory.length>100)coopProposalScaleHistory.splice(0,coopProposalScaleHistory.length-100);
   previous=phase;previousCount=passed;if(!passed)break;
  }
  return {phase:previous,count:previousCount,stages:stageHistory};
 }catch(error){for(let phase of phases)await coopDetailDelete(db,phase).catch(()=>{});throw error}
 finally{coopProposalOrderCache.clear()}
}
async function coopDetailRankingPage(db,phase,offset,limit=COOP_DETAIL_PAGE){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readonly'),out=[],range=IDBKeyRange.bound([phase],[phase,Infinity]);
    const request=tx.objectStore('records').index('ranking').openCursor(range);let advanced=false;
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(out);return}if(!advanced&&offset){advanced=true;cursor.advance(offset);return}advanced=true;out.push(cursor.value);if(out.length>=limit)resolve(out);else cursor.continue()};
  });
}
function coopDetailRank(db,phase,count){
  return new Promise((resolve,reject)=>{const request=db.transaction('records','readonly').objectStore('records').index('ranking').count(IDBKeyRange.bound([phase],[phase,-count],false,true));request.onsuccess=()=>resolve(request.result+1);request.onerror=()=>reject(request.error)});
}
async function coopDetailInitialSelection(view,token){
 if(view.initialSelection)return view.initialSelection;
 const summary=coopDetailUsageSummary,n=Math.max(1,summary.finalItems.length),top=coopDetailTopIds(summary),needs=Array.from({length:COOP_SLOTS},(_,slot)=>coopProposalSlotNeedsCandidate(slot)),items=[];
 await coopDetailWalk(view.db,view.initial,row=>{
  if(token!==coopDetailViewToken||view!==coopDetailView)throw new Error('detail-view-replaced');
  if(!coopDetailIsTopDeck(row.ids,top,needs))return;
  const deck=row.ids.map(coopFindCharacter);
  items.push({ids:row.ids,usageScore:deck.reduce((sum,c,slot)=>sum+(summary.counts[slot].get(coopCharacterKey(c))?.count||0)/n,0),costScore:deck.reduce((sum,c)=>sum+coopCharacterCost(c),0)});
 });
 items.sort((a,b)=>b.usageScore-a.usageScore||b.costScore-a.costScore||coopProposalDeckKey(a.ids).localeCompare(coopProposalDeckKey(b.ids),'ja',{numeric:true}));
 view.initialSelection=coopProposalNonOverlappingDecks(items,summary.counts);return view.initialSelection;
}

async function coopDetailRankedSelection(view,phase,token){
 const cacheKey=phase===view.ranking?'rankedSelection':'initialSelection';
 if(view[cacheKey])return view[cacheKey];
 const selected=[],used=Array.from({length:COOP_SLOTS},()=>new Set());let offset=0;
 while(true){
  const rows=await coopDetailRankingPage(view.db,phase,offset,COOP_DETAIL_BATCH);
  if(token!==coopDetailViewToken||view!==coopDetailView)throw new Error('detail-view-replaced');
  if(!rows.length)break;
  for(const row of rows){
   if(row.ids.some((id,slot)=>id&&used[slot].has(String(id))))continue;
   selected.push(row);row.ids.forEach((id,slot)=>{if(id)used[slot].add(String(id))});
  }
  offset+=rows.length;await coopYield();
 }
 view[cacheKey]=selected;return selected;
}
function coopDetailBindControls(view,total){
 const body=$('coopProposalBody');if(!body)return;
 let controls=body.querySelector('.coop-proposal-controls:not(#coopDetailPager)');
 if(!controls){controls=document.createElement('div');controls.className='coop-proposal-controls';body.prepend(controls)}
 controls.hidden=false;document.getElementById('coopDetailPager')?.remove();
 let all=$('coopProposalShowAll');
 if(!all){all=document.createElement('button');all.id='coopProposalShowAll';all.type='button';all.className='coop-all-decks-toggle';controls.prepend(all)}
 all.hidden=false;all.setAttribute('aria-pressed',String(coopProposalShowAllDecks));all.innerHTML=`<span>全デッキ表示</span><b>${coopProposalShowAllDecks?'ON':'OFF'}</b>`;
 all.onclick=()=>{if(!coopDetailView)return;coopProposalShowAllDecks=!coopProposalShowAllDecks;coopDetailShowPage().catch(coopDetailViewError)};
 let switcher=$('coopDetailResultToggle');
 if(!switcher){switcher=document.createElement('button');switcher.id='coopDetailResultToggle';switcher.type='button';switcher.className='coop-all-decks-toggle';controls.insertBefore(switcher,all.nextSibling)}
 switcher.setAttribute('aria-pressed',String(view.showInitial));switcher.innerHTML=`<span>初回計算結果</span><b>${view.showInitial?'ON':'OFF'}</b>`;
 switcher.onclick=()=>{if(!coopDetailView)return;view.showInitial=!view.showInitial;coopDetailShowPage().catch(coopDetailViewError)};
 let wrap=$('coopProposalDisplayControl'),select=$('coopProposalDisplayLimit');
 if(!wrap){wrap=document.createElement('label');wrap.id='coopProposalDisplayControl';wrap.className='coop-count-control';wrap.innerHTML='<span>表示件数</span><select id="coopProposalDisplayLimit"></select>';controls.append(wrap);select=wrap.querySelector('select')}
 wrap.hidden=false;
 const limitKey=(view.showInitial?'initial':'detailed')+(coopProposalShowAllDecks?'All':'Selected');
 view.displayLimits=view.displayLimits||{};
 const start=view.showInitial?10:6;
 view.displayLimit=coopFillDisplayLimitSelect(select,start,Math.max(1,total),view.displayLimits[limitKey]||start);
 view.displayLimits[limitKey]=view.displayLimit;
 coopProposalDisplayLimit=view.displayLimit;
 select.onchange=()=>{if(!coopDetailView)return;view.displayLimit=Number(select.value)||start;view.displayLimits[limitKey]=view.displayLimit;coopProposalDisplayLimit=view.displayLimit;coopDetailShowPage().catch(coopDetailViewError)};
 const record=$('coopRecordProposal');if(record)record.disabled=!total;
}
async function coopDetailShowPage(){
 const view=coopDetailView,token=++coopDetailViewToken;if(!view)return;
 // Invalidate any old normal-render animation before drawing the disk-backed view.
 ++coopProposalRenderToken;
 const phase=view.showInitial?view.initial:view.ranking,sourceTotal=view.showInitial?view.initialCount:view.rankCount;
 const grid=$('coopProposalGrid'),section=coopProposalResultSection(),body=$('coopProposalBody');if(!grid||!section)return;
 const usage=$('coopProposalUsageResults');if(usage)usage.hidden=!view.showInitial||!view.initialCount;
 let selection=null;
 if(!coopProposalShowAllDecks){
  try{selection=view.showInitial?await coopDetailInitialSelection(view,token):await coopDetailRankedSelection(view,phase,token)}catch(error){if(error.message==='detail-view-replaced')return;throw error}
 }
 if(token!==coopDetailViewToken||view!==coopDetailView)return;
 const total=selection?selection.length:sourceTotal;
 coopDetailBindControls(view,total);
 const limit=Math.min(total,view.displayLimit);
 grid.innerHTML='';section.hidden=false;if(body)body.hidden=false;
 const toggle=$('coopProposalToggle');if(toggle){toggle.setAttribute('aria-expanded','true');const arrow=toggle.querySelector('.coop-proposal-arrow');if(arrow)arrow.textContent='▼'}
 coopProposalDisplayed=[];coopProposalAll=[];let shown=0;
 const update=()=>{const count=$('coopProposalCount');if(count)count.textContent=`${shown.toLocaleString()} / ${total.toLocaleString()}件表示・${view.showInitial?'初回確定撃破':'詳細計算'}全${sourceTotal.toLocaleString()}件`};
 while(shown<limit){
  const rows=selection?selection.slice(shown,Math.min(limit,shown+COOP_DETAIL_BATCH)):await coopDetailRankingPage(view.db,phase,shown,Math.min(COOP_DETAIL_BATCH,limit-shown));
  if(token!==coopDetailViewToken||view!==coopDetailView)return;if(!rows.length)break;
  for(const row of rows){
   const item={ids:row.ids,deck:row.ids.map(coopFindCharacter),repeats:view.targetDecks,provisionalSlots:Array(COOP_SLOTS).fill(false),detailCertainCount:view.showInitial?undefined:row.detailCertainCount};
   coopProposalDisplayed.push(item);const card=coopProposalCard(item,shown,true);
   if(!view.showInitial){card.querySelector('.coop-proposal-copy')?.remove();card.querySelector('.coop-proposal-score-head > b').textContent=String(shown+1)}
   grid.append(card);shown++;
  }
  coopProposalAll=coopProposalDisplayed.slice();update();await new Promise(resolve=>requestAnimationFrame(resolve));
 }
 update();
}
function coopDetailViewError(error){const result=$('coopDamageResult');if(result)result.textContent='保存済み結果の読込に失敗しました: '+String(error?.message||error)}

async function coopDetailOriginalInitial(db,phase,totalDecks){
 coopProposalDeferredFirstCandidates=[];
 coopProposalEquivalentNonContinuous=Array.from({length:3},()=>({representativeId:'',characters:[]}));
 coopProposalLastBeam=[];
 coopProposalFrozenSlotIds=Array.from({length:COOP_SLOTS},()=>null);
 coopProposalAdjustingSlotIds=Array.from({length:COOP_SLOTS},()=>null);
 coopProposalExcludedSlotIds=Array.from({length:COOP_SLOTS},()=>new Set());
 coopProposalResultTarget=12;
 let exhaustive;
 const previousTurnExpansion=coopDetailInitialTurnExpansion;
 coopDetailInitialTurnExpansion=true;
 try{exhaustive=await coopProposalBruteforceAtMaximumScale(totalDecks)}
 finally{coopDetailInitialTurnExpansion=previousTurnExpansion}
 coopProposalOverallStage(5);coopSetProposalProgress(coopProposalOverall.labels[5],true);
 const expanded=await coopProposalExpandEquivalentNonContinuous(exhaustive);
 const seen=new Set(),all=[];
 for(const item of expanded){
  const ids=(item.ids||coopProposalDeckIds(item.deck)).map(String),key=coopProposalDeckKey(ids);
  if(!key||seen.has(key))continue;
  seen.add(key);all.push({...item,ids,deck:item.deck||ids.map(coopFindCharacter),provisionalSlots:Array(COOP_SLOTS).fill(false)});
 }
 const selected=coopProposalAppendDeferredFirstCandidates(all).filter(item=>!coopProposalHasDuplicateInCompletedDeck(coopProposalItemDeck(item),totalDecks));
 const ordered=coopProposalSortByUsage(selected);
 for(let offset=0;offset<ordered.length;offset+=COOP_DETAIL_BATCH){
  await coopWaitIfProposalPaused();
  await coopDetailPut(db,phase,ordered.slice(offset,offset+COOP_DETAIL_BATCH).map((item,i)=>({ids:item.ids,initialOrder:offset+i})));
  coopSetProposalProgress(coopProposalOverall.labels[5],true,Math.min(ordered.length,offset+COOP_DETAIL_BATCH),ordered.length);await coopYield();
 }
 const count=await coopDetailCount(db,phase);
 // Release original pipeline arrays only after its exact expanded results have been stored.
 exhaustive.length=0;expanded.length=0;all.length=0;selected.length=0;ordered.length=0;
 coopProposalOrderCache.clear();
 return {phase,count};
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
   if(typeof coopProposalManualCertainCache!=='undefined'&&coopProposalManualCertainCache.size>4096)coopProposalManualCertainCache.clear();
   await checkpoint({checked:checked.slice(),passed:passed.slice(),operations});
  }
 }
 await checkpoint({checked:checked.slice(),passed:passed.slice(),operations},true);
 return {count:passed[4],stages:checked.map((total,i)=>({slot:i+1,total,checked:total,passed:passed[i],workers:1}))};
}

function coopDetailCountWorkerJob(worker,message,onProgress){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>{worker.removeEventListener('message',receive);worker.removeEventListener('error',failure);worker._coopReject=null};
  const fail=error=>{if(settled)return;settled=true;cleanup();reject(error)};
  const failure=e=>fail(new Error(e.message||'Worker error'));
  const receive=e=>{const m=e.data||{};if(m.jobId!==message.jobId||settled)return;
   if(m.type==='detailCountProgress')onProgress(m);
   else if(m.type==='detailCountDone'){settled=true;cleanup();resolve(m)}
   else if(m.type==='error')fail(new Error(m.message));
  };
  worker._coopReject=fail;worker.addEventListener('message',receive);worker.addEventListener('error',failure);worker.postMessage(message);
 });
}
async function coopDetailEvaluateFast(db,evaluation,ranking,restricted,base,targetDecks){
 const total=await coopDetailCount(db,evaluation),workerCount=typeof Worker==='undefined'?0:coopDetailWorkerCount(Math.max(1,total));
 const workers=workerCount?await coopEnsureProposalWorkerPool(workerCount):[];
 const contextId='count-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 const poolIds=restricted.map(pool=>[...new Set(pool.map(coopCharacterKey))]);
 const context={type:'detailCountContext',contextId,poolIds,enemies:coopWorkerEnemies(),enemySecondFixed:coopProposalEnemySecondFixed,damageBase:coopFixedDamageMultiplier()};
 for(const worker of workers)worker.postMessage(context);
 const backup=coopDecks.map(row=>row.slice()),visible=coopVisibleRows,detail=coopDetailMode;
 let completed=0,rankCount=0,skipped=0,after=null,lastPaint=0;
 const operationsBy=Array(Math.max(1,workerCount)).fill(0);
 const paint=(force=false)=>{const now=performance.now();if(!force&&now-lastPaint<250)return;lastPaint=now;
  coopSetProposalProgress(`個別再計算 ${completed.toLocaleString()} / ${total.toLocaleString()}件・判定 ${operationsBy.reduce((a,b)=>a+b,0).toLocaleString()}組・準備済みWorker ${workerCount}`,true,completed,total,rankCount,workerCount);
 };
 const prepare=row=>{
  const placement=coopDetailPlace(base,row.ids);if(!placement)return null;
  try{
   coopDecks=Array.from({length:COOP_MAX_ROWS},(_,i)=>placement.rows[i]?.slice()||Array(COOP_SLOTS).fill(null));coopVisibleRows=targetDecks;coopDetailMode=true;
   const fixedSlots=Array.from({length:5},(_,slot)=>!coopProposalSlotNeedsCandidate(slot));
   return {row,placement,decks:coopDecks.map(r=>r.map(coopCharacterKey)),fixedSlots};
  }finally{coopDecks=backup.map(r=>r.slice());coopVisibleRows=visible;coopDetailMode=detail}
 };
 try{
  paint(true);
  while(true){
   await coopWaitIfProposalPaused();const rows=await coopDetailRead(db,evaluation,after);if(!rows.length)break;after=rows[rows.length-1].key;
   const jobs=[];
   for(const row of rows){const job=prepare(row);if(job)jobs.push(job);else{skipped++;completed++}}
   // Conservative per-evaluation upper bound; warning once, never silently truncate.
   let upper=0;
   for(const job of jobs){let product=1;for(let slot=0;slot<5;slot++){product*=job.fixedSlots[slot]?1:poolIds[slot].length;upper=Math.max(upper,product)}}
   if(!Number.isSafeInteger(upper))throw new Error('組み合わせ数が安全な整数範囲を超えています');
   if(!await coopProposalConfirmMillion(upper,4))throw new Error('計算を停止しました');
   const laneCount=Math.max(1,workerCount),queues=Array.from({length:laneCount},()=>[]);
   for(const job of jobs){let hash=0;for(const id of job.row.ids)for(const ch of String(id))hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;queues[hash%laneCount].push(job);}
   const lanes=queues.map((queue,lane)=>(async()=>{
    let next=0;
    while(next<queue.length){
     await coopWaitIfProposalPaused();if(next>=queue.length)break;const job=queue[next++],jobId=++coopProposalWorkerJobSequence;let result;
     if(workerCount){
      result=await coopDetailCountWorkerJob(workers[lane],{type:'detailCount',contextId,jobId,decks:job.decks,fixedSlots:job.fixedSlots,targetDecks,paused:coopProposalPaused},m=>{operationsBy[lane]=m.operations;paint()});
     }else{
      try{
       coopDecks=job.decks.map(row=>row.map(coopFindCharacter));coopVisibleRows=targetDecks;coopDetailMode=true;
       const pools=restricted.map((pool,slot)=>job.fixedSlots[slot]?[null]:[...new Map(pool.map(c=>[coopCharacterKey(c),c])).values()]);
       let lastYield=performance.now();
       result=await coopDetailDepthFirstCount(pools,targetDecks,async(stats,final)=>{operationsBy[0]=stats.operations;paint();if(final||performance.now()-lastYield>=24){await coopYield();await coopWaitIfProposalPaused();lastYield=performance.now()}});
      }finally{coopDecks=backup.map(r=>r.slice());coopVisibleRows=visible;coopDetailMode=detail}
     }
     await coopWaitIfProposalPaused();
     await coopDetailPut(db,ranking,[{ids:job.row.ids,detailCertainCount:result.count,placement:job.placement.placements,stages:result.stages}]);
     rankCount++;completed++;operationsBy[lane]=0;paint();
    }
   })());
   try{await Promise.all(lanes)}catch(error){coopTerminateProposalWorkerPool();await Promise.allSettled(lanes);throw error}
   paint(true);await coopYield();
  }
  paint(true);return {rankCount,skipped};
 }finally{coopDecks=backup;coopVisibleRows=visible;coopDetailMode=detail;coopProposalOrderCache.clear();if(typeof coopProposalManualCertainCache!=='undefined')coopProposalManualCertainCache.clear()}
}

async function coopProposeDetailed(){
  coopProposalExpiredMemo.clear();
  coopProposalBeginOverall(true);
  await coopProposalStartClock();coopDetailClearView();renderCoopProposalDecks([]);
  const db=await coopDetailOpenDatabase();
  // Delete only this tab's previous run; never clear another tab's calculation.
  for(const oldRun of coopDetailRuns)await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(oldRun+':',oldRun+':\uffff')));coopDetailRuns.clear();
  const originalDecks=coopDecks.map(row=>row.slice()),originalVisible=coopVisibleRows,originalDetail=coopDetailMode,originalTarget=coopProposalTargetDecks,originalSecond=coopProposalEnemySecondFixed;
  const targetDecks=originalDetail?Math.max(3,Math.min(5,Number($('coopProposalDeckCount')?.value)||4)):4;
  const run='detail-'+Date.now()+'-'+Math.random().toString(36).slice(2);coopDetailRuns.add(run);
  let initial=null,rankCount=0,skipped=0,completed=false;
  coopDetailCalculationActive=false;coopProposalTargetDecks=targetDecks;coopProposalScaleHistory=[];coopProposalRenderScaleHistory();
  try{
    const needs=Array.from({length:COOP_SLOTS},(_,slot)=>coopProposalSlotNeedsCandidate(slot));
    // Only detailed initial search relaxes the turn gate.
    // Subsequent evaluations use only the per-slot candidates in the initial results.
    const base=Array.from({length:targetDecks},(_,row)=>coopProposalDeck(Array(COOP_SLOTS).fill(null),row));
    initial=await coopDetailOriginalInitial(db,run+':initial',targetDecks);
    coopDetailCalculationActive=true;
    coopProposalOverallStage(6);coopSetProposalProgress(coopProposalOverall.labels[6],true);
    const summary={finalItems:{length:0},counts:Array.from({length:COOP_SLOTS},()=>new Map())};
    await coopDetailWalk(db,initial.phase,row=>{coopDetailMergeUsage(summary,[{ids:row.ids,deck:row.ids.map(coopFindCharacter)}])});
    coopProposalOverallStage(7);coopSetProposalProgress(coopProposalOverall.labels[7],true);
    const topIds=coopDetailTopIds(summary),evaluation=run+':evaluation',ranking=run+':ranking';let buffer=[];
    await coopDetailWalk(db,initial.phase,async row=>{if(coopDetailIsTopDeck(row.ids,topIds,needs)){buffer.push({ids:row.ids});if(buffer.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,evaluation,buffer);buffer=[]}}});
    if(buffer.length)await coopDetailPut(db,evaluation,buffer);
    const evaluationCount=await coopDetailCount(db,evaluation);
    // All characters in the existing initial usage aggregation, not just its top ten.
    const restricted=summary.counts.map((map,slot)=>needs[slot]?[...map.values()].map(x=>x.character):[null]);
    coopProposalOverallStage(8);
    const evaluatedResult=await coopDetailEvaluateFast(db,evaluation,ranking,restricted,base,targetDecks);
    rankCount=evaluatedResult.rankCount;skipped=evaluatedResult.skipped;
    await coopDetailDelete(db,evaluation);
    coopDecks=originalDecks.map(r=>r.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
    coopDetailUsageSummary=summary;coopRenderProposalUsage([],true);
    coopDetailView={db,run,initial:initial.phase,initialCount:initial.count,ranking,rankCount,skipped,targetDecks,offset:0,displayLimit:6,showInitial:rankCount===0};
    coopProposalOverallStage(9);coopSetProposalProgress(coopProposalOverall.labels[9],true);
    await coopDetailShowPage();
    coopProposalLastFoundCount=initial.count;coopProposalLastWasExhaustive=true;
    $('coopClearResult').textContent=initial.count?'詳細計算完了':'提案不可';
    $('coopDamageResult').textContent=`初回確定撃破${initial.count.toLocaleString()}件 / 個別評価${rankCount.toLocaleString()}件${skipped?` / 配置不可${skipped}件`:''}`;
    completed=true;return rankCount;
  }finally{
    coopDecks=originalDecks;coopVisibleRows=originalVisible;coopDetailMode=originalDetail;coopProposalTargetDecks=completed?targetDecks:originalTarget;coopProposalEnemySecondFixed=originalSecond;coopDetailCalculationActive=false;coopProposalOrderCache.clear();coopTerminateProposalWorkerPool();
    if(!completed){coopDetailRuns.delete(run);coopDetailClearView();await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(run+':',run+':\uffff'))).catch(()=>{})}
  }
}
