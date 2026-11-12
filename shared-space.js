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
  const cloud = window.OUR_WORLD_CLOUD;
  let remoteProfile = null;
  let profileSaving = false;
  let pendingProfile = null;
  let applyingProfile = false;
  let migrationBusy = false;
  let localOnly = false;
  let localPhotosChecked = false;
  const previewLoaders = new Map();
  const by = id => document.getElementById(id);
  const bytes = size => size >= 1e9 ? (size / 1e9).toFixed(2) + ' GB' : size >= 1e6 ? (size / 1e6).toFixed(1) + ' MB' : (size / 1000).toFixed(1) + ' KB';
  function localNames() {
    by('messageAuthor').options[0].textContent = state.me;
    by('messageAuthor').options[1].textContent = state.partner;
  }
  function status(message) { by('sharedStatus').textContent = message; }
  async function api(path, options = {}, target = connection) {
    if (!target) throw new Error('请先连接你们的共享空间。');
    if (target.provider === 'supabase') return window.getSupabaseRoom(target).api(path,options);
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
    by('sendMessage').textContent = connected ? '留给你' : cloud?.address && !localOnly ? '连接后留言' : '保存到本机';
    by('uploadSharedMedia').disabled = !connected || Boolean(uploadController);
    by('disconnectSharedSpace').disabled = Boolean(uploadController);
    by('connectSharedSpace').disabled = Boolean(uploadController);
    by('copyRoomInvite').hidden = !connected;
    by('copyAlbumInvite').hidden = !connected;
    by('refreshAlbum').disabled = !connected || refreshBusy || Boolean(uploadController);
    by('migrateLocalPhotos').hidden = !connected || !state.photos.length;
    by('migrateLocalPhotos').disabled = !connected || Boolean(uploadController) || migrationBusy;
    by('migrateLocalMessages').hidden = !connected || !(state.messages || []).length;
    by('migrateLocalMessages').disabled = !connected || migrationBusy;
    if (connected) {
      by('photos').querySelector('.section-desc').textContent = '这里上传的照片和视频，会同步到两个人的小屋。';
      by('uploadPhoto').textContent = '上传照片或视频';
      if (by('gallery').nextElementSibling !== by('sharedMediaGrid')) by('gallery').after(by('sharedMediaGrid'));
      if (by('photoSharedTools').nextElementSibling !== by('sharedUpload')) by('photoSharedTools').after(by('sharedUpload'));
      by('photoSyncNotice').textContent = '共享相册 · 云端共 ' + media.length + ' 个文件 · ' + by('sharedStorageText').textContent;
      by('gallery').hidden = true;
      by('localPhotosLabel').hidden = true;
      by('showLocalPhotos').hidden = !state.photos.length;
    } else {
      if (by('sharedMediaGrid').parentElement !== by('sharedAlbum')) by('sharedAlbum').append(by('sharedMediaGrid'));
      if (by('sharedUpload').parentElement !== by('sharedAlbum')) by('sharedAlbum').append(by('sharedUpload'));
      by('photoSyncNotice').textContent = cloud?.address ? '免费小屋已开通，先连接小屋再上传，两台设备就能看到同一份相册。' : '本机相册 · 这里原有的照片仅保存在当前设备。';
      by('gallery').hidden = false;
      by('localPhotosLabel').hidden = false;
      by('showLocalPhotos').hidden = true;
    }
  }
  const profile = () => ({me:state.me,partner:state.partner,startDate:state.startDate});
  async function saveProfile() {
    if (!connected || connection?.provider !== 'supabase' || applyingProfile) return;
    const next = profile();
    if (JSON.stringify(next) === JSON.stringify(remoteProfile)) return;
    pendingProfile = next;
    if (profileSaving) return;
    profileSaving = true;
    try {
      while (pendingProfile) {
        const value = pendingProfile; pendingProfile = null;
        await api('/room/profile',{method:'PUT',body:JSON.stringify(value)});
        remoteProfile = value;
      }
    } catch (error) { pendingProfile = profile(); toast('本机已保存，称呼和纪念日暂未同步，请稍后刷新重试。'); }
    finally { profileSaving = false; }
  }
  async function receiveProfile(value) {
    if (connection?.provider !== 'supabase' || profileSaving || pendingProfile) return;
    if (!value) { remoteProfile = null; await saveProfile(); return; }
    remoteProfile = value;
    if (JSON.stringify(profile()) === JSON.stringify(value)) return;
    const next = normalizeState({...state,...value});
    try { localStorage.setItem('our-little-world-before-shared-profile-v1',JSON.stringify(profile())); }
    catch { return; }
    applyingProfile = true;
    try { save(next); } finally { applyingProfile = false; }
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
    previewLoaders.clear();
    const grid = by('sharedMediaGrid'); grid.replaceChildren();
    if (!media.length) {
      const empty = document.createElement('p'); empty.className = 'shared-empty';
      empty.textContent = connected ? (state.photos.length ? '云端暂无照片，当前设备还有 ' + state.photos.length + ' 张本机照片。正在尝试同步，也可以点击上方“将本机照片上传到共享相册”。' : '云端暂无照片。若电脑能看到照片，请在电脑端连接同一个小屋并上传本机照片，再点“刷新共享相册”。') : '共享相册尚未连接，暂不能上传照片视频。容量以实际开通的空间为准。';
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
      const baseInfo = info.textContent;
      const retry = document.createElement('button'); retry.className = 'text-link'; retry.textContent = '重新加载'; retry.hidden = true;
      let loading = false, attempts = 0, expiresAt = 0, failed = false;
      const current = () => revision === connectionRevision && card.isConnected;
      function showFailure() {
        if (!current()) return;
        failed = true; retry.hidden = false;
        info.textContent = baseInfo + ' · 预览未加载，可重新加载或下载原文件。';
      }
      async function loadPreview() {
        if (loading || !current()) return;
        loading = true; retry.hidden = true; failed = false; info.textContent = baseInfo;
        try {
          const ticket = await mediaTicket(entry.id);
          if (!current()) return;
          const url = new URL(ticket.url);
          if (attempts) url.searchParams.set('_refresh',String(Date.now()));
          expiresAt = ticket.expiresAt || Date.now()+3600000;
          preview.src = url.href;
        } catch { showFailure(); }
        finally { loading = false; }
      }
      retry.addEventListener('click',() => { attempts++; loadPreview(); });
      preview.addEventListener('error',() => {
        if (!current()) return;
        if (!attempts) { attempts++; setTimeout(() => loadPreview(),400); }
        else showFailure();
      });
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
      actions.append(retry,download,remove); card.append(preview,name,info,actions); grid.append(card);
      previewLoaders.set(entry.id,() => { if (failed || (Date.now()>=expiresAt && (!isVideo || preview.paused))) { attempts++; loadPreview(); } });
      loadPreview();
    });
  }
  async function refresh(forceMedia = false) {
    if (!connection || refreshBusy) return;
    refreshBusy = true;
    const target = connection;
    try {
      const [room,notes,album] = await Promise.all([api('/room',{},target),api('/messages',{},target),api('/media',{},target)]);
      if (target !== connection) return;
      const mediaChanged = !connected || JSON.stringify(media) !== JSON.stringify(album.media);
      connected = true; sharedMessages = notes.messages; media = album.media;
      await receiveProfile(room.profile);
      if (pendingProfile && !profileSaving) await saveProfile();
      status('已连接两个人的小屋 · 留言和照片视频可以跨设备查看。');
      by('sharedStorageText').textContent = '已用 ' + bytes(room.usedBytes) + ' / 可用上限 ' + bytes(room.maxBytes) + (room.maxFileBytes ? ' · 单个文件最多 ' + bytes(room.maxFileBytes) : '') + (room.pendingBytes ? ' · 正在上传 ' + bytes(room.pendingBytes) : '');
      displayMode(); renderMessages();
      if (mediaChanged) renderMedia();
      else if (forceMedia) previewLoaders.forEach(reload => reload());
      if (!localPhotosChecked && target.provider === 'supabase') {
        localPhotosChecked = true;
        setTimeout(() => { if (connection === target && connected && !uploadController) migrateLocalPhotos(); },0);
      }
    } finally { refreshBusy = false; displayMode(); }
  }
  by('messageText').addEventListener('input',() => { by('messageCounter').textContent = by('messageText').value.length + ' / 1000'; });
  by('messageForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (cloud?.address && !connected && !localOnly) { connectionFields(); openDialog('sharedSpaceDialog'); return; }
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
  by('refreshAlbum').addEventListener('click',async () => {
    try { await refresh(true); toast('已从云端刷新，共 ' + media.length + ' 个文件。'); }
    catch { toast('暂时无法读取云端相册，请检查网络后重试。'); }
  });
  function connectionFields() {
    by('sharedSpaceAddress').value = cloud?.address || connection?.address || '';
    by('sharedSpaceSecret').value = connection?.secret || '';
    by('sharedSpaceAddressField').hidden = Boolean(cloud?.address);
    by('sharedConnectionHelp').textContent = cloud?.address ? '免费小屋已开通。输入你们的小屋口令，或用对方发来的邀请链接进入。' : '云端尚未开通，当前只能保存本机留言。';
  }
  document.querySelectorAll('[data-open="sharedSpaceDialog"]').forEach(button => button.addEventListener('click',connectionFields));
  by('sharedSpaceForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (uploadController) return;
    const url = new URL(by('sharedSpaceAddress').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return toast('请填写有效的 HTTPS 空间地址。');
    const target = {...(cloud || {}),address:url.href.replace(/\/$/,''),secret:by('sharedSpaceSecret').value.trim()};
    if (target.secret.length < 32 || target.secret.length > 128) return toast('小屋口令应为32至128位。');
    by('connectSharedSpace').disabled = true;
    try {
      await api('/room',{},target);
      localStorage.setItem(connectionKey,JSON.stringify(target)); connection = target; connectionRevision++;
      localOnly = false; localPhotosChecked = false;
      connected = false; sharedMessages = []; media = []; await refresh();
      by('sharedSpaceDialog').close(); toast('已连接两个人的小屋。');
    } catch (error) { toast(error.message); }
    finally { displayMode(); }
  });
  by('disconnectSharedSpace').addEventListener('click',() => {
    if (uploadController) return;
    localStorage.removeItem(connectionKey); connection = null; connected = false; sharedMessages = []; media = []; connectionRevision++;
    localOnly = true; localPhotosChecked = false;
    by('sharedSpaceSecret').value = ''; by('sharedSpaceDialog').close();
    status('本机留言 · 连接共享空间后，两部手机才能互相看到。');
    by('sharedStorageText').textContent = '共享相册尚未连接，暂不能上传。'; displayMode(); renderMessages(); renderMedia();
  });
  function uploadPart(path, blob, signal, onProgress) {
    if (connection?.provider === 'supabase') return window.getSupabaseRoom(connection).uploadPart(path,blob,signal,onProgress);
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
  async function uploadFiles(files,onUploaded) {
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
        if (onUploaded) await onUploaded(file);
        by('sharedUploadProgress').value = 100; by('sharedUploadPercent').textContent = '已上传';
        await refresh();
      }
      toast('照片和视频，已经存进两个人的相册。');
    } catch (error) {
      if (pendingId) await api('/media/' + pendingId,{method:'DELETE'}).catch(() => {});
      toast(error.name === 'AbortError' ? '上传已取消，已上传的其他文件会保留。' : error.message);
    } finally { uploadController = null; by('sharedUpload').hidden = true; displayMode(); if (connection) refresh().catch(() => {}); }
  }
  by('sharedMediaInput').addEventListener('change',async event => { const files = [...event.target.files]; event.target.value = ''; await uploadFiles(files); });
  by('showLocalPhotos').addEventListener('click',() => { by('gallery').hidden = !by('gallery').hidden; by('localPhotosLabel').hidden = by('gallery').hidden; });
  async function migrateLocalPhotos(event) {
    if (!connected || migrationBusy || uploadController) return;
    migrationBusy = true; displayMode();
    const key = 'our-little-world-migrated-photos-' + connection.address;
    try {
      const imported = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
      const photos = state.photos.filter(photo => !imported.has(photo.id));
      if (!photos.length) { if (event) toast('这些本机照片已经上传过了，原来的本机照片仍然保留。'); return; }
      const uploads = [];
      for (const photo of photos) {
        const blob = await (await fetch(photo.src)).blob();
        const extension = {'image/png':'.png','image/webp':'.webp','image/jpeg':'.jpg'}[blob.type] || '.jpg';
        const file = new File([blob],(photo.caption || '以前收藏的照片').slice(0,220) + extension,{type:blob.type});
        file.localPhotoId = photo.id; uploads.push(file);
      }
      await uploadFiles(uploads,file => { imported.add(file.localPhotoId); localStorage.setItem(key,JSON.stringify([...imported])); });
    } catch (error) { toast(error.message); }
    finally { migrationBusy = false; displayMode(); }
  }
  by('migrateLocalPhotos').addEventListener('click',migrateLocalPhotos);
  by('migrateLocalMessages').addEventListener('click',async () => {
    if (!connected || migrationBusy) return;
    migrationBusy = true; displayMode();
    const key = 'our-little-world-migrated-messages-' + connection.address;
    try {
      const imported = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
      for (const note of state.messages || []) {
        if (imported.has(note.id)) continue;
        await api('/messages',{method:'POST',body:JSON.stringify({author:note.author,text:note.text})});
        imported.add(note.id); localStorage.setItem(key,JSON.stringify([...imported]));
      }
      await refresh(); toast('本机留言已复制到共享小屋，原记录仍在本机。');
    } catch (error) { toast(error.message); }
    finally { migrationBusy = false; displayMode(); }
  });
  async function copyInvite() {
    if (!connected) return;
    const data = {address:connection.address,secret:connection.secret,provider:connection.provider,anonKey:connection.anonKey,email:connection.email,bucket:connection.bucket};
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const link = location.origin + location.pathname + '?v=20261112-photo-sync#room=' + encoded;
    try { await navigator.clipboard.writeText(link); toast('邀请链接已复制，只发给对方即可。'); }
    catch { by('roomInvite').value = link; by('roomInviteField').hidden = false; by('roomInvite').focus(); by('roomInvite').select(); }
  }
  by('copyRoomInvite').addEventListener('click',copyInvite);
  by('copyAlbumInvite').addEventListener('click',copyInvite);
  window.addEventListener('our-world-state',() => { renderMessages(); displayMode(); saveProfile(); });
  window.addEventListener('beforeunload',event => { if (uploadController) { event.preventDefault(); event.returnValue = ''; } });
  try { const saved = JSON.parse(localStorage.getItem(connectionKey)); if (saved && /^https:\/\//.test(saved.address) && typeof saved.secret === 'string') connection = saved; } catch (error) {}
  try {
    if (location.hash.startsWith('#room=')) {
      const encoded = location.hash.slice(6).replace(/-/g,'+').replace(/_/g,'/');
      if (encoded.length > 6000) throw new Error('邀请链接过长。');
      const invite = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),letter=>letter.charCodeAt(0))));
      if (invite.provider !== 'supabase' || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(invite.address) || typeof invite.secret !== 'string' || invite.secret.length < 32 || (cloud?.address && invite.address !== cloud.address)) throw new Error('邀请链接不正确。');
      connection = invite; localStorage.setItem(connectionKey,JSON.stringify(invite));
      history.replaceState(null,'',location.pathname + location.search + '#messages');
    }
  } catch (error) { toast('邀请链接无法识别，请使用对方重新复制的链接。'); }
  window.ourSharedSpace = {
    hasCloud:() => Boolean(cloud?.address || connection),
    chooseMedia:() => { if (connected) by('sharedMediaInput').click(); else { connectionFields(); openDialog('sharedSpaceDialog'); } }
  };
  localNames(); displayMode(); renderMessages(); renderMedia();
  if (connection) refresh().catch(() => { status('共享空间暂时未连接 · 当前只显示本机留言。'); });
  else if (cloud?.address) {
    status('免费小屋已开通 · 连接后查看共同留言，下面暂显示本机记录。');
    by('sharedStorageText').textContent = '免费空间已开通，连接小屋后即可查看相册和可用容量。';
  }
  setInterval(() => { if (connection && !document.hidden && !uploadController) refresh().catch(() => {}); },30000);
  const refreshOnReturn = () => { if (connection && !document.hidden && !uploadController) refresh(true).catch(() => { status('暂时无法刷新共享相册，已保留上次内容。'); }); };
  document.addEventListener('visibilitychange',refreshOnReturn);
  window.addEventListener('pageshow',refreshOnReturn);
  window.addEventListener('focus',refreshOnReturn);
  window.addEventListener('online',refreshOnReturn);
})();
