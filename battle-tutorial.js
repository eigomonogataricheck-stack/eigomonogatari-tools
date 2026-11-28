/* 対戦の遊び方(完全再現版):
 * - 指定デッキの表示(ConfirmTGEventChallenge) → 対戦画面(ScreenTGEventBattle) を
 *   APK のプレハブ・画像・実機録画座標どおりに再現。
 * - 対戦の計算・スキル・かばう・蘇生・交代・おばけ・狙い抽選はすべて仮想対戦と同じ
 *   Rust WASM エンジン(EigoBattle.Battle)で解く。手書きの簡易計算は使わない。
 * - 自分の狙いはタップするまで未指定(線なし)。味方・敵の狙い線は回答中に順次表示する。
 */
(function(){
'use strict';
const V='20261128-tg17';
const IMG=n=>`tg/${n}.webp?v=${V}`;
const ICON=id=>`https://englishstoryserver.com/Icon/Icon/Icon${id}.png`;
const CARD=id=>`https://englishstoryserver.com/Card/Card${id}.png`;
const GRAD_MAP={purple:'Gradients512_5',green:'Gradients512_2',gold:'Gradients512_0',blue:'Gradients512_4',red:'Gradients512_7'};
const timers=new Set();
const after=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn()},ms);timers.add(t);return t};
const wait=ms=>new Promise(r=>after(r,ms));
const ATTR_IX={火:1,水:2,風:3,火水:4,水風:5,風火:6,全:7};
const BADGE={N:'normal',R:'rare',CR:'cho_rare',ZR:'chozetsu_rare',伝:'densetsu',MZR:'monzetsu_rare'};
const QUESTION_SEC=30,FAST_SEC=7.5;
const TITLE='英語の意味を選びなさい。';
const MISTAKE='残念！与えるダメージは半分になるけど、<br>もう一度答える事ができるよ！';
const DECK_MAX_COST=250;

const QUIZ=[
 ['apple','りんご','いぬ','本','くつ',['dog','book','shoe']],
 ['water','水','火','木','花',['fire','tree','flower']],
 ['red','赤い','青い','白い','黒い',['blue','white','black']],
 ['school','学校','公園','駅','家',['park','station','house']],
 ['sun','太陽','月','星','雲',['moon','star','cloud']],
 ['book','本','机','ペン','かばん',['desk','pen','bag']]
];

/* APK metadata[6871] (TGEVENT_CHAT_A / 対戦中) 36個を A/B/C 各12個で表示 */
const CHAT_PAGES={
 A:['Help!','Let\'s go!','Eiigo!','Thanks!','It\'s OK!','Sorry!','Nice!','GoodJob!','Cool!','I love it!','Nice try!','All is well!'],
 B:['Skill!','Wait!','Target!','Faster','Slower','To','1','2','3','4','5','Please♡'],
 C:['にゃ～','わん!','がお～!','まだ行ける!','ありがと!','٩( \'ω\' )و','♪(´▽｀)','(｡･∀･)ﾉﾞ','(>_<)','ヾ(•ω•`)o','(*-ω人)','o((>ω< ))o']
};
const CHAT_SMALL=new Set(['GoodJob!','All is well!','まだ行ける!','ヾ(•ω•`)o','o((>ω< ))o']);

/* 第2部「そのほか」一覧(自然で分かりやすい日本語。事実を変えない・足さない) */
const OTHER_SKILLS=[
 {img:'SkillDefenseUp1',name:'シールド',desc:'受けるダメージを減らします。'},
 {img:'SkillHP',name:'回復',desc:'体力を戻します。'},
 {txt:'短',name:'短縮',desc:'味方がスキルを早く使えるようになります。タップした瞬間に効きます。'},
 {txt:'遅',name:'遅延',desc:'相手がスキルを使えるようになるのを遅らせます。'},
 {img:'hen_1',name:'色変',desc:'属性を変えます。'},
 {txt:'躱',name:'かわす',desc:'相手の攻撃をリーダー1体に集めます。'}
];

/* 自分のデッキ(完全指定): 伝1(2190)、合計コスト 80+41+41+39+40 = 241 <= 250 */
const DEFAULT_MY_DECK=[2190,1420,1739,1470,535];

/* 味方4人・相手5人のデッキ(すべて 伝<=1・重複なし・合計コスト<=250・zukan_beta.json 実在ID) */
const NPC_DECKS={
 A1:[1739,1638,1861,1792,1761], // 伝0, cost 237
 A2:[1520,1525,2013,2134,1470], // 伝0, cost 225
 A4:[2053,2249,2054,2073,1638], // 伝1, cost 250
 A5:[2007,1470,2122,535,1327],  // 伝1, cost 241
 B1:[535,1327,2122,1863,1008],  // 伝0, cost 190
 B2:[1729,1922,150,2164,740],   // 伝0, cost 214
 B3:[740,1008,2122,535,1729],   // 伝0, cost 188
 B4:[2122,1863,535,1327,2164],  // 伝0, cost 195
 B5:[150,2164,1729,1922,1008]   // 伝0, cost 204
};

const NAMES={A1:'なかま1',A2:'なかま2',A3:'あなた',A4:'なかま3',A5:'なかま4',B1:'あいて1',B2:'あいて2',B3:'あいて3',B4:'あいて4',B5:'あいて5'};
const RANKS={A1:'Rank S+',A2:'Rank S',A3:'Rank A+',A4:'Rank A',A5:'Rank A-',B1:'Rank S+',B2:'Rank S',B3:'Rank A+',B4:'Rank A',B5:'Rank A-'};
const PIDS_A=['A1','A2','A3','A4','A5'];
const PIDS_B=['B1','B2','B3','B4','B5'];
const ALL_PIDS=[...PIDS_A,...PIDS_B];

/* 実演・検証ログ(tg_check6 証拠出力用) */
const LOG={decks:{},turns:[],texts:[]};
window.__TG_LOG__=LOG;
function recText(scene,text){
 LOG.texts.push({scene,text});
}

let root,stage,stageWrap,S,waiters=[],runId=0,fxReady=null,engineReady=null,lineAnimId=0;
let ROSTER=[],BYID=new Map();

function clearAll(){
 runId++;lineAnimId++;waiters=[];
 for(const t of timers)clearTimeout(t);timers.clear();
 if(S&&S.battle){try{S.battle.free()}catch(e){}S.battle=null}
 if(window.EFX&&typeof EFX.clear==='function')EFX.clear();
}
const $=s=>stage.querySelector(s);
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e};
function img(name,x,y,w,h,cls){const e=el('img','tg-sp'+(cls?' '+cls:''));e.src=IMG(name);e.alt='';e.draggable=false;e.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;return e}
const txt=(cls,html,x,y)=>{const e=el('div','tg-tx '+cls,html);e.style.left=x+'px';e.style.top=y+'px';return e};

/* ---------- エンジン(Rust WASM) & 図鑑の読込 ---------- */
async function ensureEngine(){
 if(engineReady)return engineReady;
 engineReady=(async()=>{
  // app.js の loadData() で chars が入るのを待つ
  for(let i=0;i<150&&!(typeof chars!=='undefined'&&chars.length);i++)await new Promise(r=>setTimeout(r,100));
  if(typeof chars==='undefined'||!chars.length){
   const r=await fetch('zukan_beta.json',{cache:'no-cache'}).then(x=>x.json());
   window._tgChars=Array.isArray(r)?r:(r.characters||[]);
  }
  const srcChars=(typeof chars!=='undefined'&&chars.length)?chars:(window._tgChars||[]);
  if(!window.zukanToRoster){
   if(typeof loadScriptOnce==='function')await loadScriptOnce('battle-roster.js?v=20261121-ai8');
  }
  ROSTER=window.zukanToRoster({characters:srcChars});
  BYID=new Map(ROSTER.map(c=>[c.id,c]));
  if(!window.EigoBattle){
   if(typeof loadBattleWasm==='function')await loadBattleWasm('20261127-wasm1');
   else{
    await new Promise((ok,ng)=>{const s=document.createElement('script');s.src='wasm/bridge.js?v=20261127-wasm1';s.onload=ok;s.onerror=ng;document.head.append(s)});
    const wm=await import('./wasm/rsim_wasm.js?v=20261127-wasm1');
    const res=await fetch(new URL('wasm/rsim_wasm_bg.wasm?v=20261127-wasm1',location.href));
    await wm.default({module_or_path:res});
    wm.warm_policy();
    const br=window.EigoWasmBridge.createBridge(wm);
    window.EigoBattle=br.EigoBattle;window.EigoBrain=br.EigoBrain;
   }
  }
  return true;
 })();
 return engineReady;
}
function fx(){
 if(!fxReady)fxReady=(async()=>{
  try{
   if(typeof loadScriptOnce==='function'){
    await loadScriptOnce('battle-fxdata.js?v=20261121-ai8');
    await loadScriptOnce('battle-fx.js?v=20261128-tg6');
   }
  }catch(e){}
  return !!(window.EFX&&EFX.ok());
 })();
 return fxReady;
}

/* ---------- 図鑑データ → エンジン用スペック ---------- */
function specOf(id){
 const c=BYID.get(id);
 if(!c)throw new Error('図鑑にキャラが見つかりません: '+id);
 return{
  id:c.id,name:c.n,attrs:c.attrs.slice(),cost:c.cost,
  hp:c.hp,power:c.pw,limit_hp:c.lhp??null,limit_power:c.lpw??null,
  skill:c.sk?JSON.parse(JSON.stringify(c.sk)):null,
  limit_break:true,theme:false
 };
}
function attrStrOf(attrs){
 const s=new Set(attrs||[]);
 if(s.size>=3)return '全';
 if(s.size===2){
  if(s.has('火')&&s.has('水'))return '火水';
  if(s.has('水')&&s.has('風'))return '水風';
  return '風火';
 }
 return (attrs&&attrs[0])||'火';
}
function deckCost(ids){return ids.reduce((s,id)=>s+(BYID.get(id)?.cost||0),0)}
function deckLegendCount(ids){return ids.filter(id=>BYID.get(id)?.r==='伝').length}
/* ---------- エンジン状態 → 表示用スナップショット ---------- */
function effIcon(kind,data){
 const vs=data&&data.vs_attr;
 if(kind==='atk_up')return vs==='火'?'SkillAttackUp1':vs==='水'?'SkillAttackUp2':vs==='風'?'SkillAttackUp3':'SkillAttackUpAll';
 if(kind==='multi_attack')return 'SkillAttackSerial';
 if(kind==='all_attack')return 'SkillAttackToAll';
 if(kind==='shield'||kind==='def_up')return vs?'SkillDefenseUp1':'SkillDefenseUpAll';
 if(kind==='cover')return 'SkillProtect';
 if(kind==='heal'||kind==='regen')return 'SkillHP';
 if(kind==='color_change')return 'hen_1';
 return null;
}
function skillWord(kind){
 return{atk_up:'攻撃',multi_attack:'連続',all_attack:'全体',shield:'防御',def_up:'防御',cover:'かばう',heal:'回復',revive:'蘇生',color_change:'変化',shorten:'短縮',delay:'遅延'}[kind]||'スキル';
}
function skillGrad(kind){
 if(kind==='multi_attack'||kind==='all_attack')return 'red';
 if(kind==='cover'||kind==='shield'||kind==='def_up')return 'blue';
 if(kind==='revive'||kind==='heal')return 'gold';
 if(kind==='shorten'||kind==='color_change')return 'green';
 return 'purple';
}

function buildViewFromBattle(b){
 const view={A:[],B:[]};
 for(const tid of ['A','B']){
  const tm=b.teams[tid];
  for(const p of tm.players){
   const ac=p.active_char;
   const rinfo=ac?BYID.get(ac.cid):null;
   const effAttrs=ac&&!p.ghost?b.effective_attrs(ac):['火'];
   const buffs=[];
   if(ac&&!p.ghost){
    for(const ef of tm.effects){
     if(ef.remaining<=0)continue;
     if(!b._applies(ef,ac,true))continue;
     const ic=effIcon(ef.kind,ef.data);
     if(ic&&!buffs.some(x=>x.img===ic))buffs.push({img:ic,left:ef.remaining,justOn:false});
    }
   }
   const aliveLeft=p.ghost?0:p.deck.filter(c=>c.alive).length;
   const sk=ac&&!p.ghost?{
    need:ac.skill_turn,
    count:ac.count,
    uses:ac.uses,
    noSkill:!ac.skill||ac.uses>=b.rules.max_skill_uses,
    on:false,
    waiting:false,
    usedThisTurn:ac.used_now,
    kind:ac.skill&&ac.skill.effects&&ac.skill.effects[0]?ac.skill.effects[0].type:'normal'
   }:{need:0,count:0,uses:2,noSkill:true,on:false,waiting:false,usedThisTurn:false,kind:'normal'};
   view[tid].push({
    id:p.id,team:tid,me:p.id==='A3',
    ghost:p.ghost,
    left:aliveLeft,gone:false,
    raised:ac?!!ac.revived_used:false,
    cur:ac?{
     id:ac.cid,name:ac.name,attr:attrStrOf(effAttrs),attrs:effAttrs.slice(),
     rare:(rinfo&&rinfo.r)||'MZR',hp:ac.hp,max:ac.max_hp,pw:ac.power,
     turn:ac.skill_turn,skillDesc:(ac.skill&&ac.skill.name)||''
    }:{id:150,name:'おばけ',attr:'水',attrs:['水'],rare:'ZR',hp:0,max:1,pw:1000,turn:0,skillDesc:''},
    deckIds:p.deck.map(c=>c.cid),
    answer:null,
    prio:'normal',
    target:null,
    skill:sk,
    buffs
   });
  }
 }
 return view;
}

function initBattleState(decksMap,rulesOpt,sceneTag){
 if(S&&S.battle){try{S.battle.free()}catch(e){}}
 // 全デッキの検証ログを記録
 const deckCheck={};
 for(const pid of ALL_PIDS){
  const ids=decksMap[pid];
  const leg=deckLegendCount(ids),cost=deckCost(ids),uniq=new Set(ids).size;
  deckCheck[pid]={ids:ids.slice(),cost,legends:leg,unique:uniq,valid:ids.length===5&&uniq===5&&leg<=1&&cost<=DECK_MAX_COST};
 }
 if(sceneTag)LOG.decks[sceneTag]=deckCheck;

 const mkTeam=pids=>({
  players:pids.map(pid=>({
   id:pid,name:NAMES[pid],level:'難関大学',self_mode:true,cpu:false,
   deck:decksMap[pid].map(specOf)
  }))
 });
 const battle=new window.EigoBattle.Battle({
  rules:{seed:20261128,max_turns:40,damage_rand:[0.96,1.04],count_step:1,...(rulesOpt||{})},
  teams:{A:mkTeam(PIDS_A),B:mkTeam(PIDS_B)}
 });
 const v=buildViewFromBattle(battle);
 S={
  battle,q:0,phase:'intro',prio:'normal',finished:false,
  showYou:true,showLines:false,isAtkLayout:false,
  canTarget:false,canSkill:false,lockPrio:true,canChat:true,chatPage:'B',pauseTime:false,
  A:v.A,B:v.B
 };
}

function syncFromBattle(keepTargets=false){
 const prevTargets=keepTargets?Object.fromEntries([...S.A,...S.B].map(p=>[p.id,p.target])):{};
 const v=buildViewFromBattle(S.battle);
 S.A=v.A;S.B=v.B;
 if(keepTargets){for(const p of [...S.A,...S.B])p.target=prevTargets[p.id]||null}
}

const me=()=>S.A[2];
const player=id=>[...S.A,...S.B].find(p=>p.id===id);
function setChap(tag,title){
 const c=$('.tg-chap');
 if(c){
  if(!tag&&!title){c.hidden=true;c.innerHTML=''}
  else{c.hidden=false;c.innerHTML=`<em>${tag}</em>${title}`}
 }
 if(stage)stage.dataset.chap=tag||'';
}

/* ---------- 画面の土台(録画 t41/t48 の実測座標に一致) ---------- */
const ROW={A:{x:60,y:288,s:1},B:{x:120,y:92,s:.8}};
const ROW_ATK={A:{x:60,y:534,s:1},B:{x:60,y:134,s:1}};
function build(){
 root.innerHTML=`<div class="tg-layout"><div class="tg-stagewrap"><div class="tg-stage" aria-label="対戦画面"></div></div></div>`;
 stageWrap=root.querySelector('.tg-stagewrap');
 stage=root.querySelector('.tg-stage');
 stage.append(img('ScreenBattleBack',0,0,720,1280,'tg-bg'));
 stage.append(img('GageQuestionTimeNormal',0,0,720,10,'tg-egage'));
 const q=el('div','tg-q');
 q.append(img('PartBattleQuizeQuestionBack',0,419.4,720,320.6));
 q.append(txt('tg-qtitle','',360,450));q.append(txt('tg-qword','',360,590));
 q.append(img('mondai_fire0-min',10.6,671.8,48,54));
 q.append(img('AudioButtonOn',640,427,72,45));
 q.append(img('GageQuestionTimeNormal',72,720,578,20,'tg-gn'));
 q.append(img('GageQuestionTimeSpeedy',505.5,720,144.5,20,'tg-gs'));
 q.append(img('gageQuestionTimeBack',650,720,0,20,'tg-gc'));
 q.append(el('div','tg-banner'));
 stage.append(q);
 stage.append(img('PopUpCommonBack720480',0,740,720.7,480,'tg-popback'));
 const sel=el('div','tg-sels');
 [771,882,993,1104].forEach((top,k)=>{
  const b=el('button','tg-sel');b.type='button';b.dataset.k=k;b.style.top=top+'px';b.hidden=true;b.disabled=true;
  b.append(img('PartBattleQuizeSelectionButton',0,0,722.8,96,'tg-selbg'));
  b.append(img('SelectionNo'+(k+1),25,6,95,90));
  b.append(el('span','tg-seljp'));b.append(el('span','tg-selen'));b.append(el('span','tg-selmiss',MISTAKE));
  b.append(img('ResultMarkCircle',607,12.5,66,67,'tg-mk tg-mk-ok'));b.append(img('ResultMarkMiss',611,16,58,60,'tg-mk tg-mk-ng'));
  sel.append(b)});
 stage.append(sel);
 stage.append(el('svg','tg-lines'));$('.tg-lines').outerHTML='<svg class="tg-lines" viewBox="0 0 720 1280" aria-hidden="true"></svg>';
 stage.append(el('div','tg-rows'));
 stage.append(img('kaitou',177.2,688.8,365.6,82.4,'tg-kaitou'));
 const bar=el('div','tg-bar');
 bar.append(img('ritaia',13.5,1225.5,93,49,'tg-retire'));
 const tb=el('div','tg-turn');tb.hidden=true;
 tb.append(txt('tg-turnlabel','攻撃<br>順番',131.1,1251));
 [['priority','優先','ButtonBlueWithGoldFrame60',225],['normal','回答','ButtonGreenWithGoldFrame60',314],['delay','劣後','ButtonWineRedWithGoldFrame60',404.4]].forEach(([k,t,s,x])=>{
  const b=el('button','tg-prio');b.type='button';b.dataset.prio=k;b.style.cssText=`left:${x-45}px;top:1220px`;
  b.append(img(s,0,0,90,60));b.append(txt('tg-priotx',t,45,30));tb.append(b)});
 bar.append(tb);
 const cb=el('button','tg-chatbtn');cb.type='button';cb.dataset.act='chatopen';cb.setAttribute('aria-label','チャット');
 cb.append(img('ButtonLightGreen60',0,0,144,60));
 cb.append(img('hukidashi',43,7,58,46));
 bar.append(cb);
 stage.append(bar);
 stage.append(el('div','tg-fx'));
 stage.append(el('div','tg-cut'));
 stage.append(el('div','tg-modal'));
 stage.append(el('div','tg-guide'));
 stage.append(el('div','tg-chap'));
 stage.addEventListener('click',onClick);
 fit();
}
function fit(){const w=root.querySelector('.tg-stagewrap');if(!w)return;const s=w.clientWidth/720;w.style.height=1280*s+'px';stage.style.transform=`scale(${s})`}

/* ---------- 指定デッキの表示 → 対戦開始(ConfirmTGEventChallenge) ---------- */
function miniIconHTML(cid,size=104){
 const c=BYID.get(cid);
 const ix=ATTR_IX[attrStrOf(c.attrs)]||1;
 const bw=Math.round(size*0.54),bh=Math.round(size*0.25);
 return `<img class="tg-sp" src="${IMG('miniback'+ix)}" alt="" style="left:0;top:0;width:${size}px;height:${size}px">
  <img class="tg-sp" src="${ICON(c.id)}" alt="${c.n}" style="left:0;top:0;width:${size}px;height:${size}px" onerror="this.style.visibility='hidden'">
  <img class="tg-sp" src="${IMG('miniwaku'+ix)}" alt="" style="left:0;top:0;width:${size}px;height:${size}px">
  <img class="tg-sp" src="${IMG('badge_'+(BADGE[c.r]||'rare')+'_small')}" alt="" style="left:${size-bw}px;top:${size-bh-2}px;width:${bw}px;height:${bh}px">`;
}
async function showDeckConfirm(deck){
 const cf=el('div','tg-confirm');
 cf.innerHTML=`<img class="tg-sp" src="${IMG('ScreenBattleBack')}" alt="" style="left:0;top:0;width:720px;height:1280px">
  <div class="tg-cf-win">
   <div class="tg-cf-head">対戦イベント 出撃確認</div>
   <div class="tg-cf-note">◆デッキの左端のキャラから順番に１体ずつバトルに参加します。リーダー(助っ人)スキルは無効です!</div>
   <div class="tg-cf-meta"><span>参加デッキ（5体）</span><b>デッキコスト ${deckCost(deck)} / ${DECK_MAX_COST}</b></div>
   <div class="tg-cf-row">${deck.map((cid,i)=>`<div class="tg-cf-slot">${miniIconHTML(cid,112)}<span class="tg-de-slot-num">${i+1}</span></div>`).join('')}</div>
   <div class="tg-cf-btns">
    <button class="tg-cf-btn" type="button" data-act="cfgo"><img class="tg-sp" src="${IMG('ButtonBlueWithGoldFrame60')}" alt=""><span class="tg-tx">対戦開始</span></button>
   </div>
  </div>`;
 stage.append(cf);
 await waitEvent(e=>e.type==='cfgo');
 cf.remove();
}

/* ---------- 開始前のVS画面 ---------- */
function vsCardHTML(p){
 const c=p.cur,ix=ATTR_IX[c.attr]||1;
 return `<div class="tg-vs-row tg-vs-row-${p.team}">
  <div class="tg-vs-ico">
   <img class="tg-sp" src="${IMG('miniback'+ix)}" alt="" style="left:0;top:0;width:104px;height:104px">
   <img class="tg-sp" src="${ICON(c.id)}" alt="${c.name}" style="left:0;top:0;width:104px;height:104px" onerror="this.style.visibility='hidden'">
   <img class="tg-sp" src="${IMG('miniwaku'+ix)}" alt="" style="left:0;top:0;width:104px;height:104px">
   <img class="tg-sp" src="${IMG('badge_'+(BADGE[c.rare]||'rare')+'_small')}" alt="" style="left:48px;top:76px;width:56px;height:26px">
  </div>
  <div class="tg-vs-info"><div class="tg-vs-name">${NAMES[p.id]}</div><div class="tg-vs-rank">${RANKS[p.id]}</div></div>
 </div>`;
}
async function showVsScreen(){
 const id=runId;
 const vs=el('div','tg-vs');
 vs.innerHTML=`<img class="tg-sp" src="${IMG('ScreenBattleBack')}" alt="" style="left:0;top:0;width:720px;height:1280px">
  <div class="tg-vs-head"><span class="tg-vs-team">Team A</span><span class="tg-vs-mid">VS</span><span class="tg-vs-team">Team B</span></div>
  <div class="tg-vs-grid">
   <div class="tg-vs-col">${S.A.map(vsCardHTML).join('')}</div>
   <div class="tg-vs-col">${S.B.map(vsCardHTML).join('')}</div>
  </div>
  <div class="tg-vs-wait">開始まで後3秒</div>`;
 stage.append(vs);
 await guide('これは英語の問題に答えて戦うゲームです。5人対5人のチーム戦です。',{at:'bottom',dim:false,scene:'p1_01_vs'});
 if(id!==runId){vs.remove();return}
 for(const sec of [2,1]){
  vs.querySelector('.tg-vs-wait').textContent=`開始まで後${sec}秒`;
  await wait(240);
  if(id!==runId){vs.remove();return}
 }
 vs.remove();
}

/* ---------- キャラのカード ---------- */
function cardHTML(p){
 if(p.gone)return `<div class="tg-tx tg-left">あと<em>${p.left}</em></div><div class="tg-coin"></div><div class="tg-talk"></div>`;
 const c=p.cur,ix=ATTR_IX[c.attr]||1,dead=p.ghost||c.hp<=0;
 const baseW=p.ghost?0:Math.max(0,Math.min(1,c.hp/Math.max(1,c.max))*118);
 const exW=p.ghost||c.hp<=c.max?0:Math.max(0,Math.min(1,(c.hp-c.max)/Math.max(1,c.max))*118);
 return `<div class="tg-light"></div>
 <img class="tg-sp" src="${IMG('miniback'+ix)}" alt="" style="left:0;top:0;width:120px;height:120px">
 ${p.ghost?'':`<img class="tg-sp tg-icon" src="${ICON(c.id)}" alt="${c.name}" style="left:0;top:0;width:120px;height:120px" onerror="this.style.visibility='hidden'">`}
 <img class="tg-sp" src="${IMG('miniwaku'+ix)}" alt="" style="left:0;top:0;width:120px;height:120px">
 <img class="tg-sp" src="${IMG('badge_'+(BADGE[c.rare]||'rare')+'_small')}" alt="" style="left:56px;top:89px;width:64px;height:30px">
 ${p.ghost?`<img class="tg-sp" src="${IMG('Obake')}" alt="" style="left:0;top:0;width:120px;height:120px">`:dead?`<img class="tg-sp" src="${IMG('IconDie')}" alt="" style="left:0;top:0;width:120px;height:120px">`:''}
 <img class="tg-sp" src="${IMG('PartBattleIconGageFrame')}" alt="" style="left:0;top:120px;width:120px;height:10px">
 <img class="tg-sp tg-hp" src="${IMG('GageAllyHp')}" alt="" style="left:1px;top:121px;width:${baseW}px;height:8px">
 <img class="tg-sp tg-hp-ex" src="${IMG('HpExtraGage')}" alt="" style="left:1px;top:121px;width:${exW}px;height:8px">
 ${p.me&&S.showYou?`<img class="tg-sp tg-you" src="${IMG('you')}" alt="YOU" style="left:11.6px;top:-42px;width:96.8px;height:25.6px">`:''}
 <div class="tg-tx tg-left">あと${p.ghost?'<em>0</em>':p.left}</div>
 ${p.raised&&!p.ghost?`<img class="tg-sp tg-ank" src="${IMG('ank')}" alt="蘇生済" style="left:68px;top:-28px;width:24px;height:24px">`:''}
 ${p.ghost?'':skillHTML(p)}
 <div class="tg-coin"></div><div class="tg-talk"></div>`;
}
const BUFF_MS=1000;
const buffTick=()=>Math.floor(Date.now()/BUFF_MS);
setInterval(()=>{
 if(!stage)return;
 stage.querySelectorAll('.tg-card').forEach(c=>{const l=c.querySelectorAll('.tg-bf');if(l.length<2)return;const on=buffTick()%l.length;l.forEach((e,i)=>e.hidden=i!==on)});
},200);
function skillHTML(p){
 const k=p.skill;
 let h='';
 const bf=(p.buffs||[]).filter(b=>b.left>0),on=bf.length?buffTick()%bf.length:0;
 bf.forEach((b,idx)=>{
  h+=`<div class="tg-bf"${idx===on?'':' hidden'}><img class="tg-sp tg-buff${b.justOn?' tg-buff-pop':''}" src="${IMG(b.img)}" alt="" style="left:0;top:75px;width:45px;height:45px"><img class="tg-sp" src="${IMG(b.left>9?'SkillTime9plus':'SkillTime'+b.left)}" alt="" style="left:25px;top:90px;width:30px;height:30px"></div>`;
 });
 if(k.waiting){
  h+=`<div class="tg-wait"><img class="tg-sp" src="${IMG('CountBg')}" alt="" style="left:0;top:0;width:42.4px;height:42.4px"><img class="tg-sp" src="${IMG('waku')}" alt="" style="left:0;top:0;width:42.4px;height:42.4px"><img class="tg-sp tg-waitspin" src="${IMG('guruguru')}" alt="" style="left:8px;top:8px;width:26.4px;height:26.4px"></div>`;
 }else if(k.on){
  h+=`<div class="tg-fire is-on"><img class="tg-sp" src="${IMG('CountBg')}" alt="" style="left:0;top:0;width:62px;height:62px"><img class="tg-sp" src="${IMG('waku')}" alt="" style="left:0;top:0;width:62px;height:62px"><img class="tg-sp" src="${IMG('bikkuri')}" alt="" style="left:24.5px;top:10px;width:13px;height:42px"><div class="tg-firecnt"><img class="tg-sp tg-firecnt-bg" src="${IMG('CountBg')}" alt="" style="left:0;top:0;width:28px;height:28px"><img class="tg-sp" src="${IMG('waku')}" alt="" style="left:0;top:0;width:28px;height:28px"><span class="tg-tx tg-cntnum is-zero">${k.count}</span></div></div>`;
 }else if(!k.noSkill&&!k.usedThisTurn){
  const z=k.count<=0,rdy=p.me&&z;
  h+=`<div class="tg-cnt${rdy?' tg-ready':''}"><img class="tg-sp" src="${IMG('CountBg')}" alt="" style="left:0;top:0;width:42.4px;height:42.4px"><img class="tg-sp" src="${IMG('waku')}" alt="" style="left:0;top:0;width:42.4px;height:42.4px"><span class="tg-tx tg-cntnum${z?' is-zero':''}">${k.count}</span></div>`;
 }
 return h;
}
function renderRows(atk,popCoinId){
 if(typeof atk==='boolean')S.isAtkLayout=atk;
 else atk=S.isAtkLayout;
 const rows=$('.tg-rows');rows.innerHTML='';
 for(const t of ['B','A']){
  const L=(atk?ROW_ATK:ROW)[t];
  S[t].forEach((p,i)=>{
   const d=el('div','tg-card tg-card-'+t,cardHTML(p));d.dataset.pid=p.id;
   d.style.transform=`translate(${L.x+i*120*L.s}px,${L.y}px) scale(${L.s})`;
   if(p.me)d.classList.add('is-me');
   if(p.prio==='priority')d.classList.add('prio-first');
   else if(p.prio==='delay')d.classList.add('prio-last');
   if(p.skill&&p.skill.on)d.classList.add('is-skill-on');
   if(p.answer!=null&&(S.phase==='answer'||S.phase==='coin')){
    const cy=p.team==='A'?-72:132;
    d.querySelector('.tg-coin').innerHTML=`<img class="tg-sp${popCoinId===p.id?' tg-coin-pop':''}" src="${IMG('ans_'+(p.answer+1)+'_on')}" alt="" style="left:28.4px;top:${cy}px;width:63.2px;height:64px">`;
   }
   rows.append(d)});
 }
 for(const p of [...S.A,...S.B])for(const b of p.buffs)if(b.justOn)b.justOn=false;
 drawLines(atk?1:0);
}
function moveRows(atk){
 S.isAtkLayout=!!atk;
 for(const t of ['B','A']){const L=(atk?ROW_ATK:ROW)[t];S[t].forEach((p,i)=>{const d=stage.querySelector(`[data-pid="${p.id}"]`);if(d)d.style.transform=`translate(${L.x+i*120*L.s}px,${L.y}px) scale(${L.s})`})}
 const aid=++lineAnimId,t0=performance.now(),from=atk?0:1,to=atk?1:0;
 const step=now=>{
  if(aid!==lineAnimId)return;
  const u=Math.min(1,(now-t0)/500),e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
  drawLines(from+(to-from)*e);
  if(u<1)requestAnimationFrame(step);
 };
 requestAnimationFrame(step);
}
function rowLayout(t,k){const a=ROW[t],b=ROW_ATK[t];return{x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,s:a.s+(b.s-a.s)*k}}
function cardBox(id,atk){const p=player(id),k=typeof atk==='number'?atk:(atk===undefined?S.isAtkLayout:atk)?1:0,L=rowLayout(p.team,k),i=S[p.team].indexOf(p);return{x:L.x+i*120*L.s,y:L.y,w:120*L.s}}
function drawLines(atk){
 const svg=$('.tg-lines');if(!svg)return;let h='';
 const kAtk=typeof atk==='number'?atk:(atk===undefined?S.isAtkLayout:atk)?1:0;
 const isAtk=S.phase==='attack';
 const quad=(ax,ay,bx,by,w0,w1,cls)=>{
  const dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
  return `<polygon class="${cls}" points="${ax+nx*w0},${ay+ny*w0} ${ax-nx*w0},${ay-ny*w0} ${bx-nx*w1},${by-ny*w1} ${bx+nx*w1},${by+ny*w1}"/>`;
 };
 if(S.showLines){
  for(const p of [...S.A,...S.B]){
   if(!p.target||p.gone)continue;
   const t=player(p.target);if(!t||t.gone)continue;
   const a=cardBox(p.id,kAtk),b=cardBox(t.id,kAtk),k=a.w/120;
   const ax=a.x+60*k,ay=p.team==='A'?a.y+5*k:a.y+125*k,bx=b.x+b.w/2,by=b.y+b.w/2;
   h+=quad(ax,ay,bx,by,isAtk?11:9,isAtk?4:2.5,'tg-ln'+(p.team==='B'?' tg-ln-b':'')+(isAtk?' tg-ln-atk':''));
  }
 }
 svg.innerHTML=h;
}
function talk(id,text,ms=1500){
 const card=stage.querySelector(`[data-pid="${id}"]`);
 const d=card&&card.querySelector('.tg-talk');if(!d)return;
 d.innerHTML=`<img class="tg-sp" src="${IMG('talk')}" alt="" style="left:-49.5px;top:-46px;width:137px;height:86px;transform:scaleY(-1)"><span class="tg-tx">${text}</span>`;
 d.classList.remove('is-on');void d.offsetWidth;d.classList.add('is-on');
 card.classList.add('has-talk');
 if(d._t){clearTimeout(d._t);timers.delete(d._t)}
 d._t=after(()=>{d.classList.remove('is-on');card.classList.remove('has-talk')},ms);
}

/* ---------- 説明枠(EffectTutorial) ---------- */
async function guide(text,o={}){
 recText(o.scene||(stage&&stage.dataset.chap)||'guide',text);
 const g=$('.tg-guide');
 const cy=o.at==='top'?170:o.at==='mid'?600:1090;
 const ty=cy-14,oy=cy+151,ny=cy+85;
 const f=o.finger;
 g.innerHTML=`${o.spot?`<div class="tg-spot" style="left:${o.spot[0]}px;top:${o.spot[1]}px;width:${o.spot[2]}px;height:${o.spot[3]}px"></div>`:o.dim===false?'':'<div class="tg-dim"></div>'}
 <div class="tg-gbox"><img class="tg-sp" src="${IMG('TutorialBack')}" alt="" style="left:9.3px;top:${cy-161.45}px;width:701.4px;height:322.9px">
  <img class="tg-sp tg-oko" src="${IMG('Oko01')}" alt="" style="left:54px;top:${Math.min(1261,oy)-51.75}px;width:108px;height:103.5px">
  <div class="tg-gtext" style="top:${ty}px"><span>${text}</span></div>${o.tap!==false?`<img class="tg-sp tg-next" src="${IMG('messagepoint')}" alt="" style="left:329.5px;top:${ny-24}px;width:51px;height:48px">`:''}</div>
 ${f?`<img class="tg-sp tg-finger" src="${IMG('TutorialFinger')}" alt="" style="left:${f[0]-112}px;top:${f[1]-52}px;width:112px;height:104px;rotate:${f[2]||0}deg">`:''}`;
 g.className='tg-guide is-on'+(o.tap!==false?' is-tap':'');
 if(o.tap!==false){await waitEvent(e=>e.type==='tap');g.className='tg-guide';g.innerHTML=''}
}
function guideOff(){const g=$('.tg-guide');g.className='tg-guide';g.innerHTML=''}

/* ---------- イベント ---------- */
function waitEvent(fn){return new Promise(r=>waiters.push(ev=>{const v=fn(ev);if(v){r(v===true?ev:v);return true}return false}))}
function dispatch(ev){waiters=waiters.filter(w=>!w(ev))}
function onClick(e){
 if(e.target.closest('.tg-guide.is-tap')){dispatch({type:'tap'});return}
 const b=e.target.closest('[data-act]');
 if(b){
  const act=b.dataset.act,mod=$('.tg-modal');
  if(act==='chatopen'){
   if(!S.canChat)return;
   if(mod.querySelector('.tg-cmt'))mod.innerHTML='';else renderChatModal(S.chatPage);
  }else if(act==='chatpage'){
   const order=['A','B','C'],v=b.dataset.val,i=order.indexOf(S.chatPage);
   S.chatPage=v==='prev'?order[(i+2)%3]:v==='next'?order[(i+1)%3]:v;
   renderChatModal(S.chatPage);
  }else if(act==='chatsend'){mod.innerHTML='';talk('A3',b.dataset.val,1800)}
  dispatch({type:b.dataset.act,val:b.dataset.val||''});
  return;
 }
 const s=e.target.closest('.tg-sel');if(s&&!s.disabled){dispatch({type:'choice',k:+s.dataset.k});return}
 const pr=e.target.closest('.tg-prio');
 if(pr&&!S.lockPrio){S.prio=me().prio=pr.dataset.prio;syncPrio();renderRows();dispatch({type:'prio',v:S.prio});return}
 const c=e.target.closest('.tg-card');
 if(c){
  const p=player(c.dataset.pid);if(!p)return;
  if(p.team==='B'&&!p.ghost&&S.canTarget){
   // 同じ相手をもう一度タップすると狙い解除、別の相手なら指定
   me().target=me().target===p.id?null:p.id;
   S.showLines=true;
   renderRows();
   dispatch({type:'target',id:me().target});
   return;
  }
  if(p.me&&S.canSkill&&!p.ghost&&!p.skill.noSkill&&p.skill.count<=0&&!p.skill.usedThisTurn){
   p.skill.on=!p.skill.on;
   renderRows();
   dispatch({type:'skill',on:p.skill.on});
   return;
  }
 }
}
function syncPrio(){stage.querySelectorAll('.tg-prio').forEach(b=>b.classList.toggle('is-on',b.dataset.prio===S.prio))}

/* ---------- 問題 ---------- */
function banner(n){
 const b=$('.tg-banner'),ds=String(n).split(''),xs={1:[360],2:[295,425],3:[230,360,490]}[ds.length]||[360];
 let h='';const put=(name,cx,cy,w,hh,cls)=>h+=`<img class="tg-sp${cls?' '+cls:''}" src="${IMG(name)}" alt="" style="left:${cx-w/2}px;top:${cy-hh/2}px;width:${w}px;height:${hh}px">`;
 put('dai',100,530,136,136,'tg-blbl');ds.forEach((d,i)=>put(d,xs[i],530,144,170,'tg-blbl'));put('mon',620,530,128,134,'tg-blbl');
 h+=`<div class="tg-bup"><img class="tg-sp" src="${IMG('kougekiup')}" alt="" style="left:55px;top:587.5px;width:610px;height:137px"><img class="tg-sp" src="${IMG('80up')}" alt="" style="left:358.5px;top:604.5px;width:111px;height:83px"></div>`;
 b.innerHTML=h;b.classList.remove('is-on');void b.offsetWidth;b.classList.add('is-on');
}
function showQuestion(on){const q=$('.tg-q');q.hidden=!on;if(on)q.classList.remove('is-down')}
async function toAnswerLayout(){
 $('.tg-q').hidden=false;$('.tg-q').classList.remove('is-down');
 moveRows(false);await wait(520);
}
async function toAttackLayout(){
 stage.querySelectorAll('.tg-coin').forEach(e=>e.innerHTML='');
 $('.tg-q').classList.add('is-down');
 moveRows(true);await wait(520);
}
function resetTimerBar(){
 const gc=$('.tg-gc');if(!gc)return;
 gc.style.transition='none';gc.style.left='650px';gc.style.width='0px';
}

/* 回答中に、狙いを指定した味方・相手の線だけを順に表示する(自分 A3 は絶対に勝手に設定しない) */
function scheduleNpcTargets(id,plan){
 if(!plan||!plan.length)return;
 plan.forEach(([pid,tgt,delayMs])=>{
  after(()=>{
   if(id!==runId||S.phase!=='answer')return;
   const p=player(pid),t=player(tgt);
   if(!p||!t||t.ghost)return;
   p.target=tgt;
   S.showLines=true;
   drawLines(0);
  },delayMs);
 });
}

async function askQuestion(qi,opt={}){
 const id=runId;
 const Q=QUIZ[qi%QUIZ.length],order=opt.order||[1,0,2,3],correct=order.indexOf(0);
 const jp=[Q[1],Q[2],Q[3],Q[4]],en=[Q[0],...Q[5]];
 S.q++;
 // ターン開始時は全員の狙いをクリア(自分も味方も相手も最初は線なし)
 if(!opt.keepTargets){for(const p of [...S.A,...S.B])p.target=null}
 showQuestion(true);$('.tg-qtitle').textContent='';$('.tg-qword').textContent='';
 resetTimerBar();
 $('.tg-popback').hidden=false;stage.querySelectorAll('.tg-sel').forEach(b=>{b.hidden=true;b.disabled=true;b.className='tg-sel'});
 banner(S.q);
 if(opt.onBanner){
  await wait(480);if(id!==runId)return{res:'timeup',correct};
  await opt.onBanner();if(id!==runId)return{res:'timeup',correct};
 }else{
  await wait(700);if(id!==runId)return{res:'timeup',correct};
 }
 $('.tg-banner').classList.remove('is-on');
 S.showYou=false;S.showLines=opt.showLines!==false;
 $('.tg-qtitle').textContent=TITLE;$('.tg-qword').textContent=Q[0];
 stage.querySelectorAll('.tg-sel').forEach((b,k)=>{b.hidden=false;b.disabled=false;b.className='tg-sel';
  b.querySelector('.tg-seljp').textContent=jp[order[k]];b.querySelector('.tg-selen').textContent=en[order[k]]});
 if(opt.showTurn){$('.tg-turn').hidden=false;$('.tg-retire').hidden=true;syncPrio()}
 else{$('.tg-turn').hidden=true;$('.tg-retire').hidden=false}
 S.phase='answer';
 [...S.A,...S.B].forEach(p=>{p.answer=null});
 renderRows(false);
 resetTimerBar();
 const gc=$('.tg-gc');
 const t0=performance.now();let tries=0,res=null;
 const frame=()=>{if(S.phase!=='answer'||res)return;const r=Math.min(1,(performance.now()-t0)/1000/QUESTION_SEC);gc.style.width=578*r+'px';gc.style.left=650-578*r+'px';if(r<1&&!S.pauseTime)requestAnimationFrame(frame)};
 if(!opt.hold)requestAnimationFrame(frame);
 if(opt.lock)stage.querySelectorAll('.tg-sel').forEach((b,k)=>b.disabled=k!==correct);
 S.canSkill=true;S.canTarget=true;
 if(opt.before)await opt.before({correct});
 if(id!==runId)return{res:'timeup',correct};
 // 回答が始まったら、指定する味方・相手の狙い線を順に出す
 scheduleNpcTargets(id,opt.npcTargets);
 let start=performance.now();
 if(opt.hold){start=performance.now();requestAnimationFrame(frame)}
 while(!res){
  const ev=await waitEvent(e=>e.type==='choice');
  if(id!==runId)return{res:'timeup',correct};
  guideOff();
  const b=stage.querySelectorAll('.tg-sel')[ev.k];
  if(ev.k===correct){res=tries===0?((performance.now()-start)/1000<=FAST_SEC?'fast':'normal'):'late';me().answer=ev.k;break}
  tries++;b.disabled=true;b.classList.add('is-miss');
  if(tries>=2){
   if(opt.mustCorrect)continue;
   res='miss';me().answer=ev.k;break;
  }
 }
 S.canSkill=false;S.canTarget=false;
 for(const [pid,tgt] of opt.npcTargets||[]){const p=player(pid),t=player(tgt);if(p&&t&&!p.ghost&&!t.ghost)p.target=tgt}
 stage.querySelectorAll('.tg-sel').forEach((b,k)=>{b.disabled=true;if(k!==me().answer)b.classList.add('is-dim')});
 const kai=$('.tg-kaitou');
 kai.src=IMG('kaitou');kai.style.top='688.8px';
 kai.classList.remove('is-on');void kai.offsetWidth;kai.classList.add('is-on');
 renderRows(false,'A3');
 const others=[...S.A.filter(p=>!p.me),...S.B];
 const fixedAns=opt.answers||{};
 for(const [i,p] of others.entries()){
  await wait(55);
  if(id!==runId)return{res:'timeup',correct};
  const a=fixedAns[p.id];
  p.answer=a==='miss'?(correct+1+i%3)%4:(typeof a==='number'?a:correct);
  renderRows(false,p.id);
 }
 await wait(200);kai.classList.remove('is-on');
 stage.querySelectorAll('.tg-sel').forEach((b,k)=>{b.classList.remove('is-miss');b.classList.toggle('is-dim',k!==correct);b.classList.add('is-res',k===correct?'is-ok':'is-ng')});
 if(res==='fast')await playResultFx('fast');
 else if(res==='miss')await playResultFx('wrong');
 else await wait(240);
 return{res,correct};
}

function sparkleHTML(count,rx,ry,delayBase){
 let h='';
 for(let i=0;i<count;i++){
  const dx=Math.round((((i*73)%100)/50-1)*rx),dy=Math.round((((i*41)%100)/50-1)*ry);
  const d=(delayBase+(i%7)*.03).toFixed(2)+'s',sz=24+(i%5)*5;
  h+=`<img class="tg-sp tg-sparkle" src="${IMG('sparkle')}" alt="" style="width:${sz}px;height:${sz}px;margin:${-sz/2}px 0 0 ${-sz/2}px;--dx:${dx}px;--dy:${dy}px;--d:${d}">`;
 }
 return h;
}
async function playResultFx(kind){
 const fxBox=$('.tg-fx'),wrap=el('div','tg-ef');
 if(kind==='fast'){
  wrap.innerHTML=`<img class="tg-sp tg-ef-bg" src="${IMG('ef_bg')}" alt="" style="left:-335.5px;top:-85px;width:671px;height:170px">
   <img class="tg-sp tg-ef-ring" src="${IMG('ef_ring')}" alt="" style="left:-187.5px;top:-187.5px;width:375px;height:375px">
   <img class="tg-sp tg-ef-exc" src="${IMG('Exc1')}" alt="Excellent!" style="left:-243.5px;top:-64px;width:487px;height:128px">${sparkleHTML(24,260,95,.33)}`;
 }else if(kind==='wrong'){
  wrap.innerHTML=`<div class="tg-ef-wgrp"><img class="tg-sp" src="${IMG('ef_bg')}" alt="" style="left:-335.5px;top:-85px;width:671px;height:170px">
   <img class="tg-sp" src="${IMG('ef_x')}" alt="" style="left:-130px;top:-143px;width:260px;height:286px">
   <img class="tg-sp tg-ef-inc" src="${IMG('ef_inc')}" alt="Incorrect" style="left:-242px;top:-63.5px;width:484px;height:127px"></div>`;
 }
 fxBox.append(wrap);
 await wait(720);
 wrap.remove();
}

/* ---------- スキルのカットイン(仮想対戦 playAnim の Open → Next → Close) ---------- */
function cutBody(e,gradKey){
 const c=BYID.get(e.cid)||{},name=c.n||'',text=(c.sk&&c.sk.name)||'',grad=GRAD_MAP[gradKey]||'Gradients512_5';
 return `<div class="tg-cutbody"><img class="tg-sp tg-cutgrad" src="${IMG(grad)}" alt="">
  <img class="tg-sp tg-cutcard" src="${CARD(e.cid)}" alt="${name}" style="left:150px;top:40px;width:420px;height:365px" onerror="this.onerror=null;this.src='${ICON(e.cid)}';this.style.cssText='left:230px;top:105px;width:260px;height:260px'">
  <img class="tg-sp tg-cutlabel" src="${IMG('SkillLabel_big')}" alt="" style="left:0;top:370px;width:720px;height:76px">
  <div class="tg-tx tg-cutname">${name}</div><div class="tg-tx tg-cuttext">${text}</div></div>`;
}
function cutShow(e,gradKey){
 const box=$('.tg-cut');
 if(!box.classList.contains('is-on')){
  box.innerHTML=`<div class="tg-cutband"><div class="tg-cutfaded"></div></div>`+cutBody(e,gradKey);
  box.className='tg-cut is-on';return;
 }
 box.querySelectorAll('.tg-cutbody').forEach(o=>{o.classList.add('is-out');after(()=>o.remove(),200)});
 box.insertAdjacentHTML('beforeend',cutBody(e,gradKey));
}
async function cutClose(){
 const box=$('.tg-cut');if(!box.classList.contains('is-on'))return;
 box.classList.add('is-closing');await wait(200);
 box.className='tg-cut';box.innerHTML='';
}

/* ---------- 攻撃演出 & エンジンターンの再生 ---------- */
const FXK=1/640;
function fxName(attrs){
 const s=new Set(attrs||[]);
 if(s.size>=3)return 'FireWaterWind';
 if(s.size===2){
  if(s.has('火')&&s.has('水'))return 'FireWater';
  if(s.has('水')&&s.has('風'))return 'WaterWind';
  return 'WindFire';
 }
 return s.has('水')?'Water':s.has('風')?'Wind':'Fire';
}
function fxLevel(d){const th=[100,500,1500,3000,5000,10000,20000,50000,100000];for(let i=0;i<th.length;i++)if(d<th[i])return i+1;return 10}
function pagePos(x,y){const r=stage.getBoundingClientRect(),k=r.width/720;return{x:r.left+x*k+scrollX,y:r.top+y*k+scrollY,k}}

function updateHpBar(p,hp,max){
 const d=stage.querySelector(`[data-pid="${p.id}"]`);if(!d)return;
 const h=d.querySelector('.tg-hp'),ex=d.querySelector('.tg-hp-ex');
 const mx=Math.max(1,max||p.cur.max||1);
 if(h)h.style.width=(p.ghost?0:Math.max(0,Math.min(1,hp/mx)*118))+'px';
 if(ex)ex.style.width=(p.ghost||hp<=mx?0:Math.max(0,Math.min(1,(hp-mx)/mx)*118))+'px';
}
async function dieAnim(p){
 const id=runId,d=stage.querySelector(`[data-pid="${p.id}"]`);
 p.dying=true;
 if(d){
  d.insertAdjacentHTML('beforeend',`<img class="tg-sp tg-die-icon" src="${IMG('IconDie')}" alt="" style="left:0;top:0;width:120px;height:120px"><img class="tg-sp tg-die-star" src="${IMG('DeathStar')}" alt="" style="left:0;top:0;width:120px;height:120px">`);
 }
 /* 1秒の消滅演出のあと、その場には「あと」の数字だけが残る。次のキャラは次のターンに出る */
 after(()=>{
  if(id!==runId||!p.dying)return;
  p.gone=true;p.left=Math.max(0,p.left-1);
  const c=stage.querySelector(`[data-pid="${p.id}"]`);if(c)c.innerHTML=cardHTML(p);
  drawLines(1);
 },1000);
 const ok=await fx();
 if(ok&&d){
  const b=cardBox(p.id,true);
  after(()=>{if(id!==runId)return;const P=pagePos(b.x+b.w/2,b.y+b.w/2);EFX.play('EffectIconDie',P.x,P.y,P.k*b.w/120/FXK,FXK,{life:.9,clip:stageWrap})},450);
 }
}

/* 1回の攻撃(仮想対戦と同じ秒数: 0.15秒ずつずらす → 溜め0.8秒 → 弾0.3秒 → 着弾) */
async function shootOne(k,att,tgt,e,attrs){
 const id=runId;
 await wait(150*k);if(id!==runId)return;
 const a=cardBox(att.id,true),b=cardBox(tgt.id,true),sa=a.w/120,sb=b.w/120,da=att.team==='A'?-1:1,db=tgt.team==='A'?-1:1;
 const ax=a.x+a.w/2,ay=a.y+a.w/2+da*140*sa,bx=b.x+b.w/2,by=b.y+b.w/2;
 const ok=await fx();
 if(id!==runId)return;
 const fn=fxName(attrs);
 if(ok){
  const A=pagePos(ax,ay),B=pagePos(bx,by),ppw=A.k*sa/FXK,sc=FXK*.5;
  EFX.play('EffectElementCharge'+fn+'Ally',A.x,A.y,ppw,sc,{life:.8,clip:stageWrap});
  EFX.play('EffectBullet'+fn,A.x,A.y,ppw,sc,{life:1.1,clip:stageWrap,path:s=>{const u=Math.max(0,Math.min(1,(s-.8)/.3));return{x:A.x+(B.x-A.x)*u,y:A.y+(B.y-A.y)*u}}});
 }
 await wait(1100);if(id!==runId)return;
 if(ok){const Dm=pagePos(bx,by-db*60*sb);EFX.play('EffectDamage'+fn+'_'+fxLevel(e.damage),Dm.x,Dm.y,Dm.k*sb/FXK,FXK,{life:.9,clip:stageWrap})}
 const n=txt('tg-dmg',Math.round(e.damage).toLocaleString(),bx,by-55*sb);$('.tg-fx').append(n);after(()=>n.remove(),1100);
 const d=stage.querySelector(`[data-pid="${tgt.id}"]`);
 if(d)d.animate([{translate:'0 0'},{translate:'10px -7px'},{translate:'-9px 6px'},{translate:'6px 4px'},{translate:'-3px -2px'},{translate:'0 0'}],{duration:1000});
 tgt.cur.hp=e.calc.hp_after;
 updateHpBar(tgt,e.calc.hp_after,e.calc.max_hp);
 if(e.killed&&!tgt.dying)dieAnim(tgt);
}

/* Rust WASM エンジンで1ターン実行し、仮想対戦(battle-ui.js playAnim)と同じ順で再生する:
   短縮 → 色変・遅延 → 回復・攻撃UP・連撃・全体・シールド・かばう → 攻撃 → 蘇生 */
const SK_NAME={atk_up:'攻撃',multi_attack:'連続',all_attack:'全体',shield:'防御',def_up:'防御',heal:'回復',revive:'蘇生',color_change:'変化',shorten:'短縮',delay:'遅延',cover:'かばう'};
const SK_ORDER={heal:0,atk_up:1,multi_attack:2,all_attack:3,shield:4,def_up:4,cover:5};
async function executeEngineTurn(opts={}){
 const id=runId;
 const myRes=opts.myRes||'fast';
 const npcAns=opts.npcAns||{};
 const npcUseSkill=opts.npcUseSkill||{};
 const scene=opts.scene||('turn_'+S.q);

 const playersInput={},skillOrder=[];
 ALL_PIDS.forEach((pid,i)=>{
  const p=player(pid),bp=S.battle.players[pid],ac=bp.active_char;
  const ready=!bp.ghost&&ac&&ac.alive&&ac.skill&&ac.uses<S.battle.rules.max_skill_uses&&ac.count<=0;
  const a=pid==='A3'?myRes:(npcAns[pid]||'fast');
  const use_skill=!!(ready&&(pid==='A3'?p.skill.on:npcUseSkill[pid]));
  playersInput[pid]={correct:a!=='miss',answer_code:a==='fast'?1:a==='late'?6:0,rank:i+1,
   priority:pid==='A3'?(S.prio||'normal'):'normal',target:p.target||null,use_skill};
  if(use_skill)skillOrder.push(pid);
 });
 const preAttrs={};
 for(const p of [...S.A,...S.B])preAttrs[p.id]=p.cur.attrs.slice();

 const log=S.battle.step({players:playersInput,skill_order:skillOrder});
 const events=log.events;
 const attacks=events.filter(e=>e.kind==='attack');
 const skills=events.filter(e=>e.kind==='skill_used'&&e.pid);
 LOG.turns.push({scene,turn:S.battle.turn,
  targets:Object.fromEntries(ALL_PIDS.map(pid=>[pid,playersInput[pid].target])),
  skills:skills.map(e=>({pid:e.pid,cid:e.cid})),
  attacks:attacks.map(e=>({from:e.attacker,to:String(e.target).split('-')[0],dmg:Math.round(e.damage),killed:!!e.killed}))
 });

 S.phase='attack';S.showLines=true;$('.tg-modal').innerHTML='';
 await toAttackLayout();if(id!==runId)return log;

 const kindOf=e=>{const n=events[events.indexOf(e)+1]||{};const k=n.kind==='effect'?n.effect:n.kind;return SK_NAME[k]?k:((e.types&&e.types[0])||'atk_up')};
 const applySnap=snap=>{
  if(!snap)return;
  for(const [pid,sc] of Object.entries(snap.chars||{})){
   const p=player(pid);if(!p||p.ghost)continue;
   if(sc.hp>0&&(p.gone||p.dying)){p.gone=false;p.dying=false;p.left++;p.raised=true}
   p.cur.hp=sc.hp;p.cur.max=sc.max_hp;p.skill.count=sc.count;
   if(sc.attrs){p.cur.attrs=sc.attrs.slice();p.cur.attr=attrStrOf(sc.attrs);preAttrs[pid]=sc.attrs.slice()}
  }
 };
 const hit=(e,k)=>{
  const p=player(e.pid);
  if(p){
   p.skill.on=false;p.skill.waiting=false;p.skill.usedThisTurn=true;
   const ic=effIcon(k,(((BYID.get(e.cid)||{}).sk||{}).effects||[]).find(x=>x.type===k)),ef=((e.snap&&e.snap.teams&&e.snap.teams[p.team])||[]).find(x=>x.kind===k);
   if(ic&&ef&&!p.buffs.some(x=>x.img===ic))p.buffs.push({img:ic,left:ef.remaining,justOn:true});
  }
  applySnap(e.snap);
  renderRows(true);
 };
 const runPhase=async list=>{
  if(!list.length)return true;
  await wait(1000);if(id!==runId)return false;
  for(let i=0;i<list.length;i++){
   const e=list[i],k=kindOf(e);
   cutShow(e,skillGrad(k));talk(e.pid,SK_NAME[k]+'!',1200);
   await wait(800);if(id!==runId)return false;
   hit(e,k);
   await wait(i?400:600);if(id!==runId)return false;
  }
  await cutClose();
  return id===runId;
 };

 const ph=[[],[],[],[]];
 for(const e of skills){const k=kindOf(e);ph[k==='shorten'?0:k==='color_change'||k==='delay'?1:k==='revive'?3:2].push(e)}
 ph[2].sort((a,b)=>(SK_ORDER[kindOf(a)]??9)-(SK_ORDER[kindOf(b)]??9)||events.indexOf(a)-events.indexOf(b));
 if(!(await runPhase(ph[0])))return log;
 if(!(await runPhase(ph[1])))return log;
 if(log.regen_snap&&events.some(e=>e.kind==='regen')){applySnap(log.regen_snap);renderRows(true)}
 if(!(await runPhase(ph[2])))return log;

 await Promise.all(attacks.map((e,k)=>{
  const att=player(e.attacker),tgt=player(String(e.target).split('-')[0]);
  return att&&tgt?shootOne(k,att,tgt,e,preAttrs[e.attacker]||att.cur.attrs):null;
 }));
 if(id!==runId)return log;
 await wait(1200);if(id!==runId)return log;
 if(window.EFX&&typeof EFX.clear==='function')EFX.clear();

 await runPhase(ph[3]);
 if(id!==runId)return log;
 for(const p of [...S.A,...S.B]){
  if(p.ghost||p.gone||p.dying)continue;
  const c=S.battle.players[p.id].deck.find(x=>x.cid===p.cur.id&&x.alive);
  if(!c)continue;
  p.skill.on=false;p.skill.usedThisTurn=false;p.skill.count=c.count;
  p.skill.noSkill=!c.skill||c.uses>=S.battle.rules.max_skill_uses;
 }
 renderRows(true);
 return log;
}

async function playWinFx(){
 const fxBox=$('.tg-fx'),w=el('div','tg-win');
 w.innerHTML=`<img class="tg-sp" src="${IMG('WinBg')}" alt="" style="left:-353.5px;top:-205.5px;width:707px;height:411px">
  <img class="tg-sp tg-win-ch" src="${IMG('Win_0')}" alt="" style="left:-187px;top:-90px;width:150px;height:192px;--d:.17s">
  <img class="tg-sp tg-win-ch" src="${IMG('Win_1')}" alt="" style="left:-37px;top:-81px;width:64px;height:186px;--d:.25s">
  <img class="tg-sp tg-win-ch" src="${IMG('Win_2')}" alt="" style="left:30px;top:-84px;width:116px;height:186px;--d:.33s">
  <img class="tg-sp tg-win-ch" src="${IMG('Win_3')}" alt="" style="left:133px;top:-87px;width:65px;height:191px;--d:.45s">${sparkleHTML(24,300,170,.17)}`;
 fxBox.append(w);await wait(900);w.remove();
}

/* ================================================================
 * 第1部: 指定デッキの表示 → まず1回遊ぶ(文は台本_確定.md のとおり)
 * ================================================================ */
function renderMyDeck5(){
 const mod=$('.tg-modal');
 const slots=me().deckIds.map((cid,i)=>`<div class="tg-deck5-slot" data-slot="${i}">
  ${miniIconHTML(cid,116)}
  <span class="tg-deck5-num">${i+1}</span>
 </div>`).join('');
 mod.innerHTML=`<div class="tg-deck5"><div class="tg-deck5-row">${slots}</div></div>`;
}
const skillReady=p=>!p.ghost&&!p.skill.noSkill&&p.skill.count<=0;
/* 次のターン: ここで倒れたキャラが次のキャラに代わる */
async function nextTurn(){
 syncFromBattle(false);renderRows(true);await wait(500);
}

async function runPart1(){
 const id=runId;
 await ensureEngine();
 if(id!==runId)return;

 initBattleState({...NPC_DECKS,A3:DEFAULT_MY_DECK.slice()},{seed:20261128,count_step:1},'part1');
 build();
 await showDeckConfirm(DEFAULT_MY_DECK);
 if(id!==runId)return;
 setChap('第1部','基本の遊び方');

 await showVsScreen();
 if(id!==runId)return;

 // 登場演出
 S.phase='intro';S.showYou=true;S.showLines=false;
 showQuestion(true);
 renderRows(false);
 stage.querySelectorAll('.tg-card').forEach(d=>d.classList.add('is-hide'));
 const order=[];for(let i=0;i<5;i++)order.push(S.A[i],S.B[i]);
 for(const p of order){
  if(id!==runId)return;
  const d=stage.querySelector(`[data-pid="${p.id}"]`);
  d.classList.remove('is-hide');
  talk(p.id,NAMES[p.id],850);
  await wait(75);
 }
 await wait(300);if(id!==runId)return;

 const myBox=cardBox('A3',false);
 await guide('これがあなたです。画面の下の列が味方、上の列が相手です。',{
  at:'bottom',spot:[myBox.x-10,myBox.y-48,140,186],finger:[myBox.x+60,myBox.y-46,90],scene:'p1_02_you'
 });
 if(id!==runId)return;
 renderMyDeck5();
 await guide('戦うのは「キャラ」です。デッキの左の1体目から1体ずつ戦いに出ます。',{
  at:'bottom',spot:[40,478,132,132],finger:[106,480,90],scene:'p1_03_deck5'
 });
 $('.tg-modal').innerHTML='';
 if(id!==runId)return;
 await guide('問題が出て、みんなが答えて、攻撃する。この1回分を「1ターン」と呼びます。',{
  at:'bottom',spot:[44,64,632,366],scene:'p1_04_turn'
 });
 if(id!==runId)return;

 const npcAns={B3:'miss',B5:'miss'};
 const ORDERS=[[1,0,2,3],[0,2,1,3],[2,0,1,3],[2,1,0,3]];
 const TARGETS=[
  [['A1','B1',350],['A4','B4',950]],
  [['A2','B2',300],['A5','B5',900]],
  [['A1','B3',350]]
 ];
 /* 最初の3ターンの相手の狙いは自分(A3)以外。スキルの説明が終わるまで先頭のキャラが倒れないように */
 const EARLY=[['B1','A1',550],['B2','A5',700],['B4','A4',1100]];
 const targetsAt=n=>n<3?[...TARGETS[n%3],...EARLY]:TARGETS[n%3];

 // 第1問
 S.canTarget=true;
 const r1=await askQuestion(0,{
  order:ORDERS[0],hold:true,mustCorrect:true,lock:true,showLines:true,showTurn:false,answers:npcAns,
  npcTargets:targetsAt(0),
  onBanner:async()=>{
   await guide('難しい問題を解くほど、攻撃が強くなります。',{
    at:'bottom',spot:[44,578,632,152],scene:'p1_05_banner'
   });
  },
  before:async({correct})=>{
   S.pauseTime=true;
   await guide('下の棒は残り時間です。ピンクのうちに正解すると「Excellent!」になり、攻撃がさらに強くなります。',{
    at:'top',spot:[64,708,596,44],finger:[578,708,90],scene:'p1_06_timer'
   });
   if(id!==runId)return;
   await guide('正しい意味をタップしましょう。まちがえても1回だけ答え直せます(攻撃の強さは半分)。',{
    at:'top',spot:[0,760,720,452],finger:[180,[771,882,993,1104][correct]+48,0],tap:false,scene:'p1_07_choices'
   });
   S.pauseTime=false;
  }
 });
 S.canTarget=false;
 if(id!==runId)return;

 const log1=await executeEngineTurn({myRes:r1.res,npcAns,scene:'p1_turn1'});
 if(id!==runId)return;
 await guide('正解すると、あなたのキャラが相手のキャラを攻撃します。',{
  at:'bottom',spot:[44,120,632,558],scene:'p1_08_attack'
 });
 if(id!==runId)return;
 const killed=log1.events.find(e=>e.kind==='attack'&&e.killed);
 if(killed){
  const ko=cardBox(String(killed.target).split('-')[0],true);
  await guide('体力がなくなったキャラは倒れます。次のターンになると、次のキャラが代わりに出てきます。「あと」の数字は残りのキャラの数です。',{
   at:'bottom',spot:[ko.x-6,ko.y-32,ko.w+12,172],finger:[ko.x+ko.w/2,ko.y-30,90],scene:'p1_09_ko'
  });
  if(id!==runId)return;
 }
 const mine=cardBox('A3',true);
 if(!S.battle.finished){
  await nextTurn();if(id!==runId)return;
  if(!me().ghost&&!me().skill.noSkill){
   await guide('「スキル」はキャラごとの特別な技です。キャラの右上の数字は、あと何回正解すればスキルを使えるかを表します。',{
    at:'bottom',spot:[mine.x+72,mine.y-10,56,56],finger:[mine.x+100,mine.y-10,90],scene:'p1_10_skillcnt'
   });
   if(id!==runId)return;
  }
 }

 // 勝敗が決まるまで続ける。数字が0になった最初の問題でスキルを教える
 let q=1,taught=false;
 while(!S.battle.finished){
  const teach=!taught&&skillReady(me());
  await toAnswerLayout();if(id!==runId)return;
  S.canTarget=true;
  const r=await askQuestion(q,{
   order:ORDERS[q%4],hold:teach,mustCorrect:true,showLines:true,showTurn:false,answers:npcAns,
   npcTargets:targetsAt(q),
   before:teach?async()=>{
    S.pauseTime=true;
    const mb=cardBox('A3',false);
    const on=waitEvent(e=>e.type==='skill'&&e.on);
    await guide('数字が0になりました。問題に答える前に、自分のキャラをタップしてください。',{
     at:'bottom',spot:[mb.x-10,mb.y-16,140,156],finger:[mb.x+60,mb.y-16,90],tap:false,scene:'p1_11_skillzero'
    });
    await on;
    if(id!==runId)return;
    await guide('「!」が付きました。全員が答え終わった後、スキルが発動します。',{
     at:'bottom',spot:[mb.x+56,mb.y-20,78,78],finger:[mb.x+95,mb.y-20,90],scene:'p1_12_skillbang'
    });
    S.pauseTime=false;
   }:null
  });
  S.canTarget=false;
  if(id!==runId)return;
  await executeEngineTurn({myRes:r.res,npcAns,scene:'p1_turn'+(q+1)});
  if(id!==runId)return;
  q++;
  if(S.battle.finished)break;
  await nextTurn();if(id!==runId)return;
  if(teach){
   taught=true;
   if(!me().ghost&&me().cur.id===DEFAULT_MY_DECK[0]){
    await guide('スキルを使うと数字は元に戻ります。何回か正解すると、もう一度使えます。同じキャラがスキルを使えるのは、1試合で2回までです。',{
     at:'bottom',spot:[mine.x+72,mine.y-10,56,56],finger:[mine.x+100,mine.y-10,90],scene:'p1_13_skillreset'
    });
    if(id!==runId)return;
   }
  }
 }

 await wait(400);if(id!==runId)return;
 if(S.battle.result&&S.battle.result.winner==='A')await playWinFx();
 if(id!==runId)return;
 await showPart1Result();
}

/* 勝敗はエンジンの結果のとおりに出す */
function resultImage(){
 const w=S.battle.result&&S.battle.result.winner;
 const intact=t=>S.battle.teams[t].players.every(p=>!p.ghost);
 if(w==='A')return intact('A')?['kanzensyouri','完全勝利']:['ResultWin','勝利'];
 if(w==='B')return intact('B')?['kanzenlose','完全敗北']:['ResultLose','敗北'];
 return ['hikiwake3','引き分け'];
}
async function showPart1Result(){
 const id=runId;
 syncFromBattle(false);
 S.phase='end';S.showLines=false;guideOff();showQuestion(false);
 stage.querySelectorAll('.tg-sel').forEach(b=>b.hidden=true);$('.tg-turn').hidden=true;
 drawLines(1);
 const [pic,label]=resultImage();
 const vText='相手チームのキャラを全部倒せば勝ちです。基本はこれでおしまいです。';
 recText('p1_14_victory',vText);
 const scr=el('div','tg-result');
 scr.innerHTML=`<img class="tg-sp" src="${IMG('ScreenBattleBack')}" alt="" style="left:0;top:0;width:720px;height:1280px">
 <img class="tg-sp tg-resimg" src="${IMG(pic)}" alt="${label}" style="left:-1px;top:-3px;width:722px;height:118px;object-fit:contain">
 <div class="tg-resrow">${S.A.map(p=>`<div class="tg-card tg-card-A" style="position:relative;transform:none">${cardHTML(p)}</div>`).join('')}</div>
 <div class="tg-tx tg-restext">${vText}</div>
 <button class="tg-btn" type="button" data-act="part2" style="left:190px;top:900px"><img class="tg-sp" src="${IMG('ButtonBlueWithGoldFrame60')}" alt="" style="left:0;top:0;width:340px;height:84px"><span class="tg-tx">くわしい操作を見る</span></button>
 <button class="tg-btn-sub" type="button" data-act="again" style="left:250px;top:1030px"><img class="tg-sp" src="${IMG('ButtonWineRedWithGoldFrame60')}" alt="" style="left:0;top:0;width:220px;height:68px"><span class="tg-tx">最初から</span></button>`;
 stage.append(scr);
 const ev=await waitEvent(e=>e.type==='part2'||e.type==='again');
 if(id!==runId)return;
 scr.remove();
 if(ev.type==='part2')await showPart2Menu();
 else{clearAll();await runPart1()}
}

/* ================================================================
 * 第2部: くわしい操作(すべて Rust WASM エンジンで実演)
 * ================================================================ */
async function showPart2Menu(){
 const id=runId;
 await ensureEngine();if(id!==runId)return;
 build();
 setChap('第2部','くわしい操作');
 const items=[
  ['target','狙い'],
  ['skills','スキルの種類'],
  ['order','攻撃の順番'],
  ['survive','長く生き残る'],
  ['chat','チャット'],
  ['rank','勝敗とランク']
 ];
 const menu=el('div','tg-menu');
 menu.innerHTML=`<img class="tg-sp" src="${IMG('ScreenBattleBack')}" alt="" style="left:0;top:0;width:720px;height:1280px">
  <div class="tg-menu-box">
   <div class="tg-menu-head">くわしい操作</div>
   <div class="tg-menu-grid">${items.map(([k,label])=>`<button class="tg-menu-item" type="button" data-act="p2item" data-val="${k}"><img class="tg-sp" src="${IMG('ButtonBlueWithGoldFrame60')}" alt=""><span class="tg-tx">${label}</span></button>`).join('')}</div>
   <div class="tg-menu-foot"><button class="tg-menu-back" type="button" data-act="again"><img class="tg-sp" src="${IMG('ButtonWineRedWithGoldFrame60')}" alt=""><span class="tg-tx">第1部をもう一度</span></button></div>
  </div>`;
 stage.append(menu);
 const ev=await waitEvent(e=>e.type==='p2item'||e.type==='again');
 if(id!==runId)return;
 menu.remove();
 if(ev.type==='again'){clearAll();await runPart1();return}
 if(ev.val==='target')await demoTarget();
 else if(ev.val==='skills')await demoSkills();
 else if(ev.val==='order')await demoOrder();
 else if(ev.val==='survive')await demoSurvive();
 else if(ev.val==='chat')await demoChat();
 else if(ev.val==='rank')await demoRank();
 if(id!==runId)return;
 await showPart2Menu();
}

/* 実演の画面にも問題と4択を出す(実機はいつも出ている。押しても反応しない) */
function demoQuestion(word){
 const Q=QUIZ.find(x=>x[0]===word),jp=[Q[2],Q[1],Q[3],Q[4]];
 showQuestion(true);$('.tg-qtitle').textContent=TITLE;$('.tg-qword').textContent=word;
 stage.querySelectorAll('.tg-sel').forEach((b,k)=>{b.hidden=false;b.disabled=true;b.querySelector('.tg-seljp').textContent=jp[k]});
}
/* 裏で1ターン(画面には出さない)。correct の人だけ正解し、指定した相手を攻撃する */
function silentTurn(correct,targets){
 const pIn={};
 for(const pid of ALL_PIDS){
  const ok=correct.includes(pid);
  pIn[pid]={correct:ok,answer_code:ok?1:0,rank:1,priority:'normal',target:targets[pid]||null,use_skill:false};
 }
 S.battle.step({players:pIn,skill_order:[]});
}
/* 実演キャラを先頭に置き、自分だけ正解するターンを数字が0になるまで進める */
function prepareSkillDemoBattle(cid,seed,tag){
 const deck=[cid,...[1420,1739,1470,535,1729].filter(x=>x!==cid)].slice(0,5);
 const decks={...NPC_DECKS,A3:deck};
 /* 味方の先頭が実演キャラと同じだと見分けにくいので、順番を後ろへ回す */
 for(const pid of ['A1','A2','A4','A5'])if(decks[pid][0]===cid)decks[pid]=[...decks[pid].slice(1),cid];
 initBattleState(decks,{seed,count_step:1},tag);
 for(let n=0;n<10&&S.battle.players.A3.active_char.count>0;n++)silentTurn(['A3'],{A3:'B'+[1,2,4,5,3][n%5]});
 syncFromBattle(false);
}

/* 第2部-1: 狙い */
async function demoTarget(){
 const id=runId;
 initBattleState({...NPC_DECKS,A3:DEFAULT_MY_DECK.slice()},{seed:101,count_step:1},'p2_target');
 build();setChap('第2部','狙い');
 S.showYou=false;
 renderRows(false);
 const r=await askQuestion(1,{
  order:[1,0,2,3],hold:true,mustCorrect:true,lock:true,
  npcTargets:[['A4','B4',250],['B1','A1',550]],
  before:async()=>{
   S.pauseTime=true;
   const tb=cardBox('B3',false);
   const picked=waitEvent(e=>e.type==='target'&&e.id);
   await guide('相手のキャラをタップすると、その相手を攻撃します。',{
    at:'bottom',spot:[110,68,500,136],finger:[tb.x+tb.w/2,tb.y+tb.w+6,-90],tap:false,scene:'p2_target_1'
   });
   await picked;
   if(id!==runId)return;
   await guide('線は「だれがだれを狙っているか」を表します。',{at:'bottom',spot:[44,64,632,366],scene:'p2_target_2'});
   S.pauseTime=false;
  }
 });
 if(id!==runId)return;
 await executeEngineTurn({myRes:r.res,scene:'p2_target_turn'});
 if(id!==runId)return;
 await guide('キャラには火・水・風の属性があります。火は風に、風は水に、水は火に強く、有利な相手を攻撃すると大きなダメージになります。',{
  at:'bottom',spot:[44,120,632,558],scene:'p2_target_3'
 });
}

/* 第2部-2: スキルの種類(実演するキャラは本人がそのスキルを持つ) */
async function demoOneSkill(cfg){
 const id=runId;
 prepareSkillDemoBattle(cfg.cid,cfg.seed,cfg.tag);
 build();setChap('スキルの種類',cfg.label);
 S.showYou=false;
 renderRows(false);
 const c=BYID.get(cfg.cid),text=`${cfg.label}: ${cfg.desc}`;
 const intro=`${c.n}のスキル<br>「${c.sk.name}」<br>${text}`;
 const mb=cardBox('A3',false);
 await askQuestion(cfg.qi,{
  order:[1,0,2,3],hold:true,mustCorrect:true,lock:true,answers:cfg.npcAns,
  npcTargets:Object.entries(cfg.npcTargets||{}).map(([p,t],i)=>[p,t,200+i*150]),
  before:async({correct})=>{
   S.pauseTime=true;
   const on=waitEvent(e=>e.type==='skill'&&e.on);
   await guide(intro,{at:'bottom',spot:[mb.x-10,mb.y-16,140,156],finger:[mb.x+60,mb.y-16,90],tap:false,scene:cfg.tag+'_tap'});
   await on;
   if(id!==runId)return;
   S.canSkill=false;
   await guide('正しい意味をタップしましょう。',{
    at:'top',spot:[0,760,720,452],finger:[180,[771,882,993,1104][correct]+48,0],tap:false,scene:cfg.tag+'_answer'
   });
   S.pauseTime=false;
  }
 });
 if(id!==runId)return;
 me().skill.on=true;
 await executeEngineTurn({myRes:'fast',npcAns:cfg.npcAns,scene:cfg.tag+'_turn'});
 if(id!==runId)return;
 await wait(300);if(id!==runId)return;
 const b=cardBox(cfg.spotPid||'A3',true);
 await guide(text,{at:'bottom',spot:cfg.spot||[b.x-10,b.y-30,b.w+20,172],scene:cfg.tag+'_after'});
 if(id!==runId||S.battle.finished)return;
 syncFromBattle(false);renderRows(true);await wait(500);if(id!==runId)return;
 const m=cardBox('A3',true);
 await guide('スキルを使うと数字は元に戻ります。',{at:'bottom',spot:[m.x+72,m.y-10,56,56],finger:[m.x+100,m.y-10,90],scene:cfg.tag+'_count'});
}

async function demoSkills(){
 const id=runId;
 const miss=ids=>Object.fromEntries(ids.map(p=>[p,'miss']));
 const alone=miss(ALL_PIDS.filter(p=>p!=='A3'));
 const list=[
  {cid:2053,label:'攻撃力アップ',tag:'p2_sk_atkup',seed:201,qi:0,npcAns:alone,desc:'攻撃力が上がります。自分だけ・味方全員・特定の属性など、強くなる相手や条件はスキルごとに違います。'},
  {cid:1203,label:'連撃',tag:'p2_sk_serial',seed:202,qi:1,npcAns:alone,desc:'1回の攻撃で、何回も続けて当てます。'},
  {cid:1739,label:'全体攻撃',tag:'p2_sk_all',seed:203,qi:2,npcAns:alone,spot:[44,120,632,170],
   desc:'いつもは相手1体を攻撃しますが、これを使うと相手の5体をまとめて攻撃します。'},
  {cid:2013,label:'かばう',tag:'p2_sk_cover',seed:204,qi:3,npcAns:miss(['A1','A2','A4','A5']),
   npcTargets:{B1:'A1',B2:'A2',B3:'A4',B4:'A5',B5:'A1'},desc:'相手の攻撃を自分のキャラ1体に集めて、味方を守ります。'},
  {cid:2007,label:'蘇生',tag:'p2_sk_revive',seed:205,qi:4,npcAns:miss(['A1','A2','A4','A5','B2','B3','B4','B5']),
   npcTargets:{B1:'A2'},spotPid:'A2',desc:'倒れた味方を生き返らせます。みんなの攻撃が終わった後に出ます。'}
 ];
 for(const cfg of list){
  await demoOneSkill(cfg);
  if(id!==runId)return;
 }

 // 6. そのほか(一覧で表示)
 setChap('スキルの種類','そのほかのスキル');
 recText('p2_sk_other',OTHER_SKILLS.map(s=>`${s.name}: ${s.desc}`).join(' / '));
 const mod=$('.tg-modal');
 mod.innerHTML=`<div class="tg-skillpop">
  <div class="tg-skhead">そのほかのスキル</div>
  <div class="tg-skgrid">${OTHER_SKILLS.map(s=>`<div class="tg-skrow">
   <div class="tg-skico">${s.img?`<img src="${IMG(s.img)}" alt="">`:`<span>${s.txt}</span>`}</div>
   <div class="tg-skinfo"><div class="tg-skname">${s.name}</div><div class="tg-skdesc">${s.desc}</div></div>
  </div>`).join('')}</div>
  <div class="tg-skfoot"><button class="tg-sknext" type="button" data-act="skdone"><img class="tg-sp" src="${IMG('ButtonBlueWithGoldFrame60')}" alt=""><span class="tg-tx">戻る</span></button></div>
 </div>`;
 await waitEvent(e=>e.type==='skdone');
 mod.innerHTML='';
}

/* 第2部-3: 攻撃の順番 (全体攻撃1739 vs かばう1350 パレンケVRS を WASM エンジンで実行) */
async function demoOrder(){
 const id=runId;
  // A3=1747(全体攻撃)と B2=1350(かばう75%カット)を、数字が0の状態にする。全体攻撃の5発目で B2 が倒れる
 initBattleState({...NPC_DECKS,A3:[1747,1420,1470,535,1729],B2:[1350,150,2164,740,1008]},{seed:301,count_step:1},'p2_order');
 for(let n=0;n<2;n++)silentTurn(['A3','B2'],{A3:'B5',B2:'A5'});
 syncFromBattle(false);

 build();setChap('第2部','攻撃の順番');
 S.showYou=false;
 S.prio='normal';me().prio='normal';
 me().skill.on=true; // 全体攻撃を使う状態
 player('B2').skill.on=true; // 相手はかばうを使う
 renderRows(false);
 await askQuestion(3,{
  order:[1,0,2,3],hold:true,mustCorrect:true,lock:true,showTurn:true,
  npcTargets:[['A1','B1',200],['A2','B3',300],['A4','B4',400],['A5','B5',500]],
  before:async({correct})=>{
   S.pauseTime=true;S.canSkill=false;S.canTarget=false;
   await guide('問題が出ている間に「優先」「回答」「劣後」を選べます。',{at:'top',spot:[120,1212,340,68],scene:'p2_order_1'});
   if(id!==runId)return;
   await guide('回答(ふつう)は早く答えた人から攻撃します。優先はその人たちより先、劣後はみんなの後です。',{at:'top',spot:[120,1212,340,68],scene:'p2_order_2'});
   if(id!==runId)return;
   const b2=cardBox('B2',false);
   await guide('使い方の例: 相手が「かばう」を使っている時に全体攻撃をすると、5体分の攻撃が全部、かばっている1体に当たります。',{
    at:'bottom',spot:[b2.x-10,b2.y-12,b2.w+20,b2.w+28],scene:'p2_order_3'
   });
   if(id!==runId)return;
   S.lockPrio=false;
   const pr=waitEvent(e=>e.type==='prio'&&e.v==='priority');
   await guide('そこで全体攻撃は基本「優先」にします。最初にかばう役を倒せば、後の味方は狙いたい相手を攻撃できます。',{
    at:'top',spot:[174,1214,102,68],finger:[225,1214,90],tap:false,scene:'p2_order_4'
   });
   await pr;
   if(id!==runId)return;
   S.lockPrio=true;
   await guide('正しい意味をタップしましょう。',{
    at:'top',spot:[0,760,720,452],finger:[180,[771,882,993,1104][correct]+48,0],tap:false,scene:'p2_order_5'
   });
   S.pauseTime=false;
  }
 });
 if(id!==runId)return;
 me().skill.on=true;player('B2').skill.on=true;
 await executeEngineTurn({myRes:'fast',npcUseSkill:{B2:true},scene:'p2_order_turn'});
 if(id!==runId)return;
 await wait(900);
}

/* 第2部-4: 長く生き残る (WASM エンジンで生存強化＆おばけ攻撃を実演) */
async function demoSurvive(){
 const id=runId;
 // B5をHP低いキャラ中心にして最後におばけ化をエンジンで再現
 const decksMap={
  ...NPC_DECKS,
  A3:DEFAULT_MY_DECK.slice(),
  B5:[1203,1739,1008,2122,535]
 };
 initBattleState(decksMap,{seed:401,count_step:1},'p2_survive');
 build();setChap('第2部','長く生き残る');
 S.showYou=false;
 renderRows(false);

 // 1ターン目: 味方が攻撃し、A3が生き残る
 const allyOnly={B1:'miss',B2:'miss',B3:'miss',B4:'miss',B5:'miss'};
 const r=await askQuestion(5,{order:[1,0,2,3],mustCorrect:true,lock:true,answers:allyOnly});
 if(id!==runId)return;
 await executeEngineTurn({myRes:r.res,npcAns:allyOnly,scene:'p2_survive_t1'});
 if(id!==runId)return;
 syncFromBattle(false);
 renderRows(true);
 const bMe=cardBox('A3',true);
 await guide('倒れずにターンを越えるたび、そのキャラの攻撃は強くなります。',{
  at:'bottom',spot:[bMe.x-10,bMe.y-12,140,154],finger:[bMe.x+60,bMe.y-12,90],scene:'p2_survive_1'
 });
 if(id!==runId)return;

 // B5の人が5体すべて倒れておばけになるまで裏で進める(味方1人だけが相手の同じ人を攻撃する。全員で攻撃すると試合が終わってしまう)
 for(let step=0;step<8&&!S.battle.players.B5.ghost&&!S.battle.finished;step++)silentTurn(['A3'],{A3:'B5'});
 syncFromBattle(false);
 renderRows(true);
 await wait(250);if(id!==runId)return;

 // おばけになったB5が正解して攻撃するターン(ほかの人は違う番号を選んでいる)
 const ghostOnly={A1:'miss',A2:'miss',A4:'miss',A5:'miss',B1:'miss',B2:'miss',B3:'miss',B4:'miss'};
 await toAnswerLayout();if(id!==runId)return;
 const rg=await askQuestion(4,{order:[1,0,2,3],mustCorrect:true,lock:true,answers:ghostOnly});
 if(id!==runId)return;
 await executeEngineTurn({
  myRes:rg.res,
  npcAns:ghostOnly,
  scene:'p2_survive_ghost'
 });
 if(id!==runId)return;
 const b5=cardBox('B5',true);
 await guide('5体全部倒れると「おばけ」になりますが、正解すれば攻撃できます(スキルは使えません)。',{
  at:'bottom',spot:[b5.x-10,b5.y-28,140,168],finger:[b5.x+60,b5.y-28,90],scene:'p2_survive_2'
 });
}

/* 第2部-5: チャット(APK PartTGEventComment の見た目・並び・TGEVENT_CHAT_A を再現) */
function renderChatModal(pageKey){
 const mod=$('.tg-modal');
 const list=CHAT_PAGES[pageKey]||CHAT_PAGES.B;
 mod.innerHTML=`<div class="tg-cmt" data-page="${pageKey}">
  <img class="tg-sp tg-cmt-bg" src="${IMG('PopUpCommonBack720480_type_Advanced_tag_SpriteContainer_format_AutomaticCompressed')}" alt="">
  <img class="tg-sp tg-cmt-line" src="${IMG('YellowLine_type_Advanced_tag_Team_format_RGBA16')}" alt="">
  <div class="tg-tx tg-cmt-title">Send  Message</div>
  <button class="tg-cmt-mute" type="button" data-act="chatmute">
   <img class="tg-sp tg-cmt-mbg" src="${IMG('RedButton')}" alt="">
   <img class="tg-sp tg-cmt-mico" src="${IMG('muteIcon')}" alt="">
   <span class="tg-tx">ミュート</span>
  </button>
  <div class="tg-cmt-nav">
   <button class="tg-cmt-arrow tg-cmt-prev" type="button" data-act="chatpage" data-val="prev"><img class="tg-sp" src="${IMG('Back1')}" alt="前"></button>
   ${['A','B','C'].map((k,i)=>`<button class="tg-cmt-tab${k===pageKey?' is-on':''}" type="button" data-act="chatpage" data-val="${k}" style="left:${74+i*110}px"><img class="tg-sp" src="${IMG('ButtonBlueWithGoldFrame60')}" alt=""><span class="tg-tx">${k}</span></button>`).join('')}
   <button class="tg-cmt-arrow tg-cmt-next" type="button" data-act="chatpage" data-val="next"><img class="tg-sp" src="${IMG('Next1')}" alt="次"></button>
  </div>
  <div class="tg-cmt-grid">${list.map(w=>`<button class="tg-cmt-item${CHAT_SMALL.has(w)?' is-small':''}" type="button" data-act="chatsend" data-val="${w}"><img class="tg-sp" src="${IMG('GreenButton_type_Advanced_tag_Team_format_RGBA16')}" alt=""><span class="tg-tx">${w}</span></button>`).join('')}</div>
 </div>`;
}
async function demoChat(){
 const id=runId;
 initBattleState({...NPC_DECKS,A3:DEFAULT_MY_DECK.slice()},{seed:501},'p2_chat');
 build();setChap('第2部','チャット');
 S.showYou=false;S.showLines=false;S.phase='answer';
 demoQuestion('sun');
 renderRows(false);
  const opened=waitEvent(e=>e.type==='chatopen');
 await guide('右下の緑のボタンで、味方に短い言葉を送れます。',{
  at:'top',spot:[556,1212,158,68],finger:[635,1212,90],tap:false,scene:'p2_chat_1'
 });
 await opened;
 if(id!==runId)return;
 guideOff();
 const sent=waitEvent(e=>e.type==='chatsend');
 await guide('同じ相手を狙ってほしい時は「Target!」、スキルを使ってほしい時は「Skill!」を使います。',{
  at:'top',spot:[0,740,720,540],tap:false,scene:'p2_chat_2'
 });
 await sent;
 if(id!==runId)return;
 guideOff();
 await wait(1800);
}

/* 第2部-6: 勝敗とランク */
async function demoRank(){
 const id=runId;
 initBattleState({...NPC_DECKS,A3:DEFAULT_MY_DECK.slice()},{seed:601},'p2_rank');
 build();setChap('第2部','勝敗とランク');
 S.phase='end';showQuestion(false);
 const scr=el('div','tg-result');
 scr.innerHTML=`<img class="tg-sp" src="${IMG('ScreenBattleBack')}" alt="" style="left:0;top:0;width:720px;height:1280px">
 <img class="tg-sp tg-resimg" src="${IMG('kanzensyouri')}" alt="完全勝利" style="left:-1px;top:-3px;width:722px;height:118px">
 <div class="tg-resrow">${S.A.map(p=>`<div class="tg-card tg-card-A" style="position:relative;transform:none">${cardHTML(p)}</div>`).join('')}</div>
 <div class="tg-rankbox"><div class="tg-rank-cur">Rank A+ → Rank S</div><div class="tg-rank-arrow">ランクアップ</div></div>`;
 stage.append(scr);
 await guide('勝つとランクが上がり、負けると下がります。',{at:'bottom',dim:false,scene:'p2_rank_1'});
 if(id!==runId)return;
 scr.remove();
}

function start(){clearAll();runPart1()}
let started=false;
window.openBattleTutorial=function(){
 const m=document.getElementById('guideTutorial');if(!m)return;
 if(started&&root===m)return;
 started=true;root=m;start();fx();
 if(window.ResizeObserver)new ResizeObserver(fit).observe(m);else addEventListener('resize',fit);
};
})();
