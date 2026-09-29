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

test('dry foundation terrain changes real construction work',()=>{
  const meadowWorld=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const cm=meadowWorld.citizens[0];
  const om=addHeld(meadowWorld,cm);
  const dm=registerDesign(meadowWorld,cm,{materials:{timber:10},workMinutes:100});
  const meadow=findTerrain(meadowWorld,'meadow');
  const pm=beginConstruction(meadowWorld,cm,dm.id,meadow,[om.id]);

  const rockyWorld=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const cr=rockyWorld.citizens[0];
  const orock=addHeld(rockyWorld,cr);
  const dr=registerDesign(rockyWorld,cr,{materials:{timber:10},workMinutes:100});
  const rocky=findTerrain(rockyWorld,'rocky');
  const pr=beginConstruction(rockyWorld,cr,dr.id,rocky,[orock.id]);

  assert.equal(pm.workRequiredMinutes,100);
  assert.equal(pm.terrainKind,'meadow');

  assert.equal(pr.terrainKind,'rocky');
  assert.equal(pr.foundationFactor,1.25);
  assert.ok(pr.workRequiredMinutes>pm.workRequiredMinutes);
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


test('construction rejects a dry center whose physical footprint overlaps the river',()=>{
  const w=createSovereignGenesis({seed:20260915,realEpochMs:0}),c=w.citizens[0],o=addHeld(w,c);
  const d=registerDesign(w,c,{materials:{timber:10},workMinutes:100});

  let site=null;
  outer:
  for(let y=4;y<96;y+=.5){
    for(let x=4;x<96;x+=.5){
      if(terrainAt(w,x,y).kind==='river')continue;
      const radius=2.7+.55;
      for(let step=0;step<32;step++){
        const angle=step/32*Math.PI*2;
        const px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;
        if(terrainAt(w,px,py).kind==='river'){
          site={x,y};
          break outer;
        }
      }
    }
  }

  assert.ok(site,'expected to find a dry center with footprint crossing river');
  assert.notEqual(terrainAt(w,site.x,site.y).kind,'river');
  assert.throws(
    ()=>beginConstruction(w,c,d.id,site,[o.id]),
    /construction_site_unstable_water/
  );
});
