const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/back-to-top.js'), 'utf8');
function setup({y=0, reduced=false, userAgent='Chrome/128.0.0.0 Mobile Safari/537.36'}={}){
  const buttons=[], listeners=new Map(), clicks=new Map(), calls=[];
  const document={documentElement:{scrollHeight:2000}, querySelector:()=>buttons[0]||null,
    createElement:()=>({hidden:false, setAttribute(){}, addEventListener:(type,fn)=>clicks.set(type,fn)}),
    body:{append:b=>buttons.push(b)}};
  const window={scrollY:y,innerHeight:800,addEventListener:(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]),
    scrollTo:options=>calls.push(options)};
  const context=vm.createContext({document,window,navigator:{userAgent},matchMedia:()=>({matches:reduced})});
  const run=()=>vm.runInContext(source,context);
  run();
  const emit=type=>(listeners.get(type)||[]).forEach(fn=>fn());
  return {buttons,button:buttons[0],calls,run,emit,
    scroll:y=>{window.scrollY=y;emit('scroll');},click:()=>clicks.get('click')()};
}

test('내려갈 때 숨기고 위로 조금 되돌릴 때만 보이며, 다시 내려가면 즉시 숨긴다',()=>{
  const h=setup({y:400});
  assert.equal(h.button.hidden,true,'복원한 스크롤 위치에서도 처음에는 숨김');
  h.scroll(600);assert.equal(h.button.hidden,true);
  h.scroll(596);assert.equal(h.button.hidden,true,'작은 흔들림에는 표시하지 않음');
  h.scroll(591);assert.equal(h.button.hidden,false);
  h.scroll(592);assert.equal(h.button.hidden,true,'아래로 움직이면 바로 숨김');
  h.scroll(589);assert.equal(h.button.hidden,true,'방향을 바꾸면 위로 간 거리를 새로 셈');
  h.scroll(580);assert.equal(h.button.hidden,false);
  h.scroll(160);assert.equal(h.button.hidden,true,'맨 위 근처에서는 숨김');
});

test('맨 아래·탄성 스크롤의 복귀로 버튼이 나타나지 않는다',()=>{
  const h=setup();
  h.scroll(1200);assert.equal(h.button.hidden,true);
  h.scroll(1230);h.scroll(1210);h.scroll(1200);
  assert.equal(h.button.hidden,true,'아래 끝을 넘겼다 돌아와도 위로 읽는 동작으로 취급하지 않음');
  h.scroll(1199);assert.equal(h.button.hidden,true);
  h.scroll(1180);assert.equal(h.button.hidden,false,'끝에서 실제로 위로 되돌릴 때는 표시');
  h.scroll(1200);assert.equal(h.button.hidden,true);
  h.scroll(-20);h.scroll(0);assert.equal(h.button.hidden,true);
});

test('버튼을 누른 뒤 맨 위로 이동하는 동안 다시 나타나지 않는다',()=>{
  const h=setup();
  h.scroll(700);h.scroll(680);assert.equal(h.button.hidden,false);
  h.click();assert.equal(h.button.hidden,true);
  assert.equal(h.calls[0].behavior,'smooth');assert.equal(h.calls[0].top,0);
  for(const y of [600,400,180,100,0]){h.scroll(y);assert.equal(h.button.hidden,true);}
  h.scroll(500);h.scroll(480);assert.equal(h.button.hidden,false,'이동이 끝나면 다음 위쪽 스크롤에 다시 표시');
});

test('동작 줄이기에서는 즉시 이동하며 복귀·화면 크기 변경 뒤에는 숨긴다',()=>{
  const h=setup({reduced:true});
  h.scroll(700);h.scroll(680);h.click();assert.equal(h.calls[0].behavior,'instant');
  h.scroll(0);h.scroll(500);h.scroll(480);assert.equal(h.button.hidden,false);
  h.emit('pageshow');assert.equal(h.button.hidden,true);
  h.scroll(460);assert.equal(h.button.hidden,false);
  h.emit('resize');assert.equal(h.button.hidden,true);
});

test('같은 스크립트가 다시 실행돼도 맨 위 버튼은 한 개만 만든다',()=>{
  const h=setup();h.run();h.run();
  assert.equal(h.buttons.length,1);
});

test('삼성 인터넷에서도 위로 되돌릴 때만 사이트 버튼을 표시하고 아래로 이동하면 숨긴다',()=>{
  const h=setup({userAgent:'Mozilla/5.0 (Linux; Android 15) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36'});
  assert.equal(h.buttons.length,1);
  h.scroll(1200);assert.equal(h.button.hidden,true);
  h.scroll(1180);assert.equal(h.button.hidden,false);
  h.scroll(1190);assert.equal(h.button.hidden,true);
  h.scroll(1170);assert.equal(h.button.hidden,false);
  h.click();assert.equal(h.button.hidden,true);
  assert.equal(h.calls[0].top,0);
  h.run();assert.equal(h.buttons.length,1);
});
