(() => {
  'use strict';
  const connectionKey = 'our-little-world-account-session-v2';
  let identity = null;
  let loginBusy = false;
  let remember = true;
  let connection = null;
  let connected = false;
  let hasSynced = false;
  let recoveryTimer = null;
  let recoveryAttempts = 0;
  let loginWaitTimer = null;
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
  let storageSummary = '';
  const previewLoaders = new Map();
  let imageObserver = null;
  const by = id => document.getElementById(id);
  const bytes = size => size >= 1e9 ? (size / 1e9).toFixed(2) + ' GB' : size >= 1e6 ? (size / 1e6).toFixed(1) + ' MB' : (size / 1000).toFixed(1) + ' KB';
  function localNames() {
    by('messageAuthor').options[0].textContent = window.QXNN_PEOPLE.name('me');
    by('messageAuthor').options[1].textContent = window.QXNN_PEOPLE.name('partner');
    if (identity) by('messageAuthor').value = identity;
    by('messageAuthor').disabled = connected;
    const author = window.QXNN_PEOPLE.name(identity || 'me');
    by('messageSenderName').textContent = author;
    by('messageSenderAvatar').textContent = Array.from(author)[0] || '♡';
    by('messageRecipientName').textContent = window.QXNN_PEOPLE.name(identity === 'partner' ? 'me' : 'partner');
    by('messageForm').dataset.author = identity || 'me';
  }
  function loginFeedback(message = '', busy = false) {
    by('loginFeedback').textContent = message;
    by('connectSharedSpace').disabled = busy;
    by('connectSharedSpace').textContent = busy ? '正在回家…' : '回到小屋 →';
    by('sharedSpaceForm').setAttribute('aria-busy',String(busy));
  }
  function accountStage(stage) {
    clearTimeout(loginWaitTimer);
    loginFeedback(stage==='credentials'?'正在验证账号和密码…':'账号已验证，正在确认小屋身份…',true);
    loginWaitTimer=setTimeout(()=>{
      if(loginBusy||restoring)loginFeedback(stage==='credentials'?'账号服务连接较慢，仍在等待响应，不用重复点击。':'账号已验证，小屋连接较慢，仍在等待响应。',true);
    },5000);
  }
  function persistLogin() {
    try {
      const store = remember ? localStorage : sessionStorage;
      const other = remember ? sessionStorage : localStorage;
      other.removeItem(connectionKey);
      const saved = JSON.stringify({provider:connection.provider,address:connection.address,anonKey:connection.anonKey,bucket:connection.bucket,username:connection.username,session:connection.session});
      if (store.getItem(connectionKey) !== saved) store.setItem(connectionKey,saved);
    } catch { loginFeedback('已登录，但浏览器无法记住登录，下次需要重新进入。'); }
  }
  function loginMode() {
    const unlocked = connected && Boolean(identity);
    const wasLocked = document.documentElement.dataset.auth === 'locked';
    document.documentElement.dataset.auth = unlocked ? 'ready' : 'locked';
    by('loginPage').hidden = unlocked;
    document.querySelector('.topbar').inert = !unlocked;
    document.querySelector('main').inert = !unlocked;
    by('loginPassword').required = true;
    if (!unlocked) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if (connected) {
      by('roomLoginSummary').textContent = '当前身份：' + (window.QXNN_PEOPLE.name(identity || 'me')) + '。' + (remember ? '这台设备已记住登录。' : '本次登录仅在当前标签页保留。');
    }
    if (unlocked && wasLocked) {
      by('loginPassword').value = '';
      const destination = document.querySelector(location.hash === '#photos' ? '#photos' : '#home');
      requestAnimationFrame(() => destination?.scrollIntoView({behavior:'instant'}));
    }
  }
  function status(message) { by('sharedStatus').textContent = message; }
  async function api(path, options = {}, target = connection) {
    if (!target) throw new Error('请先连接你们的共享空间。');
    if (target.provider === 'supabase') return window.getSupabaseRoom(target).api(path,options);
    throw new Error('小屋连接配置不正确，请刷新页面。');
  }
  function displayMode() {
    by('sendMessageLabel').textContent = connected ? '把心意寄给你' : cloud?.address && !localOnly ? '连接后留言' : '保存到本机';
    by('uploadPhoto').disabled = Boolean(uploadController) || migrationBusy;
    by('disconnectSharedSpace').disabled = Boolean(uploadController);
    by('connectSharedSpace').disabled = Boolean(uploadController) || loginBusy;
    loginMode();
    by('settingsForm').querySelector('[type="submit"]').disabled=connected&&!hasSynced;
    by('anniversaryForm').querySelector('[type="submit"]').disabled=connected&&!hasSynced;
    document.querySelectorAll('[data-open="anniversaryDialog"]').forEach(button=>button.disabled=connected&&!hasSynced);
    window.dispatchEvent(new CustomEvent('our-world-connection',{detail:{connected,identity,revision:connectionRevision}}));
    by('copyAlbumInvite').hidden = !connected;
    by('albumConnection').textContent = connected ? '小屋设置' : '连接小屋';
    by('sharedMediaGrid').hidden = !connected;
    by('refreshAlbum').disabled = !connected || refreshBusy || Boolean(uploadController);
    by('migrateLocalPhotos').hidden = !connected || !state.photos.length;
    by('migrateLocalPhotos').disabled = !connected || Boolean(uploadController) || migrationBusy;
    by('migrateLocalMessages').hidden = !connected || !(state.messages || []).length;
    by('migrateLocalMessages').disabled = !connected || migrationBusy;
    if (connected) {
      by('photos').querySelector('.section-desc').textContent = '这里上传的照片和视频，会同步到两个人的小屋。';
      by('uploadPhoto').textContent = '上传照片或视频';
      by('photoSyncNotice').textContent = hasSynced ? '共享相册 · 云端共 ' + media.length + ' 个文件 · ' + storageSummary : '已登录 · 正在读取共享相册，网络恢复后会自动重试，也可点击“刷新共享相册”。';
      by('gallery').hidden = true;
      by('localPhotosLabel').hidden = true;
      by('showLocalPhotos').hidden = !state.photos.length;
    } else {
      by('photoSyncNotice').textContent = cloud?.address ? '免费小屋已开通，先连接小屋再上传，两台设备就能看到同一份相册。' : '本机相册 · 这里原有的照片仅保存在当前设备。';
      by('gallery').hidden = Boolean(cloud?.address) && !state.photos.length;
      by('localPhotosLabel').hidden = !state.photos.length;
      by('showLocalPhotos').hidden = true;
    }
  }
  const profile = () => ({me:state.me,partner:state.partner,startDate:state.startDate,anniversaries:state.anniversaries||[]});
  async function saveProfile() {
    if (!connected || !hasSynced || connection?.provider !== 'supabase' || applyingProfile) return;
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
      empty.textContent = connected ? (hasSynced ? '还没有留言。给对方写下第一句吧。' : '留言正在加载，网络恢复后会自动重试。') : '还没有本机留言。先写下想说的话，也可以稍后连接共享空间。';
      list.append(empty);
    }
    [...messages].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).forEach(message => {
      const item = document.createElement('li'); item.className = 'message-item'; item.dataset.author = message.author;
      item.dataset.self = String(message.author === identity);
      const top = document.createElement('div'); top.className = 'message-item-top';
      const avatar = document.createElement('span'); avatar.className = 'message-avatar';
      const author = document.createElement('span'); author.textContent = window.QXNN_PEOPLE.name(message.author);
      avatar.textContent = Array.from(author.textContent)[0];
      const time = document.createElement('time'); time.dateTime = message.createdAt;
      time.textContent = new Date(message.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const text = document.createElement('p'); text.textContent = message.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'message-delete'; remove.textContent = '撤下这句'; remove.setAttribute('aria-label','撤下留言：' + message.text);
      remove.addEventListener('click', async () => {
        if (connected && message.author !== identity) return toast('只能撤回自己写的留言。');
        if (!confirm('要撤下这句留言吗？')) return;
        remove.disabled = true;
        try {
          if (connected) { await api('/messages/' + encodeURIComponent(message.id),{method:'DELETE'}); await refresh(); }
          else save({...state,messages:(state.messages || []).filter(entry => entry.id !== message.id)},'留言已撤下。');
        } catch (error) { toast(error.message); remove.disabled = false; }
      });
      const badge = document.createElement('span'); badge.className = 'message-identity-badge'; badge.textContent = message.author === identity ? '我写的' : '对方写的';
      top.append(avatar,author,badge,time); item.append(top,text);
      if (connected ? message.author === identity : !cloud?.address) item.append(remove);
      list.append(item);
    });
  }
  async function mediaTicket(id, download = false) {
    return api('/media/' + encodeURIComponent(id) + '/ticket',{method:'POST',body:JSON.stringify({download})});
  }
  function renderMedia() {
    imageObserver?.disconnect();
    imageObserver = null;
    previewLoaders.forEach(reload => reload.dispose?.());
    previewLoaders.clear();
    const grid = by('sharedMediaGrid'); grid.replaceChildren();
    if (!media.length) {
      const empty = document.createElement('p'); empty.className = 'shared-empty';
      empty.textContent = connected ? (state.photos.length ? '云端暂无照片，当前设备还有 ' + state.photos.length + ' 张本机照片。正在尝试同步，也可以点击上方“将本机照片上传到共享相册”。' : '云端暂无照片。若电脑能看到照片，请在电脑端连接同一个小屋并上传本机照片，再点“刷新共享相册”。') : '共享相册尚未连接，暂不能上传照片视频。容量以实际开通的空间为准。';
      if(connected&&!hasSynced)empty.textContent='相册正在加载，网络恢复后会自动重试，不需要重新登录。';
      grid.append(empty); return;
    }
    const revision = connectionRevision;
    media.forEach(entry => {
      const card = document.createElement('article'); card.className = 'shared-media-card';
      const isVideo = entry.type.startsWith('video/');
      const preview = document.createElement(isVideo ? 'video' : 'img');
      if (isVideo) { preview.controls = true; preview.preload = 'none'; preview.playsInline = true; }
      else { preview.loading = 'eager'; preview.alt = entry.name; }
      preview.referrerPolicy = 'no-referrer';
      const name = document.createElement('p'); name.className = 'shared-media-name'; name.textContent = entry.name;
      const info = document.createElement('p'); info.className = 'shared-media-info'; info.textContent = (isVideo ? '视频 · ' : '照片 · ') + bytes(entry.size);
      const baseInfo = info.textContent;
      const retry = document.createElement('button'); retry.className = 'text-link'; retry.textContent = '重新加载'; retry.hidden = true;
      let loading = false, attempts = 0, expiresAt = 0, failed = false;
      let releasePreview = null, previewController = null;
      const current = () => revision === connectionRevision && card.isConnected;
      function showFailure() {
        if (!current()) return;
        failed = true; retry.hidden = false;
        info.textContent = baseInfo + ' · 预览未加载，可重新加载或下载原文件。';
      }
      async function loadPreview() {
        if (loading || !current()) return;
        loading = true; retry.hidden = true; failed = false; info.textContent = baseInfo;
        previewController = new AbortController();
        try {
          const ticket = !isVideo && connection.provider === 'supabase'
            ? await window.getSupabaseRoom(connection).imagePreview(entry.id,previewController.signal)
            : await mediaTicket(entry.id);
          if (!current()) { ticket.revoke?.(); return; }
          const url = new URL(ticket.url);
          if (attempts && !ticket.revoke) url.searchParams.set('_refresh',String(Date.now()));
          releasePreview?.(); releasePreview = ticket.revoke || null;
          expiresAt = ticket.expiresAt || Date.now()+3600000;
          preview.src = url.href;
        } catch {
          if (current()) {
            if (!attempts) { attempts++; setTimeout(() => loadPreview(),400); }
            else showFailure();
          }
        }
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
      const reload = () => { if (failed || (expiresAt && Date.now()>=expiresAt && (!isVideo || preview.paused))) { attempts++; loadPreview(); } };
      reload.dispose = () => { previewController?.abort(); releasePreview?.(); };
      previewLoaders.set(entry.id,reload);
      if (!isVideo && typeof IntersectionObserver !== 'undefined') {
        if (!imageObserver) imageObserver = new IntersectionObserver(entries => {
          for (const item of entries) if (item.isIntersecting) { imageObserver.unobserve(item.target); item.target.loadImage?.(); }
        },{rootMargin:'400px'});
        card.loadImage = loadPreview;
        imageObserver.observe(card);
      } else loadPreview();
    });
  }
  function scheduleRecovery() {
    if(recoveryTimer||!connection||recoveryAttempts>=3)return;
    const target=connection,delay=[1500,4000,10000][recoveryAttempts++];
    recoveryTimer=setTimeout(()=>{recoveryTimer=null;if(connection!==target)return;(connected?refresh():restoreAccount()).catch(()=>{});},delay);
  }
  function clearInvalidAccount(error,target) {
    if(target!==connection)return;
    for(const store of [localStorage,sessionStorage]){try{store.removeItem(connectionKey);}catch{}}
    clearTimeout(recoveryTimer);recoveryTimer=null;
    connection=null;connected=false;hasSynced=false;identity=null;sharedMessages=[];media=[];connectionRevision++;
    pendingProfile=null;remoteProfile=null;
    renderMessages();renderMedia();loginFeedback(error.message);displayMode();
  }
  function acceptAccount(target,account) {
    connection=target;identity=account.identity;connected=true;hasSynced=false;
    localOnly=false;localPhotosChecked=false;remoteProfile=null;pendingProfile=null;
    persistLogin();by('loginPassword').value='';loginFeedback();
    status('已连接两个人的小屋 · 正在加载照片和留言。');
    displayMode();renderMessages();renderMedia();
    refresh().catch(()=>{});
  }
  let restoring=false;
  async function restoreAccount() {
    if(!connection||restoring||loginBusy)return;
    restoring=true;const target=connection;loginFeedback('正在恢复登录，请稍等…',true);
    try{const account=await api('/account',{onStage:accountStage},target);if(target===connection)acceptAccount(target,account);}
    catch(error){
      if(target!==connection)return;
      if(error.authFailure)clearInvalidAccount(error,target);
      else {loginFeedback('暂时连不上小屋，已保留登录，会自动重试，不用重复输入密码。');scheduleRecovery();}
    }finally{clearTimeout(loginWaitTimer);restoring=false;by('connectSharedSpace').disabled=false;}
  }
  async function refresh(forceMedia = false) {
    if (!connection || refreshBusy) return;
    refreshBusy = true;
    const target = connection;
    try {
      const [room,notes,album] = await Promise.all([api('/room',{},target),api('/messages',{},target),api('/media',{},target)]);
      if (target !== connection) return;
      const mediaChanged = !hasSynced || JSON.stringify(media) !== JSON.stringify(album.media);
      if (!['me','partner'].includes(room.identity)) throw new Error('这个账号尚未加入小屋。');
      identity = room.identity;
      connected = true;hasSynced=true; sharedMessages = notes.messages; media = album.media;
      clearTimeout(recoveryTimer);recoveryTimer=null;recoveryAttempts=0;
      persistLogin();
      await receiveProfile(room.profile);
      if (pendingProfile && !profileSaving) await saveProfile();
      status('已连接两个人的小屋 · 留言和照片视频可以跨设备查看。');
      storageSummary = '已用 ' + bytes(room.usedBytes) + ' / 可用上限 ' + bytes(room.maxBytes) + (room.maxFileBytes ? ' · 单个文件最多 ' + bytes(room.maxFileBytes) : '') + (room.pendingBytes ? ' · 正在上传 ' + bytes(room.pendingBytes) : '');
      displayMode(); renderMessages();
      if (mediaChanged) renderMedia();
      else if (forceMedia) previewLoaders.forEach(reload => reload());
      if (!localPhotosChecked && target.provider === 'supabase') {
        localPhotosChecked = true;
        setTimeout(() => { if (connection === target && connected && !uploadController) migrateLocalPhotos(); },0);
      }
    } catch (error) {
      if(error.authFailure)clearInvalidAccount(error,target);
      else if(target===connection){status('已登录 · 内容暂时未能刷新，正在自动重试，不需要重新登录。');scheduleRecovery();}
      throw error;
    } finally {
      refreshBusy = false; displayMode();
      if (connection && target !== connection) refresh().catch(() => {});
    }
  }
  by('messageText').addEventListener('input',() => { by('messageCounter').textContent = by('messageText').value.length + ' / 1000'; });
  by('messageForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (cloud?.address && !connected && !localOnly) { connectionFields(); openDialog('sharedSpaceDialog'); return; }
    const text = by('messageText').value.trim(); const author = connected ? identity : by('messageAuthor').value;
    if (connected && !identity) return;
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
    by('sharedConnectionHelp').textContent = '使用自己的账号和密码，留言会自动署上你的名字。';
  }
  async function verifyAccount(target) {
    try{return await api('/account',{onStage:accountStage},target);}
    catch(error){
      if(error.authFailure||!(error.transient||error instanceof TypeError||error.name==='TimeoutError'))throw error;
      loginFeedback('网络有些慢，正在继续确认登录，不用重复点击…',true);
      await new Promise(resolve=>setTimeout(resolve,600));
      return api('/account',{onStage:accountStage},target);
    }
  }
  by('sharedSpaceForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (uploadController || loginBusy) return;
    if (!cloud?.address) return loginFeedback('登录信息暂未载入，请刷新页面。');
    loginBusy=true; loginFeedback('正在确认账号，稍等一下。',true);
    let target;
    try {
      const username=by('loginUsername').value.normalize('NFKC').trim().toLowerCase();
      const email=await window.QXNN_ACCOUNT_EMAIL(username);
      target={...cloud,username,email,password:by('loginPassword').value};
      const room=await verifyAccount(target);
      if(!['me','partner'].includes(room.identity))throw new Error('这个账号尚未加入小屋。');
      remember=by('rememberLogin').checked;
      connectionRevision++;sharedMessages=[];media=[];recoveryAttempts=0;
      acceptAccount(target,room);
      by('loginPassword').value='';loginFeedback();toast('欢迎回家，'+(window.QXNN_PEOPLE.name(identity || 'me'))+'。');
    } catch(error) {
      if(target?.session?.refresh_token&&!error.authFailure){
        connection=target;connectionRevision++;connected=false;hasSynced=false;identity=null;
        remember=by('rememberLogin').checked;persistLogin();by('loginPassword').value='';
        loginFeedback('账号已验证，连接小屋暂时有些慢，会自动重试，不用再次输入密码。');scheduleRecovery();
      }else loginFeedback(error instanceof TypeError?'暂时连不上小屋，请检查网络后再试。':error.message);
    } finally {clearTimeout(loginWaitTimer);if(target)target.password='';loginBusy=false;displayMode();}
  });
  by('toggleLoginSecret').addEventListener('click',() => {
    const show = by('loginPassword').type === 'password';
    by('loginPassword').type = show ? 'text' : 'password';
    by('toggleLoginSecret').textContent = show ? '隐藏' : '显示';
    by('toggleLoginSecret').setAttribute('aria-label',show ? '隐藏密码' : '显示密码');
    by('toggleLoginSecret').setAttribute('aria-pressed',String(show));
  });
  function disconnectLogin() {
    if (uploadController || loginBusy) return;
    for (const store of [localStorage,sessionStorage]) { try { store.removeItem(connectionKey); } catch {} }
    if(connection)window.getSupabaseRoom(connection).logout();
    clearTimeout(recoveryTimer);recoveryTimer=null;recoveryAttempts=0;
    connection = null; identity = null; connected = false;hasSynced=false; sharedMessages = []; media = []; connectionRevision++;
    remoteProfile = null; pendingProfile = null;
    localOnly = true; localPhotosChecked = false;
    by('loginPassword').value = ''; by('sharedSpaceDialog').close();
    by('loginPassword').type = 'password'; by('toggleLoginSecret').textContent = '显示'; by('toggleLoginSecret').setAttribute('aria-pressed','false'); by('toggleLoginSecret').setAttribute('aria-label','显示密码');
    loginFeedback('已退出登录，照片和留言都好好保留着。');
    status('本机留言 · 连接共享空间后，两部手机才能互相看到。');
    storageSummary = ''; displayMode(); renderMessages(); renderMedia();
  }
  by('disconnectSharedSpace').addEventListener('click',disconnectLogin);
  window.addEventListener('storage',event => {
    if (event.storageArea === localStorage && event.key === connectionKey && !event.newValue && remember && connection) {
      if (uploadController) {
        // Finish cancellation with the existing connection so the reservation is released.
        uploadController.abort();
        const waitForUpload = setInterval(() => { if (!uploadController) { clearInterval(waitForUpload); disconnectLogin(); } },100);
      } else disconnectLogin();
    }
  });
  function uploadPart(path, blob, signal, onProgress) {
    if (connection?.provider === 'supabase') return window.getSupabaseRoom(connection).uploadPart(path,blob,signal,onProgress);
    throw new Error('上传连接暂未准备好，请重新登录。');
  }
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
      for (const note of (state.messages || []).filter(entry => entry.author === identity)) {
        if (imported.has(note.id)) continue;
        await api('/messages',{method:'POST',body:JSON.stringify({author:note.author,text:note.text})});
        imported.add(note.id); localStorage.setItem(key,JSON.stringify([...imported]));
      }
      await refresh(); toast('本机留言已复制到共享小屋，原记录仍在本机。');
    } catch (error) { toast(error.message); }
    finally { migrationBusy = false; displayMode(); }
  });
  async function copyInvite() {
    const link=location.origin+location.pathname+'?v=20261114-shared-season';
    try { await navigator.clipboard.writeText(link);toast('小屋网址已复制，对方使用自己的账号登录即可。'); }
    catch { by('roomInvite').value=link;by('roomInviteField').hidden=false;by('roomInvite').focus();by('roomInvite').select();toast('网址已显示，可以长按复制。'); }
  }
  by('copyAlbumInvite').addEventListener('click',copyInvite);
  window.addEventListener('our-world-state',() => { renderMessages(); displayMode(); saveProfile(); });
  window.addEventListener('beforeunload',event => { if (uploadController) { event.preventDefault(); event.returnValue = ''; } });
  // Drop only the retired login credentials; keep every local photo and record.
  for(const store of [localStorage,sessionStorage]) {
    try { store.removeItem('our-little-world-shared-connection-v1');store.removeItem('our-little-world-login-identity-v1'); } catch {}
  }
  try {
    const saved=JSON.parse(sessionStorage.getItem(connectionKey)||localStorage.getItem(connectionKey));
    remember=!sessionStorage.getItem(connectionKey);
    if(saved?.address===cloud?.address && saved?.session?.refresh_token && saved?.session?.user?.id)connection={...cloud,...saved};
  } catch {}
  by('rememberLogin').checked=remember;
  by('loginUsername').value=connection?.username||'';
  if(location.hash.startsWith('#key=')||location.hash.startsWith('#room=')) {
    history.replaceState(null,'',location.pathname+location.search);
    loginFeedback('现在请使用自己的账号和密码登录，旧连接口令已停用。');
  }
  window.addEventListener('our-world-session',event=>{if(connection&&event.detail===connection)persistLogin();});
  window.ourSharedSpace = {
    isConnected:() => connected,
    identity:() => identity,
    revision:() => connectionRevision,
    request:(path,options) => { if (!connected) return Promise.reject(new Error('请先登录小屋。')); return api(path,options); },
    hasCloud:() => Boolean(cloud?.address || connection),
    chooseMedia:() => { if (uploadController || migrationBusy) return; if (connected) by('sharedMediaInput').click(); else { connectionFields(); openDialog('sharedSpaceDialog'); } }
  };
  connectionFields(); localNames(); displayMode(); renderMessages(); renderMedia();
  if (connection) restoreAccount();
  else if (cloud?.address) {
    loginFeedback();
    status('免费小屋已开通 · 连接后查看共同留言，下面暂显示本机记录。');
  } else loginFeedback('登录信息暂未载入，请检查网络后刷新页面。');
  setInterval(() => { if (connection && !document.hidden && !uploadController) (connected?refresh():restoreAccount()).catch(() => {}); },30000);
  const refreshOnReturn = () => { if (connection && !document.hidden && !uploadController) (connected?refresh(true):restoreAccount()).catch(() => { status('暂时无法刷新共享相册，已保留上次内容。'); }); };
  document.addEventListener('visibilitychange',refreshOnReturn);
  window.addEventListener('pageshow',refreshOnReturn);
  window.addEventListener('focus',refreshOnReturn);
  window.addEventListener('online',refreshOnReturn);
})();
