'use strict';
(() => {
  const CONFIG = Object.freeze({goal:100,speed:.48,maxSpeedMultiplier:1.30,spawnEvery:.43,chainChance:.64,chainMin:2,chainMax:4,chainSpacing:.19,obstacleChance:.17,invulnerable:1.25,ringRetry:2.2,maxDelta:.05,contactZ:.89,effectDuration:.38});
  // Test-only: change to true locally to start at 99 hearts; NEVER enable in a published build.
  const LOCAL_TEST_99_HEARTS = false;
  const canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d');
  const stage=document.querySelector('#stage'),overlay=document.querySelector('#overlay');
  const title=document.querySelector('#title'),message=document.querySelector('#message'),action=document.querySelector('#action');
  const heartsUI=document.querySelector('#hearts'),livesUI=document.querySelector('#lives'),pauseButton=document.querySelector('#pause');
  let width=1,height=1,dpr=1,frameId=null,lastTime=null,swipeStart=null;
  const newState=()=>({mode:'start',lane:1,hearts:LOCAL_TEST_99_HEARTS?99:0,lives:3,objects:[],spawnClock:0,travel:0,invulnerable:0,ringClock:0,ringActive:false,ringCollected:false,serial:0,visualLane:1,effects:[],hitFlash:0,runClock:0});
  let state=newState();
  function resize(){const box=stage.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);render();}
  function hud(){heartsUI.textContent=`♥ ${Math.min(state.hearts,CONFIG.goal)}/${CONFIG.goal}`;livesUI.textContent='●'.repeat(state.lives)+'○'.repeat(3-state.lives);pauseButton.textContent=state.mode==='paused'?'Продолжить':'Пауза';}
  function show(heading,body,button){title.textContent=heading;message.textContent=body;action.textContent=button;overlay.classList.remove('hidden');}
  function hide(){overlay.classList.add('hidden');}
  function setMode(mode){state.mode=mode;lastTime=null;hud();if(mode==='playing')hide();else if(mode==='start')show('LOVE DASH','Собери 100 сердечек, найди кольцо и получи последнюю улику!','Играть');else if(mode==='paused')show('Пауза','Игра остановлена. Продолжим?','Продолжить');else if(mode==='recover')show('Сердечки на месте ♥','Жизни закончились, но собранные сердечки сохраняются.','Продолжить');else if(mode==='won')show('Победа! Последняя улика найдена','Ты собрала кольцо! ♥','Сыграть ещё раз');}
  function restart(){state=newState();setMode('playing');}
  function resume(){if(state.mode==='recover'){state.lives=3;state.invulnerable=CONFIG.invulnerable;state.objects=state.objects.filter(o=>o.kind!=='obstacle');}setMode('playing');}
  function actionClick(){if(state.mode==='start'||state.mode==='won')restart();else if(state.mode==='recover'||state.mode==='paused')resume();}
  function move(direction){if(state.mode!=='playing')return;state.lane=Math.max(0,Math.min(2,state.lane+direction));}
  function add(kind,lane,z=0){state.objects.push({id:++state.serial,kind,lane,z,handled:false});if(kind==='ring')state.ringActive=true;}
  function spawn(){
    if(state.hearts>=CONFIG.goal&&!state.ringActive&&state.ringClock<=0){add('ring',Math.floor(Math.random()*3));return;}
    const lane=Math.floor(Math.random()*3);
    if(Math.random()<CONFIG.obstacleChance){add('obstacle',lane);return;}
    const count=Math.random()<CONFIG.chainChance ? CONFIG.chainMin+Math.floor(Math.random()*(CONFIG.chainMax-CONFIG.chainMin+1)) : 1;
    for(let i=0;i<count;i++)add('heart',lane,-i*CONFIG.chainSpacing);
  }
  function speed(){return CONFIG.speed*(1+(CONFIG.maxSpeedMultiplier-1)*Math.min(state.hearts,CONFIG.goal)/CONFIG.goal);}
  function contactEffect(kind,lane){
    state.effects.push({kind,lane,age:0});
    if(state.effects.length>16)state.effects.shift();
    if(kind==='hit')state.hitFlash=.3;
  }
  function update(dt){
    const velocity=speed();state.travel+=dt*velocity;state.runClock+=dt;
    state.visualLane+=(state.lane-state.visualLane)*Math.min(1,dt*15);
    state.invulnerable=Math.max(0,state.invulnerable-dt);
    state.hitFlash=Math.max(0,state.hitFlash-dt);
    for(const e of state.effects)e.age+=dt;
    state.effects=state.effects.filter(e=>e.age<CONFIG.effectDuration);
    state.spawnClock+=dt;
    if(state.hearts>=CONFIG.goal&&!state.ringActive)state.ringClock-=dt;
    while(state.spawnClock>=CONFIG.spawnEvery){state.spawnClock-=CONFIG.spawnEvery;spawn();}
    for(const o of state.objects){
      const oldZ=o.z;o.z+=dt*velocity;
      if(o.handled||oldZ>CONFIG.contactZ||o.z<CONFIG.contactZ)continue;
      o.handled=true;
      if(o.lane===state.lane){
        if(o.kind==='heart'){state.hearts++;contactEffect('heart',o.lane);}
        else if(o.kind==='ring'){state.ringCollected=true;setMode('won');break;}
        else if(state.invulnerable<=0){state.lives--;state.invulnerable=CONFIG.invulnerable;contactEffect('hit',o.lane);if(state.lives===0){setMode('recover');break;}}
      }
      if(o.kind==='ring'){state.ringActive=false;state.ringClock=CONFIG.ringRetry;}
    }
    state.objects=state.objects.filter(o=>!o.handled&&o.z<1.12);
    hud();
  }
  function roadX(lane,z){const t=Math.max(0,Math.min(1,z));const roadWidth=width*(.22+.72*t);return width/2+(lane-1)*roadWidth/3;}
  function heart(x,y,size){
    ctx.save();ctx.translate(x,y);ctx.scale(size/30,size/30);
    ctx.shadowColor='#ff2e9d';ctx.shadowBlur=19;ctx.fillStyle='#ff379b';ctx.strokeStyle='#fff0fa';ctx.lineWidth=2.6;
    ctx.beginPath();ctx.moveTo(0,13);ctx.bezierCurveTo(-8,7,-18,-2,-14,-10);ctx.bezierCurveTo(-10,-19,-2,-16,0,-10);ctx.bezierCurveTo(4,-17,13,-18,16,-9);ctx.bezierCurveTo(20,0,9,9,0,13);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.globalAlpha=.8;ctx.beginPath();ctx.ellipse(-7,-9,3,1.6,-.5,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function barrier(x,y,size){
    ctx.save();ctx.translate(x,y);const w=size*1.2,h=size*.65;
    ctx.shadowColor='#1d1238';ctx.shadowBlur=7;ctx.fillStyle='#a72736';ctx.fillRect(-w/2+3,-h/2+5,w,h);
    ctx.shadowBlur=0;ctx.fillStyle='#e94a52';ctx.fillRect(-w/2,-h/2,w,h);
    ctx.save();ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.clip();ctx.strokeStyle='#fff9f1';ctx.lineWidth=Math.max(4,size*.17);
    for(let i=-3;i<5;i++){ctx.beginPath();ctx.moveTo(i*size*.34-size*.3,-h);ctx.lineTo(i*size*.34+size*.3,h);ctx.stroke();}ctx.restore();
    ctx.strokeStyle='#fff0ef';ctx.lineWidth=2;ctx.strokeRect(-w/2,-h/2,w,h);
    ctx.fillStyle='#692334';ctx.fillRect(-w*.38,h*.5,w*.15,h*.35);ctx.fillRect(w*.23,h*.5,w*.15,h*.35);
    ctx.restore();
  }
  function render(){
    ctx.clearRect(0,0,width,height);
    const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#241d4c');sky.addColorStop(1,'#63345f');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    const horizon=height*.13,bottom=height*1.04;
    ctx.fillStyle='#332c52';ctx.beginPath();ctx.moveTo(width*.39,horizon);ctx.lineTo(width*.61,horizon);ctx.lineTo(width*.98,bottom);ctx.lineTo(width*.02,bottom);ctx.fill();
    ctx.strokeStyle='#ffb7e2';ctx.lineWidth=3;
    for(const edge of [0,3]){ctx.beginPath();ctx.moveTo(width*(.39+.22*edge/3),horizon);ctx.lineTo(width*(.02+.96*edge/3),bottom);ctx.stroke();}
    for(let lane=1;lane<3;lane++)for(let j=0;j<13;j++){
      const z=(j/13+state.travel*1.6)%1, next=Math.min(1,z+.038);
      const lineX=t=>width/2+(lane/3-.5)*width*(.22+.72*t);
      const y=t=>horizon+(height-horizon)*t*t;
      ctx.strokeStyle=`rgba(255,227,245,${.26+z*.65})`;ctx.lineWidth=1+z*3;
      ctx.beginPath();ctx.moveTo(lineX(z),y(z));ctx.lineTo(lineX(next),y(next));ctx.stroke();
    }
    for(let j=0;j<15;j++){
      const z=(j/15+state.travel*1.8)%1,y=horizon+(height-horizon)*z*z;
      ctx.strokeStyle=`rgba(255,207,240,${.08+z*.26})`;ctx.lineWidth=1+z*2;
      ctx.beginPath();ctx.moveTo(width*(.39-.37*z),y);ctx.lineTo(width*(.61+.37*z),y);ctx.stroke();
    }
    for(const o of state.objects){
      if(o.handled||o.z<0||o.z>1.08)continue;
      const z=o.z,y=horizon+(height-horizon)*z*z,x=roadX(o.lane,z),size=Math.max(9,Math.min(width*.12,11+z*38));
      if(o.kind==='heart')heart(x,y,size);
      else if(o.kind==='obstacle')barrier(x,y,size);
      else {ctx.save();ctx.font=`${size}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#ffdc62';ctx.shadowBlur=15;ctx.fillText('💍',x,y);ctx.restore();}
    }
    const px=width/2+(state.visualLane-1)*width*(.22+.72*CONFIG.contactZ)/3;
    const py=horizon+(height-horizon)*CONFIG.contactZ*CONFIG.contactZ;
    ctx.save();ctx.translate(px,py);const stride=Math.sin(state.runClock*17)*4;
    if(state.effects.some(e=>e.kind==='heart')){ctx.fillStyle='rgba(255,100,193,.17)';ctx.beginPath();ctx.arc(0,0,36,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=state.invulnerable>0?.78:1;
    ctx.strokeStyle='#ffc4dd';ctx.lineWidth=7;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-7,21);ctx.lineTo(-9+stride,33);ctx.moveTo(7,21);ctx.lineTo(9-stride,33);ctx.stroke();
    ctx.fillStyle='#ffc4dd';ctx.beginPath();ctx.arc(0,-19,13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ff6eae';ctx.beginPath();ctx.roundRect(-16,-8,32,32,10);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText('К',0,14);ctx.restore();
    for(const e of state.effects){
      const t=e.age/CONFIG.effectDuration,ex=roadX(e.lane,CONFIG.contactZ),ey=py;
      ctx.save();ctx.globalAlpha=1-t;
      if(e.kind==='heart'){
        ctx.font=`bold ${20+t*16}px system-ui`;ctx.fillStyle='#fff1fa';ctx.textAlign='center';ctx.shadowColor='#ff3ca5';ctx.shadowBlur=12;ctx.fillText('+1',ex+22,ey-35-t*32);
        for(let i=0;i<6;i++){const angle=i*Math.PI/3;ctx.fillStyle=i%2?'#fff':'#ff69bc';ctx.beginPath();ctx.arc(ex+Math.cos(angle)*(10+t*32),ey-12+Math.sin(angle)*(10+t*32),3*(1-t)+.5,0,Math.PI*2);ctx.fill();}
      }else{ctx.strokeStyle='#ff8b8b';ctx.lineWidth=5*(1-t);ctx.beginPath();ctx.arc(ex,ey,20+t*25,0,Math.PI*2);ctx.stroke();}
      ctx.restore();
    }
    if(state.hitFlash>0){ctx.fillStyle=`rgba(255,95,108,${state.hitFlash*.24})`;ctx.fillRect(0,0,width,height);}
  }
  function frame(time){frameId=requestAnimationFrame(frame);if(lastTime===null){lastTime=time;render();return;}const dt=Math.min(CONFIG.maxDelta,Math.max(0,(time-lastTime)/1000));lastTime=time;if(state.mode==='playing')update(dt);render();}
  action.addEventListener('click',actionClick);document.querySelector('#left').addEventListener('click',()=>move(-1));document.querySelector('#right').addEventListener('click',()=>move(1));pauseButton.addEventListener('click',()=>{if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')resume();});document.querySelector('#restart').addEventListener('click',restart);
  window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight',' ','Escape'].includes(e.key))e.preventDefault();if(e.repeat)return;if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1);if(e.key==='Escape'||e.key===' '){if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')resume();}});
  stage.addEventListener('pointerdown',e=>{if(e.target!==canvas)return;swipeStart={x:e.clientX,y:e.clientY,id:e.pointerId};});stage.addEventListener('pointerup',e=>{if(!swipeStart||e.pointerId!==swipeStart.id)return;const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>28&&Math.abs(dx)>Math.abs(dy)*1.2)move(dx>0?1:-1);});stage.addEventListener('pointercancel',()=>swipeStart=null);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')setMode('paused');lastTime=null;});window.addEventListener('blur',()=>{if(state.mode==='playing')setMode('paused');lastTime=null;});window.addEventListener('resize',resize);resize();setMode('start');frameId=requestAnimationFrame(frame);
})();
