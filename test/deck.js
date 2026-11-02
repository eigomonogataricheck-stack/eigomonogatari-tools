/* 英語物語 非公式ツール: 図鑑のデッキ編成
   図鑑の「デッキを組む」を ON にすると、図鑑のキャラを押すたびに下のデッキ(5枠)へ入る。
   分類・絞り込み・キャラ名検索は図鑑の部品をそのまま使う。
   保存: localStorage eigoZukanDeckV1 = {mode:ON/OFF, slots:[{id,name} か null ×5]} */
const ZUKAN_DECK_KEY='eigoZukanDeckV1',ZUKAN_DECK_SIZE=5;
let zukanDeck=Array(ZUKAN_DECK_SIZE).fill(null),zukanDeckMode=false,zukanDeckTarget=null;

function zukanDeckSave(){try{localStorage.setItem(ZUKAN_DECK_KEY,JSON.stringify({mode:zukanDeckMode,slots:zukanDeck.map(c=>c?{id:characterKey(c),name:c.name||''}:null)}))}catch{}}
function zukanDeckLoad(){
  let data;try{data=JSON.parse(localStorage.getItem(ZUKAN_DECK_KEY)||'null')}catch{data=null}
  const slots=Array.isArray(data?.slots)?data.slots:[];
  zukanDeck=Array.from({length:ZUKAN_DECK_SIZE},(_,i)=>{const r=slots[i];if(!r)return null;return chars.find(c=>characterKey(c)===String(r.id)&&c.name===r.name)||chars.find(c=>c.name===r.name)||null});
  zukanDeckMode=!!data?.mode;
}
function zukanDeckHas(c,except=-1){const key=characterKey(c);return zukanDeck.some((x,i)=>i!==except&&x&&characterKey(x)===key)}
function zukanDeckMessage(text,type=''){const p=$('zukanDeckStatus');if(!p)return;p.textContent=text;p.dataset.state=type}

// 図鑑のキャラを押したとき(デッキを組む ON のとき)。空き枠を選んでいればそこへ、なければ左の空き枠へ入れる
function zukanDeckAdd(c){
  if(zukanDeckHas(c))return zukanDeckMessage(`${c.name}はすでにデッキに入っています(同じキャラは1体まで)。`,'error');
  const slot=zukanDeckTarget??zukanDeck.findIndex(x=>!x);
  if(slot<0)return zukanDeckMessage('デッキがいっぱいです。入れ替えたいキャラの×で外してください。','error');
  zukanDeck[slot]=c;zukanDeckTarget=null;zukanDeckSave();renderZukanDeck();
  zukanDeckMessage(`${c.name}を${slot+1}枠目に入れました。`,'success');
}
function zukanDeckRemove(i){const c=zukanDeck[i];zukanDeck[i]=null;if(zukanDeckTarget===i)zukanDeckTarget=null;zukanDeckSave();renderZukanDeck();if(c)zukanDeckMessage(`${c.name}を外しました。`)}

// 合計は完凸の値。コストやHPのデータがないキャラが入っていれば、その旨を出す
function zukanDeckSummary(){
  const list=zukanDeck.filter(Boolean),sum=pick=>{let total=0,missing=0;for(const c of list){const v=Number(pick(c.details||{}));if(Number.isFinite(v)&&pick(c.details||{})!=null)total+=v;else missing++}return {total,missing}};
  const cost=sum(d=>d.cost),hp=sum(d=>d.limitHp??d.hp),power=sum(d=>d.limitPower??d.power);
  const attrs={};for(const c of list){const a=canon(c.details?.attribute)||'不明';attrs[a]=(attrs[a]||0)+1}
  const value=x=>x.total.toLocaleString()+(x.missing?`(不明${x.missing})`:'');
  return [['体数',`${list.length} / ${ZUKAN_DECK_SIZE}`],['合計コスト',value(cost)],['完凸HP合計',value(hp)],['完凸Power合計',value(power)],['属性',Object.entries(attrs).map(([a,n])=>a+n).join(' ')||'—']];
}
function renderZukanDeck(){
  const tray=$('zukanDeck');if(!tray)return;
  const toggle=$('zukanDeckToggle');toggle.setAttribute('aria-pressed',String(zukanDeckMode));toggle.textContent=zukanDeckMode?'デッキを組む ON':'デッキを組む OFF';
  tray.hidden=!zukanDeckMode;$('page-zukan').classList.toggle('deck-mode',zukanDeckMode);
  $('zukanDeckSlots').innerHTML=zukanDeck.map((c,i)=>{
    const d=c?.details||{},target=zukanDeckTarget===i;
    return `<div class="deck-slot${c?'':' is-empty'}${target?' is-target':''}"><button type="button" class="deck-slot-pick" data-deck-slot="${i}" data-char-drag="deck:${i}" aria-label="${c?esc(c.name)+'の詳細を開く':`${i+1}枠目(空き)。押すと次のキャラをこの枠に入れます`}"${target?' aria-pressed="true"':''}>${c?`<img src="${esc(c.imageUrl||'')}" alt="" width="64" height="64" loading="lazy" decoding="async">`:`<span>${i+1}</span>`}</button>${c?`<button type="button" class="mini-reset danger deck-slot-remove" data-deck-remove="${i}" aria-label="${esc(c.name)}を外す">×</button><small>${esc([canon(d.attribute),d.cost!=null?'C'+d.cost:''].filter(Boolean).join(' '))}</small>`:''}</div>`}).join('');
  $('zukanDeckSummary').innerHTML=zukanDeckSummary().map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  syncZukanDeckMarks();
}
// 図鑑の一覧で、デッキに入っているキャラに印を付ける
function syncZukanDeckMarks(){
  const keys=new Set(zukanDeckMode?zukanDeck.filter(Boolean).map(characterKey):[]);
  document.querySelectorAll('#page-zukan .zk-card[data-char-index]').forEach(b=>b.parentElement.classList.toggle('in-deck',keys.has(characterKey(chars[Number(b.dataset.charIndex)]))));
}
function toggleZukanDeckMode(){zukanDeckMode=!zukanDeckMode;zukanDeckTarget=null;zukanDeckSave();renderZukanDeck();zukanDeckMessage(zukanDeckMode?'図鑑のキャラを押すとデッキに入ります。':'')}

function initZukanDeck(){
  if(!$('zukanDeck'))return;
  zukanDeckLoad();
  $('zukanDeckToggle').onclick=toggleZukanDeckMode;
  $('zukanDeckClear').onclick=()=>{if(!zukanDeck.some(Boolean))return;zukanDeck.fill(null);zukanDeckTarget=null;zukanDeckSave();renderZukanDeck();zukanDeckMessage('デッキを空にしました。')};
  $('zukanDeckSlots').onclick=e=>{
    const remove=e.target.closest('[data-deck-remove]');if(remove)return zukanDeckRemove(Number(remove.dataset.deckRemove));
    const pick=e.target.closest('[data-deck-slot]');if(!pick)return;
    const i=Number(pick.dataset.deckSlot),c=zukanDeck[i];
    if(c){const index=chars.indexOf(c);if(index>=0)openDetail(index,false,zukanDeck.filter(Boolean).map(x=>chars.indexOf(x)));return}
    zukanDeckTarget=zukanDeckTarget===i?null:i;renderZukanDeck();
    zukanDeckMessage(zukanDeckTarget===null?'':`次に押したキャラを${i+1}枠目に入れます。`);
  };
  // 一覧が描き直されたら印を付け直す
  new MutationObserver(()=>{if(zukanDeckMode)syncZukanDeckMarks()}).observe($('page-zukan'),{childList:true,subtree:true});
  renderZukanDeck();
}

// ドラッグ: デッキの枠どうしは入れ替え、お気に入りなど別の枠からは置く(同じキャラは置けない)
registerCharDrag('deck',{
  get:i=>zukanDeck[Number(i)]||null,
  accepts:(i,c,from)=>!zukanDeckHas(c,Number(i))||(from?.kind==='deck'&&characterKey(zukanDeck[Number(from.id)])===characterKey(c)),
  swap:(a,b)=>{[zukanDeck[Number(a)],zukanDeck[Number(b)]]=[zukanDeck[Number(b)],zukanDeck[Number(a)]];zukanDeckSave();renderZukanDeck()},
  place:(i,c)=>{zukanDeck[Number(i)]=c;zukanDeckTarget=null;zukanDeckSave();renderZukanDeck();zukanDeckMessage(`${c.name}を${Number(i)+1}枠目に入れました。`,'success')}
});
