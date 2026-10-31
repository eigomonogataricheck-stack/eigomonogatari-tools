const $=id=>document.getElementById(id),ATTRS=['火','水','風','火水','水風','風火','全'];
const MATCH={'火':{'火':2/3,'水':1/3,'風':1,'火水':1/2,'水風':2/3,'風火':5/6,'全':2/3},'水':{'火':1,'水':2/3,'風':1/3,'火水':5/6,'水風':1/2,'風火':2/3,'全':2/3},'風':{'火':1/3,'水':1,'風':2/3,'火水':2/3,'水風':5/6,'風火':1/2,'全':2/3},'火水':{'火':5/6,'水':1/2,'風':2/3,'火水':2/3,'水風':7/12,'風火':3/4,'全':2/3},'水風':{'火':2/3,'水':5/6,'風':1/2,'火水':3/4,'水風':2/3,'風火':7/12,'全':2/3},'風火':{'火':1/2,'水':2/3,'風':5/6,'火水':7/12,'水風':3/4,'風火':2/3,'全':2/3},'全':{'火':2/3,'水':2/3,'風':2/3,'火水':2/3,'水風':2/3,'風火':2/3,'全':2/3}};
let chars=[],current=-1,detailOrder=[],pickerRole=null,fromPicker=false,lastDirection=1,selected={attacker:null,defender:null},skillEnabled={attacker:false,defender:false},detailMode=false,lastResult=null,ghostData=null,tempCharacters=[],borrowedSkills={attacker:[],defender:[]},borrowedEnabled={attacker:[],defender:[]},pickerPurpose='character';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canon=s=>String(s??'').replace(/火風/g,'風火').replace(/属性/g,'').trim();
const fmt=n=>{n=Math.round((Number(n)||0)*1e6)/1e6;return Number.isInteger(n)?String(n):String(n).replace(/0+$/,'').replace(/\.$/,'')};
let numericFocusScroll=null;
function keepNumericViewport(input){input.addEventListener('focus',()=>{numericFocusScroll={x:scrollX,y:scrollY}});input.addEventListener('blur',()=>{if(!numericFocusScroll)return;let pos=numericFocusScroll;numericFocusScroll=null;requestAnimationFrame(()=>scrollTo(pos.x,pos.y))})}
function calculatorSyncStyledSelect(select){if(!select)return;let host=select.closest('.calculator-styled-select');if(!host){host=document.createElement('span');host.className='calculator-styled-select coop-styled-select';select.parentNode.insertBefore(host,select);host.append(select);let button=document.createElement('button');button.type='button';button.className='calculator-styled-select-button coop-styled-select-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');let menu=document.createElement('span');menu.className='calculator-styled-select-menu coop-styled-select-menu';menu.hidden=true;host.append(button,menu);button.onclick=event=>{event.preventDefault();event.stopPropagation();let open=menu.hidden;document.querySelectorAll('.coop-styled-select-menu').forEach(x=>x.hidden=true);document.querySelectorAll('.coop-styled-select-button').forEach(x=>x.setAttribute('aria-expanded','false'));menu.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open){requestAnimationFrame(()=>{let rect=button.getBoundingClientRect(),viewport=window.visualViewport,viewLeft=viewport?.offsetLeft||0,viewTop=viewport?.offsetTop||0,viewWidth=viewport?.width||innerWidth,viewHeight=viewport?.height||innerHeight,maxWidth=Math.max(120,viewWidth-16);menu.style.setProperty('width','max-content','important');menu.style.setProperty('max-width',`${maxWidth}px`,'important');let naturalWidth=Math.ceil(menu.scrollWidth+12),menuWidth=Math.min(maxWidth,Math.max(rect.width,naturalWidth,150));menu.style.setProperty('width',`${menuWidth}px`,'important');let menuHeight=Math.min(menu.scrollHeight,320),left=Math.min(Math.max(viewLeft+8,rect.left),viewLeft+viewWidth-menuWidth-8),spaceBelow=viewTop+viewHeight-rect.bottom,top=spaceBelow>=menuHeight+8?rect.bottom+5:Math.max(viewTop+8,rect.top-menuHeight-5);menu.style.setProperty('left',`${left}px`,'important');menu.style.setProperty('top',`${top}px`,'important')})}}}let button=host.querySelector('.calculator-styled-select-button'),menu=host.querySelector('.calculator-styled-select-menu'),selected=select.selectedOptions[0];button.textContent=selected?.textContent||'';menu.innerHTML='';[...select.options].forEach(option=>{let item=document.createElement('button');item.type='button';item.className='coop-styled-select-option';item.textContent=option.textContent;item.setAttribute('aria-selected',String(option.value===select.value));item.onclick=event=>{event.preventDefault();event.stopPropagation();select.value=option.value;menu.hidden=true;button.setAttribute('aria-expanded','false');calculatorSyncStyledSelect(select);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}))};menu.append(item)})}
function calculatorEnhanceSelects(){let page=$('page-calculator');if(!page)return;page.querySelectorAll('select').forEach(select=>'switch' in select.dataset?uiBuildSwitch(select):calculatorSyncStyledSelect(select));page.querySelectorAll('input[type=checkbox][data-switch]').forEach(uiBuildSwitch)}
/* 2択の切替スイッチ(図鑑の「含む/一致」と同じ形)。元の select / checkbox は隠して残し、値と計算処理はそのまま使う */
/* 計算機の見出し(攻撃キャラ/攻撃対象キャラ)は省略せず全文を出す。どちらかの見出しがボタンと1行に収まらないときは、両方のカードでボタンを下の行へ回し、画像の位置をそろえる */
function syncFighterTitles(){const titles=[...document.querySelectorAll('#page-calculator .fighter-title')];if(!titles.length||!titles[0].clientWidth)return;titles.forEach(t=>t.classList.remove('is-stacked'));const stack=titles.some(t=>t.scrollWidth>t.clientWidth+1);titles.forEach(t=>t.classList.toggle('is-stacked',stack))}
function watchFighterTitles(){const battle=document.querySelector('#page-calculator .battle');if(battle&&'ResizeObserver' in window)new ResizeObserver(syncFighterTitles).observe(battle);syncFighterTitles()}
function uiSwitchChoices(control){if(control.type==='checkbox')return control.dataset.switch.split('/').map((text,i)=>({value:i===0,text}));return [...control.options].map(o=>({value:o.value,text:o.textContent}))}
function uiBuildSwitch(control){if(control.uiSwitch)return;const box=document.createElement('span');box.className='ui-switch';box.setAttribute('role','radiogroup');for(const choice of uiSwitchChoices(control)){const b=document.createElement('button'),m=String(choice.text).match(/^(.*?)[（(](.*)[）)]$/);b.type='button';b.setAttribute('role','radio');b.dataset.value=String(choice.value);b.innerHTML=m?`${esc(m[1])}<small>${esc(m[2])}</small>`:esc(choice.text);b.onclick=e=>{e.preventDefault();if(control.type==='checkbox')control.checked=choice.value;else control.value=choice.value;control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));uiSyncSwitch(control)};box.append(b)}const hide=control.closest('[data-switch-hide]')||control.closest('.calculator-self-checkbox-control')||control;hide.classList.add('ui-switch-native');hide.after(box);control.uiSwitch=box;uiSyncSwitch(control)}
function uiSyncSwitch(control){const current=String(control.type==='checkbox'?control.checked:control.value);control.uiSwitch?.querySelectorAll('button').forEach(b=>{const on=b.dataset.value===current;b.classList.toggle('active',on);b.setAttribute('aria-checked',String(on))})}
function calculatorRefreshStyledSelects(){document.querySelectorAll('#page-calculator select,#page-calculator input[data-switch]').forEach(select=>{if(select.uiSwitch){uiSyncSwitch(select);return}let button=select.closest('.calculator-styled-select')?.querySelector('.calculator-styled-select-button');if(button)button.textContent=select.selectedOptions[0]?.textContent||''})}
addEventListener('DOMContentLoaded',init);
function init(){setupCharacterFilters();loadTemporaryCharacters();ATTRS.forEach(a=>{$('attackerAttribute').add(new Option(a,a));$('defenderAttribute').add(new Option(a,a))});for(let n=0;n<=10;n++)$('survivalTurns').add(new Option(`${n}ターン（×1.3^${n}）`,n));calculatorEnhanceSelects();keepNumericViewport($('attackerPower'));keepNumericViewport($('defenderHp'));makeFields('attackBuffFields','attackBuffRate','追加攻撃力増加',4);makeFields('extraHitFields','extraHit','追加連撃効果',3,'回');makeFields('cutRateFields','cutRate','追加軽減率',6);makeFields('extraHealFields','extraHeal','追加回復効果',3);bind();bindPageHelp();watchFighterTitles();document.querySelectorAll('#page-coop input[type=checkbox][data-switch]').forEach(uiBuildSwitch);loadCalculatorPrefs();loadData();calculate()}
function makeFields(box,prefix,label,count,unit='%'){for(let i=1;i<=count;i++){let l=document.createElement('label');l.hidden=i>1;l.textContent=`${label}${i}（${unit}）`;let q=document.createElement('input');q.type='number';q.step='any';q.inputMode='decimal';keepNumericViewport(q);q.id=prefix+i;q.placeholder=i===1?(prefix==='extraHit'?'例: 5':'例: 80'):'';q.oninput=()=>{progress(prefix,count);calculate()};l.append(q);$(box).append(l)}}
function fieldCount(prefix){return prefix==='attackBuffRate'?4:prefix==='extraHit'||prefix==='extraHeal'?3:6}
function progress(prefix,count=fieldCount(prefix)){for(let i=2;i<=count;i++){let q=$(prefix+i),prev=$(prefix+(i-1)),show=prev.value!==''&&Number(prev.value)!==0;q.parentElement.hidden=!show;if(!show)q.value=''}}
function bind(){setSidebarOpen(false);$('menuToggle').onclick=toggleMenu;PC_MENU.addEventListener?.('change',syncMenuToggle);syncMenuToggle();document.addEventListener('click',e=>{if($('sidebar').classList.contains('open')&&!e.target.closest('#sidebar,#menuToggle'))setSidebarOpen(false)});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('sidebar').classList.contains('open')){setSidebarOpen(false);$('menuToggle').focus()}});['answerSpeed','selfMode','questionLevel'].forEach(id=>$(id).addEventListener('change',saveCalculatorPrefs));document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$('attackerPicker').onclick=()=>openPicker('attacker','character');$('defenderPicker').onclick=()=>openPicker('defender','character');$('zkSearch').oninput=renderZukan;$('pickerSearch').oninput=renderPicker;document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).hidden=true);document.querySelectorAll('#detailActions button').forEach(b=>b.onclick=()=>choose(b.dataset.role));$('detailPrev').onclick=()=>move(-1);$('detailNext').onclick=()=>move(1);$('tempToggle').onclick=()=>$('tempDrawer').classList.toggle('open');$('tempClearSelected').onclick=removeSelectedTemporary;$('tempClearAll').onclick=clearAllTemporary;$('detailTemp').onclick=toggleCurrentTemporary;$('attackerBorrowSkill').onclick=()=>openPicker('attacker','skill');$('defenderBorrowSkill').onclick=()=>openPicker('defender','skill');$('swap').onclick=swap;$('attackerSkillBtn').onclick=()=>toggleSkill('attacker');$('defenderSkillBtn').onclick=()=>toggleSkill('defender');['attackerPower','defenderHp','attackerAttribute','defenderAttribute','answerSpeed','selfMode','attackerEvent','defenderEvent','questionLevel','survivalTurns','allAttack'].forEach(id=>$(id).oninput=calculate);$('downloadResult').onclick=downloadResult;$('resetAll').onclick=resetAll;$('detailMode').onclick=toggleDetailMode;syncDetailMode();for(let r of ['attacker','defender']){$(r+'ResetExceptCharacter').onclick=()=>resetExceptCharacter(r);$(r+'RemoveCharacter').onclick=()=>removeCharacter(r)}let confirmKeyDown=false;window.addEventListener('keydown',e=>{if($('detail').hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable||e.repeat)return;let k=e.key.toLowerCase(),dir=0;if(k==='a'||k==='j'||e.key==='ArrowLeft')dir=-1;else if(k==='d'||k==='k'||e.key==='ArrowRight')dir=1;else if(e.key==='Enter'||e.key===' '){if(confirmKeyDown)return;confirmKeyDown=true;dir=lastDirection}else if(e.key==='Escape'){$('detail').hidden=true;return}if(dir){e.preventDefault();e.stopPropagation();move(dir)}},true);window.addEventListener('keyup',e=>{if(e.key==='Enter'||e.key===' ')confirmKeyDown=false},true)}
// 左のメニュー: スマホ・タブレットでは≡で引き出しを開閉、PCでは≡で「文字あり」と「アイコンだけ」を切り替えて覚えておく
const PC_MENU=matchMedia('(min-width:1000px)');
function setSidebarOpen(open){$('sidebar').classList.toggle('open',open);syncMenuToggle()}
function toggleMenu(){if(!PC_MENU.matches){setSidebarOpen(!$('sidebar').classList.contains('open'));return}let collapsed=document.documentElement.classList.toggle('sidebar-collapsed');try{localStorage.setItem('eigoSidebarCollapsed',collapsed?'1':'0')}catch{}syncMenuToggle()}
function syncMenuToggle(){let collapsed=document.documentElement.classList.contains('sidebar-collapsed'),open=PC_MENU.matches?!collapsed:$('sidebar').classList.contains('open');$('menuToggle').setAttribute('aria-expanded',String(open));$('menuToggle').setAttribute('aria-label',open?'メニューを閉じる':'メニューを開く');document.querySelectorAll('#sidebar [data-page]').forEach(b=>{if(PC_MENU.matches&&collapsed)b.title=b.textContent.trim();else b.removeAttribute('title')})}
function showPage(n){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+n));document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===n));setSidebarOpen(false)}
async function loadData(){try{let r=await fetch('zukan_beta.json',{cache:'no-cache'}).then(x=>{if(!x.ok)throw Error(x.status);return x.json()});chars=Array.isArray(r)?r:(r.characters||[]);if(!chars.length)throw Error('charactersが空です');$('zkStatus').textContent='';initZukanAdvancedFilters();renderZukan();renderTemporaryCharacters();renderPickerTemporary();if(typeof hydrateCoopState==='function')hydrateCoopState()}catch(error){chars=[];$('zkStatus').textContent='図鑑データを読み込めません';console.error(error)}}
function results(q=''){q=String(q).normalize('NFKC').replace(/[\s　]+/g,'').toLowerCase();return chars.map((c,i)=>({c,i})).filter(x=>!q||String(x.c.name||'').normalize('NFKC').replace(/[\s　]+/g,'').toLowerCase().includes(q))}
/* 各ページの「使い方」ボタンで開く短い説明。詳しい仕様は「使い方」ページ(catalog.js の renderComprehensiveHelp) */
const PAGE_HELP={
 calculator:{title:'ダメージ計算機の使い方',steps:[
  '「攻撃キャラ」と「攻撃対象キャラ」の枠を押してキャラを選びます。Power(攻撃側)・HP(攻撃対象)・属性が、完凸の値で自動で入ります。',
  'イベント補正・解答速度・自力モード・問題レベルを、実際の対戦に合わせて切り替えます。',
  'ゆるスキルを使うときは「スキル使用」を押します。ほかのキャラのスキルも重ねたいときは「他キャラのスキルを追加」で選び、その行の「スキル使用」を押します。',
  '予想ダメージ欄で結果を見ます。確定撃破は最低ダメージでも倒せる、乱数撃破は乱数しだい、撃破不可は倒せない、という意味です。'],
  tips:['スキル以外で受けている攻撃力アップや軽減は、「追加攻撃力増加」「追加軽減率」に%で入れます。','「詳細モード」をONにすると、生存補正・全体攻撃・追加連撃・追加回復と、幽霊攻撃への耐久が使えます。','「キャラ以外リセット」はキャラとPower/HP・属性・イベント補正を残して他を戻し、「キャラ削除」はキャラごと消します。','「計算結果を保存」すると計算履歴(最大100件)に残り、「計算機に反映」で入力を戻せます。','キャラ画像はドラッグで動かせます(スマホは長押ししてから動かす)。攻撃キャラと攻撃対象キャラの間で動かすと入れ替わり、「他キャラのスキル」の欄に置くとそのキャラのスキルを追加します。']},
 zukan:{title:'キャラ図鑑の使い方',steps:[
  '「分類」では、上の段で大分類と中分類、下の段で小分類を選ぶとキャラが並びます。「一覧」を押すと、全分類を見渡して選べます。',
  '「絞り込み」では、属性・レア・Cost・スキル・分類などの条件を選びます。下に該当数が出るので、「この条件でキャラを表示」を押します。',
  '「キャラ名で検索」では、名前の一部を入れると該当するキャラが分類ごとに出ます。',
  'キャラを押すと詳細が開きます。詳細から「攻撃キャラに設定」「攻撃対象に設定」「お気に入りに追加」ができます。'],
  tips:['詳細画面は ← →(A・D、J・K でも可)で前後のキャラへ移り、Esc で閉じます。','絞り込みは、同じ項目の中で複数選ぶと「どれか」、別の項目どうしは「すべて」に当てはまるキャラが出ます。','キャラ画像の右上の☆を押すとお気に入りに登録(★)、もう一度押すと解除できます。','お気に入りのキャラは右上の「お気に入り」と、各ページのキャラ選択から呼び出せます。「お気に入り」のキャラ画像は、各ページのキャラの枠へドラッグしても置けます。']},
 coop:{title:'協力ダメージ計算の使い方',steps:[
  '敵を入れます。1〜5層の表の左・真ん中・右の行を押して敵キャラを選ぶと、属性とHP(無凸HP×層の倍率)が自動で出ます。',
  '味方デッキの上の操作欄で、「自力」(自力/他力)と「問題レベル」を実際のプレイに合わせます。全員の火力に掛かります。',
  '味方デッキを入れます。デッキは協力に参加する人ごとの5体で、1枠目が1層、2枠目が2層…と同じ番号の層を攻撃します。1つ入れると次のデッキ欄が出ます(最大5デッキ)。',
  '「手動デッキ判定」を見ます。入力したデッキが、どの順番で出撃しても、層の3体のどれを狙っても全滅できるかを調べます。確定撃破ならどの場合でも全滅、ランダム撃破なら場合による、撃破不可なら全滅できません。'],
  tips:['ランダム撃破・撃破不可のときは、失敗する層と、その時の出撃順・攻撃先の例が表示されます。','味方の2〜5枠目に選べるのは、攻撃力アップ・連撃・全体攻撃・短縮のスキルを持つキャラだけです。キャラ選択の「ドロップキャラ」から、敵として入れたキャラも選べます。','各キャラの右上の×で、その枠のキャラを外せます。','キャラ画像はドラッグで動かせます(スマホは長押ししてから動かす)。敵どうし・味方どうしは入れ替わり、敵を味方の枠に置くとそのキャラが入ります。置けない枠は赤い点線になります。','各キャラの「スキル確認」で、その枠に掛かっているスキル(他の枠・他のデッキから受けているものを含む)を確認できます。','「デッキ1のみ自動入力」は、各層の真ん中の敵キャラをデッキ1の1〜5枠に入れます。','「詳細モード」をONにすると、敵の無凸HP・属性と味方のPowerを手入力でき、「デッキ提案」(空いている枠を自動で探す機能)が使えます。','「記録」で敵と入力中のデッキを記録データ(最大5件)に残し、「現在に反映」で呼び出せます。']},
 'coop-report':{title:'協力報告書作成の使い方',steps:[
  '「列」「行」の − ＋ で、マスの数を決めます(最初は3列5行、最大12列20行)。',
  '各マスの画像の部分を押してキャラを選び、下の欄に数値を入れます。',
  '消したいときは右上の「削除」を押します。各マスの削除ボタンと「全削除」が出ます。「削除終了」で元に戻ります。'],
  tips:['入力した内容と列・行の数は、このブラウザーに自動で保存されます。','列・行を減らしても、キャラの位置(何行目・何列目)は変わりません。表の外に出たマスは、増やし直すと元の位置に戻ります。','でき上がった表は、端末のスクリーンショットで共有してください。','キャラ画像はドラッグで別のマスへ動かせます(スマホは長押ししてから動かす)。数値も一緒に入れ替わります。']},
 migration:{title:'データ移行の使い方',steps:[
  '今まで使っていたブラウザーでこのページを開き、「移行コードを発行」→「コードをコピー」を押します。',
  'コピーしたコードを、メモやメッセージなどで新しい端末・ブラウザーへ送ります。コードが長くてメッセージで切れるときは、「ファイルに保存」でできたファイルを送ります。',
  '新しいブラウザーでこのページを開き、コードを貼り付けるか「ファイルから読み込む」でファイルを選び、「データを取り込む」を押します。確認のあと、ページが読み込み直されます。'],
  tips:['以前に発行した EIGO1- から始まるコードも、そのまま取り込めます。','取り込むと、移行先にある同じ種類のデータは上書きされます。','移行コードには保存データがそのまま入っているので、他の人には渡さないでください。']}
};
function openPageHelp(page){const d=PAGE_HELP[page];if(!d)return;$('pageHelpTitle').textContent=d.title;$('pageHelpSteps').replaceChildren(...d.steps.map(t=>{const li=document.createElement('li');li.textContent=t;return li}));const tips=$('pageHelpTips');tips.replaceChildren(...(d.tips||[]).map(t=>{const p=document.createElement('p');p.textContent=t;return p}));tips.hidden=!d.tips?.length;const sheet=$('pageHelp');sheet.hidden=false;sheet.querySelector('.close-button').focus()}
function closePageHelp(){$('pageHelp').hidden=true}
function bindPageHelp(){document.addEventListener('click',e=>{const go=e.target.closest('[data-go]');if(go){showPage(go.dataset.go);scrollTo(0,0);return}const open=e.target.closest('[data-help]');if(open){openPageHelp(open.dataset.help);return}if(e.target.closest('[data-help-close]'))closePageHelp();const sheetClose=e.target.closest('.cat-sheet-close');if(sheetClose)sheetClose.closest('.picker-category-sheet').hidden=true});document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('pageHelp').hidden){closePageHelp();return}const sheet=[...document.querySelectorAll('.picker-category-sheet')].find(x=>!x.hidden);if(sheet)sheet.hidden=true});$('pageHelpMore').onclick=()=>{closePageHelp();showPage('help');scrollTo(0,0)}}

// キャラ画像のドラッグ&ドロップ(計算機・協力ダメージ計算・協力報告書・お気に入りで共通の部品)
// 掴める/落とせる要素に data-char-drag="種類:番号" を付け、種類ごとの動きを registerCharDrag で登録する。
//   get(id): その枠のキャラ(空なら null) / accepts(id,c,相手の枠): 置けるか / swap(fromId,toId): 同じ種類どうしの入れ替え / place(id,c): 別の種類から置く
// マウスは押したまま少し動かすと、タッチは長押し(約0.35秒)してから動かすと掴める。普通のタップ・クリックは今までどおりキャラ選択を開く。
const charDragKinds={};
function registerCharDrag(kind,handler){charDragKinds[kind]=handler}
(()=>{
  let pending=null,drag=null,suppressClick=false;
  const parse=el=>{const v=el?.dataset.charDrag||'',i=v.indexOf(':');return i<0?null:{el,kind:v.slice(0,i),id:v.slice(i+1)}};
  const allowed=(src,dst)=>{if(!dst||(dst.kind===src.kind&&dst.id===src.id))return null;const h=charDragKinds[dst.kind];if(!h)return null;if(dst.kind===src.kind)return h.swap?(h.accepts?.(dst.id,src.c,src)??true)&&(!src.h.accepts||!h.get(dst.id)||src.h.accepts(src.id,h.get(dst.id),dst)):false;return h.place?(h.accepts?.(dst.id,src.c,src)??true):false};
  const targetAt=(x,y)=>parse(document.elementFromPoint(x,y)?.closest('[data-char-drag]'));
  function clearTarget(){if(!drag?.target)return;drag.target.el.classList.remove('char-drop-target','char-drop-invalid');drag.target=null}
  function begin(p){
    const h=charDragKinds[p.src.kind],c=h?.get(p.src.id);if(!c)return pending=null;
    p.src.c=c;p.src.h=h;drag={src:p.src,target:null,x:p.x,y:p.y,ghost:document.createElement('div')};pending=null;
    drag.ghost.className='char-drag-ghost';if(c.imageUrl)drag.ghost.style.backgroundImage=`url("${String(c.imageUrl).replace(/"/g,'')}")`;
    document.body.append(drag.ghost);document.body.classList.add('char-dragging');p.src.el.classList.add('char-drag-source');
    if(p.src.kind==='temp'&&innerWidth<=800)$('tempDrawer')?.classList.remove('open');
    navigator.vibrate?.(15);moveTo(p.x,p.y);autoScroll();
  }
  function moveTo(x,y){
    drag.x=x;drag.y=y;drag.ghost.style.left=x+'px';drag.ghost.style.top=y+'px';
    const t=targetAt(x,y);if(t?.el===drag.target?.el)return;clearTarget();if(!t||t.el===drag.src.el)return;
    const ok=allowed(drag.src,t);if(ok===null)return;drag.target={...t,ok};t.el.classList.add(ok?'char-drop-target':'char-drop-invalid');
  }
  // 端に近づけたら、その位置のスクロールできる欄(なければページ)を少しずつスクロールする
  function autoScroll(){
    if(!drag)return;const edge=48,{x,y}=drag;let el=document.elementFromPoint(x,y),box=null;
    while(el&&el!==document.body){const s=getComputedStyle(el);if(/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight){box=el;break}el=el.parentElement}
    const r=box?box.getBoundingClientRect():{top:0,bottom:innerHeight},dy=y<r.top+edge?-12:y>r.bottom-edge?12:0;
    if(dy){if(box)box.scrollTop+=dy;else scrollBy(0,dy);moveTo(x,y)}
    requestAnimationFrame(autoScroll);
  }
  function finish(cancel){
    if(pending){clearTimeout(pending.timer);pending=null}
    if(!drag)return;const {src,target}=drag;clearTarget();drag.ghost.remove();src.el.classList.remove('char-drag-source');document.body.classList.remove('char-dragging');drag=null;
    suppressClick=true;setTimeout(()=>suppressClick=false,0);
    if(cancel||!target?.ok)return;const h=charDragKinds[target.kind];
    if(target.kind===src.kind)h.swap(src.id,target.id);else h.place(target.id,src.c);
  }
  document.addEventListener('pointerdown',e=>{
    if(drag||(e.pointerType==='mouse'&&e.button!==0))return;const src=parse(e.target.closest('[data-char-drag]'));if(!src||!charDragKinds[src.kind]?.get(src.id))return;
    pending={src,x:e.clientX,y:e.clientY,touch:e.pointerType!=='mouse',timer:0};
    if(pending.touch)pending.timer=setTimeout(()=>pending&&begin(pending),350);
  });
  document.addEventListener('pointermove',e=>{
    if(drag){e.preventDefault();moveTo(e.clientX,e.clientY);return}
    if(!pending)return;const far=Math.hypot(e.clientX-pending.x,e.clientY-pending.y)>6;
    if(far&&pending.touch){clearTimeout(pending.timer);pending=null}else if(far){pending.x=e.clientX;pending.y=e.clientY;begin(pending)}
  });
  document.addEventListener('pointerup',()=>finish(false));
  document.addEventListener('pointercancel',()=>finish(true));
  // 掴んでいる間はタッチでページがスクロールしないようにする
  document.addEventListener('touchmove',e=>{if(drag)e.preventDefault()},{passive:false});
  document.addEventListener('contextmenu',e=>{if(pending||drag)e.preventDefault()});
  document.addEventListener('dragstart',e=>{if(e.target.closest?.('[data-char-drag]'))e.preventDefault()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag)finish(true)});
  addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false}},true);
})();
registerCharDrag('calc',{get:r=>selected[r]||null,swap:()=>swap(),place:(r,c)=>setCharacter(r,c)});
registerCharDrag('calc-borrow',{get:()=>null,accepts:(r,c)=>pickerSkillAllowed(c,'skill',r),place:(r,c)=>addBorrowedSkill(r,c)});
registerCharDrag('temp',{get:key=>chars.find(c=>characterKey(c)===key)||null});
