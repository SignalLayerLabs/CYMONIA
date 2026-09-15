import {WORLD_VERSION,GENESIS_POPULATION,PRIMITIVE_SIGNALS} from './constants.js';
import {rng,stableId} from './rng.js';
import {appendEvent} from './ledger.js';
import {genesisGenome} from './genetics.js';

function body(r,index,genome){return {massKg:55+Math.round(r()*30),hydration:82+r()*15,calories:82+r()*15,sleepPressure:5+r()*15,temperatureC:36.6,health:100,injuries:[],diseases:[],fertility:genome.fertility,pregnancy:null,reproductiveRole:index%2===0?'gestating':'non_gestating',ageMinutes:(18+Math.floor(r()*17))*525600,alive:true};}
function psychology(r){return {curiosity:r(),riskTolerance:r(),socialDrive:r(),aggression:r()*.6,empathy:.35+r()*.65,noveltySeeking:r(),stress:0,fear:0,attachment:0.2+r()*.4,confidence:.3+r()*.6};}
function position(i,r){const ring=Math.floor(i/20);const a=(i%20)/20*Math.PI*2;const radius=4+ring*2.3;return {x:50+Math.cos(a)*radius+r()*.4,y:50+Math.sin(a)*radius+r()*.4};}
function citizen(i,r,seed){const genome=genesisGenome(seed,i);const id=`genesis:${String(i+1).padStart(3,'0')}`;return {id,kind:'GENESIS',selfName:null,externalId:null,alive:true,birthWorldMinute:-Math.floor((18+r()*17)*525600),deathWorldMinute:null,position:position(i,r),genome,body:body(r,i,genome),psychology:psychology(r),knowledge:[],memories:[],knownEntityIds:[id],skills:{},language:{primitiveSignals:[...PRIMITIVE_SIGNALS],lexicon:{},heard:{},grammarPatterns:{}},relationships:{},beliefs:[],possessions:[],goals:[],activeGoal:null,plans:[],currentActionId:null,commitments:[],cognition:{lastReflectionMinute:null,pending:true,reason:'genesis_awareness'}};}

export function createSovereignGenesis({seed=20260915,realEpochMs=Date.now()}={}){
  const r=rng(seed);const worldId=`sovereign-${seed}`;
  const citizens=Array.from({length:GENESIS_POPULATION},(_,i)=>citizen(i,r,seed));
  const objects=[
    {id:'obj:endowment:food',kind:'resource_bundle',material:'food',quantity:2400,massPerUnitKg:.25,holderId:'commons:genesis',position:{x:50,y:50},condition:1,provenance:{type:'GENESIS_ENDOWMENT'}},
    {id:'obj:endowment:water-vessels',kind:'container_bundle',material:'fiber',quantity:100,massPerUnitKg:.4,holderId:'commons:genesis',position:{x:50,y:50},condition:1,provenance:{type:'GENESIS_ENDOWMENT'}},
    {id:'obj:endowment:timber',kind:'raw_material',material:'timber',quantity:600,massPerUnitKg:1,holderId:'commons:genesis',position:{x:51,y:50},condition:1,provenance:{type:'GENESIS_ENDOWMENT'}},
    {id:'obj:endowment:stone',kind:'raw_material',material:'stone',quantity:400,massPerUnitKg:1,holderId:'commons:genesis',position:{x:49,y:50},condition:1,provenance:{type:'GENESIS_ENDOWMENT'}}
  ];
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,radius=5+(i%3)*1.1;objects.push({id:`obj:endowment:shelter:${String(i+1).padStart(2,'0')}`,kind:'temporary_shelter',material:'fiber',quantity:1,massPerUnitKg:20,holderId:'commons:genesis',position:{x:50+Math.cos(a)*radius,y:50+Math.sin(a)*radius},condition:1,properties:{thermalProtection:.72,precipitationProtection:.86},provenance:{type:'GENESIS_ENDOWMENT'}});}
  const resourceDeposits=[
    {id:stableId('dep',seed,0),type:'water',quantity:1_000_000,renewPerDay:12000,position:{x:44,y:48},accessDifficulty:.08},
    {id:stableId('dep',seed,1),type:'food',quantity:900,renewPerDay:45,position:{x:55,y:46},accessDifficulty:.12},
    {id:stableId('dep',seed,2),type:'timber',quantity:15000,renewPerDay:18,position:{x:61,y:54},accessDifficulty:.25},
    {id:stableId('dep',seed,3),type:'stone',quantity:45000,renewPerDay:0,position:{x:36,y:61},accessDifficulty:.4},
    {id:stableId('dep',seed,4),type:'clay',quantity:12000,renewPerDay:.2,position:{x:43,y:53},accessDifficulty:.18},
    {id:stableId('dep',seed,5),type:'ore',quantity:8000,renewPerDay:0,position:{x:32,y:31},accessDifficulty:.7}
  ];
  const world={version:WORLD_VERSION,worldId,seed,clock:{realEpochMs:Number(realEpochMs),worldMinute:0},environment:{temperatureC:18,precipitation:0,soilMoisture:.55,seasonPhase:0,dayPhase:0,pollution:0,pathogenPressure:.012,naturalReservoirs:{waterKg:9_000_000,biomassKg:1_000_000,mineralKg:1_000_000},metabolicMatterKg:0},citizens,objects,resourceDeposits,actions:[],projects:[],designs:[],buildings:[],organizations:[],claims:[],commitments:[],currencySystems:[],relationships:[],languages:[],experiments:[],reserves:{observerEmbodimentKg:8000,observerEmbodimentEnergyUnits:800000},privateHumanIntents:{},cognitionQueue:citizens.map(c=>({citizenId:c.id,reason:'genesis_awareness',priority:.6})),ledger:[],ledgerHead:'GENESIS',observer:{classifications:[]}};
  appendEvent(world,'WORLD_GENESIS','world',{population:GENESIS_POPULATION,seed,endowmentObjectIds:objects.map(o=>o.id),materialClosure:true,timeRatio:'1 real second = 1 world minute'},[],0);
  return world;
}
