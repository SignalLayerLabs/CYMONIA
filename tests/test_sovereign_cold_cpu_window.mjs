import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

test('a cold alarm waits for an incoming request before consuming another CPU phase',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());
 const {instance}=await wake(storage);instance.ctx.getWebSockets=()=>[];
 let ticks=0;instance.tick=async()=>{ticks++;};
 await instance.alarm();assert.equal(ticks,0,'cold decode must not share its CPU window with simulation or compression');
 assert.ok(await storage.getAlarm());
 await instance.fetch(new Request('https://internal/world/runtime-heartbeat'));
 await instance.alarm();assert.equal(ticks,1,'a genuine incoming heartbeat releases the waiting phase');
});
