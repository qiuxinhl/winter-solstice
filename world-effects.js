(() => {
  'use strict';
  const root=document.documentElement;
  const layer=document.createElement('div');layer.className='world-atmosphere';layer.setAttribute('aria-hidden','true');
  layer.innerHTML='<i class="world-orb"></i><i class="world-orb second"></i>';
  const shapes={spring:['❀','✿','❁'],summer:['·','✧','•'],autumn:['❧','🍂','🍁'],winter:['❄','❅','❆']};
  let season='';
  function refresh(){
    root.classList.toggle('world-hidden',document.hidden);
    root.classList.toggle('world-reading',Boolean(document.querySelector('dialog[open]')));
    const next=root.dataset.season||'winter';if(season===next)return;season=next;
    layer.querySelectorAll('.world-particle').forEach(node=>node.remove());
    for(let i=0;i<24;i++){
      const item=document.createElement('span');item.className='world-particle';item.textContent=(shapes[season]||shapes.winter)[i%3];
      item.style.cssText='--x:'+((i*37)%100)+'%;--size:'+(16+i%5*3)+'px;--sway:'+(i%2?-90:90)+'px;--duration:'+(14+i%9)+'s;--delay:-'+(i*2.7)+'s';layer.append(item);
    }
  }
  document.body.append(layer);refresh();
  new MutationObserver(refresh).observe(root,{attributes:true,attributeFilter:['data-season']});
  document.querySelectorAll('dialog').forEach(dialog=>new MutationObserver(refresh).observe(dialog,{attributes:true,attributeFilter:['open']}));
  document.addEventListener('visibilitychange',refresh);
  document.addEventListener('click',event=>{
    if(root.classList.contains('motion-paused')||document.hidden||!event.target.closest('button,a')||event.target.closest('dialog,#loginPage')||event.clientX===0&&event.clientY===0)return;
    if(document.querySelectorAll('.world-ripple').length>20)return;
    for(let i=0;i<3;i++){
      const heart=document.createElement('span');heart.className='world-ripple';heart.textContent=i===1?'✧':'♡';heart.setAttribute('aria-hidden','true');heart.style.cssText='left:'+(event.clientX+(i-1)*12)+'px;top:'+event.clientY+'px;--drift:'+((i-1)*35)+'px';document.body.append(heart);setTimeout(()=>heart.remove(),950);
    }
  });
})();
