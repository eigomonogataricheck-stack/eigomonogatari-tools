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
var zkData = null;
var zkTimer = null;
var zkPressTimer = null;
var zkPressStart = null;
var zkSuppressClick = false;
var zkCurrentIndex = -1;
var zkDisplayedDetailOrder = [];
var L1C = {'通常ゆる':'#198754','特殊ゆる':'#dc3545'};

function loadZukan(){
  var button = document.getElementById('zkBtn');
  var loader = document.getElementById('zkLoader');
  button.disabled = true;
  loader.style.display = 'block';

  fetch('zukan_beta.json')
    .then(function(response){
      if(!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
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
  var box = document.getElementById('zkBox');

  box.addEventListener('click', function(event){
    var card = event.target.closest('.zk-has-details');
    if(!card) return;
    if(zkSuppressClick){
      zkSuppressClick = false;
      return;
    }
    if(!isTouchDevice()) openCharacterDetails(Number(card.dataset.zkIndex));
  });

  box.addEventListener('keydown', function(event){
    var card = event.target.closest('.zk-has-details');
    if(!card) return;
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      openCharacterDetails(Number(card.dataset.zkIndex));
    }
  });

  box.addEventListener('pointerdown', function(event){
    if(event.pointerType === 'mouse') return;
    var card = event.target.closest('.zk-has-details');
    if(!card) return;

    zkPressStart = {x:event.clientX, y:event.clientY, card:card};
    card.classList.add('zk-pressing');
    clearTimeout(zkPressTimer);
    zkPressTimer = setTimeout(function(){
      zkSuppressClick = true;
      card.classList.remove('zk-pressing');
      openCharacterDetails(Number(card.dataset.zkIndex));
      if(navigator.vibrate) navigator.vibrate(20);
    }, 500);
  });

  box.addEventListener('pointermove', function(event){
    if(!zkPressStart) return;
    if(Math.abs(event.clientX - zkPressStart.x) > 10 || Math.abs(event.clientY - zkPressStart.y) > 10){
      cancelZukanPress();
    }
  });

  ['pointerup','pointercancel','pointerleave'].forEach(function(type){
    box.addEventListener(type, cancelZukanPress);
  });

  document.getElementById('zkModal').addEventListener('click', function(event){
    if(event.target === this) closeCharacterDetails();
  });

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape') closeCharacterDetails();
  });
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
    ['HP', details.hp],
    ['Power', details.power],
    ['最大HP', details.limitHp],
    ['最大Power', details.limitPower]
  ];

  document.getElementById('zkModalStats').innerHTML = stats
    .filter(function(item){ return item[1] !== null && item[1] !== undefined && item[1] !== ''; })
    .map(function(item){
      return '<div class="zk-stat"><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(String(item[1])) + '</strong></div>';
    }).join('');

  var skillBlock = document.getElementById('zkModalSkillBlock');
  if(details.skill){
    document.getElementById('zkModalSkill').textContent = details.skill;
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

function switchCharacterDetails(direction){
  if(!zkData || zkCurrentIndex < 0 || zkDisplayedDetailOrder.length === 0) return;

  // JSON配列順ではなく、現在画面に並んでいる順番で移動する。
  var position = zkDisplayedDetailOrder.indexOf(zkCurrentIndex);
  if(position === -1) position = 0;

  var nextPosition = (
    position + direction + zkDisplayedDetailOrder.length
  ) % zkDisplayedDetailOrder.length;

  openCharacterDetails(zkDisplayedDetailOrder[nextPosition]);
}

function getAttributeTheme_(attribute){
  var colors = {
    '火': {solid:'#dc3545', soft:'#fff0f1'},
    '水': {solid:'#0d6efd', soft:'#eef5ff'},
    '風': {solid:'#7fbd27', soft:'#f4fae9'}
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
