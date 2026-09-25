'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const sizes = {
    // USD retail prices as displayed in the supplied Ido Pricing Doc, Sheet1 D17:G17.
    '40x52.8': {w:40,h:52.8,cols:50,rows:66,inches:'15.7″ × 20.8″',price:129},
    '52.8x52.8': {w:52.8,h:52.8,cols:66,rows:66,inches:'20.8″ × 20.8″',price:177},
    '65.6x65.6': {w:65.6,h:65.6,cols:82,rows:82,inches:'25.8″ × 25.8″',price:282},
    '52.8x78.4': {w:52.8,h:78.4,cols:66,rows:98,inches:'20.8″ × 30.9″',price:282}
  };
  const dollars = price => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(price);
  function setupPricing(){
    const select=$('#portraitSize');
    select.replaceChildren(...Object.entries(sizes).map(([key,size])=>{
      const option=document.createElement('option');option.value=key;
      option.textContent=size.inches+' · '+dollars(size.price);option.selected=key===state.size;return option;
    }));
    $('#startingPrice').textContent='Keepsakes from '+dollars(Math.min(...Object.values(sizes).map(s=>s.price)))+' USD.';
  }
  const finishes = {walnut:'#785039',charcoal:'#292724',ivory:'#e7e0d4'};
  const samplePaths = {romance:'../assets/portrait-couple.jpg',family:'../assets/portrait-family.jpg',travel:'../assets/memory-travel.jpg',couple:'../assets/memory-couple-fireworks.jpg'};
  // Clockwise inner-aperture corners measured on the original room photographs.
  const rooms = [
    {key:'coffee',src:'../assets/room-coffee-v5.jpg',quad:[[.231260,.500797],[.294258,.499203],[.295853,.561404],[.232057,.562998]],border:.15,displayScale:2.65,native:'walnut',sample:'family',size:'52.8x52.8',category:'01 / THE COFFEE TABLE',title:'A little closer\nto your everyday.',description:'Beside the books you love and the cup you reach for. A familiar memory, right where life happens.',alt:'A family memory in brick art on a coffee table seen from across the living room, with sofa, rug and fireplace visible'},
    {key:'shelf',src:'../assets/room-shelf-v4.jpg',quad:[[.5439,.1563],[.7783,.1515],[.7719,.3939],[.5327,.3892]],border:.1,native:'charcoal',sample:'family',size:'52.8x52.8',category:'02 / THE ROTATING BOOKSHELF',title:'Among all\nyour good stories.',description:'A place on the bookshelf for family, friends and the stories you share. Something meaningful to discover with every turn.',alt:'A family brick portrait seen from across a sunlit corner, with the entire rotating bookshelf and surrounding room visible'},
    {key:'wall',src:'../assets/room-wall-v5.jpg',quad:[[.318979,.241627],[.445774,.252791],[.445774,.395534],[.318979,.394737]],border:.065,displayScale:1.65,native:'walnut',sample:'family',size:'52.8x52.8',category:'03 / THE WALL AT HOME',title:'A memory that\nmakes a room yours.',description:'Above the console, beside the front door. A small welcome home from the people you love.',alt:'A family memory in brick art above a walnut console, seen from farther down the hallway with the doorway and floor in view'}
  ];
  const state = {image:null,crop:{cx:.5,cy:.5,zoom:1},size:'52.8x52.8',finish:'walnut',view:'portrait',original:false,brighten:true,uploaded:false,sequence:0};
  const cache = new Map();
  let heroIndex=0,homeIndex=0,exportUrl=null,renderVersion=0,homeVersion=0,draft=null,lastFocus=null;
  const art=document.createElement('canvas');
  function imageFrom(src) {
    if(!cache.has(src)) cache.set(src,new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{cache.delete(src);reject(new Error('Image unavailable'));};image.src=src;
    }));
    return cache.get(src);
  }
  function status(message,error=false){$('#uploadStatus').textContent=message;$('#uploadStatus').classList.toggle('error',error);}
  function imageSize(image){return {w:image.naturalWidth||image.width,h:image.naturalHeight||image.height};}
  // A cover crop in source-image pixels. Store the centre so changing aspect ratios is predictable.
  function cropRect(image,crop,size){
    const {w,h}=imageSize(image),ratio=size.cols/size.rows;
    const baseW=Math.min(w,h*ratio),cw=baseW/crop.zoom,ch=cw/ratio;
    return {x:clamp(crop.cx*w-cw/2,0,w-cw),y:clamp(crop.cy*h-ch/2,0,h-ch),w:cw,h:ch};
  }
  function normalizeCrop(crop){
    const r=cropRect(state.image,crop,sizes[state.size]),d=imageSize(state.image);
    crop.cx=(r.x+r.w/2)/d.w;crop.cy=(r.y+r.h/2)/d.h;
  }
  function drawPhoto(ctx,image,crop,size,width,height){
    const r=cropRect(image,crop,size);
    ctx.fillStyle='#f7f3ed';ctx.fillRect(0,0,width,height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,r.x,r.y,r.w,r.h,0,0,width,height);
  }
  function liftLowLight(pixels,enabled){
    if(!enabled)return false;
    let total=0;
    for(let i=0;i<pixels.length;i+=4)total+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
    const mean=total/(pixels.length/4),strength=clamp((135-mean)/100,0,.55);
    if(strength<.01)return false;
    // Lift shadow luminance before choosing each solid brick colour; no added image detail.
    const gamma=1-strength*.6;
    for(let i=0;i<pixels.length;i+=4){
      const l=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
      const gain=l>0?Math.min(2,255*Math.pow(l/255,gamma)/l):1;
      for(let c=0;c<3;c++)pixels[i+c]=Math.round(clamp(pixels[i+c]*gain,0,255));
    }
    return true;
  }
  function mosaic(target,image,crop,size,original=false,brighten=state.brighten){
    // Integer pixels per physical cell ensure every 8 mm stud is round, even in a rectangle.
    const cell=32;target.width=size.cols*cell;target.height=size.rows*cell;
    const ctx=target.getContext('2d');
    if(original){drawPhoto(ctx,image,crop,size,target.width,target.height);return;}
    // Oversample the crop before averaging each physical brick. Do not invent extra bricks.
    const sampling=document.createElement('canvas');sampling.width=size.cols*4;sampling.height=size.rows*4;
    drawPhoto(sampling.getContext('2d'),image,crop,size,sampling.width,sampling.height);
    const small=document.createElement('canvas');small.width=size.cols;small.height=size.rows;
    const p=small.getContext('2d',{willReadFrequently:true});
    p.imageSmoothingEnabled=true;p.imageSmoothingQuality='high';p.drawImage(sampling,0,0,size.cols,size.rows);
    const pixels=p.getImageData(0,0,size.cols,size.rows).data;
    const lifted=liftLowLight(pixels,brighten);
    const luminance=(x,y)=>{const i=(clamp(y,0,size.rows-1)*size.cols+clamp(x,0,size.cols-1))*4;return pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;};
    ctx.fillStyle='#262522';ctx.fillRect(0,0,target.width,target.height);
    for(let y=0;y<size.rows;y++)for(let x=0;x<size.cols;x++){
      const i=(y*size.cols+x)*4,px=x*cell,py=y*cell;
      // Mild, bounded luminance sharpening preserves eyes and lips without shifting skin hue.
      const l=luminance(x,y),blur=(l*4+luminance(x-1,y)+luminance(x+1,y)+luminance(x,y-1)+luminance(x,y+1))/8;
      const detail=clamp((l-blur)*1.6,-20,20);
      const colour=[pixels[i],pixels[i+1],pixels[i+2]].map(v=>Math.round(clamp(v+detail,0,255)));
      // Closely packed caps and quiet relief match the supplied finished-product references.
      ctx.fillStyle='rgb('+colour.join(',')+')';ctx.beginPath();ctx.arc(px+16,py+16,15.7,0,Math.PI*2);ctx.fill();
      ctx.lineWidth=.65;ctx.strokeStyle='rgba(255,255,255,.14)';ctx.beginPath();ctx.arc(px+16,py+16,15.1,Math.PI*1.05,Math.PI*1.85);ctx.stroke();
      ctx.strokeStyle='rgba(0,0,0,.14)';ctx.beginPath();ctx.arc(px+16,py+16,15.2,.05,Math.PI*.86);ctx.stroke();
    }
    return lifted;
  }
  function product(ctx,portrait,finish){
    const cw=ctx.canvas.width,ch=ctx.canvas.height,scale=Math.min(cw*.86/portrait.width,ch*.88/portrait.height);
    const w=portrait.width*scale,h=portrait.height*scale,x=(cw-w)/2,y=(ch-h)/2,b=cw*.013;
    ctx.fillStyle='#e7ddd1';ctx.fillRect(0,0,cw,ch);
    ctx.save();ctx.shadowColor='#2b1c1540';ctx.shadowBlur=26;ctx.shadowOffsetX=10;ctx.shadowOffsetY=14;ctx.fillStyle=finishes[finish];ctx.fillRect(x-b,y-b,w+b*2,h+b*2);ctx.restore();
    const displayScale=Math.min(1,(ctx.canvas.clientWidth||cw)/cw)*(window.devicePixelRatio||1);
    const filtered=roomTexture(portrait,w*Math.min(1,displayScale));
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(filtered,x,y,w,h);ctx.strokeStyle='#ffffff30';ctx.lineWidth=2;ctx.strokeRect(x-b+2,y-b+2,w+b*2-4,h+b*2-4);
  }
  // Project a flat portrait into the photographed frame plane, including perspective.
  function plane(quad){
    const [p0,p1,p2,p3]=quad;
    const dx1=p1[0]-p2[0],dx2=p3[0]-p2[0],dx3=p0[0]-p1[0]+p2[0]-p3[0];
    const dy1=p1[1]-p2[1],dy2=p3[1]-p2[1],dy3=p0[1]-p1[1]+p2[1]-p3[1];
    const denominator=dx1*dy2-dx2*dy1;
    const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
    const a=p1[0]-p0[0]+g*p1[0],b=p3[0]-p0[0]+h*p3[0];
    const d=p1[1]-p0[1]+g*p1[1],e=p3[1]-p0[1]+h*p3[1];
    return (u,v)=>[(a*u+b*v+p0[0])/(g*u+h*v+1),(d*u+e*v+p0[1])/(g*u+h*v+1)];
  }
  function textureTriangle(ctx,image,source,destination){
    const [s0,s1,s2]=source,[t0,t1,t2]=destination;
    const sx1=s1[0]-s0[0],sy1=s1[1]-s0[1],sx2=s2[0]-s0[0],sy2=s2[1]-s0[1];
    const tx1=t1[0]-t0[0],ty1=t1[1]-t0[1],tx2=t2[0]-t0[0],ty2=t2[1]-t0[1],det=sx1*sy2-sx2*sy1;
    const a=(tx1*sy2-tx2*sy1)/det,b=(ty1*sy2-ty2*sy1)/det,c=(tx2*sx1-tx1*sx2)/det,d=(ty2*sx1-ty1*sx2)/det;
    ctx.save();ctx.beginPath();
    // Small overlap removes antialias hairlines between adjacent texture triangles.
    const centre=[(t0[0]+t1[0]+t2[0])/3,(t0[1]+t1[1]+t2[1])/3];
    destination.forEach((p,i)=>{const length=Math.hypot(p[0]-centre[0],p[1]-centre[1]),k=1+.6/length;const x=centre[0]+(p[0]-centre[0])*k,y=centre[1]+(p[1]-centre[1])*k;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,t0[0]-a*s0[0]-c*s0[1],t0[1]-b*s0[0]-d*s0[1]);ctx.drawImage(image,0,0);ctx.restore();
  }
  function warp(ctx,image,sourceMap,targetMap){
    const steps=16;
    ctx.save();ctx.beginPath();[[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const p=targetMap(u,v);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.clip();
    for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
      const uv=[[x/steps,y/steps],[(x+1)/steps,y/steps],[(x+1)/steps,(y+1)/steps],[x/steps,(y+1)/steps]];
      const s=uv.map(p=>sourceMap(...p)),t=uv.map(p=>targetMap(...p));
      textureTriangle(ctx,image,[s[0],s[1],s[2]],[t[0],t[1],t[2]]);
      textureTriangle(ctx,image,[s[0],s[2],s[3]],[t[0],t[2],t[3]]);
    }ctx.restore();
  }
  function roomTexture(portrait,pixelWidth){
    // Area-filter the actual brick artwork before shrinking it into a distant frame.
    // This avoids aliasing of the stud grid without substituting the original photograph.
    let source=portrait;
    const target=Math.max(1,Math.min(portrait.width,Math.ceil(pixelWidth)));
    while(source.width>target*2){
      const half=document.createElement('canvas');half.width=Math.round(source.width/2);half.height=Math.round(source.height/2);
      const ctx=half.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,half.width,half.height);source=half;
    }
    const result=document.createElement('canvas');result.width=target;result.height=Math.max(1,Math.round(target*portrait.height/portrait.width));
    const ctx=result.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,result.width,result.height);return result;
  }
  function angledRoom(ctx,room,image,portrait,finish){
    const width=ctx.canvas.width,height=ctx.canvas.height;
    const camera=room.camera||[0,0,1],screen=p=>[(p[0]-camera[0])/camera[2]*width,(p[1]-camera[1])/camera[2]*height];
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,camera[0]*image.width,camera[1]*image.height,camera[2]*image.width,camera[2]*image.height,0,0,width,height);
    const innerMap=plane(room.quad),margin=room.border,outerSize=1+margin*2;
    const map=(u,v)=>innerMap(u*outerSize-margin,v*outerSize-margin),border=margin/outerSize;
    const ratio=portrait.width/portrait.height,displayScale=room.displayScale||1;
    const p0=screen(room.quad[0]),p1=screen(room.quad[1]),p2=screen(room.quad[2]),p3=screen(room.quad[3]);
    const viewingScale=Math.min(1,(ctx.canvas.clientWidth||width)/width);
    portrait=roomTexture(portrait,Math.max(Math.hypot(p1[0]-p0[0],p1[1]-p0[1]),Math.hypot(p2[0]-p3[0],p2[1]-p3[1]))*displayScale*viewingScale);
    if(Math.abs(ratio-1)<.001&&displayScale===1){
      if(finish!==room.native){
        ctx.save();ctx.beginPath();
        [map,innerMap].forEach(mapping=>{[[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const p=screen(mapping(u,v));i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();});
        ctx.clip('evenodd');ctx.globalAlpha=finish==='ivory'?.86:.70;ctx.fillStyle=finishes[finish];ctx.fillRect(0,0,width,height);ctx.restore();
      }
      warp(ctx,portrait,(u,v)=>[u*portrait.width,v*portrait.height],(u,v)=>screen(innerMap(u,v)));
      return;
    }
    if(!room.frameTexture){
      const texture=document.createElement('canvas');texture.width=1000;texture.height=1000;
      warp(texture.getContext('2d'),image,(u,v)=>{const p=map(u,v);return [p[0]*image.width,p[1]*image.height];},(u,v)=>[u*1000,v*1000]);
      room.frameTexture=texture;
    }
    const pad=Math.round(border*1600),inner=1600-pad*2;
    const framed=document.createElement('canvas');framed.width=1600;framed.height=Math.round(inner/ratio)+pad*2;
    const f=framed.getContext('2d'),src=[0,border*1000,(1-border)*1000,1000];
    const dx=[0,pad,1600-pad,1600],dy=[0,pad,framed.height-pad,framed.height];
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      if(row===1&&col===1)continue;
      f.drawImage(room.frameTexture,src[col],src[row],src[col+1]-src[col],src[row+1]-src[row],dx[col],dy[row],dx[col+1]-dx[col],dy[row+1]-dy[row]);
    }
    if(finish!==room.native){
      f.save();f.beginPath();f.rect(0,0,framed.width,framed.height);f.rect(pad,pad,inner,framed.height-pad*2);f.clip('evenodd');
      f.globalCompositeOperation='source-atop';f.globalAlpha=finish==='ivory'?.86:.70;f.fillStyle=finishes[finish];f.fillRect(0,0,framed.width,framed.height);f.restore();
    }
    f.drawImage(portrait,pad,pad,inner,framed.height-pad*2);
    f.strokeStyle='#21170d50';f.lineWidth=2;f.strokeRect(pad,pad,inner,framed.height-pad*2);
    // Keep standing frames resting on the same surface; wall frames stay on their centre.
    const vertical=framed.height/framed.width,offset=room.key==='wall'?(1-vertical)/2:1-vertical;
    const anchor=room.key==='wall'?.5:1;
    warp(ctx,framed,(u,v)=>[u*framed.width,v*framed.height],(u,v)=>screen(map(.5+(u-.5)*displayScale,anchor+(offset+v*vertical-anchor)*displayScale)));
  }
  function roomComposite(ctx,room,image,portrait,finish){angledRoom(ctx,room,image,portrait,finish);}
  function updateSize(){
    const s=sizes[state.size];
    $('#brickSummary').textContent='Estimated '+s.cols+' × '+s.rows+' grid · '+(s.cols*s.rows).toLocaleString()+' round bricks';
    $('#dimensionsSummary').textContent=s.inches+' · '+s.w+' × '+s.h+' cm · 8 mm bricks';
    $('#portraitPrice').textContent=dollars(s.price);
    $('#priceSize').textContent=s.inches+' · '+s.w+' × '+s.h+' cm';
  }
  async function render(){
    if(!state.image)return;
    const version=++renderVersion,view=state.view,finish=state.finish;
    const lifted=mosaic(art,state.image,state.crop,sizes[state.size],state.original);
    const canvas=$('#previewCanvas'),ctx=canvas.getContext('2d');
    canvas.setAttribute('aria-label',(state.original?'Original photo':'Round-brick keepsake')+' in '+(view==='portrait'?'portrait view':view+' setting'));
    $('#previewNote').textContent=view==='portrait'?'8 mm round bricks · Photo-matched colour simulation, not a confirmed brick palette.':'Styled room mockup · Artwork proportions preserved; furniture and room scale are illustrative.';
    if(lifted)$('#previewNote').textContent+=' Low-light colours brightened.';
    updateSize();
    if(view==='portrait'){product(ctx,art,finish);return;}
    try{const room=rooms.find(r=>r.key===view),image=await imageFrom(room.src);if(version!==renderVersion)return;roomComposite(ctx,room,image,art,finish);}
    catch{if(version===renderVersion){product(ctx,art,finish);$('#previewNote').textContent='Room image unavailable. Your artwork preview is still ready.';}}
  }
  function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));render();}
  function setOriginal(value){state.original=value;$('#originalToggle').setAttribute('aria-pressed',String(value));$('#originalToggle').textContent=value?'Back to brick artwork':'Compare original photo';render();}
  async function sample(name){
    const token=++state.sequence;status('Preparing your preview…');$('#dropzone').removeAttribute('aria-busy');
    try{const image=await imageFrom(samplePaths[name]);if(token!==state.sequence)return;state.image=image;state.crop={cx:.5,cy:.5,zoom:1};state.uploaded=false;setOriginal(false);status('Example '+({travel:'travel',couple:'couple',romance:'couple',family:'family'}[name]||'shared')+' memory. Try your own photo to see its detail.');}
    catch{if(token===state.sequence)status('The example could not load. Please upload your own photo.',true);}
  }
  async function upload(file){
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){status('Please choose a JPG, PNG or WebP photo.',true);$('#photoInput').value='';return;}
    if(file.size>15*1024*1024){status('Please choose a photo under 15 MB.',true);$('#photoInput').value='';return;}
    const token=++state.sequence,url=URL.createObjectURL(file);
    $('#dropzone').setAttribute('aria-busy','true');status('Preparing your photo…');
    try{
      const image=await imageFrom(url);if(token!==state.sequence)return;
      if(image.width*image.height>60000000)throw new Error('large');
      const bounded=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(image.width,image.height));bounded.width=Math.round(image.width*scale);bounded.height=Math.round(image.height*scale);
      const ctx=bounded.getContext('2d');ctx.fillStyle='#f7f3ed';ctx.fillRect(0,0,bounded.width,bounded.height);ctx.drawImage(image,0,0,bounded.width,bounded.height);
      state.image=bounded;state.uploaded=true;state.crop={cx:.5,cy:.5,zoom:1};setOriginal(false);
      status(file.name+' · Ready to frame. Your photo stays on this device.');openCrop();
    }catch(error){if(token===state.sequence)status(error.message==='large'?'Please resize the photo to under 60 megapixels.':'We couldn’t read that photo. Please try another JPG or PNG.',true);}
    finally{URL.revokeObjectURL(url);cache.delete(url);if(token===state.sequence){$('#dropzone').removeAttribute('aria-busy');$('#photoInput').value='';}}
  }
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let heroTimer=null,heroPaused=true,heroHovered=false,heroFocused=false;
  function scheduleHero(){
    clearTimeout(heroTimer);
    const stopped=heroPaused||heroHovered||heroFocused||document.hidden;
    $('#heroPlayback').textContent=heroPaused?'Play':'Pause';
    $('#heroPlayback').setAttribute('aria-label',heroPaused?'Play automatic memory stories':'Pause automatic memory stories');
    $('#heroCount').setAttribute('aria-live',stopped?'polite':'off');
    const nextImage=$$('[data-hero-slide]')[(heroIndex+1)%$$('[data-hero-slide]').length]?.querySelector('img');
    if(nextImage)nextImage.loading='eager';
    if(!stopped)heroTimer=setTimeout(()=>hero(heroIndex+1),6000);
  }
  function hero(index){
    const count=$$('[data-hero-slide]').length; heroIndex=(index+count)%count;
    $$('[data-hero-slide]').forEach((s,i)=>s.hidden=i!==heroIndex);
    $$('[data-hero]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.hero)===heroIndex)));
    $('#heroCount').textContent='0'+(heroIndex+1)+' / 0'+count;
    scheduleHero();
  }
  async function home(index){
    homeIndex=(index+rooms.length)%rooms.length;const room=rooms[homeIndex],version=++homeVersion;
    $('#homeCategory').textContent=room.category;$('#homeTitle').textContent=room.title;$('#homeDescription').textContent=room.description;$('#homeCount').textContent=(homeIndex+1)+' / 3';
    $$('[data-home]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.home)===homeIndex)));
    try{
      const [image,photo]=await Promise.all([imageFrom(room.src),imageFrom(samplePaths[room.sample])]);if(version!==homeVersion)return;
      const tile=document.createElement('canvas');mosaic(tile,photo,{cx:.5,cy:.5,zoom:1},sizes[room.size]);
      roomComposite($('#homeCanvas').getContext('2d'),room,image,tile,room.native);$('#homeCanvas').setAttribute('aria-label',room.alt);
    }catch{if(version===homeVersion)$('#homeDescription').textContent='This room image couldn’t load. Please refresh to see it.';}
  }
  function swipe(element,next,prev){
    let start=null;
    element.addEventListener('pointerdown',e=>{if(e.target.closest('button,a'))return;start={x:e.clientX,y:e.clientY};});
    element.addEventListener('pointerup',e=>{if(!start)return;const x=e.clientX-start.x,y=e.clientY-start.y;start=null;if(Math.abs(x)>50&&Math.abs(x)>Math.abs(y)*1.5)(x<0?next:prev)();});
    element.addEventListener('pointercancel',()=>start=null);
  }
  function drawCrop(){
    if(!draft)return;normalizeCrop(draft);
    const s=sizes[state.size],canvas=$('#cropCanvas');canvas.width=s.cols*10;canvas.height=s.rows*10;
    drawPhoto(canvas.getContext('2d'),state.image,draft,s,canvas.width,canvas.height);
    $('#zoomValue').textContent=Math.round(draft.zoom*100)+'%';$('#zoomOut').disabled=draft.zoom<=1;$('#zoomIn').disabled=draft.zoom>=4;
  }
  function openCrop(){
    if(!state.image)return;
    lastFocus=document.activeElement;draft={...state.crop};const s=sizes[state.size];
    const vp=$('#cropViewport');vp.style.aspectRatio=s.cols+'/'+s.rows;vp.style.width='min(100%, '+Math.round(Math.min(390,390*s.cols/s.rows))+'px)';
    $('#cropSizeLabel').textContent=s.inches;$('#cropDialog').showModal();document.body.classList.add('crop-open');drawCrop();vp.focus();
  }
  function closeCrop(apply=false){
    if(apply&&draft){state.crop={...draft};render();}
    $('#cropDialog').close();draft=null;pointers.clear();document.body.classList.remove('crop-open');lastFocus?.focus();
  }
  function zoom(delta){if(!draft)return;draft.zoom=clamp(draft.zoom+delta,1,4);drawCrop();}
  const pointers=new Map();let lastPinch=null;
  const viewport=$('#cropViewport');
  viewport.addEventListener('pointerdown',e=>{
    if(!draft)return;e.preventDefault();viewport.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.classList.add('dragging');lastPinch=null;
  });
  viewport.addEventListener('pointermove',e=>{
    if(!draft||!pointers.has(e.pointerId))return;e.preventDefault();
    const before=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size>=2){const [a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);if(lastPinch){draft.zoom=clamp(draft.zoom*distance/lastPinch,1,4);drawCrop();}lastPinch=distance;return;}
    const bounds=viewport.getBoundingClientRect(),r=cropRect(state.image,draft,sizes[state.size]),d=imageSize(state.image);
    draft.cx-=(e.clientX-before.x)/bounds.width*r.w/d.w;draft.cy-=(e.clientY-before.y)/bounds.height*r.h/d.h;drawCrop();
  });
  function pointerEnd(e){pointers.delete(e.pointerId);lastPinch=null;if(!pointers.size)viewport.classList.remove('dragging');}
  ['pointerup','pointercancel','lostpointercapture'].forEach(event=>viewport.addEventListener(event,pointerEnd));
  viewport.addEventListener('wheel',e=>{if(!draft)return;e.preventDefault();zoom(-Math.sign(e.deltaY)*.08);},{passive:false});
  viewport.addEventListener('keydown',e=>{
    if(!draft)return;const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'];if(!keys.includes(e.key))return;e.preventDefault();
    if(e.key==='+'||e.key==='=')return zoom(.1);if(e.key==='-')return zoom(-.1);
    const step=(e.shiftKey?.04:.01)/draft.zoom;
    if(e.key==='ArrowLeft')draft.cx+=step;if(e.key==='ArrowRight')draft.cx-=step;if(e.key==='ArrowUp')draft.cy+=step;if(e.key==='ArrowDown')draft.cy-=step;drawCrop();
  });
  async function download(){
    if(!state.image)return;const button=$('#download');button.disabled=true;
    try{
      await render();
      const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=2120;const ctx=canvas.getContext('2d');ctx.fillStyle='#fffaf4';ctx.fillRect(0,0,2000,2120);
      // Re-render the product at export resolution rather than enlarging the screen-filtered image.
      let exportPreview=$('#previewCanvas');
      if(state.view==='portrait'){exportPreview=document.createElement('canvas');exportPreview.width=2000;exportPreview.height=2000;product(exportPreview.getContext('2d'),art,state.finish);}
      ctx.drawImage(exportPreview,0,0,2000,2000);
      ctx.fillStyle='#642439';ctx.font='italic 54px Georgia';ctx.fillText('Ido',50,2077);ctx.font='26px Arial';ctx.fillText(sizes[state.size].inches+' · 8 mm round bricks · Illustrative preview',200,2072);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('export');
      if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=exportUrl;a.download='ido-'+state.size+'-'+state.view+'.png';a.textContent='Download PNG';a.style.textDecoration='underline';
      status('Your preview is ready. ');$('#uploadStatus').append(a);a.click();
    }catch{status('The preview could not be saved. Please try again.',true);}finally{button.disabled=false;}
  }
  $('#heroPrev').addEventListener('click',()=>hero(heroIndex-1));$('#heroNext').addEventListener('click',()=>hero(heroIndex+1));
  $('#heroPlayback').addEventListener('click',()=>{heroPaused=!heroPaused;scheduleHero();});
  $('.hero-carousel').addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){heroHovered=true;scheduleHero();}});
  $('.hero-carousel').addEventListener('pointerleave',()=>{heroHovered=false;scheduleHero();});
  $('.hero-carousel').addEventListener('focusin',()=>{heroFocused=true;scheduleHero();});
  $('.hero-carousel').addEventListener('focusout',e=>{heroFocused=$('.hero-carousel').contains(e.relatedTarget);scheduleHero();});
  document.addEventListener('visibilitychange',scheduleHero);
  reducedMotion.addEventListener('change',e=>{heroPaused=e.matches;scheduleHero();});
  $$('[data-hero]').forEach(b=>b.addEventListener('click',()=>hero(Number(b.dataset.hero))));
  swipe($('.hero-carousel'),()=>hero(heroIndex+1),()=>hero(heroIndex-1));
  $('#homePrev').addEventListener('click',()=>home(homeIndex-1));$('#homeNext').addEventListener('click',()=>home(homeIndex+1));
  $$('[data-home]').forEach(b=>b.addEventListener('click',()=>home(Number(b.dataset.home))));
  swipe($('.home-stage'),()=>home(homeIndex+1),()=>home(homeIndex-1));
  $('#tryHome').addEventListener('click',()=>setView(rooms[homeIndex].key));
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $$('[data-finish]').forEach(b=>b.addEventListener('click',()=>{state.finish=b.dataset.finish;$$('[data-finish]').forEach(s=>s.setAttribute('aria-pressed',String(s===b)));render();}));
  $$('[data-example]').forEach(b=>b.addEventListener('click',()=>sample(b.dataset.example)));
  $$('[data-audience]').forEach(b=>b.addEventListener('click',()=>{if(!state.uploaded)sample(b.dataset.audience);}));
  $('#portraitSize').addEventListener('change',e=>{state.size=e.target.value;updateSize();if(state.image)normalizeCrop(state.crop);render();});
  $('#openCrop').addEventListener('click',openCrop);$('#cropFromPreview').addEventListener('click',openCrop);
  $('#closeCrop').addEventListener('click',()=>closeCrop());$('#cancelCrop').addEventListener('click',()=>closeCrop());$('#applyCrop').addEventListener('click',()=>closeCrop(true));
  $('#cropDialog').addEventListener('cancel',e=>{e.preventDefault();closeCrop();});
  $('#zoomIn').addEventListener('click',()=>zoom(.15));$('#zoomOut').addEventListener('click',()=>zoom(-.15));$('#resetCrop').addEventListener('click',()=>{draft={cx:.5,cy:.5,zoom:1};drawCrop();});
  $('#originalToggle').addEventListener('click',()=>setOriginal(!state.original));$('#download').addEventListener('click',download);
  $('#brightenPhoto').addEventListener('change',e=>{state.brighten=e.target.checked;render();});
  $('#photoInput').addEventListener('change',e=>upload(e.target.files[0]));
  $('#dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#photoInput').click();}});
  ['dragenter','dragover'].forEach(event=>$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.add('dragging');}));
  ['dragleave','drop'].forEach(event=>$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragging');if(event==='drop')upload(e.dataTransfer.files[0]);}));
  document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{render();home(homeIndex);},180);});
  setupPricing();updateSize();sample('family');home(1);scheduleHero();
})();
