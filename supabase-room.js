(() => {
  'use strict';
  const adapters = new WeakMap();
  const normalizeUsername = value => {
    const username=value.normalize('NFKC').trim().toLowerCase();
    if(!/^[\p{L}\p{N}_.-]{2,24}$/u.test(username))throw new Error('账号请使用2至24个中文、字母、数字、下划线、点或短横线。');
    return username;
  };
  window.QXNN_ACCOUNT_EMAIL = async value => {
    const bytes=new TextEncoder().encode('qxnn-account-v1:'+normalizeUsername(value));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return 'qxnn-'+Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('').slice(0,40)+'@accounts.qxnn.invalid';
  };
  window.getSupabaseRoom = target => {
    if (adapters.has(target)) return adapters.get(target);
    let session = target.session || null;
    let signingIn = null;
    let member = null;
    const files = new Map();
    const address = target.address.replace(/\/$/,'');
    const bucket = target.bucket || 'couple-private';
    async function responseData(response) {
      if (response.status === 204) return null;
      return response.json().catch(() => null);
    }
    function problem(response, data, authentication = false) {
      if ((authentication && (response.status === 401 || response.status === 403)) || (response.status === 400 && /invalid_credentials|invalid login credentials|refresh.token|user_banned/i.test((data?.code || '') + ' ' + (data?.msg || data?.message || data?.error_description || '')))) {
        const error=new Error(response.status===403?'这个账号暂时无法进入小屋，请核对账号。':'账号或密码不正确，或登录已过期，请重新登录。');error.authFailure=true;return error;
      }
      const detail = data?.message || data?.error_description || data?.error || '';
      if (response.status === 401) { const error=new Error('登录已过期，请重新登录。');error.authFailure=true;return error; }
      if (response.status === 403) return new Error('这部分内容暂时无法读取，请稍后刷新重试。');
      if (/quota|capacity|space|容量|空间/.test(detail)) return new Error('免费空间剩余容量不足，请先整理相册。');
      if (/50.?MB|size|大小|文件过大/i.test(detail) || response.status === 413) return new Error('免费版单个文件最多50MB，请压缩或剪短视频后再试。');
      if (/rate|too many/i.test(detail) || response.status === 429) return new Error('操作有些频繁，请稍等一会儿再试。');
      const error=new Error('云端暂时没有完成这个操作，请稍后重试。');error.transient=response.status>=500;return error;
    }
    async function login() {
      if (session && session.expires_at * 1000 > Date.now() + 60000) return session;
      if (signingIn) return signingIn;
      signingIn = (async () => {
        const refresh = session?.refresh_token;
        const response = await fetch(address + '/auth/v1/token?grant_type=' + (refresh ? 'refresh_token' : 'password'), {
          method:'POST',headers:{apikey:target.anonKey,'Content-Type':'application/json'},
          body:JSON.stringify(refresh ? {refresh_token:refresh} : {email:target.email,password:target.password}),
          signal:AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer'
        });
        const data = await responseData(response);
        if (!response.ok || !data?.access_token || !data.user?.id) { const error=problem(response,data,true);if(error.authFailure){session=null;target.session=null;}throw error; }
        session = {...data,expires_at:data.expires_at || Math.floor(Date.now()/1000) + data.expires_in};
        target.password = '';
        target.session={access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at,user:{id:session.user.id}};
        window.dispatchEvent(new CustomEvent('our-world-session',{detail:target}));
        return session;
      })();
      try { return await signingIn; } finally { signingIn = null; }
    }
    async function request(path, options = {}, retry = true) {
      const current = await login();
      const {binary,...fetchOptions} = options;
      const response = await fetch(address + path, {
        ...fetchOptions,headers:{apikey:target.anonKey,Authorization:'Bearer ' + current.access_token,...(options.body ? {'Content-Type':'application/json'} : {}),...options.headers},
        signal:options.signal || AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'
      });
      if (response.status === 401 && retry) {
        // A late 401 from another concurrent request must not expire a token
        // that has already been renewed by the first request.
        if(session?.access_token===current.access_token){session.expires_at=0;await login();}
        return request(path,options,false);
      }
      const data = binary && response.ok ? await response.blob() : await responseData(response);
      if (!response.ok) throw problem(response,data);
      return data;
    }
    const rpc = (name,body={},signal) => request('/rest/v1/rpc/' + name,{method:'POST',body:JSON.stringify(body),signal});
    const first = data => Array.isArray(data) ? data[0] : data;
    async function entry(id) {
      if (files.has(id)) return files.get(id);
      const rows = await request('/rest/v1/couple_media?id=eq.' + encodeURIComponent(id) + '&select=*');
      if (!rows?.length) throw new Error('这份照片或视频已经不在相册里。');
      files.set(id,rows[0]); return rows[0];
    }
    async function removeMedia(id) {
      const file = await entry(id);
      await request('/storage/v1/object/' + bucket,{method:'DELETE',body:JSON.stringify({prefixes:[file.path]})});
      await rpc('couple_release_media',{p_id:id});
      files.delete(id); return {deleted:true};
    }
    async function api(path,options={}) {
      const method = options.method || 'GET';
      const data = typeof options.body === 'string' ? JSON.parse(options.body) : {};
      if (path === '/account' && method === 'GET') {
        options.onStage?.('credentials');
        await login();
        options.onStage?.('membership');
        member=await rpc('couple_current_member');
        if(!member?.ownerId||!['me','partner'].includes(member.identity))throw new Error('这个账号尚未加入小屋。');
        return member;
      }
      if (path === '/room' && method === 'GET') {
        member=await rpc('couple_current_member');
        if(!member?.ownerId||!['me','partner'].includes(member.identity))throw new Error('这个账号尚未加入小屋。');
        const [usage,rows] = await Promise.all([rpc('couple_storage_usage'),request('/rest/v1/couple_settings?select=me,partner,start_date,anniversaries&limit=1')]);
        return {...first(usage),...member,profile:rows?.length ? {me:rows[0].me,partner:rows[0].partner,startDate:rows[0].start_date,anniversaries:rows[0].anniversaries||[]} : null};
      }
      if (path === '/room/profile' && method === 'PUT') {
        if(!member)member=await rpc('couple_current_member');
        await request('/rest/v1/couple_settings?on_conflict=owner_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({owner_id:member.ownerId,me:data.me,partner:data.partner,start_date:data.startDate,anniversaries:data.anniversaries||[]})});
        return {saved:true};
      }
      if (path === '/letters' && method === 'GET') {
        const rows=[];let offset=0;
        for(;;){
          const page=await request('/rest/v1/couple_messages?text=like.'+encodeURIComponent(window.QXNN_MAIL_CODEC.prefix)+'*&select=id,author,text,createdAt:created_at&order=created_at.desc,id.desc&limit=500&offset='+offset);
          rows.push(...page);if(page.length<500)break;offset+=page.length;
        }
        return {letters:window.QXNN_MAIL_CODEC.decode(rows)};
      }
      if (path === '/letters' && method === 'POST') {
        if(!member)member=await rpc('couple_current_member');
        const texts=window.QXNN_MAIL_CODEC.encode(data);
        // Reuse the draft id after a lost response so retry cannot send a
        // second visible letter. Duplicate identical chunks decode once.
        const existing=await api('/letters');
        const sent=existing.letters.find(letter=>letter.id===data.id&&letter.author===member.identity);
        if(sent){
          if(sent.subject!==String(data.subject).trim()||sent.body!==String(data.body).trim()||sent.style!==data.style){const error=new Error('上次的信已经寄出。');error.alreadySent=true;throw error;}
          return {sent:true};
        }
        await request('/rest/v1/couple_messages',{method:'POST',body:JSON.stringify(texts.map(text=>({owner_id:member.ownerId,author:member.identity,text})))});
        return {sent:true};
      }
      const readLetter=/^\/letters\/([^/]+)\/read$/.exec(path);
      if(readLetter && method==='POST'){
        if(!member)member=await rpc('couple_current_member');
        const {letters}=await api('/letters');
        const letter=letters.find(item=>item.id===readLetter[1]&&item.author!==member.identity);
        if(!letter)throw new Error('这封来信暂时无法打开，请刷新信箱。');
        if(!letter.readAt)await request('/rest/v1/couple_messages',{method:'POST',body:JSON.stringify({owner_id:member.ownerId,author:member.identity,text:window.QXNN_MAIL_CODEC.prefix+JSON.stringify({kind:'read',id:letter.id,letterAuthor:letter.author})})});
        return {read:true};
      }
      if (path === '/messages' && method === 'GET') return {messages:await request('/rest/v1/couple_messages?text=not.like.'+encodeURIComponent(window.QXNN_MAIL_CODEC.prefix)+'*&select=id,author,text,createdAt:created_at&order=created_at.desc&limit=500')};
      if (path === '/messages' && method === 'POST') {
        if(typeof data.text!=='string'||data.text.startsWith(window.QXNN_MAIL_CODEC.prefix))throw new Error('这段内容请通过写信功能发送。');
        if(!member)member=await rpc('couple_current_member');
        return first(await request('/rest/v1/couple_messages',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:member.ownerId,author:member.identity,text:data.text})}));
      }
      const note = /^\/messages\/([^/]+)$/.exec(path);
      if (note && method === 'DELETE') { await request('/rest/v1/couple_messages?id=eq.' + encodeURIComponent(note[1]),{method:'DELETE'}); return {deleted:true}; }
      if (path === '/media' && method === 'GET') {
        const rows = await request('/rest/v1/couple_media?status=eq.ready&select=*&order=created_at.desc');
        (rows || []).forEach(row => files.set(row.id,row));
        return {media:(rows || []).map(row => ({...row,createdAt:row.created_at}))};
      }
      if (path === '/media/init' && method === 'POST') {
        const reservation = first(await rpc('couple_reserve_media',{p_name:data.name,p_type:data.type,p_size:data.size},options.signal));
        files.set(reservation.id,{...reservation,name:data.name,type:data.type,size:data.size});
        return {...reservation,partSize:50000000};
      }
      const complete = /^\/media\/([^/]+)\/complete$/.exec(path);
      if (complete && method === 'POST') { await rpc('couple_complete_media',{p_id:complete[1]},options.signal); return {uploaded:true}; }
      const ticket = /^\/media\/([^/]+)\/ticket$/.exec(path);
      if (ticket && method === 'POST') {
        const file = await entry(ticket[1]);
        const result = await request('/storage/v1/object/sign/' + bucket + '/' + file.path,{method:'POST',body:JSON.stringify({expiresIn:43200})});
        const signed = result.signedURL || result.signedUrl;
        if (!signed) throw new Error('暂时无法打开这个文件，请刷新相册。');
        const url = new URL(/^https:\/\//i.test(signed) ? signed : signed.startsWith('/storage/v1/') ? signed : '/storage/v1/' + signed.replace(/^\//,''),address);
        if (url.origin !== new URL(address).origin) throw new Error('图片链接来源不正确，请刷新相册。');
        if (data.download) url.searchParams.set('download',file.name);
        return {url:url.href,expiresAt:Date.now()+43200000};
      }
      const item = /^\/media\/([^/]+)$/.exec(path);
      if (item && method === 'DELETE') return removeMedia(item[1]);
      throw new Error('这个操作暂时不可用。');
    }
    async function uploadPart(path,blob,signal,onProgress) {
      const match = /^\/media\/([^/]+)\/parts\/1$/.exec(path);
      if (!match) throw new Error('免费版单个文件最多50MB。');
      const file = await entry(match[1]); const current = await login(); signal.throwIfAborted();
      return new Promise((resolve,reject) => {
        const request = new XMLHttpRequest(); request.open('POST',address + '/storage/v1/object/' + bucket + '/' + file.path);
        request.setRequestHeader('apikey',target.anonKey); request.setRequestHeader('Authorization','Bearer ' + current.access_token); request.setRequestHeader('Content-Type',file.type); request.setRequestHeader('x-upsert','false'); request.timeout = 300000;
        const cancel = () => request.abort(); const done = () => signal.removeEventListener('abort',cancel);
        signal.addEventListener('abort',cancel,{once:true});
        request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
        request.onload = () => { done(); if (request.status >= 200 && request.status < 300) resolve({partNumber:1,etag:file.id}); else reject(problem({status:request.status},null)); };
        request.onerror = () => { done(); reject(new Error('网络中断，请重试上传。')); };
        request.ontimeout = () => { done(); reject(new Error('上传超时，请检查网络后重试。')); };
        request.onabort = () => { done(); reject(new DOMException('已取消上传。','AbortError')); };
        if (signal.aborted) { done(); reject(new DOMException('已取消上传。','AbortError')); return; }
        request.send(blob);
      });
    }
    async function imagePreview(id,signal) {
      const file = await entry(id);
      const blob = await request('/storage/v1/object/authenticated/' + bucket + '/' + file.path,{binary:true,signal});
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('图片内容未完整读取，请重新加载。');
      const url = URL.createObjectURL(blob);
      return {url,expiresAt:Infinity,revoke:() => URL.revokeObjectURL(url)};
    }
    async function logout(){
      const active=session;session=null;member=null;target.session=null;target.password='';
      if(active?.access_token)await fetch(address+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:target.anonKey,Authorization:'Bearer '+active.access_token},credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)}).catch(()=>{});
    }
    const result = {api,uploadPart,imagePreview,logout}; adapters.set(target,result); return result;
  };
})();
