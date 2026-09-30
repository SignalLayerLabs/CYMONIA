import {DatabaseSync} from 'node:sqlite';
import {SovereignWorld} from '../../worker/src/index.js';

// Run production SQL and transactions against SQLite, retaining the database
// while recreating the Durable Object to model eviction/restart.
export function sqliteStorage(){
  const db=new DatabaseSync(':memory:');
  const kv=new Map();
  let alarm=null;
  return {
    db,
    sql:{exec(query,...args){
      const statement=db.prepare(query);
      if(statement.columns().length)return statement.all(...args);
      statement.run(...args);
      return [];
    }},
    transactionSync(callback){
      db.exec('BEGIN');
      try{const result=callback();db.exec('COMMIT');return result;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    getAlarm:async()=>alarm,
    setAlarm:async value=>{alarm=value;},
    get:async key=>kv.get(key),
    put:async(key,value)=>{kv.set(key,structuredClone(value));},
  };
}

export async function wake(storage,env={}){
  let ready;
  const messages=[];
  const instance=new SovereignWorld({
    storage,
    blockConcurrencyWhile:callback=>{ready=callback();},
    getWebSockets:()=>[{send:text=>messages.push(JSON.parse(text))}],
  },env);
  await ready;
  return {instance,messages};
}

export async function readWorld(instance){
  const response=await instance.fetch(new Request('https://example.com/world/state'));
  return (await response.json()).world;
}
