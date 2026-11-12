'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {requestJson,SafeSetupError,safeFailure}=require('./setup-free-room.cjs');
const ref='sxjlwzxbzmekasifujlv';
const address='https://'+ref+'.supabase.co';
const readyFlag=path.join(__dirname,'account-code-ready.flag');
function normalizedUsername(value){
  const result=value.normalize('NFKC').trim().toLowerCase();
  if(!/^[\p{L}\p{N}_.-]{2,24}$/u.test(result))throw new SafeSetupError('账号格式不正确，请使用2至24个中文、字母、数字或下划线、点和短横线。');
  return result;
}
function accountEmail(value){return 'qxnn-'+createHash('sha256').update('qxnn-account-v1:'+normalizedUsername(value)).digest('hex').slice(0,40)+'@accounts.qxnn.invalid';}
function prompt(){return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-File',path.join(__dirname,'account-dialog.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;if(buffer.length>16000){child.kill();reject(new SafeSetupError('本地输入超出范围。'));}});
  child.stderr.on('data',()=>{});child.on('error',()=>reject(new SafeSetupError('本地账号窗口无法打开。')));
  child.on('close',code=>{try{const data=JSON.parse(buffer.replace(/^\uFEFF/,''));buffer='';if(code||!data.ok)throw 0;resolve(data);}catch{reject(new SafeSetupError('账号设置已取消，未修改云端权限。'));}});
});}
async function main(){
  const input=await prompt();
  let service='';
  try{
    for(const who of ['me','partner']){input[who].username=normalizedUsername(input[who].username);if(input[who].password.length<8||input[who].password.length>128)throw new SafeSetupError('密码请使用8至128位。');}
    if(input.me.username===input.partner.username)throw new SafeSetupError('两个人的账号不能相同。');
    const management=(route,args={})=>requestJson({origin:'https://api.supabase.com',route,bearer:input.token,label:'云端管理操作',...args});
    const sql=async query=>management('/v1/projects/'+ref+'/database/query',{method:'POST',body:{query},label:'升级现有小屋'});
    const project=await management('/v1/projects/'+ref);
    if(project.ref!==ref||project.organization_slug!=='aqosgyrjvauwosutjxor')throw new SafeSetupError('项目归属不符，未继续。');
    const keys=await management('/v1/projects/'+ref+'/api-keys?reveal=true');service=keys.find(key=>key.name==='service_role')?.api_key;
    if(!service)throw new SafeSetupError('未取得云端管理权限。');
    const admin=(route,args={})=>requestJson({origin:address,route,bearer:service,apiKey:service,label:'配置两个人的账号',...args});
    const original=(await sql("select id from auth.users where email='room-login@"+ref+".invalid'"))[0];
    if(!/^[0-9a-f-]{36}$/i.test(original?.id||''))throw new SafeSetupError('原小屋账号未找到；未更改任何原有数据。');
    const ids={};
    for(const who of ['me','partner']){
      const email=accountEmail(input[who].username);
      const existing=(await sql("select id from auth.users where email='"+email+"'"))[0];
      if(existing){
        const membership=await sql("select to_regclass('public.couple_members') is not null as present");
        if(!membership[0]?.present)throw new SafeSetupError('账号已存在但尚未绑定，请更换账号名后再试；未覆盖已有账号。');
        const match=await sql("select user_id from public.couple_members where user_id='"+existing.id+"' and room_owner_id='"+original.id+"' and author='"+who+"'");
        if(!match.length)throw new SafeSetupError('该账号已有其他身份绑定，请更换账号名。');
        await admin('/auth/v1/admin/users/'+existing.id,{method:'PUT',body:{password:input[who].password,email_confirm:true}});ids[who]=existing.id;
      }else{
        const created=await admin('/auth/v1/admin/users',{method:'POST',body:{email,password:input[who].password,email_confirm:true}});
        if(!/^[0-9a-f-]{36}$/i.test(created?.id||''))throw new SafeSetupError('创建账号未通过验证。');ids[who]=created.id;
      }
    }
    console.log('两套账号已准备好，正在等待页面和离线权限检查完成；原小屋仍可使用。');
    while(!fs.existsSync(readyFlag)||fs.readFileSync(readyFlag,'utf8').trim()!=='ready')await new Promise(resolve=>setTimeout(resolve,3000));
    const snapshotQuery="select (select md5(coalesce(string_agg(row_to_json(m)::text,'' order by id),'')) from public.couple_media m) as media,(select md5(coalesce(string_agg(row_to_json(m)::text,'' order by id),'')) from public.couple_messages m) as messages,(select count(*)::int from storage.objects where bucket_id='couple-private') as files";
    const before=await sql(snapshotQuery);
    let migration=fs.readFileSync(path.join(__dirname,'account-upgrade.sql'),'utf8');
    const members="insert into public.couple_members(user_id,room_owner_id,author) values ('"+ids.me+"','"+original.id+"','me'),('"+ids.partner+"','"+original.id+"','partner') on conflict(user_id) do update set room_owner_id=excluded.room_owner_id,author=excluded.author;\n";
    migration=migration.replace("notify pgrst,'reload schema';",members+"\nnotify pgrst,'reload schema';");
    await sql(migration);
    const after=await sql(snapshotQuery);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new SafeSetupError('原有数据核对不一致，已停止后续步骤，请保留现状检查。');
    const configScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public-config.js'),'utf8'),configScope);
    const anon=configScope.window.OUR_WORLD_CLOUD.anonKey;
    for(const who of ['me','partner']){
      const session=await requestJson({origin:address,route:'/auth/v1/token?grant_type=password',method:'POST',bearer:anon,apiKey:anon,body:{email:accountEmail(input[who].username),password:input[who].password},label:'核验个人账号登录'});
      const read=async(route,args={})=>{
        for(let attempt=0;attempt<15;attempt++){
          try{return await requestJson({origin:address,route,bearer:session.access_token,apiKey:anon,label:'核验共享数据权限',...args});}
          catch(error){if(error.status!==404||attempt===14)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
        }
      };
      const member=await read('/rest/v1/rpc/couple_current_member',{method:'POST',body:{}});
      if(member.identity!==who||member.ownerId!==original.id)throw new SafeSetupError('账号身份核验失败。');
      await read('/rest/v1/couple_media?select=id&limit=1');
      await read('/rest/v1/couple_messages?select=id&limit=1');
      await read('/rest/v1/couple_settings?select=anniversaries&limit=1');
      await read('/auth/v1/logout?scope=local',{method:'POST'});
    }
    // The legacy owner stays in Auth for foreign keys; its credentials stop working.
    await admin('/auth/v1/admin/users/'+original.id,{method:'PUT',body:{ban_duration:'876000h'}});
    fs.writeFileSync(path.join(__dirname,'account-upgrade-state.json'),JSON.stringify({stage:'verified',projectRef:ref,at:new Date().toISOString(),legacyDataPreserved:true})+'\n');
    console.log('独立账号、服务端署名和共享数据读取已核验；原有照片和留言完整保留。');
  }finally{input.token='';service='';for(const who of ['me','partner']){input[who].password='';input[who].username='';}}
}
if(require.main===module)main().catch(error=>{console.error(safeFailure(error));process.exitCode=1;});
module.exports={normalizedUsername,accountEmail};
