import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("main CI gates Cloudflare production deployment on test and browser smoke", async () => {
  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /deploy-cloudflare:/);
  assert.match(ci, /paths-ignore:[\s\S]*state\/\*\*/);
  assert.match(ci, /needs:\s*\[test, browser-smoke\]/);
  assert.match(ci, /github\.event_name == 'push'.*github\.ref == 'refs\/heads\/main'/);
  assert.match(ci, /wrangler d1 migrations apply cymonia-participation --remote --env production/);
  assert.match(ci, /wrangler pages deploy site --project-name cymonia --branch main/);
  assert.match(ci, /npm install --no-save wrangler@4/);
  assert.match(ci, /CLOUDFLARE_API_TOKEN/);
  assert.match(ci, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(ci, /https:\/\/cymonia\.pages\.dev\/api\/health/);
});

test("GitHub Pages is a manual mirror and production Wrangler binds D1 plus Workers AI", async () => {
  const pages = await read(".github/workflows/pages.yml");
  const wrangler = await read("wrangler.toml");
  assert.match(pages, /workflow_dispatch:/);
  assert.doesNotMatch(pages, /\n\s*push:/);
  assert.match(wrangler, /\[env\.production\.ai\][\s\S]*binding = "AI"/);
  assert.match(wrangler, /\[\[env\.production\.d1_databases\]\][\s\S]*database_name = "cymonia-participation"/);
  assert.match(wrangler, /BRAIN_MODEL = "@cf\/zai-org\/glm-4\.7-flash"/);
});
