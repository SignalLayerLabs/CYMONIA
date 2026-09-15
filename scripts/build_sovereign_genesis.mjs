import fs from 'node:fs';
import path from 'node:path';
import {createSovereignGenesis,publicWorld} from '../world/index.js';
const realEpochMs=Date.UTC(2026,8,15,0,0,0);
const world=createSovereignGenesis({seed:20260915,realEpochMs});
const out={kind:'GENESIS_REPLAY',generated_at:new Date(realEpochMs).toISOString(),world:publicWorld(world,realEpochMs)};
fs.mkdirSync(path.resolve('site/data'),{recursive:true});
fs.writeFileSync(path.resolve('site/data/sovereign-genesis.json'),JSON.stringify(out,null,2)+'\n');
console.log('Built sovereign Genesis replay with',out.world.citizens.length,'Citizens');
