import test from 'node:test';
import assert from 'node:assert/strict';
import * as kernel from '../world/index.js';

function fixture(){
  const world=kernel.createSovereignGenesis({seed:71,realEpochMs:0});
  const citizen=world.citizens[0];citizen.position={x:50,y:50};
  for(const [id,material,quantity] of [['a','timber',4],['b','stone',2],['c','clay',3],['d','water',2]]){
    world.objects.push({id,material,kind:'raw_material',quantity,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},condition:1,provenance:{type:'TEST'}});
    citizen.possessions.push(id);citizen.knownEntityIds.push(id);
  }
  return {world,citizen};
}
function execute(f,operations,inputObjectIds=['a','b','c','d'],options={}){
  assert.equal(typeof kernel.executePhysicalOperations,'function','sovereign physical interpreter is exported');
  return kernel.executePhysicalOperations(f.world,f.citizen,operations,{inputObjectIds,workMinutes:30,actionId:'test:action',...options});
}

test('declarative separation is deterministic, conserves matter and records causal inputs',()=>{
  const f=fixture(),g=fixture(),mass=kernel.totalTrackedMass(f.world);
  const ops=[{primitive:'separate',target:0,quantity:1,tool:1,workJ:1200,forceN:150}];
  const receipt=execute(f,ops),other=execute(g,ops);
  assert.deepEqual(receipt,other);assert.deepEqual(f.world,g.world);
  assert.equal(f.world.objects.find(o=>o.id==='a').quantity,3);
  const output=f.world.objects.find(o=>o.id===receipt.outputObjectIds[0]);
  assert.equal(output.quantity,1);assert.equal(output.material,'timber');
  assert.equal(output.provenance.actionId,'test:action');assert.deepEqual(output.provenance.inputObjectIds,['a']);
  assert.equal(kernel.totalTrackedMass(f.world),mass);assert.ok(kernel.verifyLedger(f.world));
});

test('invalid late operation rolls back the entire physical sequence including ledger and effort',()=>{
  const f=fixture(),before=JSON.stringify(f.world);
  assert.throws(()=>execute(f,[{primitive:'separate',target:0,quantity:1,workJ:1200},{primitive:'shape',target:1,form:'flat',workJ:50}]),/resistance|rigid/);
  assert.equal(JSON.stringify(f.world),before);
});

test('joining heterogeneous inputs preserves exact mass and source provenance',()=>{
  const f=fixture(),mass=kernel.totalTrackedMass(f.world);
  const receipt=execute(f,[{primitive:'join',target:0,source:2,workJ:900}]);
  const output=f.world.objects.find(o=>o.id===receipt.outputObjectIds[0]);
  assert.equal(output.quantity*output.massPerUnitKg,7);assert.equal(output.material,'composite');
  assert.deepEqual(output.provenance.inputObjectIds,['a','c']);assert.equal(kernel.totalTrackedMass(f.world),mass);
});

test('heat transfer is limited by the source and conserves stored thermal energy',()=>{
  const f=fixture();f.world.objects.find(o=>o.id==='b').temperatureC=250;
  const receipt=execute(f,[{primitive:'transfer_heat',target:2,source:1,heatJ:9000,workJ:10}]);
  const hot=f.world.objects.find(o=>o.id==='b'),cold=f.world.objects.find(o=>o.id==='c');
  assert.equal(hot.temperatureC,244.375);assert.equal(cold.temperatureC,21);
  assert.equal(receipt.heatJ,9000);
  const before=JSON.stringify(f.world);
  assert.throws(()=>execute(f,[{primitive:'transfer_heat',target:2,source:1,heatJ:10000000}]),/thermal/);
  assert.equal(JSON.stringify(f.world),before);
});

test('operations reject capability violations, remote matter, duplicate bindings and executable fields',()=>{
  for(const [ops,ids,reason] of [
    [[{primitive:'impact',target:0,forceN:99999,workJ:100}],['a'],/force/],
    [[{primitive:'move',target:0,toPosition:{x:95,y:95},workJ:1}],['a'],/reach|transport/],
    [[{primitive:'rotate',target:0,angle:90,workJ:10}],['a','a'],/duplicate/],
    [[{primitive:'eval',target:0}],['a'],/primitive/],
    [[{primitive:'rotate',target:0,code:'globalThis.pwned=true'}],['a'],/field/],
    [[{primitive:'rotate',target:0,angle:Infinity}],['a'],/finite|number/],
  ]){
    const f=fixture(),before=JSON.stringify(f.world);
    assert.throws(()=>execute(f,ops,ids),reason);assert.equal(JSON.stringify(f.world),before);
  }
  assert.equal(globalThis.pwned,undefined);
});

test('physical access uses current holder and proximity, never initiator provenance',()=>{
  const f=fixture(),o=f.world.objects.find(o=>o.id==='a');
  o.holderId='other';o.provenance.initiatorId=f.citizen.id;
  assert.throws(()=>execute(f,[{primitive:'rotate',target:0,workJ:50}],['a']),/held|access/);
  o.holderId=null;o.position={x:70,y:70};
  assert.throws(()=>execute(f,[{primitive:'rotate',target:0,workJ:50}],['a']),/reach/);
});

test('work is bounded by action duration and living physiological capability',()=>{
  const f=fixture();
  assert.throws(()=>execute(f,[{primitive:'rotate',target:0,workJ:100000}],['a'],{workMinutes:1}),/work/);
  f.citizen.alive=false;
  assert.throws(()=>execute(f,[{primitive:'rotate',target:0,workJ:50}],['a']),/dead/);
});

test('old objects gain physical fields only when acted upon, without changing historical structures',()=>{
  const f=fixture(),history=JSON.stringify(f.world.buildings),other=JSON.stringify(f.world.objects.find(o=>o.id==='b'));
  execute(f,[{primitive:'rotate',target:0,angle:45,workJ:10}],['a']);
  assert.equal(f.world.objects.find(o=>o.id==='a').geometry.angle,45);
  assert.equal(JSON.stringify(f.world.objects.find(o=>o.id==='b')),other);
  assert.equal(JSON.stringify(f.world.buildings),history);
});

test('every advertised primitive accepts only bounded declarative data',()=>{
  assert.equal(typeof kernel.validatePhysicalOperations,'function');
  for(const primitive of ['apply_force','impact','separate','join','support','contain','move','rotate','compress','abrade','pierce','transfer_heat','cool','ignite','extinguish','transfer_matter','shape','mix']){
    assert.ok(kernel.PHYSICAL_PRIMITIVES.includes(primitive));
    assert.equal(kernel.validatePhysicalOperations([{primitive,target:0}]).ok,true,primitive);
  }
  assert.equal(kernel.validatePhysicalOperations(Array.from({length:100},()=>({primitive:'rotate',target:0}))).ok,false);
});

test('attachment dependencies cannot be consumed or cycled inside a physical sequence',()=>{
  const f=fixture();f.world.objects.find(o=>o.id==='c').geometry={form:'hollow'};
  const before=JSON.stringify(f.world);
  assert.throws(()=>execute(f,[{primitive:'contain',target:3,source:2,workJ:30},{primitive:'join',target:2,source:0,workJ:900}]),/attached|depend/);
  assert.equal(JSON.stringify(f.world),before);
  assert.throws(()=>execute(f,[{primitive:'support',target:2,source:1,workJ:50},{primitive:'support',target:1,source:2,workJ:50}]),/attached|cycle/);
  assert.equal(JSON.stringify(f.world),before);
});

test('a contained object follows transport and can be physically separated again',()=>{
  const f=fixture();f.world.objects.find(o=>o.id==='c').geometry={form:'hollow'};
  execute(f,[{primitive:'contain',target:0,source:1,workJ:30}],['d','c']);
  const water=f.world.objects.find(o=>o.id==='d');
  assert.equal(water.holderId,null);assert.equal(water.geometry.containedById,'c');
  execute(f,[{primitive:'move',target:0,toPosition:{x:51,y:50},workJ:100}],['c','d']);
  assert.deepEqual(water.position,{x:51,y:50});
  execute(f,[{primitive:'separate',target:1,source:0,workJ:30}],['c','d']);
  assert.equal(water.geometry.containedById,undefined);assert.equal(water.holderId,f.citizen.id);
});

test('in-place physical changes retain their immediate causal predecessor',()=>{
  const f=fixture(),a=execute(f,[{primitive:'rotate',target:0,angle:15,workJ:10}],['a']);
  const b=execute(f,[{primitive:'rotate',target:0,angle:15,workJ:10}],['a']);
  assert.ok(f.world.ledger.find(e=>e.id===b.eventId).causes.includes(a.eventId));
});

test('transport cost uses staged matter displacement so returning material cannot be free',()=>{
  const f=fixture(),before=JSON.stringify(f.world);
  assert.throws(()=>execute(f,[{primitive:'move',target:0,toPosition:{x:52,y:50},workJ:60},{primitive:'move',target:0,toPosition:{x:50,y:50},workJ:0}],['b']),/resistance/);
  assert.equal(JSON.stringify(f.world),before);
});
