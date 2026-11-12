(() => {
  'use strict';
  const by=id=>document.getElementById(id);
  const newLetterId=()=>{
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;
    const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  const compose=document.createElement('dialog');compose.id='composeLetterDialog';compose.setAttribute('aria-labelledby','composeLetterTitle');
  compose.innerHTML=`<div class="dialog-head"><h2 id="composeLetterTitle">给你写封信</h2><button class="icon-button" data-close aria-label="关闭写信">×</button></div><div class="dialog-body"><p class="compose-to" id="letterRecipient"></p><form id="composeLetterForm"><label class="form-field">给这封信起个名字<input id="letterSubject" maxlength="60" required placeholder="比如：今天也有一点点想你"></label><fieldset class="paper-choices"><legend>选一张可爱的信纸</legend><label><input type="radio" name="letterPaper" value="strawberry" checked>🍓 草莓奶油</label><label><input type="radio" name="letterPaper" value="sky">☁ 云朵蓝</label><label><input type="radio" name="letterPaper" value="garden">🌼 小花园</label></fieldset><label class="form-field letter-body-label">把想说的话，慢慢写给对方<textarea id="letterBody" maxlength="8000" rows="10" required placeholder="亲爱的，见字如面……"></textarea></label><div class="letter-write-meta"><span id="letterDraftStatus">未寄出的草稿只保存在这台设备。</span><span id="letterCount">0 / 8000</span></div><p class="form-help">寄出后，对方登录小屋就能在信箱收到。信件仅供你们两个人查看。</p><p id="letterSendStatus" role="status"></p><div class="dialog-actions"><button class="secondary" type="button" data-close>留着慢慢写</button><button class="primary" id="sendLetter" type="submit">把这封信寄给你 →</button></div></form></div>`;
  const reader=document.createElement('dialog');reader.id='readLetterDialog';reader.setAttribute('aria-labelledby','readLetterTitle');
  reader.innerHTML=`<div class="dialog-head"><h2>拆开一封小小的想念</h2><button class="icon-button" data-close aria-label="收好这封信">×</button></div><div class="dialog-body letter-reading"><div class="opening-envelope" aria-hidden="true"><span class="opening-flap"></span><span class="envelope-seal">♥</span><span class="envelope-caption">只寄给你</span></div><article class="cute-paper" id="readLetterPaper"><div class="paper-decoration" aria-hidden="true">♡ · ✿ · ♡</div><p id="readLetterMeta" class="read-letter-meta"></p><h2 id="readLetterTitle"></h2><div id="readLetterBody" class="read-letter-body"></div><p class="letter-signature" id="readLetterSignature"></p><p class="paper-footer">把这份喜欢，折进日常里 ♡</p></article><p id="readLetterStatus" role="status"></p></div>`;
  document.body.append(compose,reader);
  let letters=[],tab='inbox',identity=null,connected=false,revision=0,sourceRevision=-1,busy=false,sending=false,draftId=null,lastLoaded=false,queued=false;
  const name=who=>window.QXNN_PEOPLE.name(who);
  const fmt=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const draftKey=()=> 'qxnn-letter-draft-v1:'+identity;
  function draft(){return {id:draftId,subject:by('letterSubject').value,body:by('letterBody').value,style:compose.querySelector('[name="letterPaper"]:checked').value};}
  function rememberDraft(){
    if(!identity||sending)return;
    by('letterCount').textContent=by('letterBody').value.length+' / 8000';
    compose.dataset.paper=draft().style;
    try{localStorage.setItem(draftKey(),JSON.stringify(draft()));by('letterDraftStatus').textContent='草稿已留在这台设备，下次可以接着写。';}catch{by('letterDraftStatus').textContent='这台设备暂时无法保存草稿，请先保留文字再关闭。';}
  }
  function write(){
    if(!connected)return toast('先登录小屋，再把心意寄给对方吧。');
    if(sending)return toast('上一封信还在寄送，请稍等一会儿。');
    let saved;try{saved=JSON.parse(localStorage.getItem(draftKey()));}catch{}
    draftId=saved?.id||newLetterId();
    by('letterSubject').value=typeof saved?.subject==='string'?saved.subject.slice(0,60):'';
    by('letterBody').value=typeof saved?.body==='string'?saved.body.slice(0,8000):'';
    const style=['strawberry','sky','garden'].includes(saved?.style)?saved.style:'strawberry';
    compose.querySelector('[name="letterPaper"][value="'+style+'"]').checked=true;
    by('letterRecipient').textContent='寄给 '+name(identity==='me'?'partner':'me')+'，来自 '+name(identity)+' 的小小心事。';
    by('letterSendStatus').textContent='';rememberDraft();openDialog(compose.id);
  }
  document.querySelectorAll('[data-compose-letter]').forEach(button=>button.addEventListener('click',write));
  by('composeLetterForm').addEventListener('input',rememberDraft);
  by('composeLetterForm').addEventListener('change',rememberDraft);
  by('composeLetterForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!connected||sending)return;
    rememberDraft();const value=draft(),current=revision,key=draftKey();sending=true;
    by('sendLetter').disabled=true;by('letterSendStatus').textContent='正在认真封好这封信…';
    // Lock the draft while the network request is in progress.
    compose.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);
    try{
      await window.ourSharedSpace.request('/letters',{method:'POST',body:JSON.stringify(value)});
      if(current!==revision)return;
      try{localStorage.removeItem(key);}catch{}
      compose.close();toast('信已寄到对方的信箱，等对方登录来拆开。');
      tab='sent';await refresh();
    }catch(error){if(current===revision){
      if(error.alreadySent){draftId=newLetterId();sending=false;rememberDraft();by('letterSendStatus').textContent='上次的信已经寄出。当前修改已另存为新草稿，可以再次寄出。';refresh();}
      else by('letterSendStatus').textContent=error.message+' 草稿还在，可以稍后重试。';
    }}
    finally{sending=false;by('sendLetter').disabled=false;compose.querySelectorAll('input,textarea').forEach(el=>el.disabled=false);}
  });
  function render(){
    const unread=letters.filter(letter=>letter.author!==identity&&!letter.readAt).length;
    by('mailUnread').hidden=!unread;by('mailUnread').textContent=unread+' 封未读';
    document.querySelectorAll('[data-mail-tab]').forEach(button=>{button.setAttribute('aria-selected',String(button.dataset.mailTab===tab));button.tabIndex=button.dataset.mailTab===tab?0:-1;});
    by('mailList').setAttribute('aria-labelledby',tab==='inbox'?'mailInboxTab':'mailSentTab');
    by('mailList').replaceChildren();
    if(!connected)return;
    const list=letters.filter(letter=>tab==='inbox'?letter.author!==identity:letter.author===identity);
    if(!list.length){const empty=document.createElement('div');empty.className='mail-empty';empty.innerHTML='<span aria-hidden="true">✉</span><p></p>';empty.querySelector('p').textContent=tab==='inbox'?'信箱还空着，下一封心意正在路上。':'还没寄过信，写下第一封喜欢吧。';by('mailList').append(empty);}
    for(const letter of list){
      const button=document.createElement('button');button.className='mail-envelope';button.dataset.paper=letter.style;button.dataset.letterId=letter.id;
      const seal=document.createElement('span');seal.className='mail-stamp';seal.textContent=letter.style==='sky'?'☁':letter.style==='garden'?'✿':'♡';seal.setAttribute('aria-hidden','true');
      const tag=document.createElement('span');tag.className='mail-state';tag.textContent=letter.readAt?'已读':letter.author===identity?'等待拆开':'新来信';
      const title=document.createElement('strong');title.textContent=letter.subject;
      const from=document.createElement('span');from.className='mail-from';from.textContent=(tab==='inbox'?'来自 ':'寄给 ')+name(tab==='inbox'?letter.author:letter.author==='me'?'partner':'me');
      const date=document.createElement('span');date.className='mail-date';date.textContent=fmt(letter.createdAt);
      const hint=document.createElement('span');hint.className='mail-open-hint';hint.textContent='轻轻点一下，拆开看看 ↗';
      button.append(seal,tag,title,from,date,hint);button.addEventListener('click',()=>read(letter));by('mailList').append(button);
    }
  }
  async function read(letter){
    const current=revision;
    by('readLetterPaper').dataset.paper=letter.style;
    by('readLetterTitle').textContent=letter.subject;
    by('readLetterMeta').textContent=fmt(letter.createdAt)+' · 寄给 '+name(letter.author==='me'?'partner':'me');
    by('readLetterBody').textContent=letter.body;
    by('readLetterSignature').textContent='想念你的 '+name(letter.author)+' ♡';
    by('readLetterStatus').textContent='';
    reader.classList.remove('letter-opening');openDialog(reader.id);void reader.offsetWidth;reader.classList.add('letter-opening');
    if(letter.author!==identity&&!letter.readAt){
      try{
        await window.ourSharedSpace.request('/letters/'+letter.id+'/read',{method:'POST'});
        if(current!==revision)return;
        letter.readAt=new Date().toISOString();render();
      }catch{if(current===revision)by('readLetterStatus').textContent='信已经打开，已读状态暂未同步，下次打开会再试。';}
    }
  }
  async function refresh(){
    if(!connected)return;
    if(busy){queued=true;return;}
    const current=revision;busy=true;by('refreshMail').disabled=true;by('mailStatus').textContent='正在整理我们的来信…';
    try{
      const result=await window.ourSharedSpace.request('/letters');
      if(current!==revision)return;
      const old=new Set(letters.map(item=>item.id));
      const incoming=result.letters.filter(letter=>letter.author!==identity&&!letter.readAt&&!old.has(letter.id));
      if(lastLoaded&&incoming.length)toast('你收到 '+incoming.length+' 封新来信，去信箱拆开吧。');
      letters=result.letters;lastLoaded=true;render();
      by('mailStatus').textContent='共有 '+letters.length+' 封信 · 来信会自动刷新，想念也有了落脚的地方。';
    }catch(error){if(current===revision)by('mailStatus').textContent='信箱暂时没有刷新成功，已保留上次内容。请点击“刷新信箱”重试。';}
    finally{busy=false;by('refreshMail').disabled=false;if(queued){queued=false;refresh();}}
  }
  document.querySelectorAll('[data-mail-tab]').forEach(button=>{
    button.addEventListener('click',()=>{tab=button.dataset.mailTab;render();});
    button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'mailInboxTab':event.key==='End'?'mailSentTab':button.id==='mailInboxTab'?'mailSentTab':'mailInboxTab';by(target).click();by(target).focus();}});
  });
  by('refreshMail').addEventListener('click',refresh);
  window.addEventListener('our-world-connection',event=>{
    const next=event.detail;
    if(next.connected===connected&&next.identity===identity&&next.revision===sourceRevision)return;
    connected=next.connected;identity=next.identity;sourceRevision=next.revision;revision++;letters=[];lastLoaded=false;
    if(!connected){compose.close();reader.close();by('letterSubject').value='';by('letterBody').value='';by('readLetterBody').textContent='';by('readLetterTitle').textContent='';by('readLetterSignature').textContent='';by('readLetterMeta').textContent='';by('letterRecipient').textContent='';by('letterSendStatus').textContent='';by('readLetterStatus').textContent='';by('mailStatus').textContent='登录后，来收信吧。';}
    render();if(connected)refresh();
  });
  window.addEventListener('our-world-state',()=>{if(connected)render();});
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  const onReturn=()=>{if(!document.hidden)refresh();};
  document.addEventListener('visibilitychange',onReturn);window.addEventListener('online',onReturn);
})();
