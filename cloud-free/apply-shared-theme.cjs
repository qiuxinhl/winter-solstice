'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {requestJson,SafeSetupError,safeFailure}=require('./setup-free-room.cjs');
const ref='sxjlwzxbzmekasifujlv';
function prompt(){return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-File',path.join(__dirname,'local-secret-dialog.ps1'),'-Mode','token','-WindowTitle','QXNN · 同步节气与留言权限','-Purpose','仅用于同步节气设置、限制只能撤回自己的留言。不会修改账号密码或删除已有内容，令牌仅在内存中使用。','-ConfirmText','应用更新'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;if(buffer.length>16000){buffer='';child.kill();reject(new SafeSetupError('本地输入超出范围。'));}});
  child.stderr.on('data',()=>{});child.on('error',()=>reject(new SafeSetupError('本地输入窗口无法打开。')));
  child.on('close',code=>{try{const value=JSON.parse(buffer.replace(/^\uFEFF/,''));buffer='';if(code||!value.ok||!value.value)throw 0;resolve(value);}catch{reject(new SafeSetupError('已取消云端更新，未继续操作。'));}});
});}
async function apply(token){
  const management=(route,args={})=>requestJson({origin:'https://api.supabase.com',route,bearer:token,label:'更新小屋云端规则',...args});
  const project=await management('/v1/projects/'+ref);
  if(project.ref!==ref||project.organization_slug!=='aqosgyrjvauwosutjxor')throw new SafeSetupError('项目归属不符，未继续。');
  const sql=query=>management('/v1/projects/'+ref+'/database/query',{method:'POST',body:{query}});
  const preflight=await sql("select to_regclass('public.couple_members') is not null as members_ready, to_regclass('public.couple_messages') is not null as messages_ready, to_regprocedure('public.couple_author()') is not null as author_ready");
  if(!preflight[0]?.members_ready||!preflight[0]?.messages_ready||!preflight[0]?.author_ready)throw new SafeSetupError('现有双人小屋结构不符，未更改规则。');
  await sql(fs.readFileSync(path.join(__dirname,'shared-theme-and-message-permissions.sql'),'utf8'));
  const result=await sql(`select
    (select relrowsecurity from pg_class where oid='public.couple_theme'::regclass) as theme_private,
    not has_table_privilege('anon','public.couple_theme','select') as anonymous_denied,
    has_table_privilege('authenticated','public.couple_theme','select,insert,update') as members_allowed,
    exists(select 1 from pg_policy where polrelid='public.couple_messages'::regclass and polname='couple_messages_delete_self' and polcmd='d' and not polpermissive and pg_get_expr(polqual,polrelid) like '%couple_author%') as own_delete_enforced,
    exists(select 1 from pg_policy where polrelid='public.couple_theme'::regclass and polname='couple_theme_members' and pg_get_expr(polqual,polrelid) like '%couple_room_owner%') as shared_room_enforced`);
  if(!result[0]||!Object.values(result[0]).every(value=>value===true))throw new SafeSetupError('规则更新后核对未全部通过，请检查云端策略。');
  return {status:'applied-and-verified',...result[0]};
}
async function main(){
  const input=await prompt();
  try{console.log(JSON.stringify(await apply(input.value)));}
  finally{input.value='';}
}
if(require.main===module)main().catch(error=>{console.error(safeFailure(error));process.exitCode=1;});
module.exports={apply};
