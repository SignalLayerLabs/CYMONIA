import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {MATERIAL_PROPERTIES,objectMass} from './materials.js';
import {positionAt,activeAction} from './actions.js';

// A data language, not a VM. Slots bind physical inputs; they cannot address host state.
export const PHYSICAL_PRIMITIVES=Object.freeze(['apply_force','impact','separate','join','support','contain','move','rotate','compress','abrade','pierce','transfer_heat','cool','ignite','extinguish','transfer_matter','shape','mix']);
const PRIMITIVES=new Set(PHYSICAL_PRIMITIVES);
const FIELDS=new Set(['primitive','target','source','tool','quantity','workJ','forceN','heatJ','toPosition','form','angle']);
const FORMS=new Set(['bundle','flat','elongated','hollow','frame','layered','fragmented']);
const HEAT_CAPACITY=Object.freeze({water:4200,food:1800,timber:1700,stone:800,clay:1000,ore:500,fiber:1400,biomass:1800,composite:1200});
const IGNITION=Object.freeze({timber:300,fiber:240,food:320,biomass:350});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const fail=reason=>{throw new Error(`physical_${reason}`);};
const attachmentId=o=>o?.geometry?.containedById||o?.geometry?.supportedById||null;
function attachmentRoot(object,lookup){
  let root=object;const visited=new Set();
  for(let depth=0;attachmentId(root);depth++){
    if(depth>=8||visited.has(root.id))fail('attachment_cycle');visited.add(root.id);
    root=lookup(attachmentId(root));if(!root||objectMass(root)<=0)fail('attachment_parent_unavailable');
  }
  return root;
}

export function validatePhysicalOperations(operations){
  if(!Array.isArray(operations)||operations.length<1||operations.length>12)return {ok:false,reason:'physical_operations_bound'};
  for(const op of operations){
    if(!op||typeof op!=='object'||Array.isArray(op))return {ok:false,reason:'physical_operation_invalid'};
    if(!PRIMITIVES.has(op.primitive))return {ok:false,reason:'physical_primitive_invalid'};
    if(Object.keys(op).some(key=>!FIELDS.has(key)))return {ok:false,reason:'physical_field_forbidden'};
    for(const key of ['target','source','tool'])if((key==='target'||op[key]!==undefined)&&(!Number.isInteger(op[key])||op[key]<0||op[key]>7))return {ok:false,reason:'physical_slot_invalid'};
    for(const key of ['quantity','workJ','forceN','heatJ','angle'])if(op[key]!==undefined&&(!finite(op[key])||(key!=='angle'&&op[key]<0)||Math.abs(op[key])>1e8))return {ok:false,reason:'physical_number_nonfinite_or_bound'};
    if(op.form!==undefined&&!FORMS.has(op.form))return {ok:false,reason:'physical_form_invalid'};
    if(op.toPosition!==undefined&&(!op.toPosition||Object.keys(op.toPosition).some(k=>!['x','y'].includes(k))||!finite(op.toPosition.x)||!finite(op.toPosition.y)||op.toPosition.x<0||op.toPosition.x>100||op.toPosition.y<0||op.toPosition.y>100))return {ok:false,reason:'physical_position_invalid'};
  }
  return {ok:true};
}

function properties(o){return {...MATERIAL_PROPERTIES[o.material],...o.properties};}
function capacity(o){return finite(o.thermalCapacityJPerK)&&o.thermalCapacityJPerK>0?o.thermalCapacityJPerK:objectMass(o)*(HEAT_CAPACITY[o.material]||1200);}
function temperature(o,ambient){return finite(o.temperatureC)?o.temperatureC:ambient;}
function observation(o,ambient){return {material:o.material,massKg:objectMass(o),temperatureC:temperature(o,ambient),form:o.geometry?.form||null};}
function physicalCapacity(citizen){return Math.max(.05,Math.min(2,Number(citizen.genome?.physicalCapacity)||1))*Math.max(0,Math.min(1,Number(citizen.body?.health||0)/100));}

// Stage only the <=8 bound objects. A failed step cannot partially consume matter,
// alter the ledger, spend body energy, or create an output.
export function executePhysicalOperations(world,citizen,operations,{inputObjectIds=[],actionId=null,procedureId=null,at=world.clock.worldMinute,workMinutes=1}={}){
  const syntax=validatePhysicalOperations(operations);if(!syntax.ok)throw new Error(syntax.reason);
  if(!citizen?.alive||citizen.body?.alive===false)fail('citizen_dead');
  if(!world.citizens.includes(citizen))fail('citizen_not_canonical');
  if(!Array.isArray(inputObjectIds)||inputObjectIds.length<1||inputObjectIds.length>8||inputObjectIds.some(id=>typeof id!=='string'||id.length>160))fail('inputs_bound');
  if(new Set(inputObjectIds).size!==inputObjectIds.length)fail('duplicate_input');
  if(!finite(workMinutes)||workMinutes<=0||workMinutes>1440||!finite(at)||at<0)fail('work_duration_invalid');
  const ambient=Number(world.environment?.temperatureC??18),cap=physicalCapacity(citizen);
  const originals=new Map(),staged=new Map(),bindings=[...inputObjectIds],created=[];
  const actorPosition=positionAt(citizen,activeAction(world,citizen),at);
  for(const id of inputObjectIds){
    const o=world.objects.find(x=>x.id===id);
    if(!o||!finite(o.quantity)||o.quantity<=0||!finite(o.massPerUnitKg)||o.massPerUnitKg<=0||!(Number(o.condition??1)>0)||!MATERIAL_PROPERTIES[o.material]||o.reservedProjectId)fail('input_unavailable');
    const root=attachmentRoot(o,id=>world.objects.find(x=>x.id===id));
    if(attachmentId(o)&&!inputObjectIds.includes(attachmentId(o)))fail('attachment_parent_not_bound');
    if(root.holderId!==citizen.id&&root.holderId!==null&&root.holderId!==undefined)fail('input_not_held');
    if(root.holderId!==citizen.id&&(!root.position||distance(actorPosition,root.position)>2.5))fail('target_out_of_reach');
    originals.set(id,o);staged.set(id,structuredClone(o));
  }
  const observedInputs=inputObjectIds.map(id=>observation(staged.get(id),ambient));
  const sequence=Math.max(0,Number(world.physicalSequence)||0);
  const receiptId=stableId('physical',world.worldId,citizen.id,sequence,at);
  let workJ=0,heatJ=0,ambientHeatJ=0;
  const touched=new Set();
  const slot=index=>{
    if(!Number.isInteger(index)||!bindings[index])fail('slot_unbound');
    const o=staged.get(bindings[index]);if(!o||objectMass(o)<=0)fail('slot_depleted');
    return o;
  };
  const create=(inputs,data)=>{
    if(world.objects.length+created.length>=8192)fail('object_capacity');
    const id=stableId('matter',receiptId,created.length);
    const o={id,kind:'artifact',quantity:1,massPerUnitKg:1,holderId:citizen.id,position:{...actorPosition},condition:1,...data,
      provenance:{type:'PHYSICAL_OPERATION',receiptId,actionId,procedureId,inputObjectIds:inputs.map(x=>x.id)}};
    staged.set(id,o);created.push(id);touched.add(id);return o;
  };
  for(const op of operations){
    const target=slot(op.target),source=op.source!==undefined?slot(op.source):null,tool=op.tool!==undefined?slot(op.tool):null;
    const mass=objectMass(target),p=properties(target),t=temperature(target,ambient);
    const effort=op.workJ??10;
    workJ+=effort;
    if(workJ>1200*cap*workMinutes||workJ>Math.max(0,Number(citizen.body.calories||0)-5)*10000)fail('work_budget_exceeded');
    if(op.forceN>350*cap*(tool?1+Math.min(2,objectMass(tool))*Number(properties(tool).hardness||0):1))fail('force_capability_exceeded');
    if(tool&&tool.id===target.id)fail('tool_is_target');
    if(op.source!==undefined&&source.id===target.id)fail('source_is_target');
    const requireSource=()=>{if(!source)fail('source_required');return source;};
    const resist=required=>{if(effort+1e-9<required)fail('structural_resistance');};
    const lookup=id=>staged.get(id)||world.objects.find(x=>x.id===id);
    const dependants=o=>[...world.objects.filter(x=>!staged.has(x.id)),...staged.values()].filter(x=>objectMass(x)>0&&attachmentId(x)===o.id);
    const destructive=new Set(['separate','join','mix','transfer_matter','shape','compress','contain','support']);
    if(attachmentId(target)&&op.primitive!=='separate'&&!['transfer_heat','cool','ignite','extinguish'].includes(op.primitive))fail('input_attached');
    if(source&&attachmentId(source)&&['join','mix','transfer_matter','contain','support'].includes(op.primitive))fail('source_attached');
    if(destructive.has(op.primitive)&&(dependants(target).length||(source&&['join','mix','transfer_matter'].includes(op.primitive)&&dependants(source).length)))fail('attachment_dependants');
    const fractureWork=(q=mass)=>q*(100+Number(p.hardness||0)*600+Number(p.toughness||0)*100)/(tool?1+Number(properties(tool).hardness||0):1);
    touched.add(target.id);
    if(op.primitive==='separate'){
      if(attachmentId(target)&&op.quantity===undefined){
        if(!source||source.id!==attachmentId(target))fail('attachment_source_required');
        resist(mass*10);delete target.geometry.containedById;delete target.geometry.supportedById;
        target.holderId=citizen.id;target.position={...actorPosition};continue;
      }
      if(attachmentId(target))fail('input_attached');
      const q=op.quantity;if(!finite(q)||q<=0||q>=target.quantity)fail('separation_quantity_invalid');
      const splitMass=q*target.massPerUnitKg;resist(fractureWork(splitMass));
      const oldCapacity=capacity(target),fraction=splitMass/mass;
      target.quantity-=q;target.thermalCapacityJPerK=oldCapacity*(1-fraction);
      const output=create([target],{material:target.material,quantity:q,massPerUnitKg:target.massPerUnitKg,properties:{...p},temperatureC:t,thermalCapacityJPerK:oldCapacity*fraction,geometry:{form:'fragmented'}});
      bindings[op.target]=output.id;
    }else if(['join','mix','transfer_matter'].includes(op.primitive)){
      requireSource();
      const sourceMass=objectMass(source),q=op.primitive==='transfer_matter'?op.quantity:source.quantity;
      if(!finite(q)||q<=0||q>source.quantity)fail('transfer_quantity_invalid');
      const movedMass=q*source.massPerUnitKg;resist((mass+movedMass)*(op.primitive==='mix'?25:70));
      const sourceCapacity=capacity(source),takenCapacity=sourceCapacity*movedMass/sourceMass,targetCapacity=capacity(target),totalCapacity=targetCapacity+takenCapacity;
      const joinedProperties={};
      for(const key of ['density','friction','hardness','toughness','structuralIntegrity','thermalResistance'])joinedProperties[key]=(Number(p[key]||0)*mass+Number(properties(source)[key]||0)*movedMass)/(mass+movedMass);
      const output=create([target,source],{material:target.material===source.material?target.material:'composite',quantity:mass+movedMass,massPerUnitKg:1,properties:joinedProperties,temperatureC:(targetCapacity*t+takenCapacity*temperature(source,ambient))/totalCapacity,thermalCapacityJPerK:totalCapacity,geometry:{form:op.form||'bundle'}});
      target.quantity=0;source.quantity-=q;source.thermalCapacityJPerK=sourceCapacity-takenCapacity;touched.add(source.id);
      for(let i=0;i<bindings.length;i++)if(bindings[i]===target.id||(source.quantity<=0&&bindings[i]===source.id))bindings[i]=output.id;
    }else if(op.primitive==='transfer_heat'){
      requireSource();const q=op.heatJ,sc=capacity(source),tc=capacity(target),st=temperature(source,ambient);
      const maximum=Math.max(0,(st-t)/(1/sc+1/tc));
      if(!finite(q)||q<=0||q>maximum+1e-6)fail('thermal_source_insufficient');
      source.temperatureC=st-q/sc;target.temperatureC=t+q/tc;touched.add(source.id);heatJ+=q;
    }else if(op.primitive==='cool'){
      const q=op.heatJ??Math.max(0,(t-ambient)*capacity(target)*.1);
      if(q<=0||q>Math.max(0,(t-ambient)*capacity(target)))fail('thermal_ambient_limit');
      target.temperatureC=t-q/capacity(target);ambientHeatJ+=q;heatJ+=q;
    }else if(op.primitive==='ignite'){
      if(!p.combustible||!IGNITION[target.material])fail('material_not_combustible');
      if(Number(world.environment?.precipitation||0)>.65)fail('environment_too_wet');
      const needed=Math.max(0,(IGNITION[target.material]-t)*capacity(target));
      if(effort<needed)fail('ignition_energy_insufficient');
      target.temperatureC=t+effort/capacity(target);target.burning=true;
    }else if(op.primitive==='extinguish'){
      requireSource();if(source.material!=='water'||!target.burning)fail('extinguishing_source_invalid');
      resist(mass*10);target.burning=false;
      // Water is not deleted. Contact transfers heat, bounded at equilibrium.
      const tc=capacity(target),sc=capacity(source),st=temperature(source,ambient),q=Math.max(0,(t-st)/(1/tc+1/sc));
      target.temperatureC=t-q/tc;source.temperatureC=st+q/sc;heatJ+=q;touched.add(source.id);
    }else if(['shape','compress'].includes(op.primitive)){
      const pliable=target.material==='clay'||Number(p.hardness||0)<.12||t>700;
      if(!pliable)fail('material_rigid');resist(mass*(op.primitive==='compress'?120:80));
      target.geometry={...target.geometry,form:op.form||'flat',compression:op.primitive==='compress'?Math.min(1,Number(target.geometry?.compression||0)+effort/(mass*10000)):Number(target.geometry?.compression||0)};
    }else if(op.primitive==='move'){
      if(!op.toPosition||distance(actorPosition,op.toPosition)>2.5)fail('transport_out_of_reach');
      if(mass>70*cap)fail('transport_load_exceeded');
      const dependents=dependants(target);
      if(dependents.some(o=>!staged.has(o.id)))fail('attachment_dependencies_not_bound');
      const carriedMass=mass+dependents.reduce((sum,o)=>sum+objectMass(o),0);
      if(carriedMass>70*cap)fail('transport_load_exceeded');
      resist(distance(target.holderId===citizen.id?actorPosition:target.position,op.toPosition)*carriedMass*15);
      target.position={...op.toPosition};target.holderId=null;
      for(const child of dependents){child.position={...op.toPosition};touched.add(child.id);}
    }else if(op.primitive==='rotate'){
      if(!finite(op.angle))fail('rotation_angle_required');resist(mass*Math.abs(op.angle)/180);
      target.geometry={...target.geometry,angle:((Number(target.geometry?.angle||0)+op.angle)%360+360)%360};
    }else if(op.primitive==='contain'||op.primitive==='support'){
      requireSource();const sp=properties(source);
      if(op.primitive==='contain'){
        if(source.geometry?.form!=='hollow')fail('container_geometry_required');
        if(mass>objectMass(source)*4)fail('container_capacity_exceeded');
      }else if(mass>objectMass(source)*Math.max(.1,Number(sp.hardness||0))*10)fail('support_resistance');
      resist(mass*10);
      target.geometry={...target.geometry,[op.primitive==='contain'?'containedById':'supportedById']:source.id};
      if(attachmentRoot(source,lookup).id===target.id)fail('attachment_cycle');
      target.holderId=null;target.position={...(source.holderId===citizen.id?actorPosition:source.position)};
    }else if(['impact','abrade','pierce','apply_force'].includes(op.primitive)){
      resist(op.primitive==='apply_force'?mass*5:fractureWork()*.1);
      const severity=Math.min(.2,effort/Math.max(1,fractureWork()*10));
      target.geometry={...target.geometry};
      if(op.primitive==='impact')target.geometry.fragmentation=Math.min(1,Number(target.geometry.fragmentation||0)+severity);
      if(op.primitive==='abrade')target.geometry.surfaceWear=Math.min(1,Number(target.geometry.surfaceWear||0)+severity);
      if(op.primitive==='pierce')target.geometry.aperture=Math.min(1,Number(target.geometry.aperture||0)+severity);
      if(op.primitive==='apply_force')target.geometry.strain=Math.min(1,Number(target.geometry.strain||0)+severity);
    }
  }
  const originalMass=[...originals.values()].reduce((sum,o)=>sum+objectMass(o),0),finalMass=[...staged.values()].reduce((sum,o)=>sum+objectMass(o),0);
  if(Math.abs(originalMass-finalMass)>1e-6)fail('mass_not_conserved');
  const outputObjectIds=[...new Set([...created.filter(id=>objectMass(staged.get(id))>0),...bindings.filter(id=>touched.has(id)&&objectMass(staged.get(id))>0)])].slice(0,20);
  const observers=world.citizens.filter(c=>c.alive&&c.id!==citizen.id&&distance(positionAt(c,activeAction(world,c),at),actorPosition)<=8).slice(0,12).map(c=>c.id);
  const receipt={id:receiptId,actorId:citizen.id,worldMinute:at,actionId,procedureId,operations:structuredClone(operations),inputObjectIds:[...inputObjectIds],outputObjectIds,observedInputs,observedOutputs:outputObjectIds.map(id=>observation(staged.get(id),ambient)),observerIds:observers,workJ,heatJ,ambientHeatJ};
  const causeIds=[...new Set([...originals.values()].flatMap(o=>[o.provenance?.eventId,o.lastPhysicalEventId]).filter(Boolean))];
  const actionEvent=actionId&&world.ledger.findLast(e=>e.type==='ACTION_STARTED'&&e.payload?.actionId===actionId);
  if(actionEvent)causeIds.push(actionEvent.id);
  const event=appendEvent(world,'PHYSICAL_OPERATIONS_EXECUTED',citizen.id,structuredClone(receipt),causeIds.slice(-16),at);
  receipt.eventId=event.id;receipt.eventSeq=event.seq;
  for(const id of touched){
    const o=staged.get(id);o.lastPhysicalEventId=event.id;
    if(created.includes(id))o.provenance.eventId=event.id;
    if(originals.has(id))Object.assign(originals.get(id),o);
  }
  for(const id of created)world.objects.push(staged.get(id));
  citizen.body.calories=Math.max(0,citizen.body.calories-workJ/10000);
  citizen.possessions=(citizen.possessions||[]).filter(id=>!staged.has(id)||(staged.get(id).holderId===citizen.id&&objectMass(staged.get(id))>0));
  for(const [id,object] of staged)if(object.holderId===citizen.id&&objectMass(object)>0&&!citizen.possessions.includes(id))citizen.possessions.push(id);
  citizen.knownEntityIds??=[citizen.id];for(const id of created)if(!citizen.knownEntityIds.includes(id))citizen.knownEntityIds.push(id);
  world.environment.thermalExchangeJ=Number(world.environment.thermalExchangeJ||0)+ambientHeatJ;
  world.physicalSequence=sequence+1;world.physicalReceipts??=[];world.physicalReceipts.push(structuredClone(receipt));
  if(world.physicalReceipts.length>128)world.physicalReceipts.splice(0,world.physicalReceipts.length-128);
  return receipt;
}
