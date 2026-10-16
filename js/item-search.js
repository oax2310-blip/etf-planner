// 자산 배분 종목 검색 칸. 분할매수·분할매도·재매수 계획 창이 같은 검색 입력·결과 목록·선택·변경·키보드·직접 입력 처리를 쓴다.
// 이 파일만 고치면 세 창이 함께 바뀐다. 목록 출처·설명·고른 뒤 처리는 각 창이 넘기고, 이 파일은 기록을 읽거나 저장하지 않는다.
// 검색: 행의 words(이름·그룹·소분류·종목 코드·실제 거래 코드)에 띄어 쓴 낱말이 모두 들어간 행(대소문자 무시).
// 선택: 목록을 누르거나 검색 칸에서 Enter(첫 행). 고르면 검색어를 비우고 한 줄(.purchase-picked)로 접으며 '변경'으로 다시 검색한다(locked면 '변경' 없음).
// 직접 입력: manual을 넘긴 창(분할매도·재매수)만, 맞는 종목이 없을 때 버튼이나 Enter로 검색어를 창의 입력 칸에 넘긴다. 분할매수는 자산 배분 종목만 고른다.
// 화면 글자는 모두 이스케이프한다.
const itemSearch = (()=>{
const escS=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function match(rows, query){
  const terms=String(query??"").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r=>{const hay=(r.words||[]).filter(Boolean).join(" ").toLowerCase();return terms.every(w=>hay.includes(w));});
}
// host: 검색 칸을 넣을 요소(창의 .field 안). o = {id: 만들 요소 id 앞부분, label: 칸 이름 요소 id, empty: 고를 종목이 없을 때 글자,
//   rows() → [{id, name, info, badge?, words}], current() → 고른 종목 {name, info} 또는 null, locked?() → true면 '변경' 숨김,
//   pick(id), repick(), manual?: {label: 검색어 → 버튼 글자, fill: 검색어 → 창의 입력 칸 채우기}}
function create(host, o){
  const make=(tag,props,attrs={})=>{const node=Object.assign(document.createElement(tag),props);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const list=make("div",{className:"purchase-pick",id:`${o.id}ItemList`},{role:"listbox","aria-labelledby":o.label});
  const input=make("input",{type:"search",id:`${o.id}Search`,placeholder:"이름·종목 코드·그룹으로 검색",autocomplete:"off",spellcheck:false},{enterkeyhint:"search","aria-labelledby":o.label,"aria-controls":list.id});
  const box=make("div",{className:"item-search-box",id:`${o.id}SearchBox`}), picked=make("div",{className:"purchase-picked",id:`${o.id}Picked`,hidden:true});
  box.append(input,list);host.append(box,picked);
  let shown=[];
  function render(){
    const cur=o.current();picked.hidden=!cur;box.hidden=!!cur;
    if(cur){shown=[];picked.innerHTML=`<div><strong>${escS(cur.name)}</strong><small>${escS(cur.info)}</small></div>${o.locked?.()?"":`<button class="btn mini" type="button" data-repick>변경</button>`}`;return;}
    const q=input.value.trim();shown=match(o.rows(),q);
    list.innerHTML=shown.length?shown.map(r=>`<button type="button" role="option" aria-selected="false" class="purchase-opt" data-pick="${escS(r.id)}"><span><strong>${escS(r.name)}</strong><small>${escS(r.info)}</small></span>${r.badge?`<em>${escS(r.badge)}</em>`:""}</button>`).join("")
      :`<p class="purchase-none">${q?`‘${escS(q)}’에 맞는 종목이 없습니다.`:escS(o.empty)}</p>${o.manual&&q?`<button class="btn mini item-search-manual" type="button" data-manual>${escS(o.manual.label(q))}</button>`:""}`;
  }
  const pick=id=>{input.value="";o.pick(id);render();}; // '변경'으로 다시 열면 전체 목록부터
  const manual=q=>{input.value="";o.manual.fill(q);render();};
  input.oninput=render;
  input.onkeydown=e=>{
    if(e.key==="Enter"){e.preventDefault();const q=input.value.trim();if(shown[0])pick(shown[0].id);else if(o.manual&&q)manual(q);}
    else if(e.key==="ArrowDown"){const first=list.querySelector("[data-pick],[data-manual]");if(first){e.preventDefault();first.focus();}}
  };
  list.onkeydown=e=>{const b=e.target.closest?.("[data-pick],[data-manual]");if(!b||!["ArrowDown","ArrowUp"].includes(e.key))return;e.preventDefault();
    const next=e.key==="ArrowDown"?b.nextElementSibling:b.previousElementSibling;(next?.tagName==="BUTTON"?next:e.key==="ArrowUp"?input:null)?.focus();};
  list.onclick=e=>{const b=e.target.closest?.("[data-pick]");if(b){pick(b.dataset.pick);return;}if(e.target.closest?.("[data-manual]")&&o.manual)manual(input.value.trim());};
  picked.onclick=e=>{if(!e.target.closest?.("[data-repick]"))return;o.repick();render();input.focus();};
  return {render,input,list,picked,focus:()=>input.focus(),clear(){input.value="";}};
}
return {create,match};
})();
