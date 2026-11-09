const PART_SIZE = 16 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','video/mp4','video/webm','video/quicktime','video/x-matroska']);
class RoomError extends Error { constructor(status,message) { super(message); this.status=status; } }
function fail(status,message) { throw new RoomError(status,message); }
function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}); }
async function input(request,maxLength=1024*1024) {
  if (Number(request.headers.get('Content-Length'))>maxLength) fail(413,'请求内容过大。');
  const reader=request.body?.getReader(); if(!reader)fail(400,'缺少请求内容。');
  const chunks=[]; let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxLength){await reader.cancel();fail(413,'请求内容过大。');}chunks.push(value);}
  const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{fail(400,'请求内容格式不正确。');}
}
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))); }
async function secretMatches(first,second) { const a=await digest(first),b=await digest(second);let result=0;for(let i=0;i<a.length;i++)result|=a[i]^b[i];return result===0; }
async function signature(secret,value) { const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join(''); }
function maxBytes(env) { const maximum=Number(env.MAX_STORAGE_BYTES || 200000000000);if(!Number.isSafeInteger(maximum)||maximum<=0)fail(503,'空间容量设置不正确。');return maximum; }
async function room(env) { const used=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN status='ready' THEN size ELSE 0 END),0) AS usedBytes,COALESCE(SUM(CASE WHEN status='uploading' THEN size ELSE 0 END),0) AS pendingBytes FROM media").first();return {...used,maxBytes:maxBytes(env)}; }
async function mediaRecord(env,id) { const record=await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first();if(!record)fail(404,'这份照片或视频不存在。');return record; }
function publicMedia(record) {return {id:record.id,name:record.name,type:record.type,size:record.size,createdAt:record.created_at};}
function parseRange(header,size) {
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||(!match[1]&&!match[2]))return false;
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return false;start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;
  return {offset:start,length:end-start+1};
}
async function serveMedia(request,env,url,id) {
  const expires=Number(url.searchParams.get('expires'));const download=url.searchParams.get('download')==='1';const received=url.searchParams.get('signature')||'';
  const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(expires)||expires<now||expires>now+43230||received.length!==64)fail(401,'访问已过期，请刷新相册后重试。');
  if(!await secretMatches(received,await signature(env.ROOM_SECRET,id+'.'+expires+'.'+Number(download))))fail(401,'无法访问这份文件。');
  const record=await mediaRecord(env,id);if(record.status!=='ready')fail(404,'文件尚未上传完成。');
  const range=parseRange(request.headers.get('Range'),record.size);
  if(range===false)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+record.size}});
  const object=request.method==='HEAD'?await env.PHOTOS.head(record.object_key):await env.PHOTOS.get(record.object_key,range?{range}:{});
  if(!object)fail(404,'原文件暂时不可用。');
  const headers=new Headers({'Content-Type':record.type,'Accept-Ranges':'bytes','Content-Length':String(range?range.length:record.size),'Cache-Control':'private, no-store','Content-Disposition':(download?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(record.name),'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  if(range)headers.set('Content-Range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+record.size);
  if(object.httpEtag)headers.set('ETag',object.httpEtag);
  return new Response(request.method==='HEAD'?null:object.body,{status:range?206:200,headers});
}
async function route(request,env,url) {
  if(!env.ROOM_SECRET||env.ROOM_SECRET.length<32||!env.DB||!env.PHOTOS)fail(503,'小屋尚未准备好，请稍后再来。');
  const path=url.pathname.replace(/\/$/,'')||'/';
  const fileMatch=/^\/files\/([a-f0-9-]{36})$/.exec(path);
  if(fileMatch&&['GET','HEAD'].includes(request.method))return serveMedia(request,env,url,fileMatch[1]);
  const authorization=request.headers.get('Authorization')||'';
  if(authorization.length>200||!authorization.startsWith('Bearer ')||!await secretMatches(authorization.slice(7),env.ROOM_SECRET))fail(401,'空间地址或小屋口令不正确。');
  if(path==='/room'&&request.method==='GET')return json(await room(env));
  if(path==='/messages'&&request.method==='GET'){
    const {results}=await env.DB.prepare('SELECT id,author,text,created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT 500').all();return json({messages:results});
  }
  if(path==='/messages'&&request.method==='POST'){
    const data=await input(request,8192);const text=typeof data.text==='string'?data.text.trim():'';
    if(!['me','partner'].includes(data.author)||!text||text.length>1000)fail(400,'请写下1到1000字的留言，并选择写留言的人。');
    const message={id:crypto.randomUUID(),author:data.author,text,createdAt:new Date().toISOString()};
    await env.DB.prepare('INSERT INTO messages (id,author,text,created_at) VALUES (?,?,?,?)').bind(message.id,message.author,message.text,message.createdAt).run();return json(message,201);
  }
  const noteMatch=/^\/messages\/([a-f0-9-]{36})$/.exec(path);
  if(noteMatch&&request.method==='DELETE'){await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(noteMatch[1]).run();return json({deleted:true});}
  if(path==='/media'&&request.method==='GET'){
    const {results}=await env.DB.prepare("SELECT * FROM media WHERE status='ready' ORDER BY created_at DESC").all();return json({media:results.map(publicMedia)});
  }
  if(path==='/media/init'&&request.method==='POST'){
    const data=await input(request,8192);
    if(typeof data.name!=='string'||!data.name.trim()||data.name.length>240||!TYPES.has(data.type)||!Number.isSafeInteger(data.size)||data.size<=0)fail(400,'请选择有效的照片或视频文件。');
    if(Math.ceil(data.size/PART_SIZE)>10000)fail(413,'单个文件过大，请先拆分。');
    const id=crypto.randomUUID(),key='media/'+id;
    const createdAt=new Date().toISOString();
    const reservation=await env.DB.prepare("INSERT INTO media (id,object_key,name,type,size,status,created_at,last_activity) SELECT ?,?,?,?,?,'uploading',?,? WHERE (SELECT COALESCE(SUM(size),0) FROM media)+?<=?").bind(id,key,data.name.trim(),data.type,data.size,createdAt,createdAt,data.size,maxBytes(env)).run();
    if(!reservation.meta.changes)fail(413,'共享空间剩余容量不足，请整理文件或增加空间后再试。');
    try{
      const upload=await env.PHOTOS.createMultipartUpload(key,{httpMetadata:{contentType:data.type}});
      await env.DB.prepare('UPDATE media SET upload_id=? WHERE id=?').bind(upload.uploadId,id).run();return json({id,partSize:PART_SIZE},201);
    }catch(error){await env.DB.prepare('DELETE FROM media WHERE id=?').bind(id).run();throw error;}
  }
  const partMatch=/^\/media\/([a-f0-9-]{36})\/parts\/(\d{1,5})$/.exec(path);
  if(partMatch&&request.method==='PUT'){
    const record=await mediaRecord(env,partMatch[1]);if(record.status!=='uploading'||!record.upload_id)fail(409,'这份文件已不在上传中。');
    const partNumber=Number(partMatch[2]);const expected=Math.min(PART_SIZE,record.size-(partNumber-1)*PART_SIZE);
    if(partNumber<1||partNumber>Math.ceil(record.size/PART_SIZE)||Number(request.headers.get('Content-Length'))!==expected)fail(400,'上传片段大小不正确，请重新上传。');
    const upload=env.PHOTOS.resumeMultipartUpload(record.object_key,record.upload_id);
    const result=await upload.uploadPart(partNumber,request.body);
    await env.DB.prepare("UPDATE media SET last_activity=? WHERE id=? AND status='uploading'").bind(new Date().toISOString(),record.id).run();
    return json({partNumber:result.partNumber,etag:result.etag});
  }
  const completeMatch=/^\/media\/([a-f0-9-]{36})\/complete$/.exec(path);
  if(completeMatch&&request.method==='POST'){
    const record=await mediaRecord(env,completeMatch[1]);if(record.status!=='uploading')fail(409,'这份文件已完成上传。');
    const data=await input(request,2000000);const count=Math.ceil(record.size/PART_SIZE);
    if(!Array.isArray(data.parts)||data.parts.length!==count||data.parts.some((part,index)=>!part||part.partNumber!==index+1||typeof part.etag!=='string'||part.etag.length>200))fail(400,'上传片段不完整，请重试。');
    const upload=env.PHOTOS.resumeMultipartUpload(record.object_key,record.upload_id);await upload.complete(data.parts);
    const stored=await env.PHOTOS.head(record.object_key);
    if(!stored||stored.size!==record.size){await env.PHOTOS.delete(record.object_key);await env.DB.prepare('DELETE FROM media WHERE id=?').bind(record.id).run();fail(409,'文件完整性检查失败，请重新上传。');}
    await env.DB.prepare("UPDATE media SET status='ready',upload_id=NULL WHERE id=?").bind(record.id).run();return json({uploaded:true});
  }
  const ticketMatch=/^\/media\/([a-f0-9-]{36})\/ticket$/.exec(path);
  if(ticketMatch&&request.method==='POST'){
    const record=await mediaRecord(env,ticketMatch[1]);if(record.status!=='ready')fail(404,'文件尚未上传完成。');
    const data=await input(request,1024);const expires=Math.floor(Date.now()/1000)+43200;const download=data.download===true;
    const token=await signature(env.ROOM_SECRET,record.id+'.'+expires+'.'+Number(download));
    return json({url:url.origin+'/files/'+record.id+'?expires='+expires+'&download='+Number(download)+'&signature='+token});
  }
  const deleteMatch=/^\/media\/([a-f0-9-]{36})$/.exec(path);
  if(deleteMatch&&request.method==='DELETE'){
    const record=await mediaRecord(env,deleteMatch[1]);
    if(record.status==='uploading'&&record.upload_id)await env.PHOTOS.resumeMultipartUpload(record.object_key,record.upload_id).abort().catch(()=>{});
    await env.PHOTOS.delete(record.object_key);await env.DB.prepare('DELETE FROM media WHERE id=?').bind(record.id).run();return json({deleted:true});
  }
  fail(404,'没有找到这个入口。');
}
async function cleanPending(env) {
  const before=new Date(Date.now()-86400000).toISOString();
  const {results}=await env.DB.prepare("SELECT * FROM media WHERE status='uploading' AND last_activity<? LIMIT 100").bind(before).all();
  for(const record of results){
    if(record.upload_id)await env.PHOTOS.resumeMultipartUpload(record.object_key,record.upload_id).abort().catch(()=>{});
    await env.PHOTOS.delete(record.object_key);
    await env.DB.prepare("DELETE FROM media WHERE id=? AND status='uploading' AND last_activity<?").bind(record.id,before).run();
  }
}
export default {
  async scheduled(controller,env,context){ context.waitUntil(cleanPending(env)); },
  async fetch(request,env){
    const origin=request.headers.get('Origin');const allowed=env.ALLOWED_ORIGIN||'https://qiuxinhl.github.io';
    if(origin&&origin!==allowed)return json({error:'此页面无法访问这个空间。'},403);
    let response;
    try{response=request.method==='OPTIONS'?new Response(null,{status:204}):await route(request,env,new URL(request.url));}
    catch(error){response=json({error:error instanceof RoomError?error.message:'小屋暂时忙碌，请稍后重试。'},error instanceof RoomError?error.status:500);}
    const headers=new Headers(response.headers);
    if(origin===allowed)headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Vary','Origin');headers.set('Access-Control-Allow-Methods','GET,HEAD,POST,PUT,DELETE,OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization,Content-Type,Range');headers.set('Access-Control-Expose-Headers','Content-Length,Content-Range,Accept-Ranges');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    return new Response(response.body,{status:response.status,headers});
  }
};
export {parseRange,cleanPending};
