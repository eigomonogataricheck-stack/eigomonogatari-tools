/* Cooperative proposal worker build 20260915-129 */
let stopped=false;
self.onmessage=e=>{
  const m=e.data||{};
  if(m.type==='cancel'){stopped=true;return}
  if(m.type!=='start')return;
  stopped=false;
  try{
    self.chars=m.chars;self.coopEnemies=m.enemies;self.coopDecks=m.decks;self.coopVisibleRows=m.visibleRows;
    self.ATTRS=m.constants.ATTRS;self.MATCH=m.constants.MATCH;
    self.COOP_LAYER_MULTIPLIERS=m.constants.layerMultipliers;self.COOP_DAMAGE_BASE=m.constants.damageBase;
    self.COOP_SLOTS=5;self.COOP_MAX_ROWS=5;self.coopProposalOrderCache=new Map();
    (0,eval)(m.engineSource);
    const pools=m.pools,first=m.first,confirmed=[];
    let checked=0,lastReport=performance.now();
    for(let ai=m.aiStart;ai<m.aiEnd&&!stopped;ai++)for(let bi=0;bi<pools[2].length&&!stopped;bi++)for(let ci=0;ci<pools[3].length&&!stopped;ci++)for(let di=0;di<pools[4].length&&!stopped;di++){
      const deck=[first,pools[1][ai],pools[2][bi],pools[3][ci],pools[4][di]],keys=deck.map(coopCharacterKey).filter(Boolean);
      if(new Set(keys).size!==keys.length)continue;
      const repeats=coopProposalWorks(deck,3)?3:(coopProposalWorks(deck,4)?4:0);checked++;
      if(repeats)confirmed.push({ids:coopProposalDeckIds(deck),repeats,overkillRate:coopProposalOverkillRate(deck)});
      const now=performance.now();
      if(checked%500===0||now-lastReport>=250){postMessage({type:'progress',checked,confirmed:confirmed.length});lastReport=now}
    }
    postMessage({type:'done',checked,confirmed});
  }catch(error){postMessage({type:'error',message:String(error&&error.stack||error)})}
};
