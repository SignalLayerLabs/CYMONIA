async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function run(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

export async function upsertHumanFromGitHub(db, githubUser) {
  const githubId = Number(githubUser?.id);
  const login = String(githubUser?.login || "").trim();
  if (!Number.isSafeInteger(githubId) || githubId <= 0 || !login) throw new TypeError("github_identity_invalid");
  const existing = await first(db, "SELECT * FROM actors WHERE github_id=?", githubId);
  const actorId = existing?.id || `human:github:${githubId}`;
  await run(
    db,
    "INSERT INTO actors(id,actor_type,github_id,github_login,display_name,avatar_url) VALUES(?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login, display_name=excluded.display_name, avatar_url=excluded.avatar_url",
    actorId,
    "human",
    githubId,
    login,
    githubUser?.name ? String(githubUser.name).slice(0, 200) : null,
    githubUser?.avatar_url ? String(githubUser.avatar_url).slice(0, 500) : null,
  );
  return { actor: await first(db, "SELECT * FROM actors WHERE github_id=?", githubId) };
}

export async function getSessionActor(db, tokenHash) {
  if (!tokenHash) return null;
  return first(db, `SELECT a.* FROM sessions s JOIN actors a ON a.id=s.actor_id
    WHERE s.token_hash=? AND s.expires_at>datetime('now')`, tokenHash);
}

export async function createSession(db, actorId, tokenHash, expiresAt) {
  await run(db, "INSERT INTO sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)", tokenHash, actorId, expiresAt);
}

export async function deleteSession(db, tokenHash) {
  if (tokenHash) await run(db, "DELETE FROM sessions WHERE token_hash=?", tokenHash);
}

export async function saveOauthState(db, stateHash, returnTo, expiresAt) {
  await run(db, "INSERT INTO oauth_states(state_hash,return_to,expires_at) VALUES(?,?,?)", stateHash, returnTo, expiresAt);
}

export async function consumeOauthState(db, stateHash) {
  const state = await first(db, "SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>datetime('now')", stateHash);
  if (!state) return null;
  await run(db, "DELETE FROM oauth_states WHERE state_hash=?", stateHash);
  return state;
}
