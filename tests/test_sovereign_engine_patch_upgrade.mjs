import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const patcher=resolve(fileURLToPath(new URL('../scripts/patch_current_v2.mjs',import.meta.url)));
const currentAnchors=`export function f(){const completed=[];for(const a of completed){resolveAction(world,a,a.endsWorldMinute);const c=world.citizens.find(x=>x.id===a.actorId);if(c?.alive&&!continuePlan(world,c,a,a.endsWorldMinute))queueCognition(world,c,'plan_completed',.42);}return {body:{hydration:c.body.hydration,calories:c.body.calories,sleepPressure:c.body.sleepPressure,health:c.body.health,ageMinutes:c.body.ageMinutes,diseases:c.body.diseases.length,injuries:c.body.injuries.length},currentAction:action?{targetId:action.targetId}:null,objects:world.objects.filter(o=>o.quantity>0).map(o=>({id:o.id,kind:o.kind,quantity:o.quantity,holderId:o.holderId,position:o.position,condition:o.condition,provenance:o.provenance})),ledgerHead:world.ledgerHead};}`;

test('engine projection patch is safe and idempotent on current structural anchors',()=>{
  const root=mkdtempSync(join(tmpdir(),'cymonia-engine-patch-'));mkdirSync(join(root,'world'));writeFileSync(join(root,'world/engine.js'),currentAnchors);
  try{
    const first=spawnSync(process.execPath,[patcher,root],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
    const once=readFileSync(join(root,'world/engine.js'),'utf8');
    assert.match(once,/exposure:c\.body\.exposure/);assert.match(once,/path:action\.path/);assert.match(once,/material:o\.material/);assert.match(once,/ACTION_RESOLUTION_FAILED/);assert.match(once,/physical_action_failed/);assert.match(once,/recentLedger/);
    const second=spawnSync(process.execPath,[patcher,root],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);
    assert.equal(readFileSync(join(root,'world/engine.js'),'utf8'),once);
  }finally{rmSync(root,{recursive:true,force:true});}
});
