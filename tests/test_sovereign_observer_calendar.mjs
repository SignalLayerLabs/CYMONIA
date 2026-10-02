import test from 'node:test';
import assert from 'node:assert/strict';
import {ObserverCalendar} from '../site/observer-calendar.js';

function fixture(){
  let now=0;
  const calendar=new ObserverCalendar({nowFn:()=>now});
  const world=minute=>({worldId:'existing-world',clock:{worldMinute:minute}});
  return {calendar,world,at:ms=>{now=ms;return calendar.minute();}};
}

test('confirmed minutes visibly advance at one world minute per real second',()=>{
  const f=fixture();f.calendar.accept(f.world(100));
  assert.equal(f.at(0),40);
  assert.equal(f.at(1250),41.25);
  assert.equal(f.at(2000),42);
});

test('an interrupted connection freezes exactly at the last confirmed minute',()=>{
  const f=fixture();f.calendar.accept(f.world(100));
  assert.equal(f.at(60000),100);
  assert.equal(f.at(3600000),100);
});

test('repeated polls do not restart or rewind calendar playback',()=>{
  const f=fixture();f.calendar.accept(f.world(100));
  assert.equal(f.at(10000),50);
  f.calendar.accept(f.world(100));
  assert.equal(f.at(12000),52);
  f.calendar.accept(f.world(120));
  assert.equal(f.at(13000),53);
  f.calendar.accept(f.world(90));
  assert.equal(f.at(14000),54);
  assert.equal(f.at(100000),120);
});

test('calendar never announces an uncommitted year',()=>{
  const f=fixture();f.calendar.accept(f.world(525599));
  assert.equal(Math.floor(f.at(60000)/525600)+1,1);
  assert.equal(Math.floor(f.at(120000)/525600)+1,1);
  f.calendar.accept(f.world(525601));
  assert.equal(Math.floor(f.at(121000)/525600)+1,2);
  assert.equal(f.at(125000),525601);
});

test('Genesis replay stays frozen and a canonical connection starts its own clock',()=>{
  const f=fixture();f.calendar.accept({worldId:'replay',clock:{worldMinute:10}},{canonical:false});
  assert.equal(f.at(100000),10);
  f.calendar.accept(f.world(100));
  assert.equal(f.at(101000),41);
});

test('young worlds never display negative minutes or advance beyond Genesis',()=>{
  const f=fixture();f.calendar.accept(f.world(0));
  assert.equal(f.at(10000),0);
  f.calendar.accept(f.world(3));
  assert.equal(f.at(12000),2);
  assert.equal(f.at(14000),3);
});
