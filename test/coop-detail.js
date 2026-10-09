/* Detailed cooperative proposal calculation, build 20261008-detail-1.
 * Intermediate prefixes are streamed to IndexedDB, never truncated.
 * Normal proposal rules and the existing usage aggregator are reused.
 */
let coopDetailCalculationActive=false,coopDetailUsageSummary=null,coopDetailView=null;
let coopDetailDatabase=null,coopDetailViewToken=0;
const coopDetailRuns=new Set();
const COOP_DETAIL_BATCH=128,COOP_DETAIL_PAGE=10;
function coopDetailClearView(){
  coopDetailUsageSummary=null;coopDetailView=null;coopDetailViewToken++;
  document.getElementById('coopDetailPager')?.remove();
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
async function coopDetailSearch(db,run,pools,totalDecks,{countOnly=false,label='詳細計算'}={}){
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
      coopProposalProgressSlot=slot+1;
      let after=null;
      while(true){
        await coopWaitIfProposalPaused();
        const rows=await coopDetailRead(db,previous,after);
        if(!rows.length)break;
        const baseChecked=checked,basePassed=passed,originalProgress=coopSetProposalProgress;
        let items;
        try{
          coopSetProposalProgress=(text,busy,current,batchTotal,batchPassed,workers)=>originalProgress(`${label}・${slot+1}枠目`,busy,baseChecked+(current||0),total,basePassed+(batchPassed||0),workers);
          items=await coopProposalParallelStage(rows.map(row=>row.ids.map(coopFindCharacter)),pool,slot,totalDecks,label);
        }finally{coopSetProposalProgress=originalProgress}
        checked+=rows.length*pool.length;
        for(const item of items){
          const deck=item.deck;
          if(slot===COOP_SLOTS-1&&(coopProposalHasDuplicateInCompletedDeck(deck,totalDecks)||!coopProposalWorks(deck,totalDecks)))continue;
          passed++;
          if(!(countOnly&&slot===COOP_SLOTS-1))pending.push({ids:coopProposalDeckIds(deck)});
          if(pending.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,phase,pending);pending=[]}
        }
        after=rows[rows.length-1].key;
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
async function coopDetailShowPage(){
  const view=coopDetailView,token=++coopDetailViewToken;if(!view)return;
  const phase=view.showInitial?view.initial:view.ranking,total=view.showInitial?view.initialCount:view.rankCount;
  const offset=Math.min(view.offset,Math.max(0,Math.floor((total-1)/COOP_DETAIL_PAGE)*COOP_DETAIL_PAGE));view.offset=offset;
  // Initial results also use the ranking index (all have order 0).
  const data=await coopDetailRankingPage(view.db,phase,offset);
  if(token!==coopDetailViewToken||view!==coopDetailView)return;
  const grid=$('coopProposalGrid'),section=coopProposalResultSection(),body=$('coopProposalBody');if(!grid||!section)return;
  grid.innerHTML='';section.hidden=false;if(body)body.hidden=false;
  const toggle=$('coopProposalToggle');if(toggle){toggle.setAttribute('aria-expanded','true');const arrow=toggle.querySelector('.coop-proposal-arrow');if(arrow)arrow.textContent='▼'}
  coopProposalDisplayed=data.map(row=>({ids:row.ids,deck:row.ids.map(coopFindCharacter),repeats:view.targetDecks,provisionalSlots:Array(COOP_SLOTS).fill(false),detailCertainCount:view.showInitial?undefined:row.detailCertainCount}));
  coopProposalAll=coopProposalDisplayed.slice();
  for(let i=0;i<coopProposalDisplayed.length;i++){
    const item=coopProposalDisplayed[i],card=coopProposalCard(item,offset+i,true);
    if(!view.showInitial){const rank=await coopDetailRank(view.db,phase,item.detailCertainCount);if(token!==coopDetailViewToken)return;card.querySelector('b').textContent=rank+'位';const note=document.createElement('small');note.textContent='仮入力: '+(data[i].placement||[]).map(x=>`D${x.row+1}/${x.slot+1}枠`).join('、');card.append(note)}
    grid.append(card);
  }
  let pager=document.getElementById('coopDetailPager');if(!pager){pager=document.createElement('div');pager.id='coopDetailPager';pager.className='coop-proposal-controls';grid.before(pager)}pager.innerHTML='';
  const switcher=document.createElement('button');switcher.type='button';switcher.textContent=view.showInitial?'個別再計算の順位を表示':'初回の全確定撃破デッキを表示';switcher.onclick=()=>{view.showInitial=!view.showInitial;view.offset=0;coopDetailShowPage().catch(coopDetailViewError)};pager.append(switcher);
  for(let [text,delta] of [['前へ',-COOP_DETAIL_PAGE],['次へ',COOP_DETAIL_PAGE]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=delta<0?offset===0:offset+COOP_DETAIL_PAGE>=total;button.onclick=()=>{view.offset+=delta;coopDetailShowPage().catch(coopDetailViewError)};pager.append(button)}
  const status=document.createElement('span');status.textContent=`${total?offset+1:0}～${Math.min(offset+COOP_DETAIL_PAGE,total)} / 全${total.toLocaleString()}件${view.skipped?`・配置不可${view.skipped}件（順位対象外）`:''}`;pager.append(status);
  const count=$('coopProposalCount');if(count)count.textContent=status.textContent;
  const controls=body?.querySelector('.coop-proposal-controls:not(#coopDetailPager)');if(controls)controls.hidden=true;
}
function coopDetailViewError(error){const result=$('coopDamageResult');if(result)result.textContent='保存済み結果の読込に失敗しました: '+String(error?.message||error)}
async function coopProposeDetailed(){
  await coopProposalStartClock();coopDetailClearView();renderCoopProposalDecks([]);
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
    initial=await coopDetailSearch(db,run+':initial',pools,targetDecks,{label:'詳細計算・初回'});
    const summary={finalItems:{length:0},counts:Array.from({length:COOP_SLOTS},()=>new Map())};
    await coopDetailWalk(db,initial.phase,row=>{coopDetailMergeUsage(summary,[{ids:row.ids,deck:row.ids.map(coopFindCharacter)}])});
    const topIds=coopDetailTopIds(summary),evaluation=run+':evaluation',ranking=run+':ranking';let buffer=[];
    await coopDetailWalk(db,initial.phase,async row=>{if(coopDetailIsTopDeck(row.ids,topIds,needs)){buffer.push({ids:row.ids});if(buffer.length>=COOP_DETAIL_BATCH){await coopDetailPut(db,evaluation,buffer);buffer=[]}}});
    if(buffer.length)await coopDetailPut(db,evaluation,buffer);
    const evaluationCount=await coopDetailCount(db,evaluation);
    // All characters in the existing initial usage aggregation, not just its top ten.
    const restricted=summary.counts.map((map,slot)=>needs[slot]?[...map.values()].map(x=>x.character):[null]);
    let evaluated=0;
    await coopDetailWalk(db,evaluation,async row=>{
      evaluated++;const placement=coopDetailPlace(base,row.ids);
      if(!placement){skipped++;return}
      coopDecks=Array.from({length:COOP_MAX_ROWS},(_,i)=>placement.rows[i]?.slice()||Array(COOP_SLOTS).fill(null));coopVisibleRows=targetDecks;coopDetailMode=true;
      const result=await coopDetailSearch(db,run+':score'+evaluated,restricted.map((pool,slot)=>coopProposalSlotNeedsCandidate(slot)?pool:[null]),targetDecks,{countOnly:true,label:`個別再計算 ${evaluated.toLocaleString()} / ${evaluationCount.toLocaleString()}`});
      await coopDetailPut(db,ranking,[{ids:row.ids,detailCertainCount:result.count,placement:placement.placements}]);rankCount++;
      await coopDetailDelete(db,result.phase);
      coopDecks=originalDecks.map(r=>r.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
      // Bound diagnostic history too; its counters do not participate in calculation.
      if(coopProposalScaleHistory.length>100)coopProposalScaleHistory.splice(0,coopProposalScaleHistory.length-100);
      await coopYield();
    });
    await coopDetailDelete(db,evaluation);
    coopDecks=originalDecks.map(r=>r.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
    coopDetailUsageSummary=summary;coopRenderProposalUsage([],true);
    coopDetailView={db,run,initial:initial.phase,initialCount:initial.count,ranking,rankCount,skipped,targetDecks,offset:0,showInitial:rankCount===0};
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
