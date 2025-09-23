/* =========================================================
   TPB — Faux OS Desktop (emoji + realistic laptop chrome)
   ========================================================= */

const NEXT_ROUTE =
  document.querySelector('meta[name="tpb-launch"]')?.content || "act1.html";

/* ---------- safe nav ---------- */
function go(url){
  const before = location.href;
  try{ location.href = url; }catch{}
  setTimeout(()=>{ if(location.href===before) try{ location.assign(url);}catch{} },120);
}

/* ---------- emoji mapping & desktop upgrade ---------- */
const EMOJI = {
  tpb:    "💠",
  readme: "📄",
  images: "🖼️",
  system: "💾",
  trash:  "🗑️",
  notes:  "📝",
  about:  "ℹ️"
};

const desktop = document.getElementById("desktop");
if (desktop) {
  if (!desktop.querySelector(".icon")) {
    [
      {key:"readme", label:"ReadMe.txt", id:"readmeIcon"},
      {key:"images", label:"Images"},
      {key:"tpb",    label:"tpb.exe", id:"tpbIcon"},
      {key:"notes",  label:"Notes"}
    ].forEach(({key,label,id})=>{
      const b=document.createElement("button");
      b.className="icon"; b.type="button"; b.dataset.open=key; if(id) b.id=id;
      b.innerHTML=`<span class="glyph" aria-hidden="true">${EMOJI[key]||"📁"}</span><span class="name">${label}</span>`;
      desktop.appendChild(b);
    });
  } else {
    desktop.querySelectorAll(".icon").forEach(btn=>{
      if(btn.querySelector(".glyph")) return;
      const key = btn.dataset.open?.toLowerCase?.() || "";
      const label = btn.querySelector(".name")?.textContent || btn.textContent.trim();
      btn.innerHTML =
        `<span class="glyph" aria-hidden="true">${EMOJI[key]||"📁"}</span>`+
        `<span class="name">${label}</span>`;
    });
  }
}

/* ---------- window helper (fixed close button) ---------- */
const wins = document.getElementById("wins");
let z = 2;

function makeWin({title, bodyHTML, x=80, y=80, id}={}){
  const w = document.createElement("section");
  w.className="win"; w.style.left=x+"px"; w.style.top=y+"px"; w.style.zIndex=++z;
  if(id) w.id=id;

  w.innerHTML = `
    <header class="title" draggable="false">
      <b>${title}</b>
      <button class="x" type="button" aria-label="Close window" title="Close">×</button>
    </header>
    <div class="body">${bodyHTML}</div>`;

  wins.appendChild(w);

  // bring to front
  w.addEventListener("pointerdown", ()=> w.style.zIndex = ++z);

  const head = w.querySelector(".title");
  const btnX = w.querySelector(".x");

  // Close (click / Enter / Space)
  function onClose(e){
    e.preventDefault();
    e.stopPropagation();
    clickTick();
    w.remove();
  }
  btnX.addEventListener("click", onClose);
  btnX.addEventListener("keydown", (e)=>{
    if (e.key === "Enter" || e.key === " ") onClose(e);
  });
  ["pointerdown","mousedown","touchstart"].forEach(evt=>{
    btnX.addEventListener(evt, e => { e.stopPropagation(); }, {passive:false});
  });

  // Drag (ignore grabbing the X)
  let offX=0, offY=0, moving=false;
  head.addEventListener("pointerdown", (e)=>{
    if (e.button !== 0) return;
    if (e.target.closest(".x")) return;
    moving = true;
    offX = e.clientX - w.offsetLeft;
    offY = e.clientY - w.offsetTop;
    head.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  });
  head.addEventListener("pointermove", (e)=>{
    if(!moving) return;
    const bounds = wins.getBoundingClientRect();
    const W = w.offsetWidth, H = w.offsetHeight;
    let nx = e.clientX - offX;
    let ny = e.clientY - offY;
    nx = Math.max(8, Math.min(bounds.width - W - 8, nx));
    ny = Math.max(8, Math.min(bounds.height - H - 42, ny));
    w.style.left = nx + "px";
    w.style.top  = ny + "px";
  });
  head.addEventListener("pointerup", ()=>{
    moving=false;
    document.body.style.userSelect = "";
  });

  return w;
}

/* ---------- tiny SFX ---------- */
let AC=null;
function beep(f=760, dur=0.05, g=0.18, type="triangle"){
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(), v=AC.createGain();
    o.type=type; o.frequency.value=f;
    v.gain.setValueAtTime(0,AC.currentTime);
    v.gain.linearRampToValueAtTime(g,AC.currentTime+0.01);
    v.gain.exponentialRampToValueAtTime(0.0001,AC.currentTime+dur);
    o.connect(v).connect(AC.destination); o.start(); o.stop(AC.currentTime+dur+0.02);
  }catch{}
}
// small UI tick
function clickTick(){ beep(460, 0.03, 0.10, "square"); }

/* ---------- app windows ---------- */
function openReadme(){
  beep(600);
  makeWin({
    title:"ReadMe.txt",
    bodyHTML:`<pre class="mono">
// THE PERFECT BEING — desktop loader
Access <strong>tpb.exe</strong> to needed materials.
    </pre>`
  });
}
function openImages(){ beep(520); makeWin({title:"Images", bodyHTML:`<div class="mono">No images found.</div>`}); }
function openAbout(){ beep(700); makeWin({title:"About", bodyHTML:`<div class="mono">Interactive Media prototype — faux OS desktop UI.</div>`}); }

/* ---------- TPB boot -> navigate ---------- */
function openTPB(){
  beep(820);
  const w = makeWin({
    id:"boot", title:"tpb.exe — Boot Loader", x:120, y:90,
    bodyHTML:`<div class="mono">
      Initializing vectors…
      <div class="loader"><i id="bar"></i></div>
      <div id="status" style="margin-top:6px">0%</div>
    </div>`
  });
  const bar=w.querySelector("#bar"); const status=w.querySelector("#status");
  let u=0; const steps=["Probing devices","Allocating particles","Warming shaders","Stabilizing channel","Arming SFX","Hand-off"];
  (function step(){
    u=Math.min(100, u+Math.random()*18+6);
    bar.style.width=u.toFixed(1)+"%";
    const i=Math.min(steps.length-1, Math.floor(u/100*steps.length));
    status.textContent=`${Math.floor(u)}% — ${steps[i]}`;
    if(u<100) setTimeout(step, 160+Math.random()*160);
    else{
      status.textContent="Complete";
      document.body.animate(
        [{filter:"brightness(100%)"}, {filter:"brightness(150%)"}, {filter:"brightness(100%)"}],
        {duration:360, easing:"cubic-bezier(.2,.8,.2,1)"}
      );
      setTimeout(()=>go(NEXT_ROUTE), 280);
    }
  })();
}

/* ---------- desktop events ---------- */
if (desktop){
  desktop.addEventListener("click",(e)=>{
    const el=e.target.closest(".icon,[data-open]");
    if(!el) return;
    const key=el.dataset.open?.toLowerCase?.();
    if(key==="tpb") openTPB();
    else if(key==="readme") openReadme();
    else if(key==="images") openImages();
    else if(key==="about") openAbout();
  });
  desktop.addEventListener("dblclick",(e)=>{
    const el=e.target.closest(".icon,[data-open]"); if(!el) return;
    const key=el.dataset.open?.toLowerCase?.(); if(key==="tpb") openTPB();
  });
  desktop.addEventListener("keydown",(e)=>{
    if(e.key!=="Enter") return;
    const el=e.target.closest(".icon"); if(!el) return;
    const key=el.dataset.open?.toLowerCase?.();
    if(key==="tpb") openTPB();
    else if(key==="readme") openReadme();
    else if(key==="images") openImages();
    else if(key==="about") openAbout();
  });
}

/* ---------- Esc closes top window (still supported) ---------- */
window.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){ const last=[...wins.children].pop(); last?.remove(); }
});

/* ---------- focus TPB first ---------- */
document.getElementById("tpbIcon")?.focus();

/* ---------- tiny click tick on common UI targets ---------- */
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest(".icon, .win .x, .menu-item, button");
  if (!t) return;
  clickTick();
});


/* =========================================================
   Laptop 
   ========================================================= */
(function installChrome(){
  // CSS with a height var we can reuse to offset the work area
  const css = `
  :root{ --osBarH: 28px; }

  #osTopBar{
    position:fixed; inset:0 0 auto 0; height:var(--osBarH);
    display:flex; align-items:center; padding:0 10px; z-index:9999; pointer-events:none;
    background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.12));
    border-bottom:1px solid rgba(255,255,255,.08);
    backdrop-filter:blur(6px) saturate(120%);
    color:#cfe3ff; font:600 12px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing:.02em;
  }
  #osTopBar .lhs{opacity:.8}
  #osTopBar .rhs{margin-left:auto;display:flex;gap:10px;align-items:center;opacity:.95}
  #osTopBar .dot{width:6px;height:6px;border-radius:50%;background:#67e8f9;opacity:.85}

  /* push desktop icons and the window stage down so they sit under the bar */
  #desktop{ padding-top: calc(var(--osBarH) + 12px); }
  #wins{ padding-top: calc(var(--osBarH) + 8px); }

  /* optional: subtle bottom date bar (kept) */
  #osBottomBar{
    position:fixed; inset:auto 0 0 0; height:22px;
    display:flex; align-items:center; justify-content:flex-end;
    padding:0 10px; z-index:9999; pointer-events:none;
    background:linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.18));
    border-top:1px solid rgba(255,255,255,.06);
    color:#9fb6d1; font:600 11px/1 "JetBrains Mono", ui-monospace, monospace;
  }`;
  let s = document.getElementById("osChromeCSS");
  if(!s){ s = document.createElement("style"); s.id="osChromeCSS"; document.head.appendChild(s); }
  s.textContent = css;

  // top bar (no net/battery icons)
  let top = document.getElementById("osTopBar");
  if(!top){
    top = document.createElement("div");
    top.id = "osTopBar";
    top.innerHTML = `
      <div class="lhs">Research OS</div>
      <div class="rhs">
        <span class="dot"></span>
        <span id="osTime">00:00</span>
      </div>`;
    document.body.appendChild(top);
  }

  // bottom bar (date)
  let bot = document.getElementById("osBottomBar");
  if(!bot){
    bot = document.createElement("div");
    bot.id = "osBottomBar";
    bot.innerHTML = `<span id="osDate">—</span>`;
    document.body.appendChild(bot);
  }

  // live clock + date
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const pad = n => String(n).padStart(2,"0");
  function setBars(){
    const d = new Date();
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const dd = days[d.getDay()];
    const mo = months[d.getMonth()];
    const da = d.getDate();
    const yr = d.getFullYear();
    const t = document.getElementById("osTime");
    const b = document.getElementById("osDate");
    if (t) t.textContent = `${hh}:${mm}`;
    if (b) b.textContent = `${dd} • ${da} ${mo} ${yr}`;
  }
  setBars();
  setInterval(setBars, 30_000);
})();
