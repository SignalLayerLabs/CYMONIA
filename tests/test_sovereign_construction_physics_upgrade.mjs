import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {registerDesign,beginConstruction,applyConstructionWork} from '../world/artifacts.js';
import {terrainAt} from '../world/terrain.js';
import {MATERIAL_PROPERTIES} from '../world/materials.js';

function addHeld(w,c,material='timber',quantity=10){const o={id:`test:${material}:${w.objects.length}`,kind:'raw_material',material,quantity,massPerUnitKg:1,holderId:c.id,position:{...c.position},condition:1,provenance:{type:'TEST'}};w.objects.push(o);c.possessions.push(o.id);return o;}
function findTerrain(w,kind){for(let y=4;y<96;y+=2)for(let x=4;x<96;x+=2)if(terrainAt(w,x,y).kind===kind)return{x,y};throw new Error(`terrain_not_found:${kind}`);}

test('construction refuses occupied structure core and unstable river site',()=>{
  const w=createSovereignGenesis({seed:20260915,realEpochMs:0}),c=w.citizens[0],o=addHeld(w,c);
  const d=registerDesign(w,c,{materials:{timber:10},workMinutes:100});
  w.buildings.push({id:'existing',kind:'structure',position:{x:30,y:30},footprintRadius:1.5,massKg:1,protection:{thermal:.2,precipitation:.2}});
  assert.throws(()=>beginConstruction(w,c,d.id,{x:30,y:30},[o.id]),/construction_site_occupied/);
  const river=findTerrain(w,'river');
  assert.throws(()=>beginConstruction(w,c,d.id,river,[o.id]),/construction_site_unstable_water/);
});

test('foundation terrain changes real construction work',()=>{
  const meadowWorld=createSovereignGenesis({seed:20260915,realEpochMs:0}),cm=meadowWorld.citizens[0],om=addHeld(meadowWorld,cm),dm=registerDesign(meadowWorld,cm,{materials:{timber:10},workMinutes:100}),meadow=findTerrain(meadowWorld,'meadow'),pm=beginConstruction(meadowWorld,cm,dm.id,meadow,[om.id]);
  const wetWorld=createSovereignGenesis({seed:20260915,realEpochMs:0}),cw=wetWorld.citizens[0],ow=addHeld(wetWorld,cw),dw=registerDesign(wetWorld,cw,{materials:{timber:10},workMinutes:100}),wet=findTerrain(wetWorld,'wetland'),pw=beginConstruction(wetWorld,cw,dw.id,wet,[ow.id]);
  assert.equal(pm.workRequiredMinutes,100);
  assert.ok(pw.workRequiredMinutes>pm.workRequiredMinutes);
  assert.equal(pw.terrainKind,'wetland');
});

test('completed structure protection derives from incorporated material physics',()=>{
  const w=createSovereignGenesis({seed:20260915,realEpochMs:0}),c=w.citizens[0],o=addHeld(w,c,'timber',10),d=registerDesign(w,c,{materials:{timber:10},workMinutes:20}),site=findTerrain(w,'meadow'),p=beginConstruction(w,c,d.id,site,[o.id]);
  applyConstructionWork(w,c,p.id,p.workRequiredMinutes,p.createdWorldMinute+p.workRequiredMinutes);
  const b=w.buildings.at(-1);
  assert.ok(b);
  assert.equal(Number(b.protection.thermal.toFixed(2)),Number(MATERIAL_PROPERTIES.timber.thermalResistance.toFixed(2)));
  assert.equal(Number(b.protection.precipitation.toFixed(2)),Number(MATERIAL_PROPERTIES.timber.waterResistance.toFixed(2)));
  assert.equal(b.massKg,10);
  assert.equal(o.quantity,0);
});
