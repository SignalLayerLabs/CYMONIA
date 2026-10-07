import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function verifyAutonomousSamples(a,b,sa,sb,nowMs,{minAdvanceMinutes=120,quietEndedRealMs=nowMs}={}){
  assert.ok(a.ok&&b.ok,'canonical health unavailable');
  assert.equal(a.world_id,b.world_id,'canonical world identity changed');
  assert.equal(sa.worldId,a.world_id);assert.equal(sb.worldId,a.world_id);
  assert.ok(b.world_minute-a.world_minute>=minAdvanceMinutes,'unattended canonical clock did not keep advancing');
  assert.ok(b.clock_high_water_mark>a.clock_high_water_mark,'unattended advancement was not persisted');
  assert.ok(Number.isFinite(b.last_checkpoint_real_ms)&&b.last_checkpoint_real_ms>a.last_checkpoint_real_ms&&
    b.last_checkpoint_real_ms<=quietEndedRealMs,'checkpoint must be saved during the quiet interval before its final read');
  assert.equal(b.heartbeat?.tick_stalled,false,'unattended heartbeat stalled');
  assert.equal(b.heartbeat?.lastTickError,null,'unattended heartbeat failed');
  assert.ok(b.lag_world_minutes<120,'unattended simulation lag is excessive');
  const received=b.scheduler?.last_received_real_ms;
  assert.ok(Number.isFinite(received)&&received<=nowMs&&nowMs-received<60_000,'autonomous scheduler is missing or stale');
  assert.ok(sb.clock.worldMinute>sa.clock.worldMinute,'public state did not advance');
  const old=new Map(sa.citizens.map(c=>[c.id,c])),current=new Map(sb.citizens.map(c=>[c.id,c]));
  assert.ok(old.size>0,'canonical citizens unavailable');
  for(const id of old.keys())assert.ok(current.has(id),'existing citizen disappeared');
  let moved=0,changedActions=0,changedBiology=0;
  for(const [id,c] of old){const next=current.get(id);
    moved+=JSON.stringify(c.position)!==JSON.stringify(next.position);
    changedActions+=JSON.stringify(c.currentAction)!==JSON.stringify(next.currentAction);
    changedBiology+=JSON.stringify(c.body)!==JSON.stringify(next.body);
  }
  assert.ok(moved||changedActions||changedBiology,'clock advanced without changing real citizen state');
  return {worldId:b.world_id,from:a.world_minute,to:b.world_minute,
    advancedMinutes:b.world_minute-a.world_minute,lag:b.lag_world_minutes,
    citizens:sb.citizens.length,moved,changedActions,changedBiology};
}

export function quietIntervalMs(argv){
  const index=argv.indexOf('--quiet-ms');
  const quietMs=Number(index<0?180_000:argv[index+1]);
  assert.ok(Number.isFinite(quietMs)&&quietMs>=180_000&&quietMs<=1_800_000,'quiet interval must be 3–30 minutes');
  return quietMs;
}
async function main(){
  const quietMs=quietIntervalMs(process.argv.slice(2));
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const read=async path=>{
    const response=await fetch(`https://cymonia.pages.dev/api/v2/${path}`,{signal:AbortSignal.timeout(60_000)});
    assert.equal(response.status,200,`${path} HTTP ${response.status}`);return response.json();
  };
  let a;
  // Cloudflare documents up to fifteen minutes for new cron propagation.
  const deadline=Date.now()+16*60_000;
  while(Date.now()<deadline){
    try{
      const h=await read('health'),received=h.scheduler?.last_received_real_ms;
      if(h.ok&&Number.isFinite(received)&&Date.now()-received<60_000&&
          !h.heartbeat?.tick_stalled&&!h.heartbeat?.lastTickError&&h.lag_world_minutes<120){a=h;break;}
      console.log('WAIT_SCHEDULER',JSON.stringify({minute:h.world_minute,received:received??null,lag:h.lag_world_minutes}));
    }catch(error){console.log('WAIT_SCHEDULER',String(error.message));}
    await pause(30_000);
  }
  assert.ok(a,'autonomous scheduler did not activate and recover within the propagation window');
  const sa=(await read('state')).world;
  console.log('QUIET_BEGIN',JSON.stringify({worldId:a.world_id,minute:a.world_minute,quietMs}));
  await pause(quietMs);
  const quietEndedRealMs=Date.now();
  const b=await read('health'),sb=(await read('state')).world;
  const proof=verifyAutonomousSamples(a,b,sa,sb,Date.now(),{quietEndedRealMs,minAdvanceMinutes:Math.max(120,quietMs/1000-120)});
  console.log('PASS_AUTONOMOUS_WORLD',JSON.stringify(proof));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error);process.exitCode=1;});
