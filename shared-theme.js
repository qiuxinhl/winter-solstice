(() => {
  'use strict';
  const theme=window.QXNN_SOLAR_THEME;
  const room=window.ourSharedSpace;
  const select=document.getElementById('solarTermSelect');
  const follow=document.getElementById('followSolarTerm');
  const notice=document.getElementById('solarSyncStatus');
  if(!theme||!room||!select||!notice)return;
  let active=null;
  function controls(session){
    select.disabled=!window.QXNN_SOLAR_DATES||!session?.loaded;
    follow.disabled=select.disabled||theme.get()==='';
  }
  function reset(){
    active=null;theme.set('',false);controls(null);
    notice.textContent='登录后，两个人共享同一套节气装扮。';
  }
  function synced(){
    notice.textContent=theme.get()?'已同步到两个人的小屋 · 对方页面会自动换装。':'两个人已一起跟随当前节气 · 页面打开时约5秒同步一次。';
  }
  async function pull(session){
    if(active!==session||session.pulling||session.saving)return;
    session.pulling=true;const edit=session.edit;
    try{
      const value=await room.request('/room/theme');
      if(active!==session||session.edit!==edit||session.saving)return;
      if(!theme.valid(value.term))throw new Error('Invalid shared season');
      theme.set(value.term,session.loaded);session.loaded=true;controls(session);synced();
    }catch{
      if(active===session&&session.edit===edit&&!session.saving){
        notice.textContent=session.loaded?'节气暂时未能刷新，网络恢复后会自动同步。':'正在读取共同节气，网络恢复后会自动重试。';
      }
    }finally{session.pulling=false;}
  }
  async function publish(session,term){
    session.edit++;session.pending=term;
    notice.textContent='正在把这套节气装扮分享给对方…';
    if(session.saving)return;
    session.saving=true;
    try{
      while(active===session&&session.pending!==undefined){
        const value=session.pending;session.pending=undefined;
        try{await room.request('/room/theme',{method:'PUT',body:JSON.stringify({term:value})});}
        catch{
          if(active!==session)return;
          if(session.pending!==undefined)continue;
          session.loaded=false;controls(session);
          notice.textContent='这次节气未能同步，正在重新读取共同装扮，请稍后再选。';
          return;
        }
      }
      if(active===session){controls(session);synced();}
    }finally{
      session.saving=false;
      if(active===session)pull(session);
    }
  }
  window.addEventListener('our-world-solar-choice',event=>{
    const session=active;
    if(!session?.loaded||!theme.valid(event.detail?.term)){controls(session);return;}
    controls(session);publish(session,event.detail.term);
  });
  function connectionChanged(event){
    const value=event.detail;
    if(!value.connected){if(active)reset();return;}
    if(active?.revision===value.revision)return;
    active={revision:value.revision,loaded:false,pulling:false,saving:false,pending:undefined,edit:0};
    controls(active);notice.textContent='正在读取两个人共同的节气装扮…';pull(active);
  }
  window.addEventListener('our-world-connection',connectionChanged);
  const refresh=()=>{if(active&&!document.hidden)pull(active);};
  setInterval(refresh,5000);
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('pageshow',refresh);
  window.addEventListener('online',refresh);
  reset();
  if(room.isConnected())connectionChanged({detail:{connected:true,revision:room.revision()}});
})();
