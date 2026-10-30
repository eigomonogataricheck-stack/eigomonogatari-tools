/* 英語物語 対戦ツール: browser data migration */
(()=>{
  'use strict';
  const FORMAT='eigo-site-migration';
  const VERSION=1;
  const PREFIX='EIGO1-';
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

  function makeCode(){
    const storage={};
    for(const key of migrationKeys())storage[key]=localStorage.getItem(key);
    const payload={format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),storage};
    return PREFIX+bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  }

  function readCode(raw){
    const code=String(raw||'').replace(/\s+/g,'');
    if(!code.startsWith(PREFIX))throw new Error('英語物語用の移行コードではありません。');
    let payload;
    try{payload=JSON.parse(new TextDecoder().decode(base64UrlToBytes(code.slice(PREFIX.length))))}
    catch{throw new Error('移行コードを読み取れません。コード全体をコピーしてください。')}
    if(payload?.format!==FORMAT||payload?.version!==VERSION||!payload.storage||typeof payload.storage!=='object'){
      throw new Error('対応していない移行コードです。');
    }
    const storage={};
    for(const [key,value] of Object.entries(payload.storage)){
      if((ALLOWED_KEYS.has(key)||key.startsWith('eigo'))&&typeof value==='string')storage[key]=value;
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
          <p>今まで使っていたブラウザーでこのページを開き、コードを発行してコピーします。</p>
          <button id="migrationExport" type="button">移行コードを発行</button>
          <textarea id="migrationOutput" rows="6" readonly placeholder="発行したコードがここに表示されます"></textarea>
          <button id="migrationCopy" type="button" disabled>コードをコピー</button>
        </section>
        <section class="migration-box">
          <h3><span class="help-num">02</span>移行先でコードを取り込む</h3>
          <p>新しいブラウザーでこのページを開き、コピーしたコードを貼り付けて取り込みます。</p>
          <textarea id="migrationInput" rows="6" spellcheck="false" placeholder="EIGO1- から始まる移行コードを貼り付け"></textarea>
          <button id="migrationImport" class="primary" type="button">データを取り込む</button>
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
        <p class="migration-note">取り込むと、移行先にある同じ種類のデータは上書きされます。デッキ提案の詳細計算の途中結果は移行されません。移行コードには上記のデータがそのまま入っているため、他の人には渡さないでください。</p>
      </section>`;
    host.append(section);

    const output=document.getElementById('migrationOutput');
    const input=document.getElementById('migrationInput');
    const copy=document.getElementById('migrationCopy');
    document.getElementById('migrationExport').onclick=()=>{
      try{
        const code=makeCode();output.value=code;copy.disabled=false;
        setStatus(`${migrationKeys().length}件の保存項目から移行コードを発行しました。`,'success');
      }catch(error){setStatus(error.message||String(error),'error')}
    };
    copy.onclick=async()=>{
      if(!output.value)return;
      try{await navigator.clipboard.writeText(output.value);setStatus('移行コードをコピーしました。','success')}
      catch{output.focus();output.select();document.execCommand('copy');setStatus('移行コードをコピーしました。','success')}
    };
    document.getElementById('migrationImport').onclick=()=>{
      try{
        const {storage}=readCode(input.value),keys=Object.keys(storage);
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
