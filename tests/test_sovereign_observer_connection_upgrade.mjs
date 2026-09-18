import test from 'node:test';
import assert from 'node:assert/strict';
import {ObserverConnection,CONNECTION} from '../site/observer-connection.js';

function scheduler(){
  const queue=[];
  return {
    set(fn,ms){const token={fn,ms,cancelled:false};queue.push(token);return token;},
    clear(token){if(token)token.cancelled=true;},
    async run(){const t=queue.shift();if(t&&!t.cancelled)await t.fn();},
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
