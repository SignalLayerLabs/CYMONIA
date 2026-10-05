import test from 'node:test';
import assert from 'node:assert/strict';
import {ObserverConnection,CONNECTION} from '../site/observer-connection.js';

function scheduler(){
  const queue=[];
  return {
    set(fn,ms){const token={fn,ms,cancelled:false};queue.push(token);return token;},
    clear(token){if(token)token.cancelled=true;},
    async run(){let t;do{t=queue.shift();}while(t?.cancelled);if(t)await t.fn();},
    get pending(){return queue.filter(x=>!x.cancelled).length;}
  };
}

test('initial failure stays on replay during retries then recovers to canonical live',async()=>{
  const s=scheduler();let calls=0,replay=0;const modes=[];const worlds=[];
  const c=new ObserverConnection({
    fetchState:async()=>{calls++;if(calls===1)throw new Error('503');return {version:2,worldId:'sovereign-1',clock:{worldMinute:10,realEpochMs:0}};},
    loadReplay:async()=>{replay++;return {version:2,worldId:'replay',clock:{worldMinute:0,realEpochMs:0}};},
    createSocket:()=>null,
    onWorld:w=>worlds.push(w),onMode:m=>modes.push(m),
    setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,
  });
  await c.start();
  assert.equal(c.mode,CONNECTION.REPLAY);
  assert.equal(replay,1);
  assert.ok(s.pending>0);
  await s.run();
  assert.equal(c.mode,CONNECTION.LIVE);
  assert.equal(worlds.at(-1).worldId,'sovereign-1');
  assert.ok(modes.includes(CONNECTION.REPLAY));
  assert.equal(
    modes.includes(CONNECTION.RECONNECTING),
    false,
    'background retries must not replace a usable replay with RECONNECTING'
  );
});

test('a hung poll expires, preserves the world and resumes updates without a reload',{timeout:1000},async()=>{
  const s=scheduler(),worlds=[];let calls=0,late,signal;
  const c=new ObserverConnection({
    fetchState:options=>{calls++;if(calls===2){signal=options?.signal;return new Promise(resolve=>{late=resolve;});}
      return Promise.resolve({version:2,worldId:'live',clock:{worldMinute:calls===1?100:160}});},
    onWorld:w=>worlds.push(w.clock.worldMinute),setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,
  });
  await c.start();
  const pending=c.refreshNow({poll:true});
  // A successful first fetch leaves a poll timer. Skip that timer while the
  // explicit poll is in flight, then fire the request's expiration.
  await s.run();await s.run();await pending;
  assert.equal(c.attempting,false);
  assert.equal(signal?.aborted,true);
  assert.equal(c.mode,CONNECTION.DEGRADED);
  assert.equal(c.lastCanonical.clock.worldMinute,100);
  await s.run();
  assert.deepEqual(worlds,[100,160]);
  assert.equal(c.mode,CONNECTION.LIVE);
  late({version:2,worldId:'live',clock:{worldMinute:110}});
  await Promise.resolve();
  assert.equal(c.lastCanonical.clock.worldMinute,160,'late timed-out responses must not replace a newer state');
  c.stop();
});

test('a hung initial request can enter replay and later recover',{timeout:1000},async()=>{
  const s=scheduler();let calls=0;
  const c=new ObserverConnection({
    fetchState:()=>++calls===1?new Promise(()=>{}):Promise.resolve({version:2,worldId:'live',clock:{worldMinute:160}}),
    loadReplay:async()=>({version:2,worldId:'replay',clock:{worldMinute:0}}),
    setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,
  });
  const start=c.start();await s.run();await start;
  assert.equal(c.mode,CONNECTION.REPLAY);
  assert.equal(c.attempting,false);
  await s.run();assert.equal(c.mode,CONNECTION.LIVE);
  assert.equal(c.lastCanonical.clock.worldMinute,160);c.stop();
});

test('stopping a hung request aborts it without retrying or delivering its late result',{timeout:1000},async()=>{
  const s=scheduler(),worlds=[];let late,signal;
  const c=new ObserverConnection({
    fetchState:options=>{signal=options.signal;return new Promise(resolve=>{late=resolve;});},
    onWorld:w=>worlds.push(w),setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),
  });
  const start=c.start();c.stop();await start;
  assert.equal(signal.aborted,true);assert.equal(c.attempting,false);
  assert.equal(c.mode,CONNECTION.STOPPED);assert.equal(s.pending,0);
  late({version:2,worldId:'live',clock:{worldMinute:160}});await Promise.resolve();
  assert.equal(worlds.length,0);
});

test('stopping during replay loading prevents late replay delivery',{timeout:1000},async()=>{
  const s=scheduler(),worlds=[];let finishReplay,startedReplay;
  const loading=new Promise(resolve=>{startedReplay=resolve;});
  const c=new ObserverConnection({fetchState:async()=>{throw new Error('offline');},
    loadReplay:()=>{startedReplay();return new Promise(resolve=>{finishReplay=resolve;});},
    onWorld:w=>worlds.push(w),setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s)});
  const start=c.start();await loading;c.stop();
  finishReplay({version:2,worldId:'replay',clock:{worldMinute:0}});await start;
  assert.equal(c.mode,CONNECTION.STOPPED);assert.equal(worlds.length,0);assert.equal(s.pending,0);
});


test('usable replay cannot be masked by reconnecting status',async()=>{
  const s=scheduler();
  const modes=[];

  const c=new ObserverConnection({
    fetchState:async()=>{throw new Error('offline');},
    loadReplay:async()=>({
      version:2,
      worldId:'replay',
      clock:{worldMinute:0,realEpochMs:null}
    }),
    createSocket:()=>null,
    onWorld:()=>{},
    onMode:m=>modes.push(m),
    setTimeoutFn:s.set.bind(s),
    clearTimeoutFn:s.clear.bind(s),
    randomFn:()=>.5,
  });

  try{
    await c.start();

    assert.equal(c.mode,CONNECTION.REPLAY);

    c.setMode(CONNECTION.RECONNECTING);

    assert.equal(
      c.mode,
      CONNECTION.REPLAY,
      'a usable replay must remain the visible state while canonical reconnects'
    );

    assert.equal(modes.at(-1),CONNECTION.REPLAY);
  }finally{
    c.stop();
  }
});

test('last canonical state is retained during transient outage',async()=>{
  const s=scheduler();let fail=false;const worlds=[];
  const c=new ObserverConnection({
    fetchState:async()=>{if(fail)throw new Error('offline');return {version:2,worldId:'live',clock:{worldMinute:20,realEpochMs:0}};},
    createSocket:()=>null,onWorld:w=>worlds.push(w),onMode:()=>{},
    setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,
  });
  await c.start();
  fail=true;
  await c.refreshNow();
  assert.equal(c.mode,CONNECTION.DEGRADED);
  assert.equal(c.lastCanonical.worldId,'live');
  assert.equal(worlds.at(-1).worldId,'live');
});

test('socket reconnect never creates overlapping live sockets',async()=>{
  const s=scheduler();let sockets=0;const handles=[];
  const c=new ObserverConnection({
    fetchState:async()=>({version:2,worldId:'live',clock:{worldMinute:1,realEpochMs:0}}),
    createSocket:({onClose})=>{sockets++;const h={readyState:1,close(){this.readyState=3;},onClose};handles.push(h);return h;},
    onWorld:()=>{},onMode:()=>{},setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,
  });
  await c.start();
  c.ensureSocket();c.ensureSocket();
  assert.equal(sockets,1);
  handles[0].readyState=3;handles[0].onClose();
  await s.run();
  assert.equal(sockets,1);
  await s.run();
  assert.equal(sockets,2);
});

test('short websocket loss keeps canonical observer LIVE while reconnecting in background',async()=>{
  const s=scheduler();let now=1000;let closeSocket;
  const modes=[];
  const c=new ObserverConnection({
    fetchState:async()=>({version:2,worldId:'live',clock:{worldMinute:2,realEpochMs:0}}),
    createSocket:({onOpen,onClose})=>{
      const h={readyState:1,close(){this.readyState=3;}};
      closeSocket=()=>{h.readyState=3;onClose();};
      onOpen();
      return h;
    },
    onWorld:()=>{},onMode:m=>modes.push(m),
    setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),randomFn:()=>.5,nowFn:()=>now,
  });
  await c.start();
  assert.equal(c.mode,CONNECTION.LIVE);
  now+=1200;
  closeSocket();
  assert.equal(c.mode,CONNECTION.LIVE);
  assert.notEqual(modes.at(-1),CONNECTION.DEGRADED);
  assert.ok(s.pending>0);
});

function calendarConnection(){
  const s=scheduler(),worlds=[],errors=[];
  let minute=525590,resolvePoll,stream;
  const snapshot=n=>({version:2,worldId:'persistent-world',clock:{worldMinute:n,realEpochMs:0}});
  const connection=new ObserverConnection({
    fetchState:()=>minute===null?new Promise(resolve=>{resolvePoll=resolve;}):Promise.resolve(snapshot(minute)),
    createSocket:callbacks=>{stream=callbacks;return {readyState:1,close(){}};},
    onWorld:w=>worlds.push(w),onError:e=>errors.push(e),
    setTimeoutFn:s.set.bind(s),clearTimeoutFn:s.clear.bind(s),
  });
  return {connection,worlds,errors,snapshot,setMinute:n=>{minute=n;},stream:()=>stream,finishPoll:n=>resolvePoll(snapshot(n))};
}

test('a delayed REST response cannot undo a streamed year rollover',async()=>{
  const h=calendarConnection();await h.connection.start();
  h.setMinute(null);
  const poll=h.connection.refreshNow({poll:true});
  h.stream().onWorld(h.snapshot(525610));
  h.finishPoll(525590);await poll;
  assert.equal(h.connection.lastCanonical.clock.worldMinute,525610);
  assert.deepEqual(h.worlds.map(w=>w.clock.worldMinute),[525590,525610]);
  h.connection.stop();
});

test('stale WebSocket snapshots and a different world cannot reset the calendar',async()=>{
  const h=calendarConnection();await h.connection.start();
  h.stream().onWorld(h.snapshot(525610));
  h.stream().onWorld(h.snapshot(0));
  h.stream().onWorld({...h.snapshot(0),worldId:'unexpected-genesis'});
  assert.equal(h.connection.lastCanonical.worldId,'persistent-world');
  assert.equal(h.connection.lastCanonical.clock.worldMinute,525610);
  h.stream().onWorld(h.snapshot(525670));
  assert.equal(h.connection.lastCanonical.clock.worldMinute,525670);
  assert.equal(h.connection.mode,CONNECTION.LIVE);
  h.connection.stop();
});

test('compact world signal invalidates through REST instead of carrying the whole world over websocket',async()=>{
  let callbacks,fetches=0;
  const worlds=[
    {version:2,worldId:'live',clock:{worldMinute:10,realEpochMs:0}},
    {version:2,worldId:'live',clock:{worldMinute:11,realEpochMs:0}}
  ];
  const connection=new ObserverConnection({
    fetchState:async()=>worlds[Math.min(fetches++,worlds.length-1)],
    createSocket:handlers=>{callbacks=handlers;return{readyState:1,close(){}};},
    setTimeoutFn:()=>1,clearTimeoutFn:()=>{},
  });
  await connection.start();
  assert.equal(connection.lastCanonical.clock.worldMinute,10);
  callbacks.onSignal({type:'world_signal',worldMinute:11});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(connection.lastCanonical.clock.worldMinute,11);
  assert.ok(fetches>=2);
});
