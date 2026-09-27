import {writeFile,readFile} from 'node:fs/promises';
async function performCombat(page,directory){
 const refArg=process.argv.find(arg=>arg.startsWith('--combat-target-ref='));
 const targetRef=refArg?Number(refArg.split('=')[1]):null;
 if(targetRef!==null&&(!Number.isSafeInteger(targetRef)||targetRef<=0))throw Error('Invalid combat target reference');
 const target=await page.evaluate(targetRef=>{
  const root=globalThis.__worldProbeRoot,game=root.gameplay();
  return (globalThis.__facingActors??[]).map(a=>root.entity(a.gid)).filter(e=>e?.kind==='monster'&&(targetRef===null||e.refObjId===targetRef)&&e.appearanceState?.[0]!==2&&e.regionId===game.pose.regionId).map(e=>({...e,distance:Math.hypot(e.x-game.pose.x,e.z-game.pose.z)})).sort((a,b)=>a.distance-b.distance)[0];
 },targetRef);
 if(!target||target.distance>1200)throw Error('No nearby live monster in the scratch fixture: '+JSON.stringify(target));
 await writeFile(`${directory}/combat-target.json`,JSON.stringify(target,null,2));
 const destination=await page.evaluate(target=>{const p=globalThis.__worldProbeRoot.gameplay().pose,d=Math.hypot(p.x-target.x,p.z-target.z);return {...p,x:target.x+(p.x-target.x)/d*20,z:target.z+(p.z-target.z)/d*20};},target);
 await page.evaluate(destination=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'move',destination}}),destination);
 await page.waitForFunction(gid=>{const r=globalThis.__worldProbeRoot,p=r.gameplay().pose,e=r.entity(gid);return e&&Math.hypot(e.x-p.x,e.z-p.z)<35;},target.gid,{timeout:90000});
 // Halt approach before sampling a coherent rendered pose/camera.
 await page.evaluate(()=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'cancel'}}));
 await page.waitForTimeout(500);

 // Frame the scratch target through production camera input before picking.
 const turn=await page.evaluate(gid=>{const r=globalThis.__worldProbeRoot,p=r.gameplay().pose,e=r.entity(gid),camera=globalThis.__worldProbeCamera,rect=document.querySelector('canvas').getBoundingClientRect();if(!e||!camera?.follow)throw Error('Missing combat camera/target');const desired=Math.atan2(e.x-p.x,e.z-p.z)+Math.PI,delta=Math.atan2(Math.sin(desired-camera.follow.yaw),Math.cos(desired-camera.follow.yaw));return {dy:(.8-camera.follow.pitch)/.005,zoom:(40-camera.follow.distance)*20/1.2,dx:delta/.005,width:rect.width,x:rect.x,y:rect.y+rect.height*.45};},target.gid);
 const startX=turn.x+(turn.dx>0?80:turn.width-80);await page.mouse.move(startX,turn.y);await page.mouse.down({button:'right'});
 try{await page.mouse.move(startX+turn.dx,turn.y+turn.dy,{steps:20});}finally{await page.mouse.up({button:'right'});}
 await page.mouse.wheel(0,turn.zoom);
 await page.waitForTimeout(250);
 const projected=await page.evaluate(gid=>{
  const actor=globalThis.__facingActors.find(a=>a.gid===gid),rect=document.querySelector('canvas').getBoundingClientRect(),view=globalThis.__combatView,m=view.matrix;
  if(!actor)throw Error('Target has no rendered model');
  const a=actor.pose,x=a.x+((a.regionId&255)-(view.origin&255))*1920,z=a.z+((a.regionId>>>8)-(view.origin>>>8))*1920,checked=[];
  for(const y of [10,5,15,2,20,25,30]){
   const wy=a.y+y,w=m[3]*x+m[7]*wy+m[11]*z+m[15];if(w<=0)continue;
   const px=(1+(m[0]*x+m[4]*wy+m[8]*z+m[12])/w)*rect.width/2,py=(1-(m[1]*x+m[5]*wy+m[9]*z+m[13])/w)*rect.height/2;
   for(const dx of [0,-5,5,-10,10,-20,20]){
    const point=[px+dx,py];if(point[0]<0||point[1]<0||point[0]>=rect.width||point[1]>=rect.height)continue;
    const hit=globalThis.__combatRenderer.pickEntity(point[0]/rect.width,point[1]/rect.height,globalThis.__worldProbeRoot.gameplay().localGid);checked.push({point,hit});
    if(hit===gid)return {point:[point[0]+rect.x,point[1]+rect.y],checked,actor};
   }
  }
  return {checked,actor,view};
 },target.gid);
 await writeFile(`${directory}/combat-pick.json`,JSON.stringify(projected,null,2));
 if(!projected.point)throw Error('Monster is not verified under the rendered cursor');
 const point=projected.point;
 await page.mouse.move(...point);await page.screenshot({path:`${directory}/hover.png`});
 await page.evaluate(gid=>{const local=globalThis.__worldProbeRoot.gameplay().localGid;globalThis.__combatWatch={frames:0,badFrames:0,failures:[],actors:globalThis.__facingActors.filter(a=>a.gid===gid||a.gid===local).map(a=>({gid:a.gid,model:a.model}))};},target.gid);
 const startingHp=await page.evaluate(()=>{const g=globalThis.__worldProbeRoot.gameplay();return g.vitals.find(v=>v.gid===g.localGid)?.hp;});
 if(!Number.isFinite(startingHp)||startingHp<=30)throw Error('Combat fixture needs more than 30 current HP');
 await page.evaluate(gid=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'attack',gid}}),target.gid);
 const fatalProbe=process.argv.includes('--combat-fatal');
 if(fatalProbe){await page.waitForFunction(()=>{const g=globalThis.__worldProbeRoot.gameplay();return g.casts.some(c=>c.caster===g.localGid);},null,{timeout:10000});await page.evaluate(()=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'cancel'}}));}
 const samples=[],deadline=Date.now()+(fatalProbe?60000:10000);
 for(let i=0;i<(fatalProbe?240:40)&&Date.now()<deadline;i++){
  samples.push(await page.evaluate(gid=>{const r=globalThis.__worldProbeRoot,g=r.gameplay();return {at:performance.now(),damage:globalThis.__combatDamageText,presentationError:globalThis.__combatPresentationError,effects:(globalThis.__facingActors??[]).filter(a=>a.gid<0),localLife:r.entity(g.localGid)?.appearanceState?.[0],game:{localGid:g.localGid,pose:g.pose,casts:g.casts,vitals:g.vitals,error:g.error,inventory:g.inventory,skills:g.skills},target:r.entity(gid),actors:(globalThis.__facingActors??[]).filter(a=>a.gid===gid||a.gid===g.localGid),cursor:document.documentElement.dataset.sroWorldCursor};},target.gid));
  const hp=samples.at(-1).game.vitals?.find(v=>v.gid===samples.at(-1).game.localGid);if(fatalProbe?samples.at(-1).localLife===2&&hp?.hp===0:hp?.hp!==undefined&&hp.hp<Math.max(30,startingHp*.6))break;
  if(i%10===0)await page.screenshot({path:`${directory}/combat-${i}.png`});
  await page.waitForTimeout(250);
 }
 const tokens=new Set(samples.flatMap(s=>s.game.casts.filter(c=>c.caster===s.game.localGid).map(c=>c.token)));
 const resources=await page.evaluate(()=>globalThis.__combatResources??[]);await writeFile(`${directory}/combat-resources.json`,JSON.stringify(resources,null,2));
 const continuity=await page.evaluate(()=>{const result=globalThis.__combatWatch;globalThis.__combatWatch=null;return result;});
 const hpTimeline=await page.evaluate(()=>globalThis.__combatHpTimeline??[]);
 const hpWitnesses=hpTimeline.filter(e=>e.kind==='impact'&&e.gid===e.localGid&&e.impact.damage>0).map(e=>{const queued=hpTimeline.find(q=>q.kind==='ingress'&&q.event.kind==='hp-result'&&q.event.key===e.key);return {...e,queuedAt:queued?.at,queuedHp:queued?.hp,waitMs:queued?e.at-queued.at:null};});
 await writeFile(`${directory}/combat-hp-timing.json`,JSON.stringify({timeline:hpTimeline,witnesses:hpWitnesses},null,2));
 const result={hpWitnesses,target,point,continuity,inputAdapter:'verified-pick -> gameplay attack command',samples,castTokens:[...tokens]};await writeFile(`${directory}/combat-result.json`,JSON.stringify(result,null,2));if(process.argv.includes('--require-hp-timing')&&!hpWitnesses.some(e=>e.waitMs>0&&e.before>e.after&&e.queuedHp===e.before))throw Error('No live incoming hit proved HP was retained until the impact callback');const presentationErrors=[...new Set(samples.map(s=>s.presentationError).filter(Boolean))];if(presentationErrors.length)throw Error('Combat presentation failed: '+presentationErrors.join('; '));if(process.argv.includes('--require-hit-effects')&&!samples.some(s=>s.effects?.some(a=>a.model.includes('hiteffect'))))throw Error('No rendered hit effect in the combat window');if(fatalProbe){if(!hpWitnesses.some(e=>e.impact.fatal)||!samples.some(s=>s.localLife===2))throw Error('Lethal incoming result and native LIFE transition were not both observed');}else if(tokens.size<2)throw Error('Combat probe did not observe repeated local attacks');if(continuity.badFrames)throw Error('Combat actors disappeared or changed appearance: '+JSON.stringify(continuity));return result;
}

async function restoreAlive(page){
 const dead=await page.evaluate(()=>{const r=globalThis.__worldProbeRoot,g=r.gameplay();return r.entity(g.localGid)?.appearanceState?.[0]===2;});
 if(!dead)return;
 await page.evaluate(()=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'rebirth',choice:2}}));
 await page.waitForFunction(()=>{const r=globalThis.__worldProbeRoot,g=r.gameplay();return r.entity(g.localGid)?.appearanceState?.[0]===1;},{},{timeout:15000});
}
export async function probeCombat(page,directory){
 await restoreAlive(page);
 const current=await page.evaluate(()=>globalThis.__worldProbeRoot.gameplay().pose);
 const original=process.env.SRO_COMBAT_RESTORE_CHECKPOINT?JSON.parse(await readFile(process.env.SRO_COMBAT_RESTORE_CHECKPOINT,'utf8')):current;
 if(!Number.isInteger(original.regionId)||![original.x,original.y,original.z,original.angle].every(Number.isFinite))throw Error('Invalid scratch restoration checkpoint');
 await writeFile(`${directory}/combat-checkpoint.json`,JSON.stringify(original,null,2));
 const routeArg=process.argv.find(v=>v.startsWith('--combat-route='));
 const route=routeArg?JSON.parse(await readFile(routeArg.slice('--combat-route='.length),'utf8')):[];
 if(!Array.isArray(route)||route.length>8||route.some(p=>!Number.isInteger(p.regionId)||p.regionId<256||p.regionId>=0x7f00||![p.x,p.y,p.z].every(Number.isFinite)))throw Error('Invalid bounded combat walking route');
 const equipArg=process.argv.find(v=>v.startsWith('--combat-equip-slot='));
 const equipSlot=equipArg?Number(equipArg.split('=')[1]):null;let equipped=false;
 if(equipSlot!==null&&(!Number.isInteger(equipSlot)||equipSlot<13||equipSlot>255))throw Error('Invalid combat equipment source slot');
 const reached=[];
 async function swap(source,destination){const before=await page.evaluate(source=>globalThis.__worldProbeRoot.gameplay().inventory.find(i=>i.slot===source)?.refObjId,source);if(!before)throw Error('Combat equipment source empty');await page.evaluate(({source,destination})=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'inventory-move',source,destination,quantity:1}}),{source,destination});await page.waitForFunction(({destination,before})=>{const g=globalThis.__worldProbeRoot.gameplay();return !g.inventoryPending&&g.inventory.find(i=>i.slot===destination)?.refObjId===before;},{destination,before},{timeout:10000});}

 async function walk(destination){await page.evaluate(destination=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'move',destination}}),destination);await page.waitForFunction(destination=>{const r=globalThis.__worldProbeRoot,p=r.gameplay()?.pose;if(r.sessionState()?.phase!=='world')throw Error('Session disconnected during combat route');return p&&p.regionId===destination.regionId&&Math.hypot(p.x-destination.x,p.z-destination.z)<2;},destination,{timeout:90000});}
 try{if(process.argv.includes('--combat-restore-only'))return {restorationOnly:true};if(equipSlot!==null){await swap(equipSlot,6);equipped=true;}for(const destination of route){console.log('combat-route',destination.regionId,destination.x,destination.z);await walk(destination);reached.push(destination);}return await performCombat(page,directory);}
 finally{
  await page.evaluate(()=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'cancel'}}));
  await restoreAlive(page);
  if(equipped)await swap(6,equipSlot);
  for(const destination of reached.slice(0,-1).reverse())await walk(destination);
  await page.evaluate(destination=>{const r=globalThis.__worldProbeRoot;if(!r.gameplay())throw Error('Combat probe lost its session before checkpoint restoration');r.session({kind:'gameplay',command:{kind:'move',destination}});},original);
  await page.waitForFunction(destination=>{const r=globalThis.__worldProbeRoot,p=r.gameplay()?.pose;if(r.sessionState()?.phase!=='world')throw Error('Session disconnected during scratch restoration');return p&&p.regionId===destination.regionId&&Math.hypot(p.x-destination.x,p.z-destination.z)<2;},original,{timeout:90000});
 }
}
