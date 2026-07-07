"use strict";
(function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

/* ══════════ 저장: IndexedDB (+ localStorage 폴백) ══════════ */
const DB_NAME="studytool", STORE="kv";
let _db=null;
function openDB(){
  return new Promise((res,rej)=>{
    if(_db)return res(_db);
    if(!window.indexedDB)return rej("no-idb");
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
    req.onsuccess=()=>{_db=req.result;res(_db);};
    req.onerror=()=>rej(req.error);
  });
}
async function idbSet(key,val){
  try{const db=await openDB();return await new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(val,key);tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error);});}
  catch(e){ try{localStorage.setItem(DB_NAME+":"+key,JSON.stringify(val));return true;}catch(_){return false;} }
}
async function idbGet(key){
  try{const db=await openDB();return await new Promise((res,rej)=>{const tx=db.transaction(STORE,"readonly");const r=tx.objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
  catch(e){ try{const v=localStorage.getItem(DB_NAME+":"+key);return v?JSON.parse(v):undefined;}catch(_){return undefined;} }
}

/* ══════════ 상수 ══════════ */
const PALETTE=["#2F4A6B","#3E7C63","#7A4E6B","#9A7B4A","#4A6B8A","#6B7A4E","#8A5A4A","#5A6B7A"];
const REVIEW_STEPS=[1,3,7]; // 망각곡선: 1일→3일→7일 (최소 2회 이상 반복)
const DEFAULT_TREE={
  "공학":{color:"#2F4A6B", fields:{
    "일반기계기사":["기계제도","기계설계","유압기기","기계재료","기계제작법","재료역학","동역학","열역학","유체역학"],
    "전기기사":["전기자기학","전력공학","전기기기","회로이론 및 제어공학","전기설비기술기준"]
  }},
  "어학":{color:"#3E7C63", fields:{ "_":["영어회화","영어단어","일본어"] }},
  "문학":{color:"#7A4E6B", fields:{ "_":["한국문학"] }},
  "신앙":{color:"#9A7B4A", fields:{ "_":["성경구절"] }},
};
const TYPE_LABELS={
  "개념":{front:"용어",back:"정의",aux1:"보충 설명",aux2:"예시·팁"},
  "번역":{front:"원문",back:"번역",aux1:"문법 포인트",aux2:"발음·예문"},
  "구절":{front:"제목·위치",back:"구절·내용",aux1:"해설",aux2:"작가·특징"},
  "공식":{front:"상황·문제",back:"공식",aux1:"변수 설명",aux2:"암기 팁"},
  "손글씨":{front:"질문",back:"손글씨",aux1:"보충",aux2:"팁"},
};

/* ══════════ 상태 ══════════ */
let cards=[], tree={}, tab="study";
let curCat="all", curField="all", curSub="all";
let editingId=null, actionId=null, currentImg=null;
let mathReady=false, padColor="#2F4A6B", curType="개념";
const PADS={};
const memoState={};
let activity={}; // 날짜별 활동 수 {"2026-07-07": 12, ...}
async function bumpActivity(n){const k=todayStr();activity[k]=(activity[k]||0)+(n||1);await idbSet("activity",activity);}

/* ══════════ 날짜 유틸 ══════════ */
function todayStr(){const d=new Date();return d.toISOString().slice(0,10);}
function addDays(n){const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function isDue(c){ if(c.status==="inbox")return false; if(!c.due)return true; return c.due<=todayStr(); } // due 없으면 미학습→대상
function dueCount(){ return cards.filter(c=>c.status!=="inbox"&&isDue(c)).length; }

/* ══════════ 저장/로드 ══════════ */
async function persist(){ await idbSet("cards",cards); await idbSet("tree",tree); }
async function saveCards(){ await idbSet("cards",cards); }
async function saveTree(){ await idbSet("tree",tree); }
async function load(){
  const c=await idbGet("cards"); if(Array.isArray(c))cards=c;
  const t=await idbGet("tree"); if(t&&typeof t==="object"&&Object.keys(t).length)tree=t;
  const a=await idbGet("activity"); if(a&&typeof a==="object")activity=a;
  if(!tree||!Object.keys(tree).length)tree=JSON.parse(JSON.stringify(DEFAULT_TREE));
  // 마이그레이션: 신학 → 신앙 (트리 + 카드)
  if(tree["신학"]&&!tree["신앙"]){ tree["신앙"]=tree["신학"]; delete tree["신학"]; }
  cards.forEach(c=>{ if(c.cat==="신학")c.cat="신앙"; });
  // 마이그레이션: 신앙의 '교리' 과목 제거 (그 안에 카드가 없을 때만)
  if(tree["신앙"]&&tree["신앙"].fields){
    Object.keys(tree["신앙"].fields).forEach(fk=>{
      const arr=tree["신앙"].fields[fk];
      if(arr&&arr.includes("교리")){
        const hasCards=cards.some(c=>c.cat==="신앙"&&c.sub==="교리");
        if(!hasCards) tree["신앙"].fields[fk]=arr.filter(s=>s!=="교리");
      }
    });
  }
  // 마이그레이션: 누락 필드 보정
  cards.forEach(c=>{
    if(!c.status)c.status="archive";
    if(c.field===undefined)c.field="";
    if(c.streak===undefined)c.streak=0;
    if(c.due===undefined)c.due=null;
    // 구 손글씨 유형 → 개념 + backImg
    if(c.type==="손글씨"&&c.img&&!c.backImg){c.backImg=c.img;c.type="개념";}
    if(c.frontImg===undefined)c.frontImg="";
    if(c.backImg===undefined)c.backImg="";
  });
}

/* ══════════ 트리 헬퍼 ══════════ */
function catColor(name){return tree[name]?tree[name].color:"#2F4A6B";}
function catList(){return Object.keys(tree);}
function fieldList(cat){if(!tree[cat])return [];return Object.keys(tree[cat].fields).filter(f=>f!=="_");}
function hasFields(cat){return fieldList(cat).length>0;}
function subList(cat,field){
  if(!tree[cat])return [];
  if(field&&field!=="all"&&field!=="_")return tree[cat].fields[field]||[];
  let all=[];Object.values(tree[cat].fields).forEach(a=>all=all.concat(a));return [...new Set(all)];
}
function ensureInTree(cat,field,sub){
  if(!tree[cat])tree[cat]={color:PALETTE[catList().length%PALETTE.length],fields:{}};
  const f=field||"_"; if(!tree[cat].fields[f])tree[cat].fields[f]=[];
  if(sub&&!tree[cat].fields[f].includes(sub))tree[cat].fields[f].push(sub);
}

/* ══════════ CSV ══════════ */
function parseCSV(text){
  text=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");
  const rows=[];let cur=[],val="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){val+='"';i++;}else q=false;}else val+=c;}
    else{if(c==='"')q=true;else if(c===','){cur.push(val);val="";}else if(c==='\n'){cur.push(val);rows.push(cur);cur=[];val="";}else val+=c;}}
  if(val!==""||cur.length){cur.push(val);rows.push(cur);}
  const head=rows.shift().map(h=>h.trim());const idx=n=>head.indexOf(n);
  return rows.filter(r=>r.some(x=>x&&x.trim())).map((r,i)=>{const get=n=>{const j=idx(n);return j>=0?(r[j]||"").trim():"";};
    return {id:get("id")||("c"+Date.now()+i),cat:get("대분류")||"기타",field:get("분야")||"",sub:get("과목")||"기타",
      type:get("유형")||"개념",front:get("앞면"),back:get("뒷면"),aux1:get("보조1"),aux2:get("보조2"),
      confuse:get("혼동짝"),tags:(get("태그")||"").split(",").map(s=>s.trim()).filter(Boolean),
      skill:parseInt(get("숙련도"))||0,img:"",status:"archive",streak:0,due:null};});
}
function toCSV(){
  const H=["id","대분류","분야","과목","유형","앞면","뒷면","보조1","보조2","혼동짝","태그","숙련도"];
  const esc=v=>{v=(v==null?"":String(v));return /[,"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  const L=[H.join(",")];
  cards.forEach(c=>L.push([c.id,c.cat,c.field||"",c.sub,c.type,c.front,c.back,c.aux1||"",c.aux2||"",c.confuse||"",(c.tags||[]).join(","),c.skill].map(esc).join(",")));
  return "\uFEFF"+L.join("\r\n");
}

/* ══════════ 토스트 ══════════ */
let toastT=null;
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),1800);}

/* ══════════ 계층 칩 ══════════ */
function chip(label,on,color,cls,onclick,cnt,onLong){
  const b=document.createElement("button");
  b.className="chip"+(cls?" "+cls:"")+(on?" on":"");
  if(on&&color)b.style.background=color;
  b.innerHTML=(color&&!cls?`<span class="swatch" style="background:${color}"></span>`:"")+label+(cnt!=null?`<span class="cnt">${cnt}</span>`:"");
  b.onclick=onclick;
  if(onLong){ // 길게 누르면 삭제 메뉴
    let t=null,moved=false;
    const start=()=>{moved=false;t=setTimeout(()=>{t=null;if(!moved){if(navigator.vibrate)navigator.vibrate(15);onLong();}},550);};
    const cancel=()=>{if(t){clearTimeout(t);t=null;}};
    b.addEventListener("pointerdown",start);
    b.addEventListener("pointermove",()=>{moved=true;cancel();});
    b.addEventListener("pointerup",cancel);
    b.addEventListener("pointercancel",cancel);
    b.addEventListener("pointerleave",cancel);
  }
  return b;
}
function renderChips(){
  const show=(tab==="study"||tab==="memo");
  ["#row-cat","#row-field","#row-sub","#search-wrap"].forEach(s=>{const el=$(s);if(el)el.style.display=show?"":"none";});
  const ch=$("#chip-hint");if(ch)ch.style.display=(show&&curCat!=="all")?"block":"none";
  if(!show)return;
  const rc=$("#row-cat");rc.innerHTML="";rc.style.display="flex";
  rc.appendChild(chip("전체",curCat==="all","var(--accent)",null,()=>{curCat="all";curField="all";curSub="all";renderChips();render();}));
  catList().forEach(cat=>rc.appendChild(chip(cat,curCat===cat,tree[cat].color,null,()=>{curCat=cat;curField="all";curSub="all";renderChips();render();},null,()=>chipMenu("cat",cat))));
  const addCat=document.createElement("button");addCat.className="chip-add";addCat.textContent="＋";addCat.onclick=()=>openAdd2("cat");rc.appendChild(addCat);

  const rf=$("#row-field");rf.innerHTML="";
  if(curCat!=="all"&&hasFields(curCat)){rf.style.display="flex";
    rf.appendChild(chip("전체",curField==="all","var(--accent)","lv2",()=>{curField="all";curSub="all";renderChips();render();}));
    fieldList(curCat).forEach(f=>rf.appendChild(chip(f,curField===f,tree[curCat].color,"lv2",()=>{curField=f;curSub="all";renderChips();render();},null,()=>chipMenu("field",f))));
    const addF=document.createElement("button");addF.className="chip-add";addF.textContent="＋ 분야";addF.onclick=()=>openAdd2("field");rf.appendChild(addF);
  }else rf.style.display="none";

  const rs=$("#row-sub");rs.innerHTML="";
  if(curCat!=="all"){rs.style.display="flex";
    rs.appendChild(chip("전체 과목",curSub==="all",null,"lv3",()=>{curSub="all";renderChips();render();}));
    subList(curCat,curField).forEach(s=>{const cnt=cards.filter(c=>c.cat===curCat&&(curField==="all"||c.field===curField)&&c.sub===s&&c.status!=="inbox").length;
      rs.appendChild(chip(s,curSub===s,null,"lv3",()=>{curSub=s;renderChips();render();},cnt,()=>chipMenu("sub",s)));});
    const addS=document.createElement("button");addS.className="chip-add";addS.textContent="＋ 과목";addS.onclick=()=>openAdd2("sub");rs.appendChild(addS);
  }else rs.style.display="none";
}

/* ══════════ 필터 ══════════ */
function visible(){
  const q=$("#search").value.trim().toLowerCase();
  const want=tab==="study"?"inbox":"archive";
  return cards.filter(c=>{
    if((c.status||"archive")!==want)return false;
    if(curCat!=="all"&&c.cat!==curCat)return false;
    if(curField!=="all"&&(c.field||"")!==curField)return false;
    if(curSub!=="all"&&c.sub!==curSub)return false;
    if(q){const h=((c.front||"")+" "+(c.back||"")+" "+(c.aux1||"")+" "+(c.aux2||"")+" "+(c.tags||[]).join(" ")+" "+c.sub).toLowerCase();if(!h.includes(q))return false;}
    return true;});
}

function tex(el,code){try{katex.render(code,el,{throwOnError:false,displayMode:false});}catch(e){el.textContent=code;}}
function hasCloze(t){return /\{\{[^}]*\}\}/.test(t||"");}
function stripCloze(t){return (t||"").replace(/\{\{|\}\}/g,"");}

/* ══════════ 메인 렌더 ══════════ */
function render(){
  updateBadge();
  const subs={study:"막힌 카드를 모으는 임시함",memo:"카드를 가리고 떠올려보세요",train:"상황을 보고 공식을 떠올리세요",stats:"복습 현황과 진도"};
  $("#nav-sub").textContent=subs[tab]||"";
  $$(".tab").forEach(t=>t.classList.toggle("on",t.dataset.tab===tab));
  const list=$("#list"), tv=$("#train-view");
  list.style.display=(tab==="train")?"none":"flex";
  tv.style.display=(tab==="train")?"block":"none";
  renderChips();
  if(tab==="train"){renderTrain();return;}
  if(tab==="stats"){renderStats(list);return;}
  const items=visible();
  if(!items.length){list.innerHTML=tab==="study"
    ? `<div class="empty"><div class="big">임시함이 비어 있어요</div><p>공부하다 막힌 걸 우측 상단 <b>＋</b>로 담으세요.<br><b>↓</b>로 CSV도 불러올 수 있어요.</p></div>`
    : `<div class="empty"><div class="big">암기할 카드가 없어요</div><p>공부 탭에서 승격하거나 CSV를 불러오세요.</p></div>`;
    return;}
  list.innerHTML="";items.forEach(c=>list.appendChild(cardEl(c)));
}
function updateBadge(){const n=dueCount();const b=$("#train-badge");if(n>0){b.style.display="flex";b.textContent=n>99?"99+":n;}else b.style.display="none";}

let _memoLogged={};
function coverable(inner){const w=document.createElement("div");w.className="coverable";w.appendChild(inner);const cov=document.createElement("div");cov.className="cover";w.appendChild(cov);w.onclick=e=>{w.classList.toggle("revealed");if(tab==="memo"&&w.classList.contains("revealed")){const k=todayStr();if(!_memoLogged[k]){_memoLogged={};_memoLogged[k]=true;bumpActivity(1);}}e.stopPropagation();};return w;}
function field(label,build,cover){const f=document.createElement("div");f.className="field";const l=document.createElement("div");l.className="field-label";l.textContent=label;f.appendChild(l);const inner=document.createElement("div");build(inner);f.appendChild(cover?coverable(inner):inner);return f;}
function renderCloze(container,text){container.className="back-text";text.split(/(\{\{[^}]*\}\})/g).forEach(p=>{const m=p.match(/^\{\{([^}]*)\}\}$/);if(m){const b=document.createElement("span");b.className="cloze-blank";b.textContent=m[1];b.onclick=e=>{e.stopPropagation();b.classList.toggle("shown");};container.appendChild(b);}else container.appendChild(document.createTextNode(p));});}
function renderProgressive(container,text){container.className="back-text";text.split("\n").forEach((line,i)=>{if(i>0)container.appendChild(document.createElement("br"));const s=document.createElement("span");s.className="line-hidden";s.textContent=line||" ";s.onclick=e=>{e.stopPropagation();s.classList.toggle("line-hidden");s.classList.toggle("line-shown");};container.appendChild(s);});}
function defaultMode(c){if(tab!=="memo")return "off";if(c.type==="번역")return "cover";if(c.type==="구절")return hasCloze(c.back)?"cloze":"progressive";return "cover";}
function modeOptions(c){const base=[["off","펼치기"],["cover","뒷면 가림"],["all","전체 가림"]];if(c.type==="공식"||c.type==="손글씨")return base;const o=base.slice();if(hasCloze(c.back))o.push(["cloze","빈칸 채우기"]);if((c.back||"").includes("\n")||c.type==="구절")o.push(["progressive","점진적 가림"]);return o;}

function dueTag(c){
  if(c.status==="inbox")return "";
  if(!c.due)return `<span class="tag due today">복습 대기</span>`;
  if(c.due<=todayStr())return `<span class="tag due today">오늘 복습</span>`;
  return `<span class="tag due">${c.due} 예정</span>`;
}

function cardEl(c){
  const el=document.createElement("div");el.className="card"+(c.status==="inbox"?" inbox":"");
  const labels=TYPE_LABELS[c.type]||TYPE_LABELS["개념"];
  const col=catColor(c.cat);
  const st=memoState[c.id]||(memoState[c.id]={mode:defaultMode(c),flip:false});

  const top=document.createElement("div");top.className="card-top";
  const tags=document.createElement("div");tags.className="tags";
  tags.innerHTML=`<span class="tag type" style="background:${col}22;color:${col}">${c.cat}</span>`+
    (c.field?`<span class="tag">${c.field}</span>`:"")+
    `<span class="tag">${c.sub}</span><span class="tag">${c.type}</span>`+
    (tab==="memo"?dueTag(c):"")+
    (c.status==="inbox"?`<span class="tag" style="background:var(--warn-soft);color:var(--warn)">정리 필요</span>`:"");
  top.appendChild(tags);
  const keb=document.createElement("button");keb.className="kebab";keb.innerHTML="&#8943;";keb.onclick=e=>{e.stopPropagation();openAction(c.id);};top.appendChild(keb);
  el.appendChild(top);

  const canFlip=tab==="memo"&&(c.type==="번역"||c.type==="개념")&&c.back&&!c.frontImg&&!c.backImg&&c.type!=="공식";
  let frontText=c.front,backText=c.back;
  if(st.flip&&canFlip){frontText=c.back;backText=c.front;}

  // 앞면: 이미지 또는 텍스트
  if(!st.flip&&c.frontImg){const fr=document.createElement("div");fr.className="back-img";fr.style.marginBottom="4px";const im=document.createElement("img");im.src=c.frontImg;fr.appendChild(im);el.appendChild(fr);}
  else{const fr=document.createElement("div");fr.className="front";fr.textContent=frontText;el.appendChild(fr);}
  if(c.tags&&c.tags.length){const tl=document.createElement("div");tl.className="taglist";c.tags.forEach(t=>{const s=document.createElement("span");s.className="t";s.textContent=t;tl.appendChild(s);});el.appendChild(tl);}

  if(tab==="memo"){
    const m=document.createElement("div");m.className="modes";
    modeOptions(c).forEach(([v,label])=>{const b=document.createElement("button");b.className=st.mode===v?"on":"";b.textContent=label;b.onclick=()=>{st.mode=v;render();};m.appendChild(b);});
    if(canFlip){const fb=document.createElement("button");fb.className="flip-btn";fb.textContent=st.flip?"⇄ 원래대로":"⇄ 뒤집기";fb.onclick=()=>{st.flip=!st.flip;render();};
      const wrap=document.createElement("div");wrap.style.cssText="display:flex;align-items:center;margin:12px 0 4px";wrap.appendChild(m);wrap.appendChild(fb);el.appendChild(wrap);}
    else{m.style.margin="12px 0 4px";el.appendChild(m);}
  }
  const mode=tab==="memo"?st.mode:"off";

  if(c.type==="공식"&&c.back){el.appendChild(field(labels.back,inner=>{inner.className="back-formula";tex(inner,c.back);},mode==="cover"||mode==="all"));}
  else if(c.type==="공식"&&c.img){el.appendChild(field(labels.back,inner=>{inner.className="back-img";const im=document.createElement("img");im.src=c.img;inner.appendChild(im);},mode==="cover"||mode==="all"));}
  else if(c.backImg||(c.img&&c.type==="손글씨")){const src=c.backImg||c.img;el.appendChild(field(labels.back,inner=>{inner.className="back-img";const im=document.createElement("img");im.src=src;inner.appendChild(im);},mode==="cover"||mode==="all"));}
  else if(backText){
    if(mode==="cloze"&&hasCloze(backText)){el.appendChild(field(labels.back,inner=>renderCloze(inner,backText),false));}
    else if(mode==="progressive"){el.appendChild(field(labels.back,inner=>renderProgressive(inner,stripCloze(backText)),false));}
    else{el.appendChild(field(labels.back,inner=>{inner.className="back-text";inner.textContent=stripCloze(backText);},mode==="cover"||mode==="all"));}
  }
  if(c.aux1)el.appendChild(field(labels.aux1,inner=>{inner.className="aux-text";inner.textContent=c.aux1;},mode==="all"));
  if(c.aux2)el.appendChild(field(labels.aux2,inner=>{inner.className="aux-text";inner.textContent=c.aux2;},mode==="all"));
  if(c.confuse){const box=document.createElement("div");box.className="confuse-box";const lab=document.createElement("div");lab.className="field-label";lab.textContent="혼동 주의";box.appendChild(lab);const inner=document.createElement("div");inner.className="confuse-text";inner.textContent=c.confuse;box.appendChild(mode==="all"?coverable(inner):inner);el.appendChild(box);}

  const foot=document.createElement("div");foot.className="card-foot";
  const sk=document.createElement("div");sk.className="skill";sk.innerHTML='<span class="skill-label">숙련도</span>';
  const bars=document.createElement("div");bars.className="bars";
  for(let i=1;i<=5;i++){const b=document.createElement("button");b.className="bar"+(i<=c.skill?" fill":"");b.style.cssText=i<=c.skill?`background:${col}`:"";b.onclick=()=>{c.skill=(c.skill===i?i-1:i);saveCards();render();};bars.appendChild(b);}
  sk.appendChild(bars);foot.appendChild(sk);
  if(c.status==="inbox"){const p=document.createElement("button");p.className="promote";p.textContent="암기로 승격 →";p.onclick=()=>{c.status="archive";c.due=c.due||todayStr();saveCards();bumpActivity(1);render();toast("암기 카드로 옮겼어요");};foot.appendChild(p);}
  el.appendChild(foot);
  return el;
}

/* ══════════ 훈련(직관 플래시) ══════════ */
let trainQueue=[], trainIdx=0, trainRevealed=false, trainScope="due", trainResult={o:0,x:0};
function buildQueue(){
  let pool=cards.filter(c=>c.status!=="inbox");
  if(trainScope==="due") pool=pool.filter(isDue);
  // 현재 필터(대분류/과목)도 반영
  if(curCat!=="all")pool=pool.filter(c=>c.cat===curCat);
  // 섞기
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  return pool;
}
function renderTrain(){
  const v=$("#train-view");
  // 시작 화면
  if(!trainQueue.length){
    const due=cards.filter(c=>c.status!=="inbox"&&isDue(c)).length;
    const total=cards.filter(c=>c.status!=="inbox").length;
    v.innerHTML=`<div class="train-wrap">
      <div class="train-opt">
        <button data-scope="due" class="${trainScope==="due"?"on":""}">오늘 복습 (${due})</button>
        <button data-scope="all" class="${trainScope==="all"?"on":""}">전체 (${total})</button>
      </div>
      <div class="flash" style="align-items:center;justify-content:center;text-align:center">
        <div>
          <div style="font-size:20px;font-weight:800;margin-bottom:8px">상황 → 공식 훈련</div>
          <p style="color:var(--ink-3);font-size:14px;line-height:1.7">앞면(상황·키워드)을 보고<br>머릿속으로 답을 떠올린 뒤 확인하세요.<br>맞고 틀림에 따라 복습 일정이 잡힙니다.</p>
        </div>
      </div>
      <button class="train-start" id="train-start">시작하기</button>
    </div>`;
    v.querySelectorAll(".train-opt button").forEach(b=>b.onclick=()=>{trainScope=b.dataset.scope;renderTrain();});
    $("#train-start").onclick=()=>{trainQueue=buildQueue();trainIdx=0;trainRevealed=false;trainResult={o:0,x:0};
      if(!trainQueue.length){toast(trainScope==="due"?"오늘 복습할 카드가 없어요":"카드가 없어요");return;}renderTrain();};
    return;
  }
  // 완료 화면
  if(trainIdx>=trainQueue.length){
    v.innerHTML=`<div class="train-done"><div class="big">오늘 훈련 끝!</div>
      <p>맞음 ${trainResult.o} · 다시 볼 카드 ${trainResult.x}<br>틀린 카드는 내일 다시, 맞은 카드는 간격을 두고 또 나옵니다.</p>
      <button class="train-start" id="train-again" style="max-width:280px;margin:22px auto 0">돌아가기</button></div>`;
    $("#train-again").onclick=()=>{trainQueue=[];renderTrain();updateBadge();};
    return;
  }
  const c=trainQueue[trainIdx];
  const labels=TYPE_LABELS[c.type]||TYPE_LABELS["개념"];
  const col=catColor(c.cat);
  const pct=Math.round(trainIdx/trainQueue.length*100);
  const answer=document.createElement("div");
  // 뒷면 빌드
  let answerHTML="";
  const abox=document.createElement("div");abox.className="flash-a";
  const lab=document.createElement("div");lab.className="field-label";lab.textContent=labels.back;abox.appendChild(lab);
  const inner=document.createElement("div");
  abox.appendChild(inner);
  if(c.aux1){const a=document.createElement("div");a.className="aux-text";a.style.marginTop="12px";a.textContent="· "+c.aux1;abox.appendChild(a);}
  if(c.confuse){const cf=document.createElement("div");cf.className="confuse-box";cf.innerHTML=`<div class="field-label">혼동 주의</div><div class="confuse-text">${escapeHtml(c.confuse)}</div>`;abox.appendChild(cf);}

  v.innerHTML=`<div class="train-wrap">
    <div class="train-head"><div class="train-progress">${trainIdx+1} / ${trainQueue.length}</div><div class="train-progress">✓ ${trainResult.o}</div></div>
    <div class="train-bar"><div style="width:${pct}%"></div></div>
    <div class="flash" id="flash-card">
      <div class="flash-meta"><span class="tag type" style="background:${col}22;color:${col}">${c.cat}</span>${c.field?`<span class="tag">${c.field}</span>`:""}<span class="tag">${c.sub}</span></div>
      ${c.frontImg?`<div class="back-img" style="margin-bottom:8px"><img src="${c.frontImg}"></div>`:`<div class="flash-q">${escapeHtml(c.front)}</div>`}
      <div class="flash-hint" id="flash-hint">머릿속으로 답을 떠올려보세요</div>
      <div id="flash-answer-slot"></div>
      <div class="flash-spacer"></div>
      <div id="flash-controls"></div>
    </div>
  </div>`;
  // 답 렌더 채우기
  const backSrc=c.backImg||((c.type!=="공식"&&c.img)?c.img:(c.type==="공식"?c.img:""));
  if(c.type==="공식"&&c.back){inner.className="back-formula";tex(inner,c.back);}
  else if(backSrc){inner.className="back-img";const im=document.createElement("img");im.src=backSrc;inner.appendChild(im);}
  else{inner.className="back-text";inner.textContent=stripCloze(c.back);}

  const controls=$("#flash-controls");
  if(!trainRevealed){
    const btn=document.createElement("button");btn.className="reveal-btn";btn.textContent="정답 확인";
    btn.onclick=()=>{trainRevealed=true;renderTrain();};
    controls.appendChild(btn);
  }else{
    $("#flash-hint").style.display="none";
    $("#flash-answer-slot").appendChild(abox);
    const j=document.createElement("div");j.className="judge";
    const no=document.createElement("button");no.className="no";no.textContent="✕ 다시";
    const yes=document.createElement("button");yes.className="yes";yes.textContent="✓ 알았음";
    no.onclick=()=>judge(false);yes.onclick=()=>judge(true);
    j.appendChild(no);j.appendChild(yes);controls.appendChild(j);
  }
}
function judge(correct){
  const c=trainQueue[trainIdx];
  if(correct){
    c.streak=(c.streak||0)+1;
    const step=REVIEW_STEPS[Math.min(c.streak-1,REVIEW_STEPS.length-1)];
    c.due=addDays(step);
    c.skill=Math.min(5,(c.skill||0)+1);
    trainResult.o++;
  }else{
    c.streak=0; c.due=addDays(1);
    c.skill=Math.max(0,(c.skill||0)-1);
    trainResult.x++;
  }
  saveCards();
  bumpActivity(1);
  trainIdx++; trainRevealed=false; renderTrain(); updateBadge();
}
function escapeHtml(t){return String(t).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

/* ══════════ 진도 ══════════ */
function heatmapHTML(){
  const today=new Date(); today.setHours(0,0,0,0);
  const fmt=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dd=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${dd}`;};
  let max=0; Object.values(activity).forEach(v=>{if(v>max)max=v;});
  const level=v=>{ if(!v)return 0; if(max<=1)return 4; const r=v/max; return r>0.75?4:r>0.5?3:r>0.25?2:1; };
  const colors=["var(--hair-2)","#BFD8C9","#8FBBA6","#5E9B80","#3E7C63"];
  const monthNames=["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const blocks=[];
  for(let off=-2;off<=2;off++){
    const first=new Date(today.getFullYear(),today.getMonth()+off,1);
    const y=first.getFullYear(), mo=first.getMonth();
    const daysIn=new Date(y,mo+1,0).getDate();
    const lead=first.getDay();
    let cells="";
    for(let i=0;i<lead;i++)cells+=`<div style="width:13px;height:13px"></div>`;
    for(let day=1;day<=daysIn;day++){
      const d=new Date(y,mo,day);
      const key=fmt(d);
      const future=d>today;
      const isToday=fmt(d)===fmt(today);
      const cnt=activity[key]||0;
      const bg=future?"transparent":colors[level(cnt)];
      const ring=isToday?"box-shadow:0 0 0 1.5px var(--accent);":"";
      cells+=`<div title="${key}${future?"":" · "+cnt+"회"}" style="width:13px;height:13px;border-radius:3px;background:${bg};${ring}"></div>`;
    }
    blocks.push(`<div style="flex:0 0 auto"><div style="font-size:11px;font-weight:700;color:${off===0?'var(--accent)':'var(--ink-3)'};margin-bottom:6px;text-align:center">${monthNames[mo]}</div><div style="display:grid;grid-template-columns:repeat(7,13px);gap:3px">${cells}</div></div>`);
  }
  let weekSum=0; for(let i=0;i<7;i++){const dd=new Date(today);dd.setDate(dd.getDate()-i);weekSum+=activity[fmt(dd)]||0;}
  const totalDays=Object.keys(activity).filter(k=>activity[k]>0).length;
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="field-label" style="margin:0">복습 기록</div>
      <div style="font-size:12px;color:var(--ink-3)">최근 7일 <b style="color:var(--good)">${weekSum}</b>회 · 활동 <b style="color:var(--ink)">${totalDays}</b>일</div>
    </div>
    <div style="display:flex;gap:16px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px">${blocks.join("")}</div>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:12px;font-size:10px;color:var(--ink-3)">
      적음 ${colors.map(c=>`<span style="width:11px;height:11px;border-radius:2px;background:${c};display:inline-block"></span>`).join("")} 많음
    </div>
  </div>`;
}

function renderStats(list){
  const arch=cards.filter(c=>c.status!=="inbox");
  const inbox=cards.filter(c=>c.status==="inbox");
  const due=arch.filter(isDue).length;
  const avg=arch.length?(arch.reduce((a,c)=>a+c.skill,0)/arch.length):0;
  const mastered=arch.filter(c=>c.skill>=4).length;
  let byCat="";catList().forEach(cat=>{const n=arch.filter(c=>c.cat===cat).length;if(!n)return;const cdue=arch.filter(c=>c.cat===cat&&isDue(c)).length;
    byCat+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--hair-2)"><span style="display:flex;align-items:center;gap:8px;font-size:14px"><span style="width:10px;height:10px;border-radius:50%;background:${tree[cat].color}"></span>${cat}</span><span style="font-size:13px;color:var(--ink-3)">복습 ${cdue} · <b style="color:var(--ink);font-family:var(--mono)">${n}</b>장</span></div>`;});
  list.innerHTML=heatmapHTML()+`<div class="card"><div class="field-label">오늘</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:8px;text-align:center">
      <div><div style="font-size:26px;font-weight:800;color:var(--warn)">${due}</div><div style="font-size:12px;color:var(--ink-3);margin-top:2px">복습 대기</div></div>
      <div><div style="font-size:26px;font-weight:800">${arch.length}</div><div style="font-size:12px;color:var(--ink-3);margin-top:2px">암기 카드</div></div>
      <div><div style="font-size:26px;font-weight:800;color:var(--good)">${mastered}</div><div style="font-size:12px;color:var(--ink-3);margin-top:2px">숙달(4↑)</div></div>
    </div>
    <div style="margin-top:16px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-3);margin-bottom:5px"><span>평균 숙련도</span><span>${avg.toFixed(1)} / 5</span></div>
    <div style="height:7px;background:var(--hair);border-radius:4px;overflow:hidden"><div style="height:100%;width:${avg/5*100}%;background:var(--accent)"></div></div></div>
    ${due>0?`<button class="train-start" id="stats-go" style="margin-top:16px">지금 ${due}장 복습하기</button>`:""}
    ${inbox.length?`<div style="margin-top:12px;font-size:13px;color:var(--warn);text-align:center">정리 대기 ${inbox.length}장 (공부 탭)</div>`:""}
    </div>
    ${byCat?`<div class="card"><div class="field-label">대분류별</div>${byCat}</div>`:""}`;
  const go=$("#stats-go");if(go)go.onclick=()=>{tab="train";trainScope="due";trainQueue=[];render();};
}

/* ══════════ 유형 폼 전환 ══════════ */
function applyType(type){
  curType=type;
  $$("#s-type button").forEach(b=>b.classList.toggle("on",b.dataset.v===type));
  const labels=TYPE_LABELS[type]||TYPE_LABELS["개념"];
  $("#lbl-front").textContent="앞면 · "+labels.front;
  $("#lbl-back").textContent="뒷면 · "+labels.back;
  $("#lbl-aux1").textContent=labels.aux1+" (선택)";
  $("#lbl-aux2").textContent=labels.aux2+" (선택)";
  // 공식: 뒷면 그룹 숨기고 공식 전용 표시
  $("#back-group").style.display=(type==="공식")?"none":"block";
  $("#back-formula-group").style.display=(type==="공식")?"block":"none";
  $("#confuse-group").style.display=(type==="공식"||type==="개념")?"block":"none";
  $("#cloze-hint").style.display=(type==="구절"||type==="번역"||type==="개념")?"block":"none";
  if(type==="공식")switchInputPane("latex");
}

// io-tabs: 앞면/뒷면의 직접입력 ↔ 손글씨 전환
function switchIO(io,mode){
  $$(`.io-tabs[data-io="${io}"] button`).forEach(b=>b.classList.toggle("on",b.dataset.mode===mode));
  $$(`.io-pane[data-io="${io}"]`).forEach(p=>p.classList.toggle("on",p.dataset.mode===mode));
  if(mode==="draw"){const key=io==="front"?"padFront":"padBack";setTimeout(()=>setupDrawBox(key),60);}
}
$$('.io-tabs button').forEach(b=>{const io=b.closest('.io-tabs').dataset.io;b.onclick=()=>switchIO(io,b.dataset.mode);});

/* ══════════ 시트 연동 ══════════ */
function fillCatSel(sel){$("#s-cat").innerHTML=catList().map(c=>`<option${c===sel?" selected":""}>${c}</option>`).join("");}
function fillFieldSel(cat,sel){const fields=fieldList(cat);const el=$("#s-field").closest(".field-group");
  if(fields.length){el.style.display="block";$("#s-field").innerHTML=fields.map(f=>`<option${f===sel?" selected":""}>${f}</option>`).join("");}
  else{el.style.display="none";$("#s-field").innerHTML="";}}
function fillSubSel(cat,field,sel){const subs=subList(cat,field);$("#s-sub").innerHTML=subs.map(s=>`<option${s===sel?" selected":""}>${s}</option>`).join("")+`<option value="__new">+ 직접 입력…</option>`;}
function currentField(){const el=$("#s-field").closest(".field-group");return el.style.display==="none"?"":$("#s-field").value;}

function resetPad(key,img){ PADS[key]={strokes:[],img:img||null}; }
function openSheet(id){
  editingId=id||null;
  $("#sheet-title").textContent=id?"카드 편집":"새 카드";
  const c=id?cards.find(x=>x.id===id):null;
  const cat=c?c.cat:(curCat!=="all"?curCat:catList()[0]);
  fillCatSel(cat);
  fillFieldSel(cat,c?c.field:(curField!=="all"?curField:fieldList(cat)[0]));
  fillSubSel(cat,currentField(),c?c.sub:(curSub!=="all"?curSub:null));
  const type=c?(c.type==="손글씨"?"개념":c.type):"개념"; // 구 손글씨 유형은 개념으로
  applyType(type);
  // 손글씨 박스 초기화 (앞/뒤/공식)
  resetPad("padFront",c?.frontImg||null);
  resetPad("padBack", c?.backImg || (c&&c.type==="손글씨"?c.img:null) || null);
  resetPad("padFormula", (c&&c.type==="공식")?c.img||null:null);
  buildDrawBox($('.draw-box[data-pad="padFront"]'));
  buildDrawBox($('.draw-box[data-pad="padBack"]'));
  buildDrawBox($('.draw-box[data-pad="padFormula"]'));
  // 텍스트
  $("#s-front").value=c?.front||"";
  $("#s-back").value=(c&&c.type!=="공식")?c.back||"":"";
  $("#s-aux1").value=c?.aux1||"";$("#s-aux2").value=c?.aux2||"";
  $("#s-confuse").value=c?.confuse||"";
  $("#s-tags").value=c?(c.tags||[]).join(", "):"";
  // 앞/뒤 입력 모드: 이미지 있으면 손글씨 탭으로
  switchIO("front", c?.frontImg?"draw":"text");
  switchIO("back", (c&&(c.backImg||(c.type==="손글씨"&&c.img)))?"draw":"text");
  // 공식
  const mf=$("#s-mathfield");
  if(c&&c.type==="공식"){if(mf&&mathReady){try{mf.value=c.back||"";}catch(e){}}$("#s-formula").value=c.back||"";const p=$("#s-preview");c.back?tex(p,c.back):(p.textContent="");switchInputPane(c.img?"draw":"latex");}
  else{if(mf&&mathReady){try{mf.value="";}catch(e){}}$("#s-formula").value="";$("#s-preview").textContent="";switchInputPane("latex");}
  $("#sheet-bg").classList.add("open");$("#sheet").classList.add("open");
}
function closeSheet(){$("#sheet-bg").classList.remove("open");$("#sheet").classList.remove("open");try{const mf=$("#s-mathfield");if(mf)mf.blur();window.mathVirtualKeyboard.hide();}catch(e){}}
$("#sheet-close").onclick=closeSheet;$("#sheet-bg").onclick=closeSheet;
$("#s-cat").onchange=()=>{const cat=$("#s-cat").value;fillFieldSel(cat);fillSubSel(cat,currentField());};
$("#s-field").onchange=()=>fillSubSel($("#s-cat").value,currentField());
$("#s-sub").onchange=()=>{if($("#s-sub").value==="__new"){const name=prompt("새 과목 이름");if(name){ensureInTree($("#s-cat").value,currentField(),name.trim());saveTree();fillSubSel($("#s-cat").value,currentField(),name.trim());renderChips();}else fillSubSel($("#s-cat").value,currentField());}};
$$("#s-type button").forEach(b=>b.onclick=()=>applyType(b.dataset.v));

$("#add-btn").onclick=()=>openSheet();

function ioMode(io){return $(`.io-tabs[data-io="${io}"] button.on`)?.dataset.mode||"text";}

$("#s-save").onclick=async()=>{
  const cat=$("#s-cat").value;const field=currentField();
  let sub=$("#s-sub").value;if(sub==="__new"||!sub)sub="기타";
  // 앞면: 텍스트 또는 손글씨
  const frontMode=ioMode("front");
  let front="", frontImg="";
  if(frontMode==="draw"){frontImg=commitDraw("padFront")||"";if(!frontImg){toast("앞면 손글씨를 써주세요");return;}}
  else{front=$("#s-front").value.trim();if(!front){toast("앞면을 입력하세요");return;}}
  // 뒷면/공식
  let back="", backImg="", img="";
  if(curType==="공식"){
    const pane=$("#formula-input-tabs button.on")?.dataset.pane;const mf=$("#s-mathfield");
    if(pane==="draw"){img=commitDraw("padFormula")||"";if(!img){toast("공식 손글씨를 써주세요");return;}}
    else if(pane==="visual"&&mf&&mathReady){back=(mf.value||"").trim();}
    else{back=$("#s-formula").value.trim();}
    if(!back&&!img){toast("공식을 입력하거나 손글씨로 써주세요");return;}
  }else{
    const backMode=ioMode("back");
    if(backMode==="draw"){backImg=commitDraw("padBack")||"";if(!backImg){toast("뒷면 손글씨를 써주세요");return;}}
    else{back=$("#s-back").value.trim();if(!back){toast("뒷면을 입력하세요");return;}}
  }
  ensureInTree(cat,field,sub);
  const data={cat,field,sub,type:curType,front,frontImg,back,backImg,
    aux1:$("#s-aux1").value.trim(),aux2:$("#s-aux2").value.trim(),confuse:$("#s-confuse").value.trim(),
    tags:$("#s-tags").value.split(",").map(s=>s.trim()).filter(Boolean),img};
  if(editingId){const t=cards.find(x=>x.id===editingId);Object.assign(t,data);}
  else{cards.push({id:"u"+Date.now(),...data,skill:0,status:"inbox",streak:0,due:null});}
  await persist();await bumpActivity(1);renderChips();closeSheet();render();
  toast(editingId?"저장했어요":"임시함에 담았어요");
};

/* ══════════ 항목 추가 시트 ══════════ */
let add2Kind="cat";
function openAdd2(kind){add2Kind=kind;
  const t={cat:["새 대분류","예: 자격증 / 상식 / 코딩"],field:["새 분야",`${curCat} 안의 분야 · 예: 정보처리기사`],sub:["새 과목","예: 알고리즘"]};
  $("#add2-title").textContent=t[kind][0];$("#add2-name").placeholder=t[kind][1];$("#add2-name").value="";
  $("#add2-bg").classList.add("open");$("#add2-sheet").classList.add("open");}
function closeAdd2(){$("#add2-bg").classList.remove("open");$("#add2-sheet").classList.remove("open");}
$("#add2-close").onclick=closeAdd2;$("#add2-bg").onclick=closeAdd2;
$("#add2-save").onclick=async()=>{
  const name=$("#add2-name").value.trim();if(!name){toast("이름을 입력하세요");return;}
  if(add2Kind==="cat"){if(tree[name]){toast("이미 있는 대분류예요");return;}tree[name]={color:PALETTE[catList().length%PALETTE.length],fields:{"_":[]}};curCat=name;curField="all";curSub="all";}
  else if(add2Kind==="field"){if(curCat==="all"){toast("먼저 대분류를 고르세요");return;}if(tree[curCat].fields[name]){toast("이미 있는 분야예요");return;}tree[curCat].fields[name]=[];curField=name;curSub="all";}
  else{if(curCat==="all"){toast("먼저 대분류를 고르세요");return;}const f=(curField!=="all"?curField:(fieldList(curCat)[0]||"_"));ensureInTree(curCat,f==="_"?"":f,name);curSub=name;}
  await saveTree();closeAdd2();renderChips();render();toast(`'${name}' 추가됨`);
};

/* ══════════ 계층 삭제 ══════════ */
function cardsUnder(kind,name){
  if(kind==="cat")return cards.filter(c=>c.cat===name);
  if(kind==="field")return cards.filter(c=>c.cat===curCat&&c.field===name);
  return cards.filter(c=>c.cat===curCat&&(curField==="all"||c.field===curField)&&c.sub===name);
}
// 길게 누르면: 이름 변경할지 물어보고, 아니면 삭제 확인
async function chipMenu(kind,name){
  const kindLabel={cat:"대분류",field:"분야",sub:"과목"}[kind];
  const nn=window.prompt(`'${name}' ${kindLabel} — 새 이름을 입력하면 변경, 비우고 확인하면 삭제합니다.`, name);
  if(nn===null)return;               // 취소
  const newName=nn.trim();
  if(newName===""){ await doDelete(kind,name,kindLabel); return; }
  if(newName===name)return;          // 변경 없음
  await doRename(kind,name,newName,kindLabel);
}
async function doRename(kind,name,newName,kindLabel){
  if(kind==="cat"){
    if(tree[newName]){toast("이미 있는 이름이에요");return;}
    tree[newName]=tree[name]; delete tree[name];
    cards.forEach(c=>{if(c.cat===name)c.cat=newName;});
    if(curCat===name)curCat=newName;
  }else if(kind==="field"){
    if(tree[curCat].fields[newName]){toast("이미 있는 이름이에요");return;}
    tree[curCat].fields[newName]=tree[curCat].fields[name]; delete tree[curCat].fields[name];
    cards.forEach(c=>{if(c.cat===curCat&&c.field===name)c.field=newName;});
    if(curField===name)curField=newName;
  }else{
    const fkey=(curField!=="all"?curField:null);
    if(fkey&&tree[curCat].fields[fkey]){const a=tree[curCat].fields[fkey];const i=a.indexOf(name);if(i>=0)a[i]=newName;}
    else{Object.keys(tree[curCat].fields).forEach(f=>{const a=tree[curCat].fields[f];const i=a.indexOf(name);if(i>=0)a[i]=newName;});}
    cards.forEach(c=>{if(c.cat===curCat&&(curField==="all"||c.field===curField)&&c.sub===name)c.sub=newName;});
    if(curSub===name)curSub=newName;
  }
  await persist();renderChips();render();toast(`'${newName}'(으)로 변경됨`);
}
async function doDelete(kind,name,kindLabel){
  const inside=cardsUnder(kind,name);
  let removeCards=false;
  if(inside.length){
    if(!window.confirm(`'${name}' ${kindLabel} 안에 카드가 ${inside.length}장 있어요.\n확인 = 카드까지 함께 삭제 / 취소 = 삭제 안 함`))return;
    removeCards=true;
  }else{ if(!window.confirm(`'${name}' ${kindLabel}를 삭제할까요?`))return; }
  if(removeCards){const ids=new Set(inside.map(c=>c.id));cards=cards.filter(c=>!ids.has(c.id));}
  if(kind==="cat"){ delete tree[name]; if(curCat===name){curCat="all";curField="all";curSub="all";} }
  else if(kind==="field"){ if(tree[curCat])delete tree[curCat].fields[name]; if(curField===name){curField="all";curSub="all";} }
  else{ if(tree[curCat]){ const fkey=(curField!=="all"?curField:null);
      if(fkey&&tree[curCat].fields[fkey]){tree[curCat].fields[fkey]=tree[curCat].fields[fkey].filter(x=>x!==name);}
      else{ Object.keys(tree[curCat].fields).forEach(f=>{tree[curCat].fields[f]=tree[curCat].fields[f].filter(x=>x!==name);}); } }
    if(curSub===name)curSub="all"; }
  await persist();renderChips();render();toast(`'${name}' 삭제됨`);
}

/* ══════════ 액션 ══════════ */
function openAction(id){actionId=id;const c=cards.find(x=>x.id===id);$("#act-promote").style.display=c.status==="inbox"?"block":"none";$("#action-bg").classList.add("open");$("#action-sheet").classList.add("open");}
function closeAction(){$("#action-bg").classList.remove("open");$("#action-sheet").classList.remove("open");}
$("#action-bg").onclick=closeAction;$("#act-cancel").onclick=closeAction;
$("#act-edit").onclick=()=>{closeAction();openSheet(actionId);};
$("#act-promote").onclick=async()=>{const c=cards.find(x=>x.id===actionId);c.status="archive";c.due=c.due||todayStr();await saveCards();closeAction();render();toast("암기 카드로 옮겼어요");};
$("#act-delete").onclick=async()=>{cards=cards.filter(x=>x.id!==actionId);await saveCards();renderChips();closeAction();render();toast("삭제했어요");};

/* ══════════ CSV I/O ══════════ */
$("#import-btn").onclick=()=>$("#csv-file").click();
$("#csv-file").onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=async()=>{try{const parsed=parseCSV(r.result);const ids=new Set(cards.map(c=>c.id));let add=0;
    parsed.forEach(p=>{if(!ids.has(p.id)){cards.push(p);ensureInTree(p.cat,p.field,p.sub);add++;}});
    await persist();renderChips();render();toast(`${add}장 추가했어요 (중복 ${parsed.length-add}장 제외)`);
  }catch(err){toast("CSV 형식을 확인하세요");}e.target.value="";};r.readAsText(f,"utf-8");};
$("#export-btn").onclick=()=>{if(!cards.length){toast("내보낼 카드가 없어요");return;}const blob=new Blob([toCSV()],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="StudyTool_"+todayStr()+".csv";a.click();toast("CSV로 내보냈어요");};

/* ══════════ 탭 ══════════ */
$$(".tab").forEach(t=>t.onclick=()=>{tab=t.dataset.tab;Object.keys(memoState).forEach(k=>delete memoState[k]);if(tab!=="train")trainQueue=[];render();window.scrollTo({top:0,behavior:"smooth"});});
$("#search").oninput=render;

/* ══════════ MathLive ══════════ */
function switchInputPane(pane){$$("#formula-input-tabs button").forEach(b=>b.classList.toggle("on",b.dataset.pane===pane));$$('#back-formula-group .input-pane').forEach(p=>p.classList.toggle("on",p.dataset.pane===pane));}
$("#s-formula")&&($("#s-formula").oninput=()=>{const v=$("#s-formula").value.trim();const p=$("#s-preview");v?tex(p,v):(p.textContent="");});
function initMathLive(){const mf=$("#s-mathfield");if(!mf)return;
  if(mf.tagName==="MATH-FIELD"&&mf.value!==undefined){mathReady=true;
    try{mf.mathVirtualKeyboardPolicy="manual";}catch(e){}try{window.mathVirtualKeyboard.hide();}catch(e){}
    mf.addEventListener("input",()=>{const l=mf.value||"";const p=$("#s-preview");l?tex(p,l):(p.textContent="");});
    mf.addEventListener("focus",()=>{const open=$("#sheet").classList.contains("open");const vis=$("#formula-input-tabs button.on")?.dataset.pane==="visual";if(open&&vis){try{window.mathVirtualKeyboard.show();}catch(e){}}else{try{mf.blur();window.mathVirtualKeyboard.hide();}catch(e){}}});
  }else{mf.style.display="none";$("#ml-fallback").style.display="block";const fb=$("#s-formula-fb");if(fb)fb.oninput=()=>{const v=fb.value.trim();const p=$("#s-preview");v?tex(p,v):(p.textContent="");};}}
if(window.customElements&&customElements.whenDefined){customElements.whenDefined("math-field").then(initMathLive).catch(()=>initMathLive());setTimeout(()=>{if(!mathReady)initMathLive();},2500);}else setTimeout(initMathLive,2000);
$$("#formula-input-tabs button").forEach(b=>b.onclick=()=>{switchInputPane(b.dataset.pane);const mf=$("#s-mathfield");
  if(b.dataset.pane==="draw"){setTimeout(()=>setupDrawBox("padFormula"),60);}
  if(b.dataset.pane==="latex"&&mf&&mathReady){$("#s-formula").value=mf.value||$("#s-formula").value;const v=$("#s-formula").value.trim();const p=$("#s-preview");v?tex(p,v):null;try{window.mathVirtualKeyboard.hide();}catch(e){}}
  if(b.dataset.pane==="visual"&&mf&&mathReady){const lv=$("#s-formula").value.trim();if(lv){try{mf.value=lv;}catch(e){}}setTimeout(()=>{try{mf.focus();}catch(e){}},60);}});

/* ══════════ 손글씨 캔버스 (공용) ══════════ */
let eraserOn=false; // 화면 토글 지우개
// S펜 버튼/지우개 끝 감지
function isEraseSignal(e){
  if(e.pointerType==="pen"){
    if(e.button===5)return true;
    if(typeof e.buttons==="number" && (e.buttons&32))return true;
    if(typeof e.buttons==="number" && (e.buttons&2))return true;
  }
  return false;
}

/* ══════════ 손글씨 컴포넌트 (앞면/뒷면/공식 재사용) ══════════ */
// PADS[key] = {strokes, ctx, cv, drawStroke, wired, img}
function buildDrawBox(host){
  const key=host.dataset.pad;
  host.innerHTML=`
    <canvas class="pad-canvas" data-c="${key}"></canvas>
    <div class="pad-tools">
      <button class="pen on" data-t="ink" style="background:var(--accent)"></button>
      <button class="pen" data-t="red" style="background:#B5524A"></button>
      <button data-t="eraser">지우개</button>
      <button data-t="undo">되돌리기</button>
      <button data-t="clear">전체지움</button>
      <button class="full" data-t="full">전체화면</button>
    </div>
    <div class="dhint">S펜 버튼을 누른 채로 그으면 지워집니다. (안 되면 "지우개"를 켜세요)</div>
    <div class="attach-preview" data-prev="${key}" style="display:none"><img><button class="rm">지우고 다시</button></div>`;
  if(!PADS[key])PADS[key]={strokes:[],img:null};
  // 도구 버튼
  host.querySelector('[data-t="ink"]').onclick=e=>{padColor="#2F4A6B";setEraser(false,host);markPen(host,"ink");};
  host.querySelector('[data-t="red"]').onclick=e=>{padColor="#B5524A";setEraser(false,host);markPen(host,"red");};
  host.querySelector('[data-t="eraser"]').onclick=()=>setEraser(!eraserOn,host);
  host.querySelector('[data-t="undo"]').onclick=()=>{if(PADS[key].strokes.length){PADS[key].strokes.pop();redrawPad(key);}};
  host.querySelector('[data-t="clear"]').onclick=()=>clearPad(key);
  host.querySelector('[data-t="full"]').onclick=()=>openFS(key);
  host.querySelector('.attach-preview .rm').onclick=()=>{PADS[key].img=null;PADS[key].strokes=[];renderDrawPreview(key);};
}
function markPen(host,which){host.querySelectorAll('.pen').forEach(b=>b.classList.toggle("on",b.dataset.t===which));}
function renderDrawPreview(key){
  const host=document.querySelector(`.draw-box[data-pad="${key}"]`);if(!host)return;
  const P=PADS[key];const prev=host.querySelector(`[data-prev="${key}"]`);
  const cv=host.querySelector("canvas");const tools=host.querySelector(".pad-tools");const hint=host.querySelector(".dhint");
  if(P&&P.img){prev.style.display="block";prev.querySelector("img").src=P.img;cv.style.display="none";tools.style.display="none";hint.style.display="none";}
  else{prev.style.display="none";cv.style.display="block";tools.style.display="flex";hint.style.display="block";}
}
// 캔버스 세팅 (host 보일 때 호출)
function setupDrawBox(key){
  const host=document.querySelector(`.draw-box[data-pad="${key}"]`);if(!host)return;
  if(PADS[key]&&PADS[key].img){renderDrawPreview(key);return;}
  const cv=host.querySelector("canvas");if(!cv)return;
  setupPadCanvas(cv,key);
  renderDrawPreview(key);
}
function setupPadCanvas(cv,key){
  const rect=cv.getBoundingClientRect();if(rect.width<10)return;
  const dpr=window.devicePixelRatio||1;cv.width=Math.round(rect.width*dpr);cv.height=Math.round(rect.height*dpr);
  const ctx=cv.getContext("2d",{desynchronized:true});ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineCap="round";ctx.lineJoin="round";
  if(!PADS[key])PADS[key]={strokes:[],img:null};PADS[key].ctx=ctx;PADS[key].cv=cv;redrawPad(key);
  if(PADS[key].wired)return;PADS[key].wired=true;let drawing=false,cur=null,raf=0;
  const pos=e=>{const r=cv.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const width=e=>{const p=(e.pressure&&e.pressure>0&&e.pressure<1)?e.pressure:0.5;return 1.7+p*2.4;};
  const drawStroke=(s,ctx)=>{
    ctx.save();
    if(s.erase)ctx.globalCompositeOperation="destination-out";
    if(s.pts.length<2){ctx.fillStyle=s.erase?"rgba(0,0,0,1)":s.color;const p=s.pts[0];ctx.beginPath();ctx.arc(p.x,p.y,s.w/2,0,Math.PI*2);ctx.fill();ctx.restore();return;}
    ctx.strokeStyle=s.erase?"rgba(0,0,0,1)":s.color;ctx.lineWidth=s.w;const pts=s.pts;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length-1;i++){const mx=(pts[i].x+pts[i+1].x)/2,my=(pts[i].y+pts[i+1].y)/2;ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);}
    ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);ctx.stroke();ctx.restore();};
  PADS[key].drawStroke=drawStroke;
  const sched=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;if(cur)drawStroke(cur,ctx);});};
  cv.addEventListener("pointerdown",e=>{if(e.pointerType==="touch"&&e.isPrimary===false)return;drawing=true;try{cv.setPointerCapture(e.pointerId);}catch(_){}
    const erase=eraserOn||isEraseSignal(e);
    cur={color:padColor,w:erase?18:width(e),pts:[pos(e)],erase};PADS[key].strokes.push(cur);drawStroke(cur,ctx);e.preventDefault();},{passive:false});
  cv.addEventListener("pointermove",e=>{if(!drawing)return;const evs=e.getCoalescedEvents?e.getCoalescedEvents():[e];for(const ev of(evs.length?evs:[e]))cur.pts.push(pos(ev));sched();e.preventDefault();},{passive:false});
  const end=e=>{if(!drawing)return;drawing=false;try{cv.releasePointerCapture(e.pointerId);}catch(_){}if(cur)drawStroke(cur,ctx);cur=null;};
  cv.addEventListener("pointerup",end);cv.addEventListener("pointercancel",end);
}
function redrawPad(key){const P=PADS[key];if(!P||!P.ctx)return;const dpr=window.devicePixelRatio||1;P.ctx.clearRect(0,0,P.cv.width/dpr,P.cv.height/dpr);if(P.drawStroke)P.strokes.forEach(s=>P.drawStroke(s,P.ctx));}
function clearPad(key){if(PADS[key]){PADS[key].strokes=[];redrawPad(key);}}
function padToImg(key){const P=PADS[key];if(!P||!P.strokes.length)return null;const cv=P.cv;const out=document.createElement("canvas");out.width=cv.width;out.height=cv.height;const o=out.getContext("2d");o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);o.drawImage(cv,0,0);return out.toDataURL("image/png");}
// draw-box에서 현재 이미지 확정 (저장 시 호출)
function commitDraw(key){const P=PADS[key];if(!P)return null;if(P.img)return P.img;const img=padToImg(key);if(img)P.img=img;return P.img;}

function setEraser(on,host){
  eraserOn=on;
  document.querySelectorAll('.draw-box [data-t="eraser"]').forEach(b=>b.classList.toggle("era-on",on));
  const fe=$("#fs-eraser");if(fe)fe.classList.toggle("era-on",on);
}

/* ══════════ 전체화면 손글씨 ══════════ */
let fsKey=null;
function openFS(key){fsKey=key;const fs=$("#fs-draw");fs.classList.add("open");setTimeout(()=>{setupPadCanvas($("#fs-canvas"),"fs-canvas");
  // 기존 스트로크 있으면 새 캔버스에서 이어 그리긴 어려워 초기화
  if(PADS["fs-canvas"]){PADS["fs-canvas"].strokes=[];redrawPad("fs-canvas");}
},60);}
function closeFS(){$("#fs-draw").classList.remove("open");fsKey=null;}
$("#fs-cancel").onclick=closeFS;
$("#fs-attach").onclick=()=>{const img=padToImg("fs-canvas");if(!img){toast("먼저 손글씨를 써주세요");closeFS();return;}
  if(fsKey&&PADS[fsKey]){PADS[fsKey].img=img;PADS[fsKey].strokes=[];renderDrawPreview(fsKey);}
  closeFS();toast("손글씨를 첨부했어요");};
$("#fs-pen-ink").onclick=()=>{padColor="#2F4A6B";setEraser(false);$("#fs-pen-ink").classList.add("on");$("#fs-pen-red").classList.remove("on");};
$("#fs-pen-red").onclick=()=>{padColor="#B5524A";setEraser(false);$("#fs-pen-red").classList.add("on");$("#fs-pen-ink").classList.remove("on");};
$("#fs-undo").onclick=()=>{if(PADS["fs-canvas"]){PADS["fs-canvas"].strokes.pop();redrawPad("fs-canvas");}};
$("#fs-clear").onclick=()=>clearPad("fs-canvas");
$("#fs-eraser")&&($("#fs-eraser").onclick=()=>setEraser(!eraserOn));

/* ══════════ 시작 ══════════ */
(async function(){
  await load();
  await saveTree();   // 마이그레이션(교리 제거 등) 결과를 영구 저장
  tab="memo";
  renderChips();render();
})();
})();
