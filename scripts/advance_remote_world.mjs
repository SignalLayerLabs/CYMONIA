// Use the same transactional mutation path as human Citizens.
const { CYMONIA_WORLD_URL, WORLD_ADVANCE_TOKEN } = process.env;
if (!CYMONIA_WORLD_URL && !WORLD_ADVANCE_TOKEN) {
  console.log('Autonomous World: remote clock is not configured (static replay only).');
  process.exit(0);
}
if (!CYMONIA_WORLD_URL || !WORLD_ADVANCE_TOKEN) throw new Error('Remote clock needs CYMONIA_WORLD_URL and WORLD_ADVANCE_TOKEN.');
const endpoint = new URL('/api/world/advance', CYMONIA_WORLD_URL);
if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('Remote world URL must use HTTPS.');
const ticks = Number(process.env.CYMONIA_REMOTE_TICKS || 1);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 12) throw new Error('CYMONIA_REMOTE_TICKS must be an integer from 1 to 12.');
const response = await fetch(endpoint, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
  headers: { authorization: `Bearer ${WORLD_ADVANCE_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ticks }),
});
if (!response.ok) throw new Error(`Remote world rejected the tick (HTTP ${response.status}).`);
const result = await response.json();
if (!result.ok || !Number.isInteger(result.tick)) throw new Error('Remote world returned an invalid acknowledgement.');
console.log(JSON.stringify({ ok: true, tick: result.tick, metrics: result.metrics }));
