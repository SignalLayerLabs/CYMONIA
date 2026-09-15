import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const renderer=fs.readFileSync(new URL('../site/sovereign-renderer.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');

test('relations overlay renders canonical relationship edges',()=>{
  assert.match(renderer,/drawRelations\(/);
  assert.match(renderer,/relationships/);
  assert.match(renderer,/this\.overlay==='relations'/);
});

test('citizen follow projection uses explicit coordinates and inspector formats structured goals',()=>{
  assert.doesNotMatch(renderer,/project\(\.\.\.Object\.values/);
  assert.match(app,/goalLabel/);
  assert.match(app,/actionTypes/);
});
