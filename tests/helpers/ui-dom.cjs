// 외부 라이브러리 없이 화면 템플릿·입력 이벤트·제출을 실행하는 작은 DOM 대역.
module.exports=function uiDom(){
  const ids=new Map(),listeners=new Map(),voids=new Set(['input','br','hr','img','meta','link']);
  function match(node,selector){
    return selector.split(',').some(part=>{
      const chain=part.trim().split(/\s+(?![^\[]*\])/);let at=node;
      function simple(n,s){
        if(!n)return false;
        if(s.includes(':invalid')&&n.checkValidity())return false;
        s=s.replace(/:invalid/g,'');
        const attrs=[...s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
        if(!attrs.every(([,key,value])=>n.hasAttribute(key)&&(value===undefined||n.getAttribute(key)===value)))return false;
        s=s.replace(/\[[^\]]*\]/g,'');
        if([...s.matchAll(/#([\w-]+)/g)].some(([,id])=>n.id!==id))return false;
        if([...s.matchAll(/\.([\w-]+)/g)].some(([,c])=>!n.classList.contains(c)))return false;
        const tag=s.match(/^[\w-]+/)?.[0];return !tag||n.tagName===tag;
      }
      if(!simple(at,chain.pop()))return false;
      while(chain.length){const wanted=chain.pop();at=at.parentNode;while(at&&!simple(at,wanted))at=at.parentNode;if(!at)return false;}
      return true;
    });
  }
  function element(tag='div',attrs={}){
    let value=attrs.value??'',html='';
    const n={tagName:tag,attrs:{...attrs},children:[],parentNode:null,style:{},dataset:{},textContent:'',validationMessage:'',
      getAttribute(k){return this.attrs[k]??null;},hasAttribute(k){return Object.hasOwn(this.attrs,k);},
      setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')ids.set(String(v),this);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);},
      removeAttribute(k){delete this.attrs[k];if(k.startsWith('data-'))delete this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];},
      matches(s){return match(this,s);},closest(s){let at=this;while(at){if(at.matches(s))return at;at=at.parentNode;}return null;},
      querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);},querySelector(s){return this.querySelectorAll(s)[0]??null;},
      append(...nodes){for(const child of nodes){child.parentNode=this;this.children.push(child);}},
      focus(){document.activeElement=this;},select(){},setSelectionRange(){},addEventListener(){},
      dispatchEvent(e){this['on'+e.type]?.({target:this,currentTarget:this});},
      setCustomValidity(v){this.validationMessage=v;},
      checkValidity(){
        if(this.disabled||this.readOnly)return true;
        if(this.validationMessage)return false;
        if(this.required&&!this.value)return false;
        if(this.type!=='number'||!this.value)return true;
        const num=Number(this.value),min=this.getAttribute('min'),max=this.getAttribute('max'),step=this.getAttribute('step');
        if(!Number.isFinite(num)||min!==null&&num<Number(min)||max!==null&&num>Number(max))return false;
        const count=(num-Number(min??this.defaultValue??0))/Number(step??1);return step==='any'||Math.abs(count-Math.round(count))<1e-8;
      },reportValidity(){this.reported=true;return this.checkValidity();},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},
      get elements(){return Object.fromEntries(this.querySelectorAll('[name]').map(e=>[e.getAttribute('name'),e]));},
      get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1];},
      get defaultValue(){return this.attrs.value??'';},
      get value(){return value;},set value(v){value=String(v??'');if(this.type==='number'&&value&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))value='';},
      get innerHTML(){return html;},set innerHTML(v){html=String(v);this.children=[];parse(html,this);}
    };
    for(const key of ['id','type','min','max','step','inputMode','placeholder'])Object.defineProperty(n,key,{get(){return this.attrs[key==='inputMode'?'inputmode':key]??'';},set(v){this.setAttribute(key==='inputMode'?'inputmode':key,v);if(key==='type')this.value=this.value;}});
    for(const key of ['disabled','hidden','required','readOnly','checked'])Object.defineProperty(n,key,{get(){return this.hasAttribute(key==='readOnly'?'readonly':key);},set(v){if(v)this.setAttribute(key==='readOnly'?'readonly':key,'');else this.removeAttribute(key==='readOnly'?'readonly':key);}});
    n.classList={contains:c=>(n.attrs.class??'').split(/\s+/).includes(c),toggle(c,on){const set=new Set((n.attrs.class??'').split(/\s+/).filter(Boolean));on=on??!set.has(c);if(on)set.add(c);else set.delete(c);n.attrs.class=[...set].join(' ');},add(c){this.toggle(c,true);},remove(c){this.toggle(c,false);}};
    Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));return n;
  }
  function parse(html,root){
    const stack=[root];
    for(const token of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)){
      const [full,tag,tail]=token;
      if(full.startsWith('</')){const i=stack.findLastIndex(n=>n.tagName===tag);if(i>0)stack.length=i;continue;}
      const attrs=Object.fromEntries([...tail.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)].map(([,k,v,w])=>[k,v??w??'']));
      const node=element(tag,attrs);stack.at(-1).append(node);if(!voids.has(tag)&&!full.endsWith('/>'))stack.push(node);
    }
    for(const select of root.querySelectorAll('select')){const options=select.querySelectorAll('option');select.value=(options.find(o=>o.hasAttribute('selected'))??options[0])?.getAttribute('value')??'';}
  }
  const body=element('body'),document={body,activeElement:null,
    createElement:tag=>element(tag),createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),
    getElementById(id){if(!ids.has(id)){const n=element('div',{id});body.append(n);}return ids.get(id);},
    querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s),
    addEventListener(type,fn){const list=listeners.get(type)??[];list.push(fn);listeners.set(type,list);}
  };
  return {document,parse:html=>parse(html,body),type(node,value){node.value=value;(listeners.get('input')??[]).forEach(fn=>fn({target:node}));node.oninput?.({target:node});},change(node,value){if(value!==undefined)node.value=value;node.onchange?.({target:node});}};
};
