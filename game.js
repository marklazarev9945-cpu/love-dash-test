'use strict';
(() => {
  const CONFIG = Object.freeze({goal:100,speed:.48,maxSpeedMultiplier:1.30,spawnEvery:.43,chainChance:.64,chainMin:2,chainMax:4,chainSpacing:.19,obstacleChance:.17,invulnerable:1.25,ringRetry:2.2,maxDelta:.05,contactZ:.89,effectDuration:.38});
  // Test-only: change to true locally to start at 99 hearts; NEVER enable in a published build.
  const LOCAL_TEST_99_HEARTS = false;
  const DEBUG_MOTION = false; // Development only; false in published build.
  const PARK = Object.freeze({spacing:0.40, ahead:2.0, sideOffset:0.15, maxVisibleDepth:2.3});
  const canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d');
  const stage=document.querySelector('#stage'),overlay=document.querySelector('#overlay');
  const title=document.querySelector('#title'),message=document.querySelector('#message'),action=document.querySelector('#action');
  const heartsUI=document.querySelector('#hearts'),livesUI=document.querySelector('#lives'),pauseButton=document.querySelector('#pause');
  let width=1,height=1,dpr=1,frameId=null,lastTime=null,swipeStart=null;
  const newState=()=>({mode:'start',lane:1,hearts:LOCAL_TEST_99_HEARTS?99:0,lives:3,objects:[],spawnClock:0,travel:0,invulnerable:0,ringClock:0,ringActive:false,ringCollected:false,serial:0,visualLane:1,effects:[],hitFlash:0,runClock:0});
  let state=newState();
  // Visual-only state. Gameplay coordinates, input, spawn and collisions are unchanged.
  const WORLDS=[{name:'Первое свидание',sky:'#b9e4fa',ground:'#a5c985',road:'#d9cbb0',edge:'#fff2d4'},{name:'Первое путешествие',sky:'#c6dce8',ground:'#91b6b8',road:'#c7b9ad',edge:'#f9e7d7'},{name:'Предложение',sky:'#a6ddf6',ground:'#e9d5a5',road:'#e1c9a7',edge:'#fff3d7'},{name:'Дом',sky:'#f4d9ba',ground:'#d7b9a2',road:'#d5b7a2',edge:'#fff1df'}];
  const WORLD_FADE=1.15, LABEL_TIME=2.8;
  let worldIndex=0,previousWorld=0,worldFade=WORLD_FADE,labelAge=LABEL_TIME;
  // Shared world-space longitudinal coordinates: game object z = travel - spawnTravel.
  // Park landmarks use the exact same travel and projection as collectible objects.
  const parkLandmarks=[];
  let nextParkDistance=0, parkSerial=0;
  function resetPark(){parkLandmarks.length=0;nextParkDistance=0;parkSerial=0;fillPark();}
  function fillPark(){
    while(nextParkDistance < state.travel + PARK.ahead){
      const n=parkSerial++;
      for(let side of [-1,1]){
        // A fixed variety, without random frame-to-frame reshuffling.
        const kinds=['tree','lamp','bush','tree','bench','tree','bush'];
        parkLandmarks.push({distance:nextParkDistance,side,kind:kinds[(n*3+(side===1?2:0))%kinds.length],variant:(n*7+(side===1?3:0))%5});
      }
      nextParkDistance+=PARK.spacing+(n%4)*.055;
    }
  }
  resetPark();
  function resize(){const box=stage.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);render();}
  function hud(){heartsUI.textContent=`♥ ${Math.min(state.hearts,CONFIG.goal)}/${CONFIG.goal}`;livesUI.textContent='●'.repeat(state.lives)+'○'.repeat(3-state.lives);pauseButton.textContent=state.mode==='paused'?'Продолжить':'Пауза';}
  function show(heading,body,button){title.textContent=heading;message.textContent=body;action.textContent=button;overlay.classList.remove('hidden');}
  function hide(){overlay.classList.add('hidden');}
  function setMode(mode){state.mode=mode;lastTime=null;hud();if(mode==='playing')hide();else if(mode==='start')show('LOVE DASH','Собери 100 сердечек, найди кольцо и получи последнюю улику!','Играть');else if(mode==='paused')show('Пауза','Игра остановлена. Продолжим?','Продолжить');else if(mode==='recover')show('Сердечки на месте ♥','Жизни закончились, но собранные сердечки сохраняются.','Продолжить');else if(mode==='won')show('Победа! Последняя улика найдена','Ты собрала кольцо! ♥','Сыграть ещё раз');}
  function restart(){state=newState();resetPark();worldIndex=0;previousWorld=0;worldFade=WORLD_FADE;labelAge=0;setMode('playing');}
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
    const nextWorld=0; // v0.3A.2: keep Butovsky Park for the entire run, including ring phase.
    if(nextWorld!==worldIndex){previousWorld=worldIndex;worldIndex=nextWorld;worldFade=0;labelAge=0;}
    worldFade=Math.min(WORLD_FADE,worldFade+dt);labelAge+=dt;
    const velocity=speed();state.travel+=dt*velocity;state.runClock+=dt;
    fillPark();
    // Remove only after the entire illustrated object has passed below Canvas.
    // Because items are inserted in distance order (two per station), front removal is safe.
    while(parkLandmarks.length && decorationFullyBelow(parkLandmarks[0], state.travel-parkLandmarks[0].distance)) parkLandmarks.shift();
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
  // The painted trapezoid and every world-space anchor share this section.
  function roadSection(y){
    const horizon=height*.13,bottom=height*1.04;
    const roadWidth=width*(.22+.74*(y-horizon)/(bottom-horizon));
    return {y,left:width/2-roadWidth/2,right:width/2+roadWidth/2,laneWidth:roadWidth/3};
  }
  function roadBoundary(boundary,section){return section.left+boundary*section.laneWidth;}
  function roadX(lane,z){return roadBoundary(lane+.5,projectDepth(z));}
  function projectDepth(z){
    const depth=Math.max(0,z),horizon=height*.13;
    const section=roadSection(horizon+(height-horizon)*depth*depth);
    const contactY=horizon+(height-horizon)*CONFIG.contactZ*CONFIG.contactZ;
    const contact=roadSection(contactY);
    // Uniform CSS-pixel scaling; DPR only controls the backing buffer.
    // Character bounds include the round caps on the animated legs.
    const contactScale=Math.max(0,Math.min(1,width/390,(contactY-8)/33,(height-contactY-8)/37));
    return {...section,scale:contactScale*section.laneWidth/contact.laneWidth};
  }
  function parkPlacement(item,z){
    // Keep the desktop contact size close to the original .89 * 1.25.
    const proj=projectDepth(z),scale=proj.scale*1.1;
    // Conservative local bounds include strokes and all illustration parts.
    const bounds=item.kind==='tree'?[-46,-143,46,1]:item.kind==='lamp'?[-15,-128,15,3]:item.kind==='bench'?[-36,-41,36,3]:[-37,-43,43,7];
    const [left,top,right,bottom]=bounds;
    const edge=roadSection(Math.max(height*.13,proj.y+bottom*scale));
    const gap=proj.laneWidth*(.08+.02*item.variant);
    const x=item.side<0?edge.left-gap-right*scale:edge.right+gap-left*scale;
    return {x,y:proj.y,scale,left:x+left*scale,right:x+right*scale,top:proj.y+top*scale,bottom:proj.y+bottom*scale};
  }
  function decorationFullyBelow(item,z){
    if(z<0)return false;
    return parkPlacement(item,z).top>height+8;
  }
  function parkDecoration(item,z){
    if(z<0||decorationFullyBelow(item,z))return;
    const {x,y,scale}=parkPlacement(item,z);
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    if(item.kind==='tree'){
      ctx.fillStyle='#927454';ctx.fillRect(-6,-77,12,77);
      for(const [cx,cy,r] of [[0,-110,32],[-20,-92,26],[20,-90,25]]){
        ctx.fillStyle='#609b62';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#a6d28b';ctx.beginPath();ctx.arc(cx-8,cy-9,r*.36,0,Math.PI*2);ctx.fill();
      }
    }else if(item.kind==='lamp'){
      ctx.strokeStyle='#566c60';ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-116);ctx.stroke();
      rounded(-12,-125,24,21,7,'#526d60');rounded(-8,-121,16,13,4,'#fff2be');
    }else if(item.kind==='bench'){
      rounded(-33,-38,66,12,4,'#b17e58');rounded(-33,-22,66,11,3,'#bd8b60');
      ctx.strokeStyle='#705b4c';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-24,-12);ctx.lineTo(-24,0);ctx.moveTo(24,-12);ctx.lineTo(24,0);ctx.stroke();
    }else{
      for(const [cx,cy,r] of [[-15,-15,21],[10,-18,24],[27,-11,15]]){ctx.fillStyle='#7bb478';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  }
  function drawParkMotion(){
    // Fixed longitudinal positions; no independent scenery animation clocks.
    const visible=parkLandmarks.map(item=>({item,z:state.travel-item.distance}))
      .filter(o=>o.z>=0&&!decorationFullyBelow(o.item,o.z));
    visible.sort((a,b)=>a.z-b.z);
    // Restrict scenery to shoulders: never paint over the playable three lanes.
    ctx.save();
    const top=projectDepth(0),bottom=roadSection(height*1.04);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(top.left,0);ctx.lineTo(top.left,top.y);ctx.lineTo(bottom.left,bottom.y);ctx.lineTo(0,bottom.y);ctx.closePath();
    ctx.moveTo(width,0);ctx.lineTo(top.right,0);ctx.lineTo(top.right,top.y);ctx.lineTo(bottom.right,bottom.y);ctx.lineTo(width,bottom.y);ctx.closePath();
    ctx.clip();
    for(const {item,z} of visible)parkDecoration(item,z);
    ctx.restore();
  }
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
  function polygon(points,fill){ctx.fillStyle=fill;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
  function rounded(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function tree(x,y,scale){ctx.fillStyle='#876a4b';ctx.fillRect(x-3*scale,y,6*scale,36*scale);for(const [dx,dy,r] of [[0,-7,21],[-13,4,16],[14,3,17]]){ctx.fillStyle='#6caa71';ctx.beginPath();ctx.arc(x+dx*scale,y+dy*scale,r*scale,0,Math.PI*2);ctx.fill();ctx.fillStyle='#9dcf83';ctx.beginPath();ctx.arc(x+(dx-5)*scale,y+(dy-5)*scale,r*.35*scale,0,Math.PI*2);ctx.fill();}}
  function building(x,y,w,h,fill){rounded(x,y,w,h,3,fill);ctx.fillStyle='#f9e9c9';for(let i=0;i<3;i++)for(let j=0;j<2;j++)ctx.fillRect(x+w*(.15+j*.48),y+13+i*h*.23,w*.19,h*.13);polygon([[x-4,y],[x+w/2,y-15],[x+w+4,y]],'#8e8c91');}
  function worldBackdrop(index){
    const w=WORLDS[index],horizon=height*.13;
    const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,w.sky);sky.addColorStop(1,index===3?'#f6e8d4':'#e5f1e4');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    // Fixed, gentle landscape illustrations: no moving horizontal road texture.
    if(index===0){
      ctx.fillStyle='#b7dca2';ctx.fillRect(0,horizon,width,height);
      for(let i=0;i<5;i++){const x=width*(i+.25)/4.5;tree(x,height*.25+(i%2)*height*.12,Math.max(.5,width/470));}
      for(const x of [width*.09,width*.84]){rounded(x,height*.69,width*.12,7,3,'#a67d57');ctx.fillStyle='#886c51';ctx.fillRect(x+5,height*.69+7,4,17);ctx.fillRect(x+width*.12-9,height*.69+7,4,17);}
      ctx.fillStyle='#81b86d';ctx.fillRect(0,height*.82,width,height*.18);
    }else if(index===1){
      ctx.fillStyle='#a2c5c9';ctx.fillRect(0,horizon,width,height);
      ctx.fillStyle='#8cb7c5';ctx.fillRect(0,height*.67,width,height*.33);
      building(width*.015,height*.24,width*.21,height*.35,'#ddc8b3');building(width*.77,height*.22,width*.22,height*.38,'#d4bda7');
      ctx.strokeStyle='#e6d5bc';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,height*.69);ctx.quadraticCurveTo(width*.15,height*.59,width*.3,height*.69);ctx.moveTo(width*.7,height*.69);ctx.quadraticCurveTo(width*.86,height*.59,width,height*.69);ctx.stroke();
      for(const x of [width*.06,width*.94]){ctx.strokeStyle='#665e60';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,height*.63);ctx.lineTo(x,height*.40);ctx.stroke();ctx.fillStyle='#f6e6b6';ctx.beginPath();ctx.arc(x,height*.4,6,0,Math.PI*2);ctx.fill();}
    }else if(index===2){
      ctx.fillStyle='#8ed3ed';ctx.fillRect(0,horizon,width,height);
      ctx.fillStyle='#4da9cb';ctx.fillRect(0,height*.37,width,height*.42);
      polygon([[0,height*.63],[width*.3,height*.56],[width*.48,height*.75],[width*.65,height*.57],[width,height*.64],[width,height],[0,height]],'#f2dfac');
      polygon([[0,height*.84],[width*.23,height*.75],[width*.4,height],[0,height]],'#dcc88f');polygon([[width*.7,height],[width*.85,height*.76],[width,height*.82],[width,height]],'#e1c88d');
      ctx.strokeStyle='#91a76b';ctx.lineWidth=2;for(let i=0;i<12;i++){const x=width*(i+.4)/12,y=height*(.81+(i%3)*.055);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-4,y-14);ctx.moveTo(x,y);ctx.lineTo(x+4,y-12);ctx.stroke();}
      ctx.fillStyle='#fff9e7';ctx.beginPath();ctx.arc(width*.82,height*.14,Math.min(24,width*.045),0,Math.PI*2);ctx.fill();
    }else{
      ctx.fillStyle='#ebd8c3';ctx.fillRect(0,horizon,width,height);
      ctx.fillStyle='#cba98e';ctx.fillRect(0,height*.73,width,height*.27);
      for(const x of [width*.06,width*.78]){rounded(x,height*.22,width*.17,height*.29,7,'#f7f0df');rounded(x+5,height*.25,width*.17-10,height*.22,3,'#a8d7df');ctx.strokeStyle='#eee4d3';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+width*.085,height*.25);ctx.lineTo(x+width*.085,height*.47);ctx.stroke();}
      for(const x of [width*.12,width*.89]){rounded(x-11,height*.72,22,19,4,'#ba806a');ctx.fillStyle='#68966c';for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(x+(i-1)*8,height*.69-i%2*9,8,14,(i-1)*.3,0,Math.PI*2);ctx.fill();}}
      rounded(width*.01,height*.84,width*.19,12,4,'#b68e75');rounded(width*.8,height*.84,width*.19,12,4,'#b68e75');
    }
  }
  function drawWorld(index){
    worldBackdrop(index);
    const w=WORLDS[index],top=projectDepth(0),bottom=roadSection(height*1.04);
    polygon([[top.left,top.y],[top.right,top.y],[bottom.right,bottom.y],[bottom.left,bottom.y]],w.road);
    // Static subtle lane separators and edges, shared by all four locations.
    for(let boundary=0;boundary<=3;boundary++){
      ctx.strokeStyle=boundary===0||boundary===3?w.edge:'rgba(255,255,255,.47)';ctx.lineWidth=boundary===0||boundary===3?3:2;
      ctx.beginPath();ctx.moveTo(roadBoundary(boundary,top),top.y);ctx.lineTo(roadBoundary(boundary,bottom),bottom.y);ctx.stroke();
    }
  }
  function drawLocationLabel(){
    if(labelAge>=LABEL_TIME)return;
    const fadeIn=Math.min(1,labelAge/.35),fadeOut=Math.min(1,(LABEL_TIME-labelAge)/.65),alpha=Math.min(fadeIn,fadeOut);
    ctx.save();ctx.globalAlpha=alpha;
    const label=WORLDS[worldIndex].name;ctx.font=`700 ${Math.max(14,Math.min(19,width*.043))}px system-ui`;
    const textWidth=ctx.measureText(label).width,boxWidth=Math.min(width-24,textWidth+32),x=(width-boxWidth)/2,y=height*.19;
    rounded(x,y,boxWidth,38,18,'rgba(255,250,239,.92)');ctx.fillStyle='#654d4a';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,width/2,y+19);ctx.restore();
  }
  function render(){
    ctx.clearRect(0,0,width,height);
    if(worldFade<WORLD_FADE&&previousWorld!==worldIndex){drawWorld(previousWorld);ctx.save();ctx.globalAlpha=worldFade/WORLD_FADE;drawWorld(worldIndex);ctx.restore();}
    else drawWorld(worldIndex);
    // Park scenery shares the world's longitudinal travel with hearts and barriers.
    // During crossfade it fades away with the park; other locations are untouched.
    if((worldIndex===0 || (previousWorld===0 && worldFade<WORLD_FADE)) && state.mode!=='start'){
      ctx.save();
      if(worldIndex!==0)ctx.globalAlpha=1-worldFade/WORLD_FADE;
      else if(previousWorld!==0&&worldFade<WORLD_FADE)ctx.globalAlpha=worldFade/WORLD_FADE;
      drawParkMotion();ctx.restore();
    }
    drawLocationLabel();
    for(const o of state.objects){
      if(o.handled||o.z<0||o.z>1.08)continue;
      const z=o.z,proj=projectDepth(z),y=proj.y,x=roadX(o.lane,z),size=(11+CONFIG.contactZ*38)*proj.scale;
      if(o.kind==='heart')heart(x,y,size);
      else if(o.kind==='obstacle')barrier(x,y,size);
      else {ctx.save();ctx.font=`${size}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#ffdc62';ctx.shadowBlur=15;ctx.fillText('💍',x,y);ctx.restore();}
    }
    const contact=projectDepth(CONFIG.contactZ),px=roadX(state.visualLane,CONFIG.contactZ),py=contact.y;
    ctx.save();ctx.translate(px,py);ctx.scale(contact.scale,contact.scale);const stride=Math.sin(state.runClock*17)*4;
    if(state.effects.some(e=>e.kind==='heart')){ctx.fillStyle='rgba(255,100,193,.17)';ctx.beginPath();ctx.arc(0,0,36,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=state.invulnerable>0?.78:1;
    ctx.strokeStyle='#ffc4dd';ctx.lineWidth=7;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-7,21);ctx.lineTo(-9+stride,33);ctx.moveTo(7,21);ctx.lineTo(9-stride,33);ctx.stroke();
    ctx.fillStyle='#ffc4dd';ctx.beginPath();ctx.arc(0,-19,13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ff6eae';ctx.beginPath();ctx.roundRect(-16,-8,32,32,10);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText('К',0,14);ctx.restore();
    for(const e of state.effects){
      const t=e.age/CONFIG.effectDuration,ex=roadX(e.lane,CONFIG.contactZ),ey=py;
      ctx.save();ctx.translate(ex,ey);ctx.scale(contact.scale,contact.scale);ctx.globalAlpha=1-t;
      if(e.kind==='heart'){
        ctx.font=`bold ${20+t*16}px system-ui`;ctx.fillStyle='#fff1fa';ctx.textAlign='center';ctx.shadowColor='#ff3ca5';ctx.shadowBlur=12;ctx.fillText('+1',22,-35-t*32);
        for(let i=0;i<6;i++){const angle=i*Math.PI/3;ctx.fillStyle=i%2?'#fff':'#ff69bc';ctx.beginPath();ctx.arc(Math.cos(angle)*(10+t*32),-12+Math.sin(angle)*(10+t*32),3*(1-t)+.5,0,Math.PI*2);ctx.fill();}
      }else{ctx.strokeStyle='#ff8b8b';ctx.lineWidth=5*(1-t);ctx.beginPath();ctx.arc(0,0,20+t*25,0,Math.PI*2);ctx.stroke();}
      ctx.restore();
    }
    if(DEBUG_MOTION){
      const item=parkLandmarks.find(o=>state.travel-o.distance>=0);
      const heartObject=state.objects.find(o=>o.kind==='heart');
      ctx.save();ctx.fillStyle='rgba(31,40,34,.8)';ctx.fillRect(8,height-76,Math.min(width-16,310),68);
      ctx.fillStyle='#fff';ctx.font='12px monospace';ctx.textAlign='left';
      ctx.fillText(`worldSpeed: ${speed().toFixed(3)} / worldDistance: ${state.travel.toFixed(2)}`,14,height-55);
      ctx.fillText(`heart z: ${heartObject?.z.toFixed(2)??'-'} / park z: ${item?(state.travel-item.distance).toFixed(2):'-'}`,14,height-36);
      ctx.fillText(`park objects: ${parkLandmarks.length}`,14,height-17);ctx.restore();
    }
    if(state.hitFlash>0){ctx.fillStyle=`rgba(255,95,108,${state.hitFlash*.24})`;ctx.fillRect(0,0,width,height);}
  }
  function frame(time){frameId=requestAnimationFrame(frame);if(lastTime===null){lastTime=time;render();return;}const dt=Math.min(CONFIG.maxDelta,Math.max(0,(time-lastTime)/1000));lastTime=time;if(state.mode==='playing')update(dt);render();}
  action.addEventListener('click',actionClick);document.querySelector('#left').addEventListener('click',()=>move(-1));document.querySelector('#right').addEventListener('click',()=>move(1));pauseButton.addEventListener('click',()=>{if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')resume();});document.querySelector('#restart').addEventListener('click',restart);
  window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight',' ','Escape'].includes(e.key))e.preventDefault();if(e.repeat)return;if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1);if(e.key==='Escape'||e.key===' '){if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')resume();}});
  stage.addEventListener('pointerdown',e=>{if(e.target!==canvas)return;swipeStart={x:e.clientX,y:e.clientY,id:e.pointerId};});stage.addEventListener('pointerup',e=>{if(!swipeStart||e.pointerId!==swipeStart.id)return;const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>28&&Math.abs(dx)>Math.abs(dy)*1.2)move(dx>0?1:-1);});stage.addEventListener('pointercancel',()=>swipeStart=null);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')setMode('paused');lastTime=null;});window.addEventListener('blur',()=>{if(state.mode==='playing')setMode('paused');lastTime=null;});window.addEventListener('resize',resize);resize();setMode('start');frameId=requestAnimationFrame(frame);
})();
