/* Detailed cooperative proposal calculation, build 20261014-abort-active-transactions.
 * Intermediate prefixes are streamed to IndexedDB, never truncated.
 * Normal proposal rules and the existing usage aggregator are reused.
 */
let coopDetailCalculationActive=false,coopDetailUsageSummary=null,coopDetailView=null,coopDetailGeneration=0;
let coopDetailDatabase=null,coopDetailViewToken=0;
const coopDetailActiveTransactions=new Set();
const coopDetailRuns=new Set();
function coopDetailInvalidateRun(){coopDetailGeneration++;coopDetailCalculationActive=false}
function coopDetailAbortAllRuns(){coopDetailInvalidateRun();coopDetailViewToken++;coopDetailUsageSummary=null;coopDetailView=null;coopDetailRuns.clear();for(const tx of [...coopDetailActiveTransactions]){try{tx.abort()}catch{}}coopDetailActiveTransactions.clear();try{coopDetailDatabase?.close()}catch{}coopDetailDatabase=null;document.getElementById('coopDetailPager')?.remove()}
function coopDetailAssertRun(generation){if(generation!==coopDetailGeneration||coopProposalCancelRequested)throw new Error('計算を停止しました')}
function coopDetailPrepareNormalRun(){coopDetailInvalidateRun();coopDetailClearView();coopDetailUsageSummary=null;coopDetailView=null;document.getElementById('coopDetailPager')?.remove();let controls=document.querySelector('#coopProposalBody .coop-proposal-controls');if(controls)controls.hidden=false}
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
    const generation=coopDetailGeneration,request=indexedDB.open('eigoCoopDetailedCalculationV1',1);
    request.onupgradeneeded=()=>{let store=request.result.createObjectStore('records',{keyPath:'key'});store.createIndex('ranking',['phase','order','deckKey'])};
    request.onerror=()=>reject(new Error('詳細計算の保存領域を開けません: '+(request.error?.message||'')));
    request.onblocked=()=>reject(new Error('別のタブが詳細計算の保存領域を使用しています。'));
    request.onsuccess=()=>{if(generation!==coopDetailGeneration){request.result.close();reject(new Error('Calculation stopped'));return}coopDetailDatabase=request.result;coopDetailDatabase.onversionchange=()=>{coopDetailDatabase.close();coopDetailDatabase=null};resolve(coopDetailDatabase)};
  });
}
function coopDetailRange(phase,after=null){
  const prefix=phase+'\u0001';
  return IDBKeyRange.bound(after||prefix,prefix+'\uffff',!!after,false);
}
function coopDetailTransaction(db,action){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite');coopDetailActiveTransactions.add(tx);
    tx.oncomplete=()=>{coopDetailActiveTransactions.delete(tx);resolve()};
    tx.onabort=()=>{coopDetailActiveTransactions.delete(tx);reject(new Error(coopProposalCancelRequested?'計算を停止しました':'詳細計算の保存に失敗しました。容量不足・保存権限を確認してください。計算は未完了です: '+(tx.error?.message||'')))};
    tx.onerror=()=>{};
    try{action(tx.objectStore('records'))}catch(error){tx.abort();reject(error)}
  });
}
async function coopDetailPut(db,phase,items){
  if(!items.length)return;
  await coopDetailTransaction(db,store=>{for(let item of items){const ids=item.ids.map(String),deckKey=coopProposalDeckKey(ids);store.put({key:phase+'\u0001'+deckKey,phase,deckKey,ids})}});
}
function coopDetailRead(db,phase,after=null,limit=COOP_DETAIL_BATCH){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readonly'),out=[];coopDetailActiveTransactions.add(tx);tx.oncomplete=()=>coopDetailActiveTransactions.delete(tx);tx.onabort=()=>{coopDetailActiveTransactions.delete(tx);reject(new Error('計算を停止しました'))};
    const request=tx.objectStore('records').openCursor(coopDetailRange(phase,after));
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const cursor=request.result;if(!cursor||out.length>=limit){resolve(out);return}out.push(cursor.value);if(out.length>=limit)resolve(out);else cursor.continue()};
  });
}
function coopDetailCount(db,phase){
  return new Promise((resolve,reject)=>{const tx=db.transaction('records','readonly');coopDetailActiveTransactions.add(tx);tx.oncomplete=()=>coopDetailActiveTransactions.delete(tx);tx.onabort=()=>{coopDetailActiveTransactions.delete(tx);reject(new Error('計算を停止しました'))};const request=tx.objectStore('records').count(coopDetailRange(phase));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
}
async function coopDetailDelete(db,phase){await coopDetailTransaction(db,store=>store.delete(coopDetailRange(phase)))}
async function coopDetailWalk(db,phase,visit){
  let after=null;
  while(true){await coopWaitIfProposalPaused();const rows=await coopDetailRead(db,phase,after);if(!rows.length)break;for(let i=0;i<rows.length;i++){if((i&127)===0)await coopWaitIfProposalPaused();const result=visit(rows[i]);if(result&&typeof result.then==='function')await result}after=rows[rows.length-1].key;await coopYield()}
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
async function coopDetailSearch(db,run,pools,totalDecks,{countOnly=false,label='詳細計算',readAheadBatches=1,generation=null}={}){
  let previous=run+':seed',previousCount=1,checked=0;
  const phases=[previous];
  await coopDetailPut(db,previous,[{ids:Array(COOP_SLOTS).fill('')}]);
  try{
    for(let slot=0;slot<COOP_SLOTS;slot++){
      if(generation!==null)coopDetailAssertRun(generation);
      const phase=run+':slot'+slot,pool=[...new Map((pools[slot]||[]).map(c=>[coopCharacterKey(c),c])).values()],total=previousCount*pool.length;
      phases.push(phase);checked=0;let passed=0,pending=[],lastPaint=performance.now();
      if(!Number.isSafeInteger(total))throw new Error('組み合わせ数が安全に集計できる整数範囲を超えています。枠の固定を増やしてください。');
      if(generation!==null)coopDetailAssertRun(generation);
      if(!await coopProposalConfirmMillion(total,slot))throw new Error('計算を停止しました');
      if(generation!==null)coopDetailAssertRun(generation);
      coopProposalProgressCoverage=pools.map(p=>p.filter(Boolean).length);
      coopOverallProgress.slot=slot+1;
      let after=null;
      while(true){
        if(generation!==null)coopDetailAssertRun(generation);
        await coopWaitIfProposalPaused();
        if(generation!==null)coopDetailAssertRun(generation);
        const rows=[];
        for(let batch=0;batch<Math.max(1,Math.floor(Number(readAheadBatches)||1));batch++){
          const part=await coopDetailRead(db,previous,after,COOP_DETAIL_BATCH);if(generation!==null)coopDetailAssertRun(generation);
          if(!part.length)break;
          rows.push(...part);after=part[part.length-1].key;
          if(part.length<COOP_DETAIL_BATCH)break;
        }
        if(!rows.length)break;
        const baseChecked=checked,basePassed=passed;
        const finalCountOnly=countOnly&&slot===COOP_SLOTS-1;
        const onProgress=(text,busy,current,batchTotal,batchPassed,workers)=>{
          if(generation!==null&&generation!==coopDetailGeneration)return;
          coopSetProposalProgress(`${label}・${slot+1}枠目`,busy,baseChecked+(current||0),total,basePassed+(batchPassed||0),workers);
        };
        if(generation!==null)coopDetailAssertRun(generation);
        const fixedSlot=pool.length===1&&pool[0]===null;
        let items;
        if(fixedSlot){
          items=[];let fixedPassed=0;
          for(let i=0;i<rows.length;i++){
            if((i&127)===0){await coopWaitIfProposalPaused();if(generation!==null)coopDetailAssertRun(generation);await coopYield()}
            const item=coopProposalPrefixLayerEvaluation(rows[i].ids.map(coopFindCharacter),slot,totalDecks);
            if(item){fixedPassed++;if(!finalCountOnly)items.push(item)}
          }
          if(finalCountOnly)items={count:fixedPassed};
        }else items=await coopProposalParallelStage(rows.map(row=>row.ids.map(coopFindCharacter)),pool,slot,totalDecks,label,{countOnly:finalCountOnly,onProgress});
        checked+=rows.length*pool.length;
        if(generation!==null)coopDetailAssertRun(generation);
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
      await coopDetailDelete(db,previous);if(generation!==null)coopDetailAssertRun(generation);
      coopProposalRecordWorkerHistory(slot,total,passed,[]);
      previous=phase;previousCount=passed;
      if(!passed)break;
    }
    return {phase:previous,count:previousCount};
  }catch(error){for(let phase of phases)await coopDetailDelete(db,phase).catch(()=>{});throw error}
  finally{if(generation===null||generation===coopDetailGeneration)coopProposalOrderCache.clear()}
}
async function coopDetailInitialRows(view){
  if(!view.initialRowsPromise)view.initialRowsPromise=(async()=>{
    const items=[];
    await coopDetailWalk(view.db,view.initial,row=>items.push({ids:row.ids,deck:row.ids.map(coopFindCharacter),repeats:view.targetDecks}));
    return coopProposalSortByUsage(items);
  })().catch(error=>{view.initialRowsPromise=null;throw error});
  return view.initialRowsPromise;
}
async function coopDetailSelectedRows(view){
  const rows=await coopDetailInitialRows(view);
  return view.showAll?rows:coopProposalNonOverlappingDecks(rows);
}
function coopDetailUiToggle(label,pressed,action){
  const button=document.createElement('button');button.type='button';button.className='coop-all-decks-toggle';
  button.setAttribute('aria-pressed',String(pressed));button.innerHTML=`<span>${label}</span><b>${pressed?'ON':'OFF'}</b>`;button.onclick=action;return button;
}
async function coopDetailShowPage(){
  const view=coopDetailView,token=++coopDetailViewToken;if(!view)return;
  coopProposalRenderToken++;
  const selected=await coopDetailSelectedRows(view);
  if(token!==coopDetailViewToken||view!==coopDetailView)return;
  const grid=$('coopProposalGrid'),section=coopProposalResultSection(),body=$('coopProposalBody');if(!grid||!section)return;
  const controlsOriginal=body?.querySelector('.coop-proposal-controls:not(#coopDetailPager)');if(controlsOriginal)controlsOriginal.hidden=true;
  let controls=document.getElementById('coopDetailPager');
  if(!controls){
    controls=document.createElement('div');controls.id='coopDetailPager';controls.className='coop-proposal-controls coop-detail-controls';
    const all=coopDetailUiToggle('全デッキ表示',false,()=>{});all.id='coopDetailShowAll';controls.append(all);
    const label=document.createElement('label');label.className='coop-count-control';label.innerHTML='<span>表示件数</span>';
    const select=document.createElement('select');select.id='coopDetailDisplayLimit';select.setAttribute('aria-label','表示件数');label.append(select);controls.append(label);grid.before(controls);
  }
  const all=controls.querySelector('#coopDetailShowAll');all.setAttribute('aria-pressed',String(!!view.showAll));all.querySelector('b').textContent=view.showAll?'ON':'OFF';
  all.onclick=()=>{view.showAll=!view.showAll;coopDetailShowPage().catch(coopDetailViewError)};
  const select=controls.querySelector('#coopDetailDisplayLimit');select.disabled=false;
  const requested=view.displayLimit??10,limit=selected.length?coopFillDisplayLimitSelect(select,10,selected.length,requested):0;
  if(!selected.length){select.innerHTML='<option value="0">0</option>';select.disabled=true;coopSyncStyledSelect(select)}
  select.onchange=()=>{view.displayLimit=Math.max(0,Math.floor(Number(select.value)||0));coopSyncStyledSelect(select);coopDetailShowPage().catch(coopDetailViewError)};
  const data=selected.slice(0,limit);grid.replaceChildren();section.hidden=false;
  const toggle=$('coopProposalToggle');if(toggle){toggle.setAttribute('aria-expanded',String(!body?.hidden));const arrow=toggle.querySelector('.coop-proposal-arrow');if(arrow)arrow.textContent=body?.hidden?'▶':'▼'}
  coopProposalDisplayed=data.map(row=>({ids:row.ids,deck:row.deck||row.ids.map(coopFindCharacter),repeats:view.targetDecks,provisionalSlots:Array(COOP_SLOTS).fill(false)}));coopProposalAll=coopProposalDisplayed.slice();
  for(let i=0;i<coopProposalDisplayed.length;i++){grid.append(coopProposalCard(coopProposalDisplayed[i],i,false));if(i%100===99){await coopYield();if(token!==coopDetailViewToken||view!==coopDetailView)return}}
  if(!data.length){const empty=document.createElement('p');empty.className='coop-detail-empty';empty.textContent='確定撃破デッキはありません';grid.append(empty)}
  const usage=$('coopProposalUsageResults');if(usage)usage.hidden=!view.initialCount;
  const count=$('coopProposalCount');if(count)count.textContent=`確定撃破デッキ ${data.length.toLocaleString()} / ${selected.length.toLocaleString()}件`;
}
function coopDetailViewError(error){const result=$('coopDamageResult');if(result)result.textContent='保存済み結果の読込に失敗しました: '+String(error?.message||error)}
async function coopProposeDetailed(){
  const generation=++coopDetailGeneration;
  coopOverallReset(true);await coopProposalStartClock();coopDetailAssertRun(generation);coopDetailClearView();renderCoopProposalDecks([]);
  const db=await coopDetailOpenDatabase();coopDetailAssertRun(generation);
  // Delete only this tab's previous run; never clear another tab's calculation.
  for(const oldRun of coopDetailRuns)await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(oldRun+':',oldRun+':\uffff')));coopDetailRuns.clear();
  const originalDecks=coopDecks.map(row=>row.slice()),originalVisible=coopVisibleRows,originalDetail=coopDetailMode,originalTarget=coopProposalTargetDecks,originalSecond=coopProposalEnemySecondFixed;
  const targetDecks=Math.max(3,Math.min(5,Number($('coopProposalDeckCount')?.value)||4));
  const run='detail-'+Date.now()+'-'+Math.random().toString(36).slice(2);coopDetailRuns.add(run);
  let initial=null,completed=false;
  coopDetailCalculationActive=true;coopProposalTargetDecks=targetDecks;coopProposalScaleHistory=[];coopProposalRenderScaleHistory();
  try{
    const needs=Array.from({length:COOP_SLOTS},(_,slot)=>coopProposalSlotNeedsCandidate(slot));
    const pools=needs.map((need,slot)=>need?(slot===0?coopProposalFirstCandidatesAll(chars):coopProposalPoolAll(slot)):[null]);
    initial=await coopDetailSearch(db,run+':initial',pools,targetDecks,{label:'詳細計算',readAheadBatches:4,generation});coopDetailAssertRun(generation);
    await coopProposalPostProcessProgress('枠別キャラ使用数を集計中',initial.count,initial.count);const summary={finalItems:{length:0},counts:Array.from({length:COOP_SLOTS},()=>new Map())};
    await coopDetailWalk(db,initial.phase,row=>{coopDetailAssertRun(generation);const ids=row.ids.map(String);coopDetailMergeUsage(summary,[{ids,deck:ids.map(coopFindCharacter)}])});coopDetailAssertRun(generation);
    coopDecks=originalDecks.map(row=>row.slice());coopVisibleRows=originalVisible;coopDetailMode=originalDetail;
    coopDetailUsageSummary=summary;coopRenderProposalUsage([],true);
    coopDetailView={db,run,initial:initial.phase,initialCount:initial.count,targetDecks,showAll:false,displayLimit:10};
    coopDetailView.needs=needs.slice();coopDetailView.normalSettings={limit:coopProposalDisplayLimit,all:coopProposalShowAllDecks};coopProposalRenderToken++;
    const resultBody=$('coopProposalBody');if(resultBody)resultBody.hidden=false;
    await coopProposalPostProcessProgress('提案デッキをソート中',initial.count,initial.count);
    coopDetailAssertRun(generation);await coopDetailShowPage();coopDetailAssertRun(generation);
    coopProposalLastFoundCount=initial.count;coopProposalLastWasExhaustive=true;
    $('coopClearResult').textContent=initial.count?'詳細計算完了':'提案不可';
    $('coopDamageResult').textContent=`確定撃破デッキ${initial.count.toLocaleString()}件`;
    coopOverallProgress.percent=100;completed=true;return initial.count;
  }finally{
    if(generation===coopDetailGeneration){coopDecks=originalDecks;coopVisibleRows=originalVisible;coopDetailMode=originalDetail;coopProposalTargetDecks=completed?targetDecks:originalTarget;coopProposalEnemySecondFixed=originalSecond;coopDetailCalculationActive=false;calculateCoop();coopProposalOrderCache.clear();coopTerminateProposalWorkerPool()}
    if(!completed){coopDetailRuns.delete(run);if(generation===coopDetailGeneration)coopDetailClearView();await coopDetailTransaction(db,store=>store.delete(IDBKeyRange.bound(run+':',run+':\uffff'))).catch(()=>{})}
  }
}
