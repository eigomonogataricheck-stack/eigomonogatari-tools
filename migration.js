/* 英語物語 対戦ツール: browser data migration */
(()=>{
  'use strict';
  const FORMAT='eigo-site-migration';
  const VERSION=1;
  // EIGO2- … キャラの中身を「番号・ID・名前」に置き換えたうえで圧縮した短いコード(今の形式)
  // EIGO1- … 保存データをそのまま入れた古いコード(取り込みだけ対応)
  const PREFIX='EIGO2-',OLD_PREFIX='EIGO1-';
  const ALLOWED_KEYS=new Set([
    'eigoTemporaryCharacters',
    'eigoCalculatorHistoryV1',
    'eigoCoopCalculatorV1',
    'eigoCoopProposalHistoryV1',
    'eigoCoopSelfMode',
    'eigoCoopQuestionLevel'
  ]);

  function migrationKeys(){
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key&&(ALLOWED_KEYS.has(key)||key.startsWith('eigo')))keys.push(key);
    }
    return [...new Set(keys)].sort();
  }

  function bytesToBase64Url(bytes){
    let binary='';
    for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  function base64UrlToBytes(value){
    const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(normalized+'='.repeat((4-normalized.length%4)%4));
    return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  }

  async function streamBytes(bytes,stream){
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  // 計算履歴や報告書はキャラの中身ごと保存しているため、そのままだとコードが数十万文字になり、送る途中で切れる。
  // 図鑑データと完全に同じキャラは {"$c":番号,"k":ID,"n":名前} に置き換え、取り込むときに図鑑データから元に戻す。
  async function characterList(){
    const ready=()=>typeof chars!=='undefined'&&chars.length;
    for(let i=0;i<100&&!ready();i++)await new Promise(r=>setTimeout(r,100));
    if(!ready())throw new Error('キャラデータを読み込めていません。ページを開き直してから、もう一度お試しください。');
    return chars;
  }
  function packCharacters(value,index){
    if(Array.isArray(value))return value.map(v=>packCharacters(v,index));
    if(!value||typeof value!=='object')return value;
    if(typeof value.name==='string'&&'imageUrl' in value&&'details' in value){
      const hit=index.get(JSON.stringify(value));
      if(hit!==undefined)return {$c:hit,k:String(value.id??''),n:value.name};
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,packCharacters(v,index)]));
  }
  function unpackCharacters(value,list){
    if(Array.isArray(value))return value.map(v=>unpackCharacters(v,list));
    if(!value||typeof value!=='object')return value;
    if(Number.isInteger(value.$c)&&typeof value.n==='string'){
      const same=c=>String(c?.id??'')===value.k&&c?.name===value.n;
      const c=same(list[value.$c])?list[value.$c]:list.find(same)||list.find(x=>x?.name===value.n);
      if(!c)throw new Error(`キャラ「${value.n}」が見つかりません。移行元と同じサイトのページで取り込んでください。`);
      return c;
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unpackCharacters(v,list)]));
  }
  // 保存値がJSONならキャラを置き換える(JSONでない値はそのまま)
  function mapJsonValue(value,fn){
    let data;
    try{data=JSON.parse(value)}catch{return value}
    return JSON.stringify(fn(data));
  }

  async function makeCode(){
    const list=await characterList(),index=new Map();
    list.forEach((c,i)=>{const key=JSON.stringify(c);if(!index.has(key))index.set(key,i)});
    const storage={};
    for(const key of migrationKeys())storage[key]=mapJsonValue(localStorage.getItem(key),data=>packCharacters(data,index));
    const payload={format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),storage};
    return PREFIX+bytesToBase64Url(await streamBytes(new TextEncoder().encode(JSON.stringify(payload)),new CompressionStream('deflate-raw')));
  }

  async function readCode(raw){
    const code=String(raw||'').replace(/\s+/g,'');
    const packed=code.startsWith(PREFIX);
    if(!packed&&!code.startsWith(OLD_PREFIX))throw new Error('英語物語用の移行コードではありません。EIGO2- (古いコードは EIGO1-)から始まる全体を貼り付けてください。');
    let payload;
    try{
      let bytes=base64UrlToBytes(code.slice(PREFIX.length));
      if(packed)bytes=await streamBytes(bytes,new DecompressionStream('deflate-raw'));
      payload=JSON.parse(new TextDecoder().decode(bytes));
    }
    catch{throw new Error('移行コードを読み取れません。途中で切れている可能性があります。コード全体をコピーするか、「ファイルに保存」で移してください。')}
    if(payload?.format!==FORMAT||payload?.version!==VERSION||!payload.storage||typeof payload.storage!=='object'){
      throw new Error('対応していない移行コードです。');
    }
    const list=packed?await characterList():null,storage={};
    for(const [key,value] of Object.entries(payload.storage)){
      if((ALLOWED_KEYS.has(key)||key.startsWith('eigo'))&&typeof value==='string')storage[key]=packed?mapJsonValue(value,data=>unpackCharacters(data,list)):value;
    }
    return {payload,storage};
  }

  function setStatus(text,type=''){
    const status=document.getElementById('migrationStatus');
    if(!status)return;
    status.textContent=text;
    status.className='migration-status'+(type?' '+type:'');
  }

  function ensureUi(){
    const host=document.getElementById('migrationMount');
    if(!host||document.getElementById('browserDataMigration'))return;
    const section=document.createElement('section');
    section.id='browserDataMigration';
    section.className='migration-panel';
    section.innerHTML=`
      <div class="migration-grid">
        <section class="migration-box">
          <h3><span class="help-num">01</span>移行元でコードを発行</h3>
          <p>今まで使っていたブラウザーでこのページを開き、コードを発行してコピーします。長いときは「ファイルに保存」も使えます。</p>
          <button id="migrationExport" class="reset-btn" type="button">移行コードを発行</button>
          <textarea id="migrationOutput" rows="6" readonly placeholder="発行したコードがここに表示されます"></textarea>
          <div class="migration-actions"><button id="migrationCopy" class="reset-btn" type="button" disabled>コードをコピー</button><button id="migrationSave" class="reset-btn" type="button" disabled>ファイルに保存</button></div>
        </section>
        <section class="migration-box">
          <h3><span class="help-num">02</span>移行先でコードを取り込む</h3>
          <p>新しいブラウザーでこのページを開き、コピーしたコードを貼り付けるか、保存したファイルを読み込んでから取り込みます。</p>
          <textarea id="migrationInput" rows="6" spellcheck="false" placeholder="EIGO2- から始まる移行コードを貼り付け"></textarea>
          <div class="migration-actions"><label class="reset-btn migration-file">ファイルから読み込む<input id="migrationFile" type="file" accept=".txt,text/plain"></label><button id="migrationImport" class="primary" type="button">データを取り込む</button></div>
        </section>
      </div>
      <p id="migrationStatus" class="migration-status" role="status" aria-live="polite"></p>
      <section class="migration-info">
        <h3>移行されるデータ</h3>
        <ul>
          <li>お気に入りのキャラ</li>
          <li>計算機の計算履歴と、詳細モード・解答速度・自力モード・問題レベルの設定</li>
          <li>協力ダメージ計算の敵・味方デッキ・Power・計算条件・記録データ</li>
          <li>協力報告書のキャラ・数値・列数・行数</li>
        </ul>
        <p class="migration-note">計算履歴などが多いとコードが長くなり、メッセージで送ると途中で切れることがあります。そのときは「ファイルに保存」でできたファイルを送り、移行先で「ファイルから読み込む」を使ってください。取り込むと、移行先にある同じ種類のデータは上書きされます。デッキ提案の詳細計算の途中結果は移行されません。移行コードには上記のデータがそのまま入っているため、他の人には渡さないでください。</p>
      </section>`;
    host.append(section);

    const output=document.getElementById('migrationOutput');
    const input=document.getElementById('migrationInput');
    const copy=document.getElementById('migrationCopy');
    const save=document.getElementById('migrationSave');
    document.getElementById('migrationExport').onclick=async()=>{
      try{
        setStatus('移行コードを作成しています…');
        const code=await makeCode();output.value=code;copy.disabled=save.disabled=false;
        setStatus(`${migrationKeys().length}件の保存項目から移行コード(${code.length.toLocaleString()}文字)を発行しました。`,'success');
      }catch(error){setStatus(error.message||String(error),'error')}
    };
    copy.onclick=async()=>{
      if(!output.value)return;
      try{await navigator.clipboard.writeText(output.value);setStatus('移行コードをコピーしました。','success');return}catch{}
      output.focus();output.select();
      let ok=false;
      try{ok=document.execCommand('copy')}catch{}
      setStatus(ok?'移行コードをコピーしました。':'自動でコピーできませんでした。選択されているコードを長押し(または Ctrl+C)でコピーしてください。',ok?'success':'error');
    };
    save.onclick=()=>{
      if(!output.value)return;
      const a=document.createElement('a'),url=URL.createObjectURL(new Blob([output.value],{type:'text/plain'}));
      a.href=url;a.download=`eigo-migration-${new Date().toISOString().slice(0,10)}.txt`;
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setStatus('移行コードをファイルに保存しました。このファイルを移行先の端末へ送ってください。','success');
    };
    document.getElementById('migrationFile').onchange=async e=>{
      const file=e.target.files?.[0];e.target.value='';
      if(!file)return;
      try{input.value=(await file.text()).trim();setStatus(`「${file.name}」を読み込みました。「データを取り込む」を押してください。`,'success')}
      catch{setStatus('ファイルを読み込めませんでした。','error')}
    };
    document.getElementById('migrationImport').onclick=async()=>{
      try{
        const {storage}=await readCode(input.value),keys=Object.keys(storage);
        if(!keys.length)throw new Error('取り込める保存データがありません。');
        if(!confirm(`${keys.length}件の保存項目を現在のブラウザーデータへ上書きします。続行しますか？`))return;
        for(const [key,value] of Object.entries(storage))localStorage.setItem(key,value);
        setStatus(`${keys.length}件の保存項目を取り込みました。ページを再読み込みします。`,'success');
        setTimeout(()=>location.reload(),300);
      }catch(error){setStatus(error.message||String(error),'error')}
    };
  }

  function start(){
    ensureUi();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
