(() => {
  'use strict';
  // Letters share the existing private, author-stamped store. A reserved
  // prefix keeps them out of the message board; one batch commits atomically.
  const prefix='QXNNMAIL1:';
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const styles=['strawberry','sky','garden'];
  const author=value=>value==='me'||value==='partner';
  function encode(input){
    const subject=String(input.subject||'').trim(),body=String(input.body||'').trim();
    if(!uuid.test(input.id)||!subject||subject.length>60||!body||body.length>8000)throw new Error('请填写信的标题（最多60字）和正文（最多8000字）。');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(subject+body))throw new Error('文字中有无法保存的隐藏字符，请重新粘贴为普通文字。');
    const chars=Array.from(body),total=Math.ceil(chars.length/180),style=styles.includes(input.style)?input.style:'strawberry';
    return Array.from({length:total},(_,part)=>prefix+JSON.stringify({kind:'letter',id:input.id,part,total,subject,body:chars.slice(part*180,(part+1)*180).join(''),style}));
  }
  function decode(rows){
    const groups=new Map(),reads=[];
    for(const row of rows){
      if(!author(row.author)||typeof row.text!=='string'||!row.text.startsWith(prefix))continue;
      let data;try{data=JSON.parse(row.text.slice(prefix.length));}catch{continue;}
      if(!data||!uuid.test(data.id))continue;
      if(data.kind==='read'){if(author(data.letterAuthor)&&row.author!==data.letterAuthor)reads.push({...data,createdAt:row.createdAt});continue;}
      if(data.kind!=='letter'||!Number.isInteger(data.total)||data.total<1||data.total>45||!Number.isInteger(data.part)||data.part<0||data.part>=data.total||typeof data.subject!=='string'||!data.subject.trim()||data.subject.length>60||typeof data.body!=='string'||!data.body||Array.from(data.body).length>180||!styles.includes(data.style))continue;
      const key=row.author+':'+data.id;
      if(!groups.has(key))groups.set(key,{id:data.id,author:row.author,subject:data.subject,style:data.style,total:data.total,parts:new Map(),createdAt:row.createdAt,invalid:false});
      const group=groups.get(key);
      if(group.total!==data.total||group.subject!==data.subject||group.style!==data.style||(group.parts.has(data.part)&&group.parts.get(data.part)!==data.body)){group.invalid=true;continue;}
      group.parts.set(data.part,data.body);
      if(row.createdAt<group.createdAt)group.createdAt=row.createdAt;
    }
    const letters=[];
    for(const group of groups.values()){
      if(group.invalid||group.parts.size!==group.total)continue;
      const body=Array.from({length:group.total},(_,i)=>group.parts.get(i)).join('');
      if(body.length>8000)continue;
      const read=reads.filter(r=>r.id===group.id&&r.letterAuthor===group.author).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
      letters.push({id:group.id,author:group.author,subject:group.subject,body,style:group.style,createdAt:group.createdAt,readAt:read?.createdAt||null});
    }
    return letters.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  }
  window.QXNN_MAIL_CODEC=Object.freeze({prefix,encode,decode});
})();
