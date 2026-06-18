var tierData=null;

window.onload=function(){
  fetch('tier_all_patterns.json').then(function(r){return r.json()}).then(function(d){
    tierData=d;
    var sel=document.getElementById('attribute');
    var sb=d.meta.shibari;
    Object.keys(sb).forEach(function(id){sel.add(new Option(sb[id],id))});
    var btn=document.getElementById('btn');
    btn.disabled=false;
    btn.textContent='Tierを生成・表示';
  }).catch(function(){
    document.getElementById('btn').textContent='読み込み失敗';
    document.getElementById('tier-result').innerHTML='<div class="alert alert-danger">Tierデータの読み込みに失敗しました。</div>';
  });
};

function execTier(){
  var sk=document.getElementById('attribute').value||'*';
  var ck=document.getElementById('cost').value||'*';
  var wk=document.getElementById('waku').value||'*';
  var hv=document.getElementById('hosei').value;
  var hk=hv===''?'*':hv;
  var key=sk+'|'+ck+'|'+wk+'|'+hk;
  var bucket=tierData.data[key];
  var r=document.getElementById('tier-result');
  if(!bucket){r.innerHTML='<p class="text-muted">該当データなし。</p>';return}

  var mode=document.getElementById('mode').value;
  var minCount=Number(document.getElementById('minCount').value);
  var results=[];
  Object.keys(bucket).forEach(function(cId){
    var d=bucket[cId];
    if(d[0]<minCount)return;
    results.push({cId:cId,count:d[0],rate:d[0]?d[1]/d[0]:0});
  });
  if(mode==='使用者数'){results.sort(function(a,b){return b.count-a.count})}
  else{results.sort(function(a,b){return b.rate-a.rate})}

  var tierNames=['S','A','B','C','D','E','F','G'];
  var th;
  if(mode==='使用者数'){
    var m=results.length?results[0].count:0;
    th=[m/2,m/3,m/4,m/5,m/6,m/7,m/8,0];
  }else{
    th=[0.4,0.25,0.1,0,-0.1,-0.25,-0.4,-Infinity];
  }

  var tiers=tierNames.map(function(){return[]});
  results.forEach(function(x){
    var val=mode==='使用者数'?x.count:x.rate;
    for(var i=0;i<th.length;i++){if(val>=th[i]){tiers[i].push(x.cId);break}}
  });

  var html='<h5 class="mb-3 border-bottom pb-2">生成結果</h5>';
  var any=false;
  tiers.forEach(function(cs,i){
    if(!cs.length)return;
    any=true;
    html+='<div class="tier-row"><div class="rank-label text-secondary">'+tierNames[i]+'</div><div class="icon-list">';
    cs.forEach(function(cId){html+='<img src="https://englishstoryserver.com/Icon/Icon/Icon'+cId+'.png" loading="lazy">'});
    html+='</div></div>';
  });
  r.innerHTML=any?html:'<p class="text-muted">該当データなし。</p>';
}

/* === 図鑑 === */
var zkData=null,zkTimer=null;var L1C={'通常ゆる':'#198754','特殊ゆる':'#dc3545'};
function loadZukan(){var b=document.getElementById('zkBtn'),l=document.getElementById('zkLoader');b.disabled=true;l.style.display='block';fetch('zukan.json').then(function(r){return r.json()}).then(function(d){l.style.display='none';b.style.display='none';zkData=d;document.getElementById('zkControls').style.display='block';document.getElementById('zkSearch').addEventListener('input',function(){clearTimeout(zkTimer);zkTimer=setTimeout(renderZukan,200)});renderZukan()}).catch(function(){l.style.display='none';b.disabled=false;document.getElementById('zkBox').innerHTML='<div class="alert alert-danger">読み込み失敗</div>'})}
function renderZukan(){var q=(document.getElementById('zkSearch').value||'').trim().toLowerCase();var tree={},total=0,hits=0;for(var i=0;i<zkData.length;i++){var r=zkData[i],m=q&&r.n.toLowerCase().indexOf(q)>=0;total++;if(m)hits++;if(q&&!m)continue;if(!tree[r.d])tree[r.d]={};if(!tree[r.d][r.c])tree[r.d][r.c]={};var sk=r.s||'_';if(!tree[r.d][r.c][sk])tree[r.d][r.c][sk]={};var hk=r.h||'_';if(!tree[r.d][r.c][sk][hk])tree[r.d][r.c][sk][hk]=[];tree[r.d][r.c][sk][hk].push({n:r.n,u:r.u,m:m})}var op=!!q,html='';var l1k=Object.keys(tree);l1k.sort(function(a){return a==='通常ゆる'?-1:1});for(var i1=0;i1<l1k.length;i1++){var d=l1k[i1],bg=L1C[d]||'#6c757d',l2k=Object.keys(tree[d]),l2h='';for(var i2=0;i2<l2k.length;i2++){var c=l2k[i2],l3=tree[d][c],l3k=Object.keys(l3),hasL3=!(l3k.length===1&&l3k[0]==='_'),l3h='';for(var i3=0;i3<l3k.length;i3++){var s=l3k[i3],l4=l3[s],l4k=Object.keys(l4),cards='';for(var i4=0;i4<l4k.length;i4++){var h=l4k[i4],chars=l4[h];if(h!=='_')cards+='<div class="zk-head">'+h+'</div>';for(var ic=0;ic<chars.length;ic++){var ch=chars[ic];cards+='<div class="zk-card'+(ch.m?' zk-match':'')+'">'+'<img src="'+ch.u+'" loading="lazy"><div class="zk-name">'+ch.n+'</div></div>'}}if(hasL3&&s!=='_'){l3h+='<div style="margin:2px 0"><button class="zk-b3'+(op?' op':'')+'" onclick="tgl(this)">'+s+' <span class="ar">▶</span></button><div class="zk-bd'+(op?' op':'')+'"><div class="zk-grid">'+cards+'</div></div></div>'}else{l3h+='<div class="zk-grid">'+cards+'</div>'}}l2h+='<div style="margin:3px 0"><button class="zk-b2'+(op?' op':'')+'" onclick="tgl(this)">'+c+' <span class="ar">▶</span></button><div class="zk-bd'+(op?' op':'')+'">'+l3h+'</div></div>'}html+='<div class="zk-l1"><button class="zk-b1'+(op?' op':'')+'" style="background:'+bg+'" onclick="tgl(this)">'+d+' <span class="ar">▶</span></button><div class="zk-bd'+(op?' op':'')+'">'+l2h+'</div></div>'}document.getElementById('zkCount').textContent=q?hits+'件ヒット / 全'+total+'体':'全'+total+'体';var box=document.getElementById('zkBox');box.innerHTML=html||'<p class="text-muted mt-3">該当なし</p>';if(q&&hits>0){var f=box.querySelector('.zk-match');if(f)f.scrollIntoView({behavior:'smooth',block:'center'})}}
function tgl(b){b.classList.toggle('op');b.nextElementSibling.classList.toggle('op')}
function toggleAll(){var bs=document.querySelectorAll('.zk-b1,.zk-b2,.zk-b3'),any=false;for(var i=0;i<bs.length;i++){if(bs[i].classList.contains('op')){any=true;break}}for(var i=0;i<bs.length;i++){if(any){bs[i].classList.remove('op');bs[i].nextElementSibling.classList.remove('op')}else{bs[i].classList.add('op');bs[i].nextElementSibling.classList.add('op')}}}
