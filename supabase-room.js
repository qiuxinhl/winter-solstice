(() => {
  'use strict';
  const adapters = new WeakMap();
  window.getSupabaseRoom = target => {
    if (adapters.has(target)) return adapters.get(target);
    let session = null;
    let signingIn = null;
    const files = new Map();
    const address = target.address.replace(/\/$/,'');
    const bucket = target.bucket || 'couple-private';
    async function responseData(response) {
      if (response.status === 204) return null;
      return response.json().catch(() => null);
    }
    function problem(response, data) {
      if (response.status === 401 || response.status === 403) return new Error('小屋口令不正确，或登录已过期，请重新连接。');
      const detail = data?.message || data?.error_description || data?.error || '';
      if (/quota|capacity|space|容量|空间/.test(detail)) return new Error('免费空间剩余容量不足，请先整理相册。');
      if (/50.?MB|size|大小|文件过大/i.test(detail) || response.status === 413) return new Error('免费版单个文件最多50MB，请压缩或剪短视频后再试。');
      if (/rate|too many/i.test(detail) || response.status === 429) return new Error('操作有些频繁，请稍等一会儿再试。');
      return new Error('云端暂时没有完成这个操作，请稍后重试。');
    }
    async function login() {
      if (session && session.expires_at * 1000 > Date.now() + 60000) return session;
      if (signingIn) return signingIn;
      signingIn = (async () => {
        const refresh = session?.refresh_token;
        const response = await fetch(address + '/auth/v1/token?grant_type=' + (refresh ? 'refresh_token' : 'password'), {
          method:'POST',headers:{apikey:target.anonKey,'Content-Type':'application/json'},
          body:JSON.stringify(refresh ? {refresh_token:refresh} : {email:target.email,password:target.secret}),
          signal:AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer'
        });
        const data = await responseData(response);
        if (!response.ok || !data?.access_token || !data.user?.id) { session = null; throw problem(response,data); }
        session = {...data,expires_at:data.expires_at || Math.floor(Date.now()/1000) + data.expires_in};
        return session;
      })();
      try { return await signingIn; } finally { signingIn = null; }
    }
    async function request(path, options = {}, retry = true) {
      const current = await login();
      const response = await fetch(address + path, {
        ...options,headers:{apikey:target.anonKey,Authorization:'Bearer ' + current.access_token,...(options.body ? {'Content-Type':'application/json'} : {}),...options.headers},
        signal:options.signal || AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'
      });
      if (response.status === 401 && retry) { session.expires_at = 0; await login(); return request(path,options,false); }
      const data = await responseData(response);
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
      if (path === '/room' && method === 'GET') {
        const [usage,settings] = await Promise.all([rpc('couple_storage_usage'),request('/rest/v1/couple_settings?select=me,partner,start_date&limit=1')]);
        return {...first(usage),profile:settings?.length ? {me:settings[0].me,partner:settings[0].partner,startDate:settings[0].start_date} : null};
      }
      if (path === '/room/profile' && method === 'PUT') {
        const current = await login();
        await request('/rest/v1/couple_settings?on_conflict=owner_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({owner_id:current.user.id,me:data.me,partner:data.partner,start_date:data.startDate})});
        return {saved:true};
      }
      if (path === '/messages' && method === 'GET') return {messages:await request('/rest/v1/couple_messages?select=id,author,text,createdAt:created_at&order=created_at.desc&limit=500')};
      if (path === '/messages' && method === 'POST') {
        const current = await login();
        return first(await request('/rest/v1/couple_messages',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:current.user.id,author:data.author,text:data.text})}));
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
        const url = new URL(/^https:\/\//.test(signed) ? signed : address + '/storage/v1' + signed);
        if (data.download) url.searchParams.set('download',file.name);
        return {url:url.href};
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
    const result = {api,uploadPart}; adapters.set(target,result); return result;
  };
})();
