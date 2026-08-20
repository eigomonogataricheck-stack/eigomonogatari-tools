var tierData=null;

window.onload=function(){
  bindZukanDetails();
  preloadZukanData();
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

  tierDisplayedIds = [];
  var html='<h5 class="mb-3 border-bottom pb-2">生成結果</h5>';
  var any=false;
  tiers.forEach(function(cs,i){
    if(!cs.length)return;
    any=true;
    html+='<div class="tier-row"><div class="rank-label text-secondary">'+tierNames[i]+'</div><div class="icon-list">';
    cs.forEach(function(cId){tierDisplayedIds.push(Number(cId));html+='<img src="https://englishstoryserver.com/Icon/Icon/Icon'+cId+'.png" loading="lazy" draggable="false" role="button" tabindex="0" data-tier-id="'+cId+'" alt="キャラ詳細">'});
    html+='</div></div>';
  });
  r.innerHTML=any?html:'<p class="text-muted">該当データなし。</p>';
}

/* === 図鑑 === */
var zkData = null;
var zkTimer = null;
var zkPressTimer = null;
var zkPressStart = null;
var zkSuppressClick = false;
var zkCurrentIndex = -1;
var zkDisplayedDetailOrder = [];

// 1 = 次、-1 = 前
var zkLastDirection = 1;
var zkDetailsBound = false;
var tierDisplayedIds = [];
var zkDataPromise = null;
var L1C = {'通常ゆる':'#198754','特殊ゆる':'#dc3545'};

function preloadZukanData(){
  if(Array.isArray(zkData)) return Promise.resolve(zkData);
  if(zkDataPromise) return zkDataPromise;

  zkDataPromise = fetch('zukan_beta.json')
    .then(function(response){
      if(!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function(data){
      zkData = data;
      return data;
    })
    .catch(function(error){
      zkDataPromise = null;
      throw error;
    });
  return zkDataPromise;
}

function loadZukan(){
  var button = document.getElementById('zkBtn');
  var loader = document.getElementById('zkLoader');
  button.disabled = true;
  loader.style.display = 'block';

  preloadZukanData()
    .then(function(data){
      loader.style.display = 'none';
      button.style.display = 'none';
      zkData = data;
      document.getElementById('zkControls').style.display = 'block';
      document.getElementById('zkSearch').addEventListener('input', function(){
        clearTimeout(zkTimer);
        zkTimer = setTimeout(renderZukan, 200);
      });
      bindZukanDetails();
      renderZukan();
    })
    .catch(function(error){
      console.error(error);
      loader.style.display = 'none';
      button.disabled = false;
      document.getElementById('zkBox').innerHTML =
        '<div class="alert alert-danger">図鑑データの読み込みに失敗しました。</div>';
    });
}

function renderZukan(){
  var query = (document.getElementById('zkSearch').value || '').trim().toLowerCase();
  var tree = {};
  var total = 0;
  var hits = 0;

  for(var i = 0; i < zkData.length; i++){
    var row = zkData[i];
    var name = row.name || '';
    var matched = !!query && name.toLowerCase().indexOf(query) >= 0;
    total++;
    if(matched) hits++;
    if(query && !matched) continue;

    var large = row.largeCategory || '_';
    var middle = row.middleCategory || '_';
    var small = row.smallCategory || '_';
    var heading = row.heading || '_';

    if(!tree[large]) tree[large] = {};
    if(!tree[large][middle]) tree[large][middle] = {};
    if(!tree[large][middle][small]) tree[large][middle][small] = {};
    if(!tree[large][middle][small][heading]) tree[large][middle][small][heading] = [];

    tree[large][middle][small][heading].push({
      index: i,
      name: name,
      imageUrl: row.imageUrl || '',
      matched: matched,
      hasDetails: !!row.details
    });
  }

  var opened = !!query;
  var html = '';
  zkDisplayedDetailOrder = [];
  var largeKeys = Object.keys(tree);
  largeKeys.sort(function(a){ return a === '通常ゆる' ? -1 : 1; });

  largeKeys.forEach(function(large){
    var middleHtml = '';

    Object.keys(tree[large]).forEach(function(middle){
      var smallTree = tree[large][middle];
      var smallKeys = Object.keys(smallTree);
      var hasSmallLevel = !(smallKeys.length === 1 && smallKeys[0] === '_');
      var smallHtml = '';

      smallKeys.forEach(function(small){
        var cards = '';

        Object.keys(smallTree[small]).forEach(function(heading){
          var characters = smallTree[small][heading];
          if(heading !== '_') cards += '<div class="zk-head">' + escapeHtml(heading) + '</div>';

          characters.forEach(function(character){
            if(character.hasDetails) zkDisplayedDetailOrder.push(character.index);
            cards += '<div class="zk-card' +
              (character.matched ? ' zk-match' : '') +
              (character.hasDetails ? ' zk-has-details' : '') +
              '" data-zk-index="' + character.index + '"' +
              (character.hasDetails ? ' tabindex="0" role="button" aria-label="' + escapeHtml(character.name) + 'の詳細を表示"' : '') + '>' +
              '<img src="' + escapeHtml(character.imageUrl) + '" alt="' + escapeHtml(character.name) + '" loading="lazy" draggable="false">' +
              '<div class="zk-name">' + escapeHtml(character.name) + '</div>' +
              '</div>';
          });
        });

        if(hasSmallLevel && small !== '_'){
          smallHtml += '<div style="margin:2px 0">' +
            '<button class="zk-b3' + (opened ? ' op' : '') + '" onclick="tgl(this)">' +
            escapeHtml(small) + ' <span class="ar">▶</span></button>' +
            '<div class="zk-bd' + (opened ? ' op' : '') + '"><div class="zk-grid">' + cards + '</div></div></div>';
        }else{
          smallHtml += '<div class="zk-grid">' + cards + '</div>';
        }
      });

      middleHtml += '<div style="margin:3px 0">' +
        '<button class="zk-b2' + (opened ? ' op' : '') + '" onclick="tgl(this)">' +
        escapeHtml(middle) + ' <span class="ar">▶</span></button>' +
        '<div class="zk-bd' + (opened ? ' op' : '') + '">' + smallHtml + '</div></div>';
    });

    html += '<div class="zk-l1">' +
      '<button class="zk-b1' + (opened ? ' op' : '') + '" style="background:' + (L1C[large] || '#6c757d') + '" onclick="tgl(this)">' +
      escapeHtml(large) + ' <span class="ar">▶</span></button>' +
      '<div class="zk-bd' + (opened ? ' op' : '') + '">' + middleHtml + '</div></div>';
  });

  document.getElementById('zkCount').textContent = query
    ? hits + '件ヒット / 全' + total + '体'
    : '全' + total + '体';

  var box = document.getElementById('zkBox');
  box.innerHTML = html || '<p class="text-muted mt-3">該当なし</p>';

  if(query && hits > 0){
    var first = box.querySelector('.zk-match');
    if(first) first.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

function bindZukanDetails(){
  if(zkDetailsBound) return;
  zkDetailsBound = true;

  var box = document.getElementById('zkBox');

  box.addEventListener('contextmenu', function(event){
    if(event.target.closest('.zk-card')) event.preventDefault();
  });

  box.addEventListener('dragstart', function(event){
    if(event.target.closest('.zk-card')) event.preventDefault();
  });

  document.getElementById('tier-result').addEventListener('click', function(event){
    var image = event.target.closest('[data-tier-id]');
    if(image) openTierCharacterDetails(image.dataset.tierId);
  });

  document.getElementById('tier-result').addEventListener('keydown', function(event){
    var image = event.target.closest('[data-tier-id]');
    if(image && (event.key === 'Enter' || event.key === ' ')){
      event.preventDefault();
      openTierCharacterDetails(image.dataset.tierId);
    }
  });

  document.getElementById('tier-result').addEventListener('contextmenu', function(event){
    if(event.target.closest('[data-tier-id]')) event.preventDefault();
  });

  box.addEventListener('click', function(event){
    var card = event.target.closest('.zk-has-details');
    if(!card) return;
    if(zkSuppressClick){
      zkSuppressClick = false;
      return;
    }
    openCharacterDetails(Number(card.dataset.zkIndex));
  });

  box.addEventListener('keydown', function(event){
    var card = event.target.closest('.zk-has-details');
    if(!card) return;
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      openCharacterDetails(Number(card.dataset.zkIndex));
    }
  });

  // 図鑑はPC・スマホとも通常タップで開く。


  var modal = document.getElementById('zkModal');
  if(modal){
    modal.addEventListener('click', function(event){
      if(event.target === this) closeCharacterDetails();
    });
  }

  document.addEventListener(
  'keydown',
  function(event) {
    // Escは入力中でも詳細を閉じられる
    if (event.key === 'Escape') {
      closeCharacterDetails();
      return;
    }

    // 詳細画面が開いていない場合は無効
    var modal =
      document.getElementById('zkModal');

    if (
      !modal ||
      !modal.classList.contains('op')
    ) {
      return;
    }

    // 検索欄、意見箱、選択欄などへの入力中は無効
    if (isShortcutInputActive_()) {
      return;
    }

    var key =
      String(event.key || '').toLowerCase();

    // A、J、←: 前
    if (
      key === 'a' ||
      key === 'j' ||
      event.key === 'ArrowLeft'
    ) {
      event.preventDefault();
      switchCharacterDetails(-1);
      return;
    }

    // D、K、→: 次
    if (
      key === 'd' ||
      key === 'k' ||
      event.key === 'ArrowRight'
    ) {
      event.preventDefault();
      switchCharacterDetails(1);
      return;
    }

    // Space、Enter:
    // 最後に操作した方向を繰り返す
    if (
      event.code === 'Space' ||
      event.key === 'Enter'
    ) {
      event.preventDefault();
      switchCharacterDetails(
        zkLastDirection
      );
    }
  }
);
}

function cancelZukanPress(){
  clearTimeout(zkPressTimer);
  if(zkPressStart && zkPressStart.card) zkPressStart.card.classList.remove('zk-pressing');
  zkPressStart = null;
}

function openCharacterDetails(index){
  var character = zkData[index];
  if(!character || !character.details) return;

  zkCurrentIndex = index;
  var details = character.details;
  var theme = getAttributeTheme_(details.attribute);
  var panel = document.getElementById('zkModalPanel');
  panel.style.setProperty('--zk-accent', theme.accent);
  panel.style.setProperty('--zk-soft', theme.soft);
  panel.style.setProperty('--zk-theme', theme.background);
  panel.style.setProperty('--zk-theme-soft', theme.softBackground);

  document.getElementById('zkModalImage').src = character.imageUrl || '';
  document.getElementById('zkModalImage').alt = character.name || '';
  document.getElementById('zkModalName').textContent = character.name || details.name || '';
  document.getElementById('zkModalMeta').textContent = [details.rare, details.attribute].filter(Boolean).join(' / ');

  // 左上から右、次に左下から右の順番
  var stats = [
    ['Cost', details.cost],
    ['最大突破数', details.limitBreak],
    ['無凸HP', details.hp],
    ['無凸Power', details.power],
    ['完凸HP', details.limitHp],
    ['完凸Power', details.limitPower]
  ];

  document.getElementById('zkModalStats').innerHTML = stats
    .filter(function(item){ return item[1] !== null && item[1] !== undefined && item[1] !== ''; })
    .map(function(item){
      return '<div class="zk-stat"><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(String(item[1])) + '</strong></div>';
    }).join('');

  var skillBlock = document.getElementById('zkModalSkillBlock');
  if(details.skill){
    document.getElementById('zkModalSkill').innerHTML = formatSkillText_(details.skill);
    document.getElementById('zkModalSkillTurn').textContent =
      details.skillTurn !== null && details.skillTurn !== undefined
        ? '必要ターン ' + details.skillTurn
        : '';
    skillBlock.style.display = '';
  }else{
    skillBlock.style.display = 'none';
  }

  var modal = document.getElementById('zkModal');
  modal.classList.add('op');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('zk-modal-open');
  document.getElementById('zkModalClose').focus();
}

function openTierCharacterDetails(characterId){
  var id = Number(characterId);
  preloadZukanData()
    .then(function(){
      var indexById = new Map();
      zkData.forEach(function(character,index){
        if(character.details) indexById.set(Number(character.id),index);
      });
      zkDisplayedDetailOrder = tierDisplayedIds
        .map(function(tierId){ return indexById.get(Number(tierId)); })
        .filter(function(index){ return index !== undefined; });
      var index = indexById.get(id);
      if(index !== undefined) openCharacterDetails(index);
    })
    .catch(function(error){ console.error('キャラ詳細の読み込みに失敗しました。',error); });
}

function switchCharacterDetails(direction) {
  if (
    !zkData ||
    zkCurrentIndex < 0 ||
    zkDisplayedDetailOrder.length === 0
  ) {
    return;
  }

  // キーボード・画面ボタンの両方で方向を記憶
  zkLastDirection = direction < 0 ? -1 : 1;

  var position =
    zkDisplayedDetailOrder.indexOf(zkCurrentIndex);

  if (position === -1) {
    position = 0;
  }

  var nextPosition = (
    position +
    zkLastDirection +
    zkDisplayedDetailOrder.length
  ) % zkDisplayedDetailOrder.length;

  openCharacterDetails(
    zkDisplayedDetailOrder[nextPosition]
  );
}

function isShortcutInputActive_() {
  var element = document.activeElement;

  if (!element) {
    return false;
  }

  var tagName =
    String(element.tagName || '').toLowerCase();

  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  );
}

function getAttributeTheme_(attribute){
  var colors = {
    '火': {solid:'#e53935', soft:'#ffe7e5'},
    '水': {solid:'#1976d2', soft:'#e3f0ff'},
    '風': {solid:'#7cbf19', soft:'#edf8d8'}
  };
  var text = String(attribute || '');
  var found = ['火','水','風'].filter(function(type){
    return text.indexOf(type) >= 0;
  });

  if(found.length === 0){
    return {
      accent:'#6c757d',
      background:'#6c757d',
      softBackground:'#f1f3f5'
    };
  }

  if(found.length === 1){
    return {
      accent:colors[found[0]].solid,
      background:colors[found[0]].solid,
      softBackground:colors[found[0]].soft
    };
  }

  // 複合属性は均等な斜めグラデーションにする。
  var solidColors = found.map(function(type){ return colors[type].solid; });
  var softColors = found.map(function(type){ return colors[type].soft; });

  return {
    accent:colors[found[0]].solid,
    background:'linear-gradient(135deg, ' + solidColors.join(', ') + ')',
    softBackground:'linear-gradient(135deg, ' + softColors.join(', ') + ')'
  };
}

function closeCharacterDetails(){
  var modal = document.getElementById('zkModal');
  if(!modal || !modal.classList.contains('op')) return;
  modal.classList.remove('op');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('zk-modal-open');
  zkCurrentIndex = -1;
}

function isTouchDevice(){
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function formatSkillText_(text) {
  var escaped = escapeHtml(text);

  var attributeClass = {
    '火': 'skill-attribute-fire',
    '水': 'skill-attribute-water',
    '風': 'skill-attribute-wind',
    '全': 'skill-attribute-all'
  };

  return escaped.replace(
    /(\d+(?:\.\d+)?%?)|([火水風全])/g,
    function(match, number, attribute) {
      if (number !== undefined) {
        return (
          '<span class="skill-number">' +
          number +
          '</span>'
        );
      }

      return (
        '<span class="skill-attribute ' +
        attributeClass[attribute] +
        '">' +
        attribute +
        '</span>'
      );
    }
  );
}

function escapeHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tgl(button){
  button.classList.toggle('op');
  button.nextElementSibling.classList.toggle('op');
}

function toggleAll(){
  var buttons = document.querySelectorAll('.zk-b1,.zk-b2,.zk-b3');
  var anyOpen = Array.prototype.some.call(buttons, function(button){
    return button.classList.contains('op');
  });

  Array.prototype.forEach.call(buttons, function(button){
    button.classList.toggle('op', !anyOpen);
    button.nextElementSibling.classList.toggle('op', !anyOpen);
  });
}


/* === 意見箱 === */
var OPINION_URL = 'https://script.google.com/macros/s/AKfycbzb1SZylMA0l61jgM628eMbXeUt7M4tVx-BrrOIK3KpvAWZ_WzJR_cSPsdOMA5EETt8/exec';

function submitOpinion(){
  var text = document.getElementById('opinionText').value.trim();
  var message = document.getElementById('opinionMsg');
  var button = document.getElementById('opinionSubmit');

  if(!text){
    message.textContent = '内容を入力してください。';
    message.className = 'opinion-msg opinion-error';
    return;
  }

  button.disabled = true;
  message.textContent = '送信中...';
  message.className = 'opinion-msg';

  fetch(OPINION_URL + '?api=opinion&text=' + encodeURIComponent(text))
    .then(function(response){
      if(!response.ok) throw new Error('HTTP ' + response.status);
      document.getElementById('opinionText').value = '';
      message.textContent = '送信しました。';
      message.className = 'opinion-msg opinion-success';
    })
    .catch(function(error){
      console.error(error);
      message.textContent = '送信に失敗しました。';
      message.className = 'opinion-msg opinion-error';
    })
    .finally(function(){
      button.disabled = false;
    });
}
(()=>{
  let lastDirection=1; // 初期は「後」
  const isDetailOpen=()=>{const d=document.getElementById('detail');return d&&!d.hidden&&getComputedStyle(d).display!=='none'};
  const move=direction=>{
    lastDirection=direction<0?-1:1;
    if(typeof window.nav==='function'){window.nav(lastDirection);return;}
    const id=lastDirection<0?'detailPrev':'detailNext';
    const button=document.getElementById(id);
    if(button) button.click();
  };
  const prev=document.getElementById('detailPrev'),next=document.getElementById('detailNext');
  if(prev) prev.addEventListener('click',()=>{lastDirection=-1},true);
  if(next) next.addEventListener('click',()=>{lastDirection=1},true);
  document.addEventListener('keydown',event=>{
    if(!isDetailOpen()) return;
    const tag=document.activeElement?.tagName||'';
    if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
    const key=event.key.toLowerCase();
    if(key==='a'||key==='j'||event.key==='ArrowLeft'){event.preventDefault();move(-1);return;}
    if(key==='d'||key==='k'||event.key==='ArrowRight'){event.preventDefault();move(1);return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();move(lastDirection);}
  },true);
})();
