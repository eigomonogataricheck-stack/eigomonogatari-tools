/* Detailed cooperative proposal calculation, build 20261008-detail-1.
 * Intermediate prefixes are streamed to IndexedDB, never truncated.
 * Normal proposal rules and the existing usage aggregator are reused.
 */
let coopDetailCalculationActive=false,coopDetailUsageSummary=null,coopDetailView=null;
let coopDetailDatabase=null,coopDetailViewToken=0;
const coopDetailRuns=new Set();
const COOP_DETAIL_BATCH=512,COOP_DETAIL_PAGE=10;
function coopDetailClearView(){
  const view=coopDetailView;
  coopDetailUsageSummary=null;coopDetailView=null;coopDetailViewToken++;coopProposalRenderToken++;
  document.getElementById('coopDetailPager')?.remove();
  const controls=document.querySelector('#coopProposalBody .coop-proposal-controls');if(controls)controls.hidden=false;
  if(view?.normalSettings){coopProposalDisplayLimit=view.normalSettings.limit;coopProposalShowAllDecks=view.normalSettings.all}
  const usage=$('coopProposalUsageResults');if(usage)usage.hidden=true;
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
  await coopDetailTransaction(db,store=>{for(let item of items){const ids=item.ids.map(String),deckKey=coopProposalDeckKey(ids);store.put({key:phase+'\u0001'+deckKey,phase,deckKey,ids,order:-Number(item.detailCertainCount||0),detailCertainCount:item.detailCertainCount,placement:item.placement,unplaceable:!!item.unplaceable})}});
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
async function coopDetailSearch(db,run,pools,totalDecks,{countOnly=false,label='詳細計算',readAheadBatches=1}={}){
  let previous=run+':seed',previousCount=1,checked=0;
  const phases=[previous];
  await coopDetailPut(db,previous,[{ids:Array(COOP_SLOTS).fill('')}]);
  try{
    for(let slot=0;slot<COOP_SLOTS;slot++){
      const phase=run+':slot'+slot,pool=[...new Map((pools[slot]||[]).map(c=>[coopCharacterKey(c),c])).values()],total=previousCount*pool.length;
      phases.push(phase);checked=0;let passed=0,pending=[],lastPaint=performance.now();
      if(!Number.isSafeInteger(total))throw new Error('組み合わせ数が安全に集計できる整数範囲を超えています。枠の固定を増やしてください。');
      if(!await coopProposalConfirmMillion(total,slot))throw new Error('計算を停止しました');
      coopProposalProgressCoverage=pools.map(p=>p.filter(Boolean).length);
      coopOverallProgress.slot=slot+1;
      let after=null;
      while(true){
        await coopWaitIfProposalPaused();
        const rows=[];
        for(let batch=0;batch<Math.max(1,Math.floor(Number(readAheadBatches)||1));batch++){
          const part=await coopDetailRead(db,previous,after,COOP_DETAIL_BATCH);
          if(!part.length)break;
          rows.push(...part);after=part[part.length-1].key;
          if(part.length<COOP_DETAIL_BATCH)break;
        }
        if(!rows.length)break;
        const baseChecked=checked,basePassed=passed,originalProgress=coopSetProposalProgress;
        const finalCountOnly=countOnly&&slot===COOP_SLOTS-1;  
        let items;  
        try{  
          coopSetProposalProgress=(text,busy,current,batchTotal,batchPassed,workers)=>originalProgress(`${label}・${slot+1}枠目`,busy,baseChecked+(current||0),total,basePassed+(batchPassed||0),workers);  
          items=await coopProposalParallelStage(rows.map(row=>row.ids.map(coopFindCharacter)),pool,slot,totalDecks,label,{countOnly:finalCountOnly});  
        }finally{coopSetProposalProgress=originalProgress}  
        checked+=rows.length*pool.length;  
        if(finalCountOnly){passed+=items.count||0;coopSetProposalProgress(`${label}・${slot+1}枠目`,true,checked,total,passed,coopWorkerCount(rows.length*pool.length));continue}  
for(const item of items){
          const deck=item.deck;
          if(slot===COOP_SLOTS-1&&coopProposalHasDuplicateInCompletedDeck(deck,totalDecks))continue;
          passed++;
          if(!(countOnly&&slot===COOP_SLOTS-1))pending.push({ids:coopProposalDeckIds(deck)});
          if(pending.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,phase,pending);pending=[]}
        }
        coopSetProposalProgress(`${label}・${slot+1}枠目`,true,checked,total,passed,coopWorkerCount(rows.length*pool.length));
      }
      if(pending.length)await coopDetailPut(db,phase,pending);
      await coopDetailDelete(db,previous);
      coopProposalRecordWorkerHistory(slot,total,passed,[]);
      previous=phase;previousCount=passed;
      if(!passed)break;
    }
    return {phase:previous,count:previousCount};
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
function coopDetailChooseRanked(rows,needs){
 const selected=[],used=Array.from({length:COOP_SLOTS},()=>new Set());
 for(const row of rows){if(row.ids.some((id,slot)=>needs[slot]&&used[slot].has(String(id))))continue;selected.push(row);row.ids.forEach((id,slot)=>{if(needs[slot])used[slot].add(String(id))})}
 return selected;
}
function coopDetailUiMode(view){return !view.showInitial?(view.detailAll?'detailAll':'detail'):view.initialAll?'initialAll':'initialSelected'}
function coopDetailUiLimit(view,mode){return view.uiLimits?.[mode]??(mode.startsWith('detail')?6:10)}
function coopDetailUiSetLimit(view,mode,value){view.uiLimits??={};view.uiLimits[mode]=Math.max(0,Math.floor(Number(value)||0))}
async function coopDetailInitialRows(view){
  if(!view.initialRowsPromise)view.initialRowsPromise=(async()=>{
    const items=[];
    await coopDetailWalk(view.db,view.initial,row=>items.push({ids:row.ids,deck:row.ids.map(coopFindCharacter),repeats:view.targetDecks}));
    return coopProposalSortByUsage(items);
  })().catch(error=>{view.initialRowsPromise=null;throw error});
  return view.initialRowsPromise;
}
async function coopDetailSelectedRows(view){
  if(view.showInitial){const rows=await coopDetailInitialRows(view);return view.initialAll?rows:coopProposalNonOverlappingDecks(rows)}
  if(view.detailAll){
    if(!view.allRankedRowsPromise)view.allRankedRowsPromise=(async()=>{
      const rows=[];
      for(let offset=0;offset<view.rankCount;offset+=128){rows.push(...await coopDetailRankingPage(view.db,view.ranking,offset,128));await coopYield()}
      return rows;
    })().catch(error=>{view.allRankedRowsPromise=null;throw error});
    return view.allRankedRowsPromise;
  }
  if(!view.rankedRowsPromise)view.rankedRowsPromise=(async()=>{
    const selected=[],used=Array.from({length:COOP_SLOTS},()=>new Set());
    for(let offset=0;offset<view.rankCount;offset+=128){
      const rows=await coopDetailRankingPage(view.db,view.ranking,offset,128);
      for(const row of rows){if(row.ids.some((id,slot)=>view.needs[slot]&&used[slot].has(String(id))))continue;
        selected.push(row);row.ids.forEach((id,slot)=>{if(view.needs[slot])used[slot].add(String(id))});}
      await coopYield();
    }
    return selected;
  })().catch(error=>{view.rankedRowsPromise=null;throw error});
  return view.rankedRowsPromise;
}
function coopDetailUiToggle(label,pressed,action){
  const button=document.createElement('button');button.type='button';button.className='coop-all-decks-toggle';
  button.setAttribute('aria-pressed',String(pressed));button.innerHTML=`<span>${label}</span><b>${pressed?'ON':'OFF'}</b>`;button.onclick=action;return button;
}
async function coopDetailShowPage(){
  const view=coopDetailView,token=++coopDetailViewToken;if(!view)return;
  coopProposalRenderToken++;
  view.needs??=Array.from({length:COOP_SLOTS},(_,slot)=>coopProposalSlotNeedsCandidate(slot));
  const mode=coopDetailUiMode(view),selected=await coopDetailSelectedRows(view);
  if(token!==coopDetailViewToken||view!==coopDetailView||mode!==coopDetailUiMode(view))return;
  const grid=$('coopProposalGrid'),section=coopProposalResultSection(),body=$('coopProposalBody');if(!grid||!section)return;
  const controlsOriginal=body?.querySelector('.coop-proposal-controls:not(#coopDetailPager)');if(controlsOriginal)controlsOriginal.hidden=true;
  let controls=document.getElementById('coopDetailPager');
  if(!controls){
    controls=document.createElement('div');controls.id='coopDetailPager';controls.className='coop-proposal-controls coop-detail-controls';
    const row=document.createElement('div');row.className='coop-detail-toggle-row';
    const all=coopDetailUiToggle('全デッキ表示',false,()=>{});all.id='coopDetailShowAll';
    const result=coopDetailUiToggle('初回計算結果',false,()=>{});result.id='coopDetailResultSwitch';
    row.append(all,result);controls.append(row);
    const label=document.createElement('label');label.className='coop-count-control';label.innerHTML='<span>表示件数</span>';
    const select=document.createElement('select');select.id='coopDetailDisplayLimit';select.setAttribute('aria-label','表示件数');label.append(select);controls.append(label);grid.before(controls);
  }
  const all=controls.querySelector('#coopDetailShowAll'),result=controls.querySelector('#coopDetailResultSwitch');
  const allOn=view.showInitial?!!view.initialAll:!!view.detailAll;
  all.setAttribute('aria-pressed',String(allOn));all.querySelector('b').textContent=allOn?'ON':'OFF';
  result.setAttribute('aria-pressed',String(view.showInitial));result.querySelector('b').textContent=view.showInitial?'ON':'OFF';
  all.onclick=()=>{const key=view.showInitial?'initialAll':'detailAll';view[key]=!view[key];coopDetailShowPage().catch(coopDetailViewError)};
  result.onclick=()=>{view.showInitial=!view.showInitial;coopDetailShowPage().catch(coopDetailViewError)};
  const select=controls.querySelector('#coopDetailDisplayLimit');select.disabled=false;
  const requested=coopDetailUiLimit(view,mode),limit=selected.length?coopFillDisplayLimitSelect(select,mode.startsWith('detail')?6:10,selected.length,requested):0;
  if(!selected.length){select.innerHTML='<option value="0">0</option>';select.disabled=true;coopSyncStyledSelect(select)}
  select.onchange=()=>{coopDetailUiSetLimit(view,mode,select.value);coopSyncStyledSelect(select);coopDetailShowPage().catch(coopDetailViewError)};
  const data=selected.slice(0,limit);grid.replaceChildren();section.hidden=false;
  const toggle=$('coopProposalToggle');if(toggle){toggle.setAttribute('aria-expanded',String(!body?.hidden));const arrow=toggle.querySelector('.coop-proposal-arrow');if(arrow)arrow.textContent=body?.hidden?'▶':'▼'}
  coopProposalDisplayed=data.map(row=>({ids:row.ids,deck:row.deck||row.ids.map(coopFindCharacter),repeats:view.targetDecks,provisionalSlots:Array(COOP_SLOTS).fill(false),detailCertainCount:view.showInitial?undefined:row.detailCertainCount}));coopProposalAll=coopProposalDisplayed.slice();
  for(let i=0;i<data.length;i++){
    const item=coopProposalDisplayed[i],card=coopProposalCard(item,i,false);
    if(!view.showInitial){card.querySelector('.coop-proposal-copy')?.remove();const rank=await coopDetailRank(view.db,view.ranking,item.detailCertainCount);if(token!==coopDetailViewToken||view!==coopDetailView)return;card.querySelector('b').textContent=rank+'位'}
    grid.append(card);if(i%100===99){await coopYield();if(token!==coopDetailViewToken||view!==coopDetailView)return}
  }
  if(!data.length){const empty=document.createElement('p');empty.className='coop-detail-empty';empty.textContent=view.showInitial?'初回の確定撃破デッキはありません':'表示できる詳細結果はありません';grid.append(empty)}
  const usage=$('coopProposalUsageResults');if(usage)usage.hidden=!view.showInitial||!view.initialCount;
  const count=$('coopProposalCount');if(count)count.textContent=`${view.showInitial?'初回結果':'詳細結果'} ${data.length.toLocaleString()} / ${selected.length.toLocaleString()}件${view.skipped?` / 配置不可 ${view.skipped}件`:''}`;
}

function coopDetailViewError(error){const result=$('coopDamageResult');if(result)result.textContent='保存済み結果の読込に失敗しました: '+String(error?.message||error)}
async function coopProposeDetailed(){
  coopOverallReset(true);await coopProposalStartClock();coopDetailClearView();renderCoopProposalDecks([]);
  const db=await coopDetailOpenDatabase();
  // Delete only this tab's previous run; never clear another tab's calculation.
  for(const oldRun of coopDetailRuns)await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(oldRun+':',oldRun+':\uffff')));coopDetailRuns.clear();
  const originalDecks=coopDecks.map(row=>row.slice()),originalVisible=coopVisibleRows,originalDetail=coopDetailMode,originalTarget=coopProposalTargetDecks,originalSecond=coopProposalEnemySecondFixed;
  const targetDecks=originalDetail?Math.max(3,Math.min(5,Number($('coopProposalDeckCount')?.value)||4)):4;
  const run='detail-'+Date.now()+'-'+Math.random().toString(36).slice(2);coopDetailRuns.add(run);
  let initial=null,rankCount=0,skipped=0,completed=false;
  coopDetailCalculationActive=true;coopProposalTargetDecks=targetDecks;coopProposalScaleHistory=[];coopProposalRenderScaleHistory();
  try{
    const needs=Array.from({length:COOP_SLOTS},(_,slot)=>coopProposalSlotNeedsCandidate(slot));
    const pools=needs.map((need,slot)=>need?(slot===0?coopProposalFirstCandidatesAll(chars):coopProposalPoolAll(slot)):[null]);
    // Freeze the original input mapping, including normal-mode automatic fixed positions.
    const base=Array.from({length:targetDecks},(_,row)=>coopProposalDeck(Array(COOP_SLOTS).fill(null),row));
    initial=await coopDetailSearch(db,run+':initial',pools,targetDecks,{label:'詳細計算・初回',readAheadBatches:4});
    const summary={finalItems:{length:0},counts:Array.from({length:COOP_SLOTS},()=>new Map())};
    await coopDetailWalk(db,initial.phase,row=>{coopDetailMergeUsage(summary,[{ids:row.ids,deck:row.ids.map(coopFindCharacter)}])});
    const topIds=coopDetailTopIds(summary),evaluation=run+':evaluation',ranking=run+':ranking';let buffer=[];
    await coopDetailWalk(db,initial.phase,async row=>{if(coopDetailIsTopDeck(row.ids,topIds,needs)){buffer.push({ids:row.ids});if(buffer.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,evaluation,buffer);buffer=[]}}});
    if(buffer.length)await coopDetailPut(db,evaluation,buffer);
    const evaluationCount=await coopDetailCount(db,evaluation);coopOverallProgress.percent=20;
    // All characters in the existing initial usage aggregation, not just its top ten.
    const restricted=summary.counts.map((map,slot)=>needs[slot]?[...map.values()].map(x=>x.character):[null]);
    let evaluated=0,evaluationAfter=null;
    const COOP_DETAIL_EVALUATION_BATCH=16;
    while(true){
      await coopWaitIfProposalPaused();
      const evaluationRows=await coopDetailRead(db,evaluation,evaluationAfter,COOP_DETAIL_EVALUATION_BATCH);
      if(!evaluationRows.length)break;
      evaluationAfter=evaluationRows[evaluationRows.length-1].key;
      const prepared=[];
      for(const row of evaluationRows){
        const placement=coopDetailPlace(base,row.ids);evaluated++;
        if(!placement){skipped++;continue}
        prepared.push({row,placement,number:evaluated});
      }
      const rankingBatch=[];
      for(const entry of prepared){
        coopOverallProgress.base=20+80*(entry.number-1)/Math.max(1,evaluationCount);
        coopOverallProgress.span=80/Math.max(1,evaluationCount);coopOverallProgress.slot=1;
        coopDecks=Array.from({length:COOP_MAX_ROWS},(_,i)=>entry.placement.rows[i]?.slice()||Array(COOP_SLOTS).fill(null));coopVisibleRows=targetDecks;coopDetailMode=true;
        const result=await coopDetailSearch(db,run+':score'+entry.number,restricted.map((pool,slot)=>coopProposalSlotNeedsCandidate(slot)?pool:[null]),targetDecks,{countOnly:true,label:`個別再計算 ${entry.number.toLocaleString()} / ${evaluationCount.toLocaleString()}`});
        rankingBatch.push({ids:entry.row.ids,detailCertainCount:result.count,placement:entry.placement.placements});rankCount++;
        await coopDetailDelete(db,result.phase);
        coopDecks=originalDecks.map(r=>r.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
        if(coopProposalScaleHistory.length>100)coopProposalScaleHistory.splice(0,coopProposalScaleHistory.length-100);
      }
      if(rankingBatch.length)await coopDetailPut(db,ranking,rankingBatch);
      coopOverallProgress.percent=20+80*evaluated/Math.max(1,evaluationCount);
      await coopYield();
    }
    await coopDetailDelete(db,evaluation);
    coopDecks=originalDecks.map(r=>r.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
    coopDetailUsageSummary=summary;coopRenderProposalUsage([],true);
    coopDetailView={db,run,initial:initial.phase,initialCount:initial.count,ranking,rankCount,skipped,targetDecks,offset:0,showInitial:rankCount===0};
    coopDetailView.needs=needs.slice();coopDetailView.normalSettings={limit:coopProposalDisplayLimit,all:coopProposalShowAllDecks};coopDetailView.initialAll=false;coopDetailView.detailAll=false;coopDetailView.uiLimits={detail:6,detailAll:6,initialAll:10,initialSelected:10};coopProposalRenderToken++;
    const resultBody=$('coopProposalBody');if(resultBody)resultBody.hidden=false;
    await coopDetailShowPage();
    coopProposalLastFoundCount=initial.count;coopProposalLastWasExhaustive=true;
    $('coopClearResult').textContent=initial.count?'詳細計算完了':'提案不可';
    $('coopDamageResult').textContent=`初回確定撃破${initial.count.toLocaleString()}件 / 個別評価${rankCount.toLocaleString()}件${skipped?` / 配置不可${skipped}件`:''}`;
    coopOverallProgress.percent=100;completed=true;return rankCount;
  }finally{
    coopDecks=originalDecks;coopVisibleRows=originalVisible;coopDetailMode=originalDetail;coopProposalTargetDecks=completed?targetDecks:originalTarget;coopProposalEnemySecondFixed=originalSecond;coopDetailCalculationActive=false;calculateCoop();coopProposalOrderCache.clear();coopTerminateProposalWorkerPool();
    if(!completed){coopDetailRuns.delete(run);coopDetailClearView();await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(run+':',run+':\uffff'))).catch(()=>{})}
  }
}
