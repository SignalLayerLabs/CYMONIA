import { mkdirSync, writeFileSync } from "node:fs";
import { createWorld, advanceWorld, publicWorld } from "../functions/_lib/world-engine.js";
const ticks=Number(process.env.CYMONIA_REPLAY_TICKS||72);const world=advanceWorld(createWorld({seed:20260914}),ticks);mkdirSync("site/data",{recursive:true});writeFileSync("site/data/world.json",JSON.stringify(publicWorld(world),null,2)+"\n");console.log(JSON.stringify({tick:world.tick,citizens:world.citizens.length,companies:world.companies.length,buildings:world.buildings.length,needs:world.needs.length,innovations:world.innovations.length}));
