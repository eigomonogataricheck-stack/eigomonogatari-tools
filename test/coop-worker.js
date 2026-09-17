/* Cooperative proposal worker build 20260917-200 */
let stopped=false;
self.onmessage=e=>{
  const m=e.data||{};
  if(m.type==='cancel'){stopped=true;return}
  if(m.type!=='start')return;
  stopped=false;
  try{
    self.chars=m.chars;self.coopEnemies=m.enemies;self.coopDecks=m.decks;self.coopVisibleRows=m.visibleRows;self.coopDetailMode=!!m.detailMode;self.coopProposalTargetDecks=m.targetDecks;self.coopProposalEnemySecondFixed=!!m.enemySecondFixed;
    self.ATTRS=m.constants.ATTRS;self.MATCH=m.constants.MATCH;
    self.COOP_LAYER_MULTIPLIERS=m.constants.layerMultipliers;self.COOP_DAMAGE_BASE=m.constants.damageBase;
    self.COOP_SLOTS=5;self.COOP_MAX_ROWS=5;self.coopProposalOrderCache=new Map();
    (0,eval)(m.engineSource);
    for(const name of ['canon','norm','conditionAttribute','matches','coopProposalWorks','coopProposalLayerRemainingAttacks','coopProposalPlanRemainingAttacks','coopProposalOverkillRate','coopCharacterKey'])if(typeof self[name]!=='function')throw new Error('Worker関数の読込失敗: '+name);
    postMessage({type:'ready'});
    const candidateTemplates=m.candidateTemplates||[],confirmed=[];
    const rawTotal=candidateTemplates.length;
    let checked=0,lastReport=performance.now();
    for(let flat=m.workerIndex;flat<rawTotal&&!stopped;flat+=m.workerCount){
      const deck=candidateTemplates[flat];
      const repeats=coopProposalWorks(deck,self.coopProposalTargetDecks)?self.coopProposalTargetDecks:0;checked++;
      if(repeats)confirmed.push({ids:coopProposalDeckIds(deck),repeats,overkillRate:coopProposalOverkillRate(deck)});
      const now=performance.now();
      if(checked%500===0||now-lastReport>=250){postMessage({type:'progress',checked,confirmed:confirmed.length});lastReport=now}
    }
    postMessage({type:'done',checked,confirmed});
  }catch(error){postMessage({type:'error',message:String(error&&error.stack||error)})}
};
