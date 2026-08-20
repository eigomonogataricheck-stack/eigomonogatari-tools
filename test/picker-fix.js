(function(){
  'use strict';
  var picker=document.getElementById('picker');
  if(!picker)return;

  function displayAttribute(text){return String(text==null?'':text).replace(/火風/g,'風火');}

  function normalizeVisibleFireWind(root){
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    var node;
    while((node=walker.nextNode())){
      if(node.nodeValue&&node.nodeValue.indexOf('火風')!==-1)node.nodeValue=displayAttribute(node.nodeValue);
    }
    root.querySelectorAll('option').forEach(function(option){
      if(option.textContent.indexOf('火風')!==-1)option.textContent=displayAttribute(option.textContent);
    });
  }

  function syncArrow(button){
    var arrow=button.querySelector('.ar,.picker-arrow');
    if(!arrow){arrow=document.createElement('span');arrow.className='ar';button.appendChild(arrow);}
    arrow.textContent=button.classList.contains('op')?'▼':'▶';
  }

  function closeAll(){
    picker.querySelectorAll('.zk-b1,.zk-b2,.zk-b3').forEach(function(button){button.classList.remove('op');syncArrow(button);});
    picker.querySelectorAll('.zk-bd,.zk-body').forEach(function(body){body.classList.remove('op','open');});
    picker.querySelectorAll('.picker-extra-toggle').forEach(function(button){button.classList.remove('op');syncArrow(button);});
    picker.querySelectorAll('.picker-extra-body').forEach(function(body){body.classList.remove('op');});
  }

  function wrapExposedOther(){
    picker.querySelectorAll('.zk-bd,.zk-body').forEach(function(parent){
      Array.from(parent.children).forEach(function(child){
        if(!child.matches('.zk-grid,.picker-cards'))return;
        if(child.parentElement&&child.parentElement.classList.contains('picker-extra-body'))return;
        var button=document.createElement('button');
        button.type='button';button.className='picker-extra-toggle';
        button.innerHTML='<span>その他</span><span class="ar">▶</span>';
        var body=document.createElement('div');body.className='picker-extra-body';
        parent.insertBefore(button,child);parent.insertBefore(body,child);body.appendChild(child);
        button.addEventListener('click',function(event){
          event.stopPropagation();button.classList.toggle('op');body.classList.toggle('op');syncArrow(button);
        });
      });
    });
  }

  function prepare(){
    wrapExposedOther();normalizeVisibleFireWind(picker);closeAll();
    picker.querySelectorAll('.zk-b1,.zk-b2,.zk-b3').forEach(function(button){
      if(button.dataset.arrowFixBound)return;
      button.dataset.arrowFixBound='1';
      button.addEventListener('click',function(){setTimeout(function(){syncArrow(button);},0);});
      syncArrow(button);
    });
  }

  var observer=new MutationObserver(function(mutations){
    var opened=mutations.some(function(m){return m.type==='attributes'&&m.attributeName==='hidden'&&!picker.hidden;});
    if(opened)setTimeout(prepare,0);
    else{
      wrapExposedOther();normalizeVisibleFireWind(picker);
      picker.querySelectorAll('.zk-b1,.zk-b2,.zk-b3').forEach(syncArrow);
    }
  });
  observer.observe(picker,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']});
  prepare();
})();
