/* Cooperative proposal worker build 20260915-133 */
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
    for(const name of ['coopProposalWorks','coopProposalOverkillRate','coopCharacterKey'])if(typeof self[name]!=='function')throw new Error('Worker関数の読込失敗: '+name);
    postMessage({type:'ready'});
    const pools=m.pools,first=m.first,confirmed=[];
    const n2=pools[2].length,n3=pools[3].length,n4=pools[4].length,rawTotal=pools[1].length*n2*n3*n4;
    let checked=0,lastReport=performance.now();
    for(let flat=m.workerIndex;flat<rawTotal&&!stopped;flat+=m.workerCount){
      let rest=flat,di=rest%n4;rest=Math.floor(rest/n4);let ci=rest%n3;rest=Math.floor(rest/n3);let bi=rest%n2;let ai=Math.floor(rest/n2);
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
