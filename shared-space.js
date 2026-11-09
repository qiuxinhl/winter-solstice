(() => {
  'use strict';
  const connectionKey = 'our-little-world-shared-connection-v1';
  let connection = null;
  let connected = false;
  let sharedMessages = [];
  let media = [];
  let refreshBusy = false;
  let uploadController = null;
  let connectionRevision = 0;
  const by = id => document.getElementById(id);
  const bytes = size => size >= 1e9 ? (size / 1e9).toFixed(2) + ' GB' : size >= 1e6 ? (size / 1e6).toFixed(1) + ' MB' : (size / 1000).toFixed(1) + ' KB';
  function localNames() {
    by('messageAuthor').options[0].textContent = state.me;
    by('messageAuthor').options[1].textContent = state.partner;
  }
  function status(message) { by('sharedStatus').textContent = message; }
  async function api(path, options = {}, target = connection) {
    if (!target) throw new Error('请先连接你们的共享空间。');
    const response = await fetch(target.address + path, {
      ...options,
      headers: { Authorization:'Bearer ' + target.secret, ...(options.body && typeof options.body === 'string' ? {'Content-Type':'application/json'} : {}), ...options.headers },
      signal:options.signal || AbortSignal.timeout(30000),
      credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error || (response.status === 401 ? '空间地址或小屋口令不正确。' : '暂时连接不上小屋，请稍后重试。'));
    }
    return response.json();
  }
  function displayMode() {
    by('sendMessage').textContent = connected ? '留给你' : '保存到本机';
    by('uploadSharedMedia').disabled = !connected || Boolean(uploadController);
    by('disconnectSharedSpace').disabled = Boolean(uploadController);
    by('connectSharedSpace').disabled = Boolean(uploadController);
  }
  function renderMessages() {
    localNames();
    const list = by('messageList');
    list.replaceChildren();
    const messages = connected ? sharedMessages : (state.messages || []);
    if (!messages.length) {
      const empty = document.createElement('li'); empty.className = 'shared-empty';
      empty.textContent = connected ? '还没有留言。给对方写下第一句吧。' : '还没有本机留言。先写下想说的话，也可以稍后连接共享空间。';
      list.append(empty);
    }
    [...messages].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).forEach(message => {
      const item = document.createElement('li'); item.className = 'message-item'; item.dataset.author = message.author;
      const top = document.createElement('div'); top.className = 'message-item-top';
      const avatar = document.createElement('span'); avatar.className = 'message-avatar';
      const author = document.createElement('span'); author.textContent = message.author === 'partner' ? state.partner : state.me;
      avatar.textContent = Array.from(author.textContent)[0];
      const time = document.createElement('time'); time.dateTime = message.createdAt;
      time.textContent = new Date(message.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const text = document.createElement('p'); text.textContent = message.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'message-delete'; remove.textContent = '撤下这句'; remove.setAttribute('aria-label','撤下留言：' + message.text);
      remove.addEventListener('click', async () => {
        if (!confirm('要撤下这句留言吗？')) return;
        remove.disabled = true;
        try {
          if (connected) { await api('/messages/' + encodeURIComponent(message.id),{method:'DELETE'}); await refresh(); }
          else save({...state,messages:(state.messages || []).filter(entry => entry.id !== message.id)},'留言已撤下。');
        } catch (error) { toast(error.message); remove.disabled = false; }
      });
      top.append(avatar,author,time); item.append(top,text,remove); list.append(item);
    });
  }
  async function mediaTicket(id, download = false) {
    return api('/media/' + encodeURIComponent(id) + '/ticket',{method:'POST',body:JSON.stringify({download})});
  }
  function renderMedia() {
    const grid = by('sharedMediaGrid'); grid.replaceChildren();
    if (!media.length) {
      const empty = document.createElement('p'); empty.className = 'shared-empty';
      empty.textContent = connected ? '相册还是空的。放入一张合照，或一段想记住的视频吧。' : '共享相册尚未连接，暂不能上传照片视频。容量以实际开通的空间为准。';
      grid.append(empty); return;
    }
    const revision = connectionRevision;
    media.forEach(entry => {
      const card = document.createElement('article'); card.className = 'shared-media-card';
      const isVideo = entry.type.startsWith('video/');
      const preview = document.createElement(isVideo ? 'video' : 'img');
      if (isVideo) { preview.controls = true; preview.preload = 'none'; preview.playsInline = true; }
      else { preview.loading = 'lazy'; preview.alt = entry.name; }
      preview.referrerPolicy = 'no-referrer';
      const name = document.createElement('p'); name.className = 'shared-media-name'; name.textContent = entry.name;
      const info = document.createElement('p'); info.className = 'shared-media-info'; info.textContent = (isVideo ? '视频 · ' : '照片 · ') + bytes(entry.size);
      const actions = document.createElement('div'); actions.className = 'shared-media-actions';
      const download = document.createElement('button'); download.className = 'text-link'; download.textContent = '下载原文件';
      download.addEventListener('click',async () => {
        download.disabled = true;
        try { const ticket = await mediaTicket(entry.id,true); const anchor = document.createElement('a'); anchor.href = ticket.url; anchor.rel = 'noreferrer'; anchor.download = entry.name; document.body.append(anchor); anchor.click(); anchor.remove(); }
        catch (error) { toast(error.message); } finally { download.disabled = false; }
      });
      const remove = document.createElement('button'); remove.className = 'text-link'; remove.textContent = '移出相册';
      remove.addEventListener('click',async () => {
        if (!confirm('确定从共享相册删除这个原文件吗？删除后对方也将无法查看。')) return;
        remove.disabled = true;
        try { if (isVideo) preview.pause(); await api('/media/' + entry.id,{method:'DELETE'}); await refresh(); }
        catch (error) { toast(error.message); remove.disabled = false; }
      });
      actions.append(download,remove); card.append(preview,name,info,actions); grid.append(card);
      mediaTicket(entry.id).then(ticket => { if (revision === connectionRevision && card.isConnected) preview.src = ticket.url; }).catch(() => { info.textContent += ' · 预览暂不可用，可重试刷新'; });
      preview.addEventListener('error',() => { info.textContent = (isVideo ? '当前浏览器可能不支持此视频格式，可下载原文件。' : '当前浏览器可能不支持此图片格式，可下载原文件。'); },{once:true});
    });
  }
  async function refresh(forceMedia = false) {
    if (!connection || refreshBusy) return;
    refreshBusy = true;
    const target = connection;
    try {
      const [room,notes,album] = await Promise.all([api('/room',{},target),api('/messages',{},target),api('/media',{},target)]);
      if (target !== connection) return;
      const mediaChanged = forceMedia || !connected || JSON.stringify(media) !== JSON.stringify(album.media);
      connected = true; sharedMessages = notes.messages; media = album.media;
      status('已连接两个人的小屋 · 留言和照片视频可以跨设备查看。');
      by('sharedStorageText').textContent = '已用 ' + bytes(room.usedBytes) + ' / 空间上限 ' + bytes(room.maxBytes) + (room.pendingBytes ? ' · 正在上传 ' + bytes(room.pendingBytes) : '');
      displayMode(); renderMessages(); if (mediaChanged) renderMedia();
    } finally { refreshBusy = false; }
  }
  by('messageText').addEventListener('input',() => { by('messageCounter').textContent = by('messageText').value.length + ' / 1000'; });
  by('messageForm').addEventListener('submit',async event => {
    event.preventDefault();
    const text = by('messageText').value.trim(); const author = by('messageAuthor').value;
    if (!text || text.length > 1000) return toast('请写下 1 到 1000 字的留言。');
    by('sendMessage').disabled = true;
    try {
      if (connected) {
        await api('/messages',{method:'POST',body:JSON.stringify({text,author})});
        by('messageText').value = ''; by('messageCounter').textContent = '0 / 1000';
        toast('这句话，已经留给对方了。'); await refresh();
      } else {
        if ((state.messages || []).length >= 500) throw new Error('本机已经保存了500句留言，请先备份或整理。');
        if (save({...state,messages:[...(state.messages || []),{id:makeId(),author,text,createdAt:new Date().toISOString()}]},'已保存在本机；另一部手机暂时看不到。')) { by('messageText').value = ''; by('messageCounter').textContent = '0 / 1000'; }
      }
    } catch (error) { toast(error.message); }
    finally { by('sendMessage').disabled = false; }
  });
  by('refreshMessages').addEventListener('click',async () => {
    try { if (connection) await refresh(true); else renderMessages(); } catch (error) { status('暂时连不上小屋，已显示上次加载的内容。'); toast(error.message); }
  });
  document.querySelectorAll('[data-open="sharedSpaceDialog"]').forEach(button => button.addEventListener('click',() => {
    by('sharedSpaceAddress').value = connection?.address || ''; by('sharedSpaceSecret').value = connection?.secret || '';
  }));
  by('sharedSpaceForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (uploadController) return;
    const url = new URL(by('sharedSpaceAddress').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return toast('请填写有效的 HTTPS 空间地址。');
    const target = {address:url.href.replace(/\/$/,''),secret:by('sharedSpaceSecret').value.trim()};
    if (target.secret.length < 32 || target.secret.length > 128) return toast('小屋口令应为32至128位。');
    by('connectSharedSpace').disabled = true;
    try {
      await api('/room',{},target);
      localStorage.setItem(connectionKey,JSON.stringify(target)); connection = target; connectionRevision++;
      connected = false; sharedMessages = []; media = []; await refresh();
      by('sharedSpaceDialog').close(); toast('已连接两个人的小屋。');
    } catch (error) { toast(error.message); }
    finally { displayMode(); }
  });
  by('disconnectSharedSpace').addEventListener('click',() => {
    if (uploadController) return;
    localStorage.removeItem(connectionKey); connection = null; connected = false; sharedMessages = []; media = []; connectionRevision++;
    by('sharedSpaceSecret').value = ''; by('sharedSpaceDialog').close();
    status('本机留言 · 连接共享空间后，两部手机才能互相看到。');
    by('sharedStorageText').textContent = '共享相册尚未连接，暂不能上传。'; displayMode(); renderMessages(); renderMedia();
  });
  function uploadPart(path, blob, signal, onProgress) {
    return new Promise((resolve,reject) => {
      const request = new XMLHttpRequest(); request.open('PUT',connection.address + path); request.setRequestHeader('Authorization','Bearer ' + connection.secret); request.timeout = 180000;
      const cancel = () => request.abort(); signal.addEventListener('abort',cancel,{once:true});
      const done = () => signal.removeEventListener('abort',cancel);
      request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
      request.onload = () => { done(); try { const result = JSON.parse(request.responseText); if (request.status < 200 || request.status >= 300) throw new Error(result.error || '这段文件未能上传，请重试。'); resolve(result); } catch (error) { reject(error); } };
      request.onerror = () => { done(); reject(new Error('网络中断，请检查连接后重新上传。')); };
      request.ontimeout = () => { done(); reject(new Error('网络较慢，上传超时，请重试。')); };
      request.onabort = () => { done(); reject(new DOMException('已取消上传。','AbortError')); };
      if (signal.aborted) { done(); reject(new DOMException('已取消上传。','AbortError')); return; }
      request.send(blob);
    });
  }
  by('uploadSharedMedia').addEventListener('click',() => { if (connected && !uploadController) by('sharedMediaInput').click(); });
  by('cancelSharedUpload').addEventListener('click',() => uploadController?.abort());
  by('sharedMediaInput').addEventListener('change',async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (!connected || uploadController || !files.length) return;
    const controller = new AbortController(); uploadController = controller; displayMode(); by('sharedUpload').hidden = false;
    let pendingId = null;
    try {
      for (const file of files) {
        controller.signal.throwIfAborted();
        by('sharedUploadLabel').textContent = '正在上传：' + file.name;
        by('sharedUploadProgress').value = 0; by('sharedUploadPercent').textContent = '准备上传…';
        const upload = await api('/media/init',{method:'POST',body:JSON.stringify({name:file.name,size:file.size,type:file.type}),signal:controller.signal}); pendingId = upload.id;
        const parts = [];
        for (let offset = 0; offset < file.size; offset += upload.partSize) {
          const number = parts.length + 1; const blob = file.slice(offset,offset + upload.partSize);
          const part = await uploadPart('/media/' + upload.id + '/parts/' + number,blob,controller.signal,loaded => {
            const percent = Math.min(99,Math.floor((offset + loaded) / file.size * 100)); by('sharedUploadProgress').value = percent; by('sharedUploadPercent').textContent = percent + '% · ' + bytes(offset + loaded) + ' / ' + bytes(file.size);
          });
          parts.push({partNumber:number,etag:part.etag});
        }
        await api('/media/' + upload.id + '/complete',{method:'POST',body:JSON.stringify({parts}),signal:controller.signal}); pendingId = null;
        by('sharedUploadProgress').value = 100; by('sharedUploadPercent').textContent = '已上传';
        await refresh();
      }
      toast('照片和视频，已经存进两个人的相册。');
    } catch (error) {
      if (pendingId) await api('/media/' + pendingId,{method:'DELETE'}).catch(() => {});
      toast(error.name === 'AbortError' ? '上传已取消，已上传的其他文件会保留。' : error.message);
    } finally { uploadController = null; by('sharedUpload').hidden = true; displayMode(); if (connection) refresh().catch(() => {}); }
  });
  window.addEventListener('our-world-state',renderMessages);
  window.addEventListener('beforeunload',event => { if (uploadController) { event.preventDefault(); event.returnValue = ''; } });
  try { const saved = JSON.parse(localStorage.getItem(connectionKey)); if (saved && /^https:\/\//.test(saved.address) && typeof saved.secret === 'string') connection = saved; } catch (error) {}
  localNames(); displayMode(); renderMessages(); renderMedia();
  if (connection) refresh().catch(() => { status('共享空间暂时未连接 · 当前只显示本机留言。'); });
  setInterval(() => { if (connection && !document.hidden && !uploadController) refresh().catch(() => {}); },30000);
})();
