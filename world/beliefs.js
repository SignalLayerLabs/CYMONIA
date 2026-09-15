import {stableId} from './rng.js';
import {knows,learn} from './epistemics.js';
import {appendEvent} from './ledger.js';

const STANCES=new Set(['supports','opposes','uncertain','sacred','taboo','causal','identity','normative']);
export function adoptBelief(world,citizen,{stanceCode='uncertain',conceptIds=[],confidence=.5}={},source={kind:'reflection'},at=world.clock.worldMinute){
  const concepts=[...new Set((conceptIds||[]).map(String))].slice(0,12);
  for(const concept of concepts)if(!knows(citizen,concept))throw new Error(`unknown_concept:${concept}`);
  const stance=STANCES.has(stanceCode)?stanceCode:'uncertain';
  const id=stableId('belief',citizen.id,stance,concepts.join('|'));
  let belief=(citizen.beliefs||[]).find(b=>b.id===id);
  if(belief){belief.confidence=Math.max(0,Math.min(1,Number(confidence)||0));belief.source=source;belief.updatedWorldMinute=at;return belief;}
  belief={id,stanceCode:stance,conceptIds:concepts,confidence:Math.max(0,Math.min(1,Number(confidence)||0)),truthStatus:'unverified',source,createdWorldMinute:at,updatedWorldMinute:at};
  citizen.beliefs??=[];citizen.beliefs.push(belief);
  appendEvent(world,'BELIEF_ADOPTED',citizen.id,{beliefId:id,stanceCode:stance,conceptIds:concepts,confidence:belief.confidence},[],at);
  return belief;
}
export function shareBelief(world,sender,receiver,beliefId,at=world.clock.worldMinute){
  const belief=(sender.beliefs||[]).find(b=>b.id===beliefId);if(!belief)throw new Error('belief_not_found');
  for(const concept of belief.conceptIds)if(!knows(receiver,concept))learn(receiver,concept,{kind:'communication',from:sender.id,evidence:{beliefId}},Math.max(.2,belief.confidence*.55),at);
  const copy=adoptBelief(world,receiver,{stanceCode:belief.stanceCode,conceptIds:belief.conceptIds,confidence:belief.confidence*.72},{kind:'communication',from:sender.id,beliefId},at);
  appendEvent(world,'BELIEF_SHARED',sender.id,{receiverId:receiver.id,beliefId,receiverBeliefId:copy.id},[beliefId],at);
  return copy;
}
