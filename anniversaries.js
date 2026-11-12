(() => {
  'use strict';
  const by=id=>document.getElementById(id);
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const day=value=>Date.parse(value+'T00:00:00Z');
  function validDate(value) {
    return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value>='1900-01-01' && value<='2100-12-31' && Number.isFinite(day(value)) && new Date(day(value)).toISOString().slice(0,10)===value;
  }
  function normalize(values) {
    if(!Array.isArray(values)||values.length>100)throw new Error('纪念日最多可保存100个。');
    const ids=new Set();
    return values.map(item=>{
      if(!item||typeof item.id!=='string'||item.id.length>80||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>30||!validDate(item.date)||typeof item.yearly!=='boolean')throw new Error('纪念日的名称或日期不完整。');
      const kind=item.kind==='birthday'||(!item.kind&&/生日/.test(item.name))?'birthday':'custom';
      const person=['me','partner','custom'].includes(item.person)?item.person:'custom';
      const personName=typeof item.personName==='string'?item.personName.trim().slice(0,24):'';
      ids.add(item.id);return {id:item.id,name:item.name.trim(),date:item.date,yearly:item.yearly,kind,person,personName};
    });
  }
  function timing(item,current=today()) {
    let next=item.date;
    if(item.yearly && item.date<=current){
      const [,month,date]=item.date.split('-').map(Number);
      const at=year=>new Date(Date.UTC(year,month-1,Math.min(date,new Date(Date.UTC(year,month,0)).getUTCDate()))).toISOString().slice(0,10);
      const year=Number(current.slice(0,4));next=at(year);if(next<current)next=at(year+1);
    }
    return {next,days:Math.round((day(next)-day(current))/86400000)};
  }
  let editing=null;
  const dialog=document.createElement('dialog');dialog.id='anniversaryDialog';dialog.setAttribute('aria-labelledby','anniversaryTitle');
  dialog.innerHTML='<div class="dialog-head"><h2 id="anniversaryTitle">添加一个纪念日</h2><button class="icon-button" data-close aria-label="关闭纪念日设置">×</button></div><div class="dialog-body"><form id="anniversaryForm"><label class="form-field">这是什么日子<input id="anniversaryName" maxlength="30" placeholder="比如：你的生日、第一次见面" required></label><label class="form-field">值得记住的日期<input id="anniversaryDate" type="date" min="1900-01-01" max="2100-12-31" required></label><label class="anniversary-repeat"><input id="anniversaryYearly" type="checkbox" checked>每年纪念这一天</label><p class="form-help">每年纪念的日子会显示下一次倒数；不勾选时，显示距离这一天的天数。2月29日在非闰年按2月28日计算。</p><div class="dialog-actions"><button class="secondary" type="button" data-close>先想想</button><button class="primary" type="submit">把这一天记好</button></div></form></div>';
  document.body.append(dialog);
  const birthdayFields=document.createElement('div');birthdayFields.id='birthdayFields';birthdayFields.hidden=true;
  birthdayFields.innerHTML='<label class="form-field">是谁的生日<select id="anniversaryPerson"><option value="me">我</option><option value="partner">对方</option><option value="custom">自定义姓名</option></select></label><label class="form-field" id="anniversaryPersonNameField" hidden>生日主角的名字<input id="anniversaryPersonName" maxlength="24" placeholder="写下要记住的名字"></label>';
  const kindLabel=document.createElement('label');kindLabel.className='form-field';kindLabel.innerHTML='日子类型<select id="anniversaryKind"><option value="custom">特别的日子</option><option value="birthday">生日</option></select>';
  by('anniversaryForm').prepend(birthdayFields);by('anniversaryForm').prepend(kindLabel);
  function birthdayMode(){const birthday=by('anniversaryKind').value==='birthday';birthdayFields.hidden=!birthday;by('anniversaryName').closest('label').hidden=birthday;by('anniversaryName').required=!birthday;by('anniversaryPersonNameField').hidden=!birthday||by('anniversaryPerson').value!=='custom';by('anniversaryPersonName').required=birthday&&by('anniversaryPerson').value==='custom';}
  by('anniversaryKind').addEventListener('change',birthdayMode);by('anniversaryPerson').addEventListener('change',birthdayMode);
  function fill(item=null){editing=item?.id||null;by('anniversaryTitle').textContent=item?'修改这个纪念日':'添加一个纪念日';by('anniversaryName').value=item?.name||'';by('anniversaryDate').value=item?.date||today();by('anniversaryYearly').checked=item?.yearly??true;by('anniversaryKind').value=item?.kind||(/生日/.test(item?.name||'')?'birthday':'custom');by('anniversaryPerson').value=item?.person||window.QXNN_PEOPLE.selfKey();by('anniversaryPersonName').value=item?.personName||'';birthdayMode();}
  document.querySelectorAll('[data-open="anniversaryDialog"]').forEach(button=>button.addEventListener('click',()=>fill()));
  by('anniversaryForm').addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const kind=by('anniversaryKind').value,person=by('anniversaryPerson').value,personName=by('anniversaryPersonName').value.trim();
      const item={id:editing||makeId(),name:kind==='birthday'?'生日':by('anniversaryName').value,date:by('anniversaryDate').value,yearly:by('anniversaryYearly').checked,kind,person,personName};
      const items=[...(state.anniversaries||[])];const index=items.findIndex(entry=>entry.id===editing);if(index<0)items.push(item);else items[index]=item;
      if(save({...state,anniversaries:normalize(items)},'这个日子，已经记在我们的小屋里。'))dialog.close();
    }catch(error){toast(error.message);}
  });
  function render(){
    for(const key of ['me','partner']){const name=window.QXNN_PEOPLE.name(key);by('anniversaryPerson').querySelector('[value="'+key+'"]').textContent=['我','对方'].includes(name)?name:name+(key===window.QXNN_PEOPLE.selfKey()?'（我）':'（对方）');}
    const list=by('anniversaryList');list.replaceChildren();
    const items=(state.anniversaries||[]).map(item=>({...item,...timing(item)})).sort((a,b)=>Math.abs(a.days)-Math.abs(b.days));
    if(!items.length){const empty=document.createElement('p');empty.className='anniversary-empty';empty.textContent='还没有添加其他纪念日。把想一起记住的日子，放在这里吧。';list.append(empty);return;}
    for(const item of items){
      const card=document.createElement('article');card.className='anniversary-card';
      const top=document.createElement('div');top.className='anniversary-card-top';
      const icon=document.createElement('span');icon.className='anniversary-icon';icon.textContent=item.kind==='birthday'?'🎂':'♡';icon.setAttribute('aria-hidden','true');
      const person=['me','partner'].includes(item.person)?window.QXNN_PEOPLE.name(item.person):item.personName;
      const title=item.kind==='birthday'?(person?person+'的生日':'生日 · 请补充姓名'):item.name;
      const name=document.createElement('h4');name.textContent=title;top.append(icon,name);
      const value=document.createElement('p');value.className='anniversary-count';
      const number=document.createElement('strong');number.textContent=item.days===0?'就是今天':Math.abs(item.days);
      const unit=document.createElement('span');unit.textContent=item.days===0?'一起好好过':item.days>0?'天后到来':'天的回忆';value.append(number,unit);
      const date=document.createElement('time');date.dateTime=item.date;date.textContent=item.date.replaceAll('-',' / ')+(item.yearly?' · 每年纪念':'');
      const countdown=document.createElement('p');countdown.className='anniversary-countdown';countdown.dataset.target=item.next;countdown.dataset.birthday=String(item.kind==='birthday');countdown.setAttribute('aria-label','纪念日实时倒计时');
      const tools=document.createElement('div');tools.className='anniversary-card-tools';
      const edit=document.createElement('button');edit.type='button';edit.className='text-link';edit.textContent='修改';edit.setAttribute('aria-label','修改纪念日：'+item.name);edit.addEventListener('click',()=>{fill(item);openDialog('anniversaryDialog');});
      const remove=document.createElement('button');remove.type='button';remove.className='text-link';remove.textContent='删除';remove.setAttribute('aria-label','删除纪念日：'+item.name);remove.addEventListener('click',()=>{if(confirm('确定删除“'+item.name+'”这个纪念日吗？'))save({...state,anniversaries:(state.anniversaries||[]).filter(entry=>entry.id!==item.id)},'这个纪念日已移除。');});
      tools.append(edit,remove);card.append(top,value,countdown,date,tools);list.append(card);
    } tick();
  }
  function tick(){
    for(const node of document.querySelectorAll('.anniversary-countdown')){
      const current=today(),target=node.dataset.target;
      if(target===current){node.textContent=node.dataset.birthday==='true'?'就是今天，生日快乐！':'就是今天，一起好好过。';continue;}
      let seconds=Math.abs(Math.floor((Date.parse(target+'T00:00:00+08:00')-Date.now())/1000));
      const days=Math.floor(seconds/86400);seconds%=86400;
      node.textContent=(target<current?'已过去 ':'倒计时 ')+days+'天 '+String(Math.floor(seconds/3600)).padStart(2,'0')+'时 '+String(Math.floor(seconds%3600/60)).padStart(2,'0')+'分 '+String(seconds%60).padStart(2,'0')+'秒';
    }
  }
  window.QXNN_ANNIVERSARIES=Object.freeze({normalize,timing});
  window.addEventListener('our-world-state',render);
  window.addEventListener('our-world-connection',render);
  let renderedDay=today();setInterval(()=>{if(document.hidden)return;if(renderedDay!==today()){renderedDay=today();render();}else tick();},1000);
})();
