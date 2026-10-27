// 자산 배분의 편입 표시에서 온 이동(#go?tab=…&id=…). 탭과 선택 종목을 정하고, 그려진 뒤 그 카드로 스크롤하며 잠깐 강조한다.
// 선택은 목록을 직접 누를 때와 같은 화면 상태(selectedPlan·selectedRebuy·분할매수 선택)만 바꾸고 새 저장 필드를 만들지 않는다. 주소 형식은 member-link.js.
const memberGo = (()=>{
let pending=null, frame=0, waitingLoad=false;
// 분할매도·재매수: 주소의 id(없던 옛 항목은 '#순번')가 가리키는 목록 위치. 순번은 목록 범위 안의 0 이상 정수만 허용하며, 없으면 -1.
const indexOf = (list, id) => id.startsWith("#") ? (/^#\d+$/.test(id)&&Number(id.slice(1))<list.length ? Number(id.slice(1)) : -1) : list.findIndex(x=>x&&x.id===id);
function select(t){
  if(t.tab==="plans"){const i=indexOf(state.plans,t.id);if(i<0)return false;state.selectedPlan=state.plans[i].id;return true;}
  if(t.tab==="rebuy"){
    const list=rebuyItems(state), i=indexOf(list,t.id);if(i<0)return false;
    state.selectedRebuy=list[i].id||null;return true;
  }
  const it=(assetStore.doc.allocation?.groups||[]).flatMap(g=>g.items||[]).find(x=>x.id===t.id&&x.buyPlan);
  if(!it)return false;purchasePlanner.select(it.id);return true;
}
// 해시가 이동 주소면 탭을 열고 true. 대상이 이미 없어졌으면 탭만 연다.
function open(){
  const t=memberLink.parse(location.hash);if(!t)return false;
  pending=select(t)?t:null;
  if(!pending)history.replaceState(null,"",`#${t.tab}`);
  openTab(t.tab);return true;
}
function nodeOf(t){
  if(t.tab==="plans")return [...$$("[data-plan]")].find(x=>x.dataset.plan===state.selectedPlan);
  if(t.tab==="rebuy")return [...$$("[data-rebuy]")].find(x=>rebuyItems(state)[Number(x.dataset.rebuy)]===rebuyPick());
  return [...$$("[data-purchase-select]")].find(x=>x.dataset.purchaseSelect===t.id);
}
// 화면 렌더링 뒤마다 부른다. 페이지 로딩·폰트가 끝나 위치가 정해진 다음에 한 번만 이동한다.
function schedule(){
  if(!pending||document.hidden)return;
  if(document.readyState!=="complete"){if(!waitingLoad){waitingLoad=true;addEventListener("load",()=>{waitingLoad=false;schedule();},{once:true});}return;}
  if(document.fonts?.status==="loading"){const t=pending;document.fonts.ready.then(()=>{if(pending===t)schedule();});return;}
  if(frame)cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
    frame=0;const t=pending;if(!t||document.hidden||state.tab!==t.tab)return;
    const node=nodeOf(t);pending=null;history.replaceState(null,"",`#${state.tab}`);if(!node?.isConnected)return;
    scrollBelowTop(node);node.focus({preventScroll:true});flashTarget(node);
  });
}
return {open,schedule};
})();
