(() => {
  'use strict';
  const offset=8*3600000;
  function elapsed(startDate,now=new Date()) {
    const [year,month,date]=startDate.split('-').map(Number);
    const stamp=total=>{
      const y=year+Math.floor((month-1+total)/12),m=(month-1+total)%12;
      return Date.UTC(y,m,Math.min(date,new Date(Date.UTC(y,m+1,0)).getUTCDate()))-offset;
    };
    const current=new Date(now.getTime()+offset);
    let months=(current.getUTCFullYear()-year)*12+current.getUTCMonth()-(month-1);
    if(stamp(months)>now.getTime())months--;
    months=Math.max(0,months);
    let seconds=Math.max(0,Math.floor((now.getTime()-stamp(months))/1000));
    const days=Math.floor(seconds/86400);seconds%=86400;
    return {years:Math.floor(months/12),months:months%12,days,hours:Math.floor(seconds/3600),minutes:Math.floor(seconds%3600/60),seconds:seconds%60,totalDays:Math.max(0,Math.floor((now.getTime()-stamp(0))/86400000))};
  }
  window.QXNN_TIME=Object.freeze({elapsed});
})();
