import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
test('clock sends one authorized tick and fails visibly when the world rejects it',async()=>{
  let reject=false,requests=0;
  const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests++;assert.equal(req.url,'/api/world/advance');assert.equal(req.headers.authorization,'Bearer clock-test');assert.deepEqual(JSON.parse(body),{ticks:1});res.writeHead(reject?503:200,{'content-type':'application/json'});res.end(JSON.stringify({ok:!reject,tick:73}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const run=()=>new Promise(resolve=>{const p=spawn(process.execPath,['scripts/advance_remote_world.mjs'],{env:{...process.env,CYMONIA_WORLD_URL:`http://127.0.0.1:${server.address().port}`,WORLD_ADVANCE_TOKEN:'clock-test',CYMONIA_REMOTE_TICKS:'1'},stdio:'ignore'});p.on('exit',resolve);});
  try{assert.equal(await run(),0);reject=true;assert.notEqual(await run(),0);assert.equal(requests,2);}finally{await new Promise(resolve=>server.close(resolve));}
});
