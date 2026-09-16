import assert from 'node:assert/strict';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);

const browser = await chromium.launch({ headless: true });
const url = process.env.CYMONIA_URL || 'http://127.0.0.1:8765';

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 }
});

const errors = [];
let stateCalls = 0;

page.on('pageerror', error => {
  errors.push(error.message);
});

/*
 * Browser smoke must be deterministic and must not depend on external CDNs.
 * The production shell keeps Pixi/Matter, while this integration test
 * intentionally exercises the Canvas fallback.
 */
await page.route('https://cdn.jsdelivr.net/**', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  });
});

const epoch = Date.now() - 10_200;

const liveWorld = {
  version: 2,
  worldId: 'sovereign-browser-smoke',
  clock: {
    worldMinute: 10,
    realEpochMs: epoch
  },
  environment: {
    temperatureC: 18,
    precipitation: 0.12,
    dayPhase: 0.4,
    seasonPhase: 0.2
  },
  citizens: [
    {
      id: 'genesis:001',
      kind: 'GENESIS',
      selfName: null,
      observerDisplayName: null,
      alive: true,
      position: { x: 10, y: 10 },
      birthWorldMinute: -10000000,
      deathWorldMinute: null,
      body: {
        hydration: 80,
        calories: 80,
        sleepPressure: 20,
        health: 100,
        ageMinutes: 12000000,
        diseases: 0,
        injuries: 0
      },
      psychology: {
        curiosity: 0.7,
        empathy: 0.6
      },
      knowledge: [],
      language: {
        primitiveSignals: ['attention'],
        lexicon: {}
      },
      knownEntityIds: ['genesis:001'],
      relationships: {},
      possessions: [],
      activeGoal: null,
      currentAction: {
        id: 'act:test',
        type: 'MOVE',
        purpose: 'explore',
        startedWorldMinute: 10,
        endsWorldMinute: 90,
        fromPosition: { x: 10, y: 10 },
        targetPosition: { x: 18, y: 10 },
        targetId: null
      }
    }
  ],
  objects: [],
  resourceDeposits: [],
  buildings: [],
  organizations: [],
  claims: [],
  projects: [],
  history: [],
  recentLedger: [],
  ledgerHead: 'test'
};

await page.route('**/api/v2/state', async route => {
  stateCalls++;

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      world: liveWorld
    })
  });
});

/*
 * Python http.server has no websocket endpoint.
 * Keep the socket stable for this browser integration test.
 * WebSocket reconnect semantics have their own unit coverage.
 */
await page.addInitScript(() => {
  window.WebSocket = class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = MockWebSocket.CONNECTING;

      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({ type: 'open' });
      }, 0);
    }

    send() {}

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;

      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({
        type: 'close',
        code: 1000,
        wasClean: true
      });
    }
  };
});

try {
  await page.goto(`${url}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  await page.waitForSelector('#worldCanvas', {
    state: 'visible',
    timeout: 10000
  });

  /*
   * A population of exactly 1 proves that the canonical fixture was accepted.
   * Genesis replay contains 100 Citizens, so replay cannot satisfy this check.
   */
  await page.waitForFunction(
    () => document.querySelector('#populationValue')?.textContent === '1',
    null,
    { timeout: 10000 }
  );

  assert.ok(
    stateCalls >= 1,
    'canonical state endpoint must be requested'
  );

  assert.equal(
    await page.locator(
      '.hud,.world-grid,.analysis-grid,.agents-panel,.ledger-panel,#researchView,#participateView,#protocolView'
    ).count(),
    0
  );

  assert.ok(
    await page.locator('#worldCanvas').isVisible()
  );

  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight + 2
    ),
    false
  );

  await page.waitForFunction(
    () => typeof window.render_game_to_text === 'function',
    null,
    { timeout: 5000 }
  );

  const first = JSON.parse(
    await page.evaluate(() => window.render_game_to_text())
  );

  assert.equal(first.citizens.length, 1);
  assert.equal(first.citizens[0].id, 'genesis:001');

  const before = first.citizens[0].x;

  await page.waitForTimeout(500);

  const second = JSON.parse(
    await page.evaluate(() => window.render_game_to_text())
  );

  const after = second.citizens[0].x;

  assert.ok(
    after > before,
    `expected fractional canonical movement: ${before} -> ${after}`
  );

  await page.locator('#historyOpen').click();

  assert.ok(
    await page.locator('#societyHistory').isVisible()
  );

  assert.ok(
    await page.locator('#worldCanvas').isVisible()
  );

  await page.locator('#historyClose').click();

  assert.equal(
    await page.locator('#societyHistory').isVisible(),
    false
  );

  await page.setViewportSize({
    width: 390,
    height: 844
  });

  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );

  assert.deepEqual(
    errors,
    [],
    `browser page errors: ${errors.join(' | ')}`
  );

  console.log(
    'PASS: canonical state rendering, fractional movement, game-only shell, history, mobile containment and zero page errors.'
  );
} finally {
  await browser.close();
}
