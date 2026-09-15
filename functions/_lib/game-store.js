import { detectMissions, matchMissions, playerProgress, verifyMissionAnswers } from './missions.js';
import { getParticipationSnapshot, TREASURY_ID } from './store.js';

const first = (db,sql,...args) => db.prepare(sql).bind(...args).first();
const all = async(db,sql,...args) => (await db.prepare(sql).bind(...args).all()).results || [];
function failure(code,status=409){const error=new Error(code);error.status=status;return error;}
const definition=row=>({...JSON.parse(row.definition_json),status:row.status,created_at:row.created_at,completed_at:row.completed_at});

export async function syncMissions(db, snapshot, research, events) {
  const missions=detectMissions(snapshot,research,events);
  if(missions.length) await db.batch(missions.map(m=>db.prepare('INSERT OR IGNORE INTO missions(id,definition_json,reward_cym,xp,role_count) VALUES(?,?,?,?,?)').bind(m.id,JSON.stringify(m),m.reward_cym,m.xp,m.mode==='cooperative'?2:1)));
  const activeIds=events.map(e=>e.id);
  for(const row of await all(db,"SELECT id FROM world_events WHERE status='active'")) if(!activeIds.includes(row.id)) await db.prepare("UPDATE world_events SET status='resolved',resolved_at=datetime('now') WHERE id=?").bind(row.id).run();
  if(events.length) await db.batch(events.map(e=>db.prepare("INSERT INTO world_events(id,definition_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition_json=excluded.definition_json,status='active',resolved_at=NULL").bind(e.id,JSON.stringify(e))));
  return missions.length;
}

export async function getPlayer(db,actorId) {
  const row=actorId?await first(db,`SELECT COALESCE(SUM(xp),0) xp,COALESCE(SUM(reward_cym),0) earned_cym,COUNT(*) proofs_accepted FROM mission_rewards WHERE actor_id=?`,actorId):{};
  const founded=actorId?await first(db,'SELECT COUNT(*) n FROM companies WHERE founder_actor_id=?',actorId):{};
  const crises=actorId?await first(db,"SELECT COUNT(*) n FROM mission_rewards WHERE actor_id=? AND mission_id LIKE 'event:%'",actorId):{};
  const achievements=actorId?await all(db,'SELECT achievement,serial,created_at FROM achievements WHERE actor_id=?',actorId):[];
  return playerProgress({...row,value_created:Number(row?.proofs_accepted||0),companies_founded:founded?.n||0,crises_survived:crises?.n||0,achievements});
}
export async function requireAbility(db,actorId,ability) {
  const p=await getPlayer(db,actorId);
  if(!p.unlocks.includes(ability)) throw failure(`rank_unlock_required:${ability}`,403);
  return p;
}
export async function publicMission(db,row,actorId=null) {
  const {expected,...mission}=definition(row);
  if(actorId){
    mission.my_claim=await first(db,'SELECT role,created_at FROM mission_claims WHERE mission_id=? AND actor_id=?',row.id,actorId);
    mission.attempts=await all(db,'SELECT accepted,reason,message,created_at FROM mission_attempts WHERE mission_id=? AND actor_id=? ORDER BY id DESC LIMIT 5',row.id,actorId);
    mission.my_completed=Boolean(await first(db,'SELECT 1 n FROM mission_rewards WHERE mission_id=? AND actor_id=?',row.id,actorId));
    mission.my_verified=mission.attempts.some(a=>a.accepted===1);
  }
  mission.team=await all(db,'SELECT a.github_login AS login,c.role,EXISTS(SELECT 1 FROM mission_attempts p WHERE p.mission_id=c.mission_id AND p.actor_id=c.actor_id AND p.accepted=1) verified FROM mission_claims c JOIN actors a ON a.id=c.actor_id WHERE c.mission_id=?',row.id);
  return mission;
}
export async function gameSnapshot(db,actorId=null) {
  const base=await getParticipationSnapshot(db,actorId),player=await getPlayer(db,actorId);
  const rows=await all(db,"SELECT * FROM missions ORDER BY (status='completed'),created_at DESC,id LIMIT 150");
  const missions=await Promise.all(rows.map(row=>publicMission(db,row,actorId)));
  const events=(await all(db,"SELECT * FROM world_events WHERE status='active' ORDER BY created_at DESC")).map(e=>({...JSON.parse(e.definition_json),created_at:e.created_at}));
  const history=await all(db,`SELECT r.*,a.github_login login,json_extract(m.definition_json,'$.title') title FROM mission_rewards r JOIN actors a ON a.id=r.actor_id JOIN missions m ON m.id=r.mission_id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 30`);
  const leaderboard=await all(db,`SELECT a.github_login login,SUM(r.reward_cym) earned_cym,SUM(r.xp) xp,COUNT(*) verified_outcomes FROM mission_rewards r JOIN actors a ON a.id=r.actor_id WHERE substr(r.created_at,1,7)=strftime('%Y-%m','now') GROUP BY r.actor_id ORDER BY verified_outcomes DESC,earned_cym DESC,login LIMIT 10`);
  return {...base,player,missions,recommended:matchMissions(missions,player),events,history,leaderboard,season:new Date().toISOString().slice(0,7),value_unit:'independent evidence audits'};
}

export async function startMission(db,id,actorId,{role}={}) {
  const row=await first(db,'SELECT * FROM missions WHERE id=?',id);
  if(!row) throw failure('mission_not_found',404);
  const m=definition(row), player=await getPlayer(db,actorId);
  const existing=await first(db,'SELECT * FROM mission_claims WHERE mission_id=? AND actor_id=?',id,actorId);
  if(existing) return publicMission(db,row,actorId);
  if(row.status==='completed'||row.status==='expired') throw failure('mission_already_completed');
  if(m.difficulty>player.max_difficulty) throw failure('rank_unlock_required:cooperative_missions',403);
  const actor=await first(db,'SELECT actor_type FROM actors WHERE id=?',actorId);
  if(actor?.actor_type!=='human') throw failure('human_player_required',403);
  const current=await first(db,"SELECT COUNT(*) n FROM mission_claims c JOIN missions m ON m.id=c.mission_id WHERE c.actor_id=? AND m.status='active'",actorId);
  if(current.n>=3) throw failure('finish_an_active_mission_first');
  let assigned=`contributor:${actorId}`;
  if(m.mode==='cooperative'){
    const taken=await all(db,'SELECT role FROM mission_claims WHERE mission_id=?',id);
    assigned=role||m.roles.find(r=>!taken.some(t=>t.role===r));
    if(!assigned||!m.roles.includes(assigned)||taken.some(t=>t.role===assigned)) throw failure('team_role_unavailable');
  }
  const fundingKey=`mission:fund:${id}`;
  await db.batch([
    db.prepare("UPDATE missions SET status='active',escrow_cym=reward_cym WHERE id=? AND status='open' AND EXISTS(SELECT 1 FROM wallets WHERE actor_id=? AND earned_cym>=missions.reward_cym)").bind(id,TREASURY_ID),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym-(SELECT reward_cym FROM missions WHERE id=?),updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM missions WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(id,TREASURY_ID,id,fundingKey),
    db.prepare("INSERT OR IGNORE INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,?,'mission_funding',?,('escrow:'||id),reward_cym,'{}' FROM missions WHERE id=? AND status='active'").bind(crypto.randomUUID(),fundingKey,TREASURY_ID,id),
    db.prepare("INSERT OR IGNORE INTO mission_claims(mission_id,actor_id,role) SELECT id,?,? FROM missions WHERE id=? AND status='active'").bind(actorId,assigned,id),
  ]);
  if(!await first(db,'SELECT 1 n FROM mission_claims WHERE mission_id=? AND actor_id=?',id,actorId)) throw failure('mission_unavailable_or_treasury_insufficient');
  return publicMission(db,await first(db,'SELECT * FROM missions WHERE id=?',id),actorId);
}

export async function verifyWork(db,id,actorId,answers) {
  const row=await first(db,'SELECT * FROM missions WHERE id=?',id);
  if(!row) throw failure('mission_not_found',404);
  const claim=await first(db,'SELECT * FROM mission_claims WHERE mission_id=? AND actor_id=?',id,actorId);
  if(!claim) throw failure('start_mission_first',403);
  if(row.status==='completed'){
    const reward=await first(db,'SELECT * FROM mission_rewards WHERE mission_id=? AND actor_id=?',id,actorId);
    return {accepted:Boolean(reward),already_settled:Boolean(reward),reason:reward?'already_verified':'another_solution_verified',message:reward?'Your reward is already in your wallet.':'Another player verified this evidence first. Find a new mission.',reward_cym:0,xp:0,player:await getPlayer(db,actorId)};
  }
  const m=definition(row), result=verifyMissionAnswers(m,answers), previousPlayer=await getPlayer(db,actorId);
  if(row.status!=='active') throw failure('mission_not_active');
  const boundedAnswers=Object.fromEntries(m.proof.map(f=>[f.key,String(answers?.[f.key]??'').slice(0,500)]));
  // Every statement is serialized together by D1. Journal keys guard credit on retry.
  const statements=[db.prepare(`INSERT OR IGNORE INTO mission_attempts(mission_id,actor_id,role,answers_json,accepted,reason,message)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM missions WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM mission_attempts WHERE mission_id=? AND actor_id=? AND accepted=1)`).bind(id,actorId,claim.role,JSON.stringify(boundedAnswers),result.accepted?1:0,result.reason,result.message,id,id,actorId)];
  if(result.accepted) statements.push(
    db.prepare("UPDATE missions SET status='completed',escrow_cym=0,completed_at=datetime('now') WHERE id=? AND status='active' AND (SELECT COUNT(DISTINCT actor_id) FROM mission_attempts WHERE mission_id=? AND accepted=1)>=role_count").bind(id,id),
    db.prepare(`INSERT OR IGNORE INTO mission_rewards(mission_id,actor_id,reward_cym,xp) SELECT p.mission_id,p.actor_id,m.reward_cym/m.role_count,m.xp FROM mission_attempts p JOIN missions m ON m.id=p.mission_id WHERE m.id=? AND m.status='completed' AND p.accepted=1 AND p.id IN(SELECT id FROM mission_attempts WHERE mission_id=? AND accepted=1 ORDER BY id LIMIT (SELECT role_count FROM missions WHERE id=?))`).bind(id,id,id),
    db.prepare(`UPDATE wallets SET earned_cym=earned_cym+(SELECT reward_cym FROM mission_rewards r WHERE r.mission_id=? AND r.actor_id=wallets.actor_id),reputation=reputation+5,updated_at=datetime('now') WHERE actor_id IN(SELECT actor_id FROM mission_rewards WHERE mission_id=?) AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=('mission:pay:'||?||':'||wallets.actor_id))`).bind(id,id,id),
    db.prepare(`INSERT OR IGNORE INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ('mission:pay:'||mission_id||':'||actor_id),('mission:pay:'||mission_id||':'||actor_id),'mission_settlement',('escrow:'||mission_id),actor_id,reward_cym,json_object('mission_id',mission_id,'xp',xp) FROM mission_rewards WHERE mission_id=?`).bind(id),
    db.prepare(`INSERT OR IGNORE INTO achievements(actor_id,achievement,serial) SELECT ?, 'Genesis contributor', (SELECT COUNT(*)+1 FROM achievements WHERE achievement='Genesis contributor') WHERE EXISTS(SELECT 1 FROM mission_rewards WHERE actor_id=?) AND (SELECT COUNT(*) FROM achievements WHERE achievement='Genesis contributor')<100`).bind(actorId,actorId),
  );
  await db.batch(statements);
  const reward=await first(db,'SELECT * FROM mission_rewards WHERE mission_id=? AND actor_id=?',id,actorId),player=await getPlayer(db,actorId);
  return {...result,waiting_for_team:result.accepted&&!reward,message:result.accepted&&!reward?'Your evidence is verified. The other independent team role must also pass before payment.':result.message,
    impact:reward?m.impact:null,reward_cym:reward?reward.reward_cym:0,xp:reward?reward.xp:0,player,unlocked:player.unlocks.filter(x=>!previousPlayer.unlocks.includes(x))};
}
export async function missionMentorContext(db,id,actorId){
  const row=await first(db,'SELECT * FROM missions WHERE id=?',id);
  if(!row) throw failure('mission_not_found',404);
  if(!await first(db,'SELECT 1 n FROM mission_claims WHERE mission_id=? AND actor_id=?',id,actorId)) throw failure('start_mission_first',403);
  const m=await publicMission(db,row,actorId);
  return {title:m.title,economic_reason:m.why,steps:m.steps,evidence:m.evidence,proof:m.proof,previous_attempts:m.attempts,prohibited_changes:['Never change the source evidence.','Never change balances, rewards, Constitution or validation.'],next_step:m.steps[0]};
}
