/* ---------- utilities ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const pick = a => a[Math.floor(Math.random()*a.length)];
const norm = s => String(s).toLowerCase().replace(/[’`]/g,"'").replace(/\s+/g," ").trim();
const today = () => { const d=new Date(); return Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5); };
const fmtDay = n => { const d=new Date(n*864e5); return String(d.getUTCDate()).padStart(2,"0")+"/"+String(d.getUTCMonth()+1).padStart(2,"0"); };
const WEEKDAY = ["CN","T2","T3","T4","T5","T6","T7"];
const wdOf = n => new Date(n*864e5).getUTCDay();
const SPK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;
const speakBtn = (t, cls="") => `<button class="speak ${cls}" data-say="${esc(t)}" aria-label="Nghe phát âm: ${esc(t)}" title="Nghe phát âm">${SPK}</button>`;
const exHtml = s => esc(s).replace(/\*(.+?)\*/g, '<em class="hl">$1</em>');
const LEVELS = ["A1 · Dễ","A2 · Vừa","B1 · Khó hơn"];
const KIND_CLS = {"đồng nghĩa":"syn","gần nghĩa":"syn","trái nghĩa":"ant","cụm từ":"col","liên quan":"rel","dễ nhầm":"warn","lưu ý":"warn"};
const exPlain = s => String(s).replace(/\*/g,"");
const marked = s => (String(s).match(/\*(.+?)\*/)||[])[1] || "";

/* spaced-repetition intervals (days) by box */
const INTERVAL = [0,1,3,7,14,30,60];
const MAX_BOX = 6, STRONG = 5;

/* ---------- data ---------- */
let DATA = null, LESSONS = [], WORDS = {}, WEEKS = [];
function buildIndex(d){
  DATA = d; WEEKS = d.weeks; LESSONS = d.lessons;
  LESSONS.forEach(l => l.words = l.words.map(r => {
    const exs = (r[8]||[]).map((e,i) => ({lv:i, en:e[0], vi:e[1]}));
    const w = {w:r[0], ipa:r[1], pos:r[2], vi:r[3], f:r[4],
      forms: r[5] ? {v2:r[5][0], v3:r[5][1], irr:!!r[5][2], ipa2:r[5][3]||"", ipa3:r[5][4]||""} : null,
      fam:(r[6]||[]).map(x=>({form:x[0],pos:x[1],vi:x[2],ipa:x[3]||""})),
      rel:(r[7]||[]).map(x=>({form:x[0],kind:x[1],vi:x[2],ipa:x[3]||""})),
      exs, ex:(exs[1]||exs[0]).en, exvi:(exs[1]||exs[0]).vi, lesson:l.id};
    WORDS[w.w] = w; return w;
  }));
}
const lessonById = id => LESSONS.find(l => l.id===id) || LESSONS[0];

/* ---------- progress state ---------- */
const fresh = () => ({v:1, t:0, cur:"w1d1", done:{}, seen:{}, srs:{}, streak:{n:0,last:null}});
let LS_KEY = "vc-progress-guest";
function loadLocal(){ try{ const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; }catch(e){ return null; } }
let P = fresh();
/* combine two progress records without ever losing learned words or finished lessons */
function mergeProgress(a, b){
  const m = Object.assign(fresh(), (a.t||0) >= (b.t||0) ? a : b);
  m.t = Math.max(a.t||0, b.t||0);
  m.done = Object.assign({}, b.done, a.done);
  for (const id in b.done) if (a.done && a.done[id] != null) m.done[id] = Math.min(a.done[id], b.done[id]);
  m.seen = {};
  for (const id of new Set([...Object.keys(a.seen||{}), ...Object.keys(b.seen||{})]))
    m.seen[id] = [...new Set([...((a.seen||{})[id]||[]), ...((b.seen||{})[id]||[])])];
  m.srs = Object.assign({}, b.srs);
  for (const w in (a.srs||{})){
    const x = a.srs[w], y = m.srs[w];
    if (!y || x[1] > y[1] || (x[1]===y[1] && x[0] > y[0])) m.srs[w] = x;
  }
  const sa = a.streak||{n:0,last:null}, sb = b.streak||{n:0,last:null};
  m.streak = (sa.last||0) > (sb.last||0) ? sa : (sb.last||0) > (sa.last||0) ? sb : (sa.n >= sb.n ? sa : sb);
  return m;
}

/* ---------- account + cloud storage (Supabase) ---------- */
const SB = window.VC_SUPABASE;
let MY_ID = null, ME = null, BOARD = null, PROFILES = {}, online = false;
let writing = false, pendingWrite = false, saveTimer = null, lastBoard = "", boardWrite = Promise.resolve();

function save(){
  P.t = Date.now();
  try{ localStorage.setItem(LS_KEY, JSON.stringify(P)); }catch(e){}
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
}
async function flush(){
  if (!MY_ID) return;
  if (writing){ pendingWrite = true; return; }
  writing = true;
  try{
    const { error } = await SB.from("progress").upsert({user_id: MY_ID, data: P, updated_at: new Date().toISOString()});
    if (error) throw error;
    online = true; setSave("cloud"); writeBoard();
  }catch(e){
    LAST_ERR = e; console.error("[Vocabulary Challenge] Không lưu được tiến độ:", e);
    setSave("retry");
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 15000);
  }
  writing = false;
  if (pendingWrite){ pendingWrite = false; flush(); }
}
let LAST_ERR = null;
/* turn a Supabase / network error into a reason the learner (or the site owner) can act on */
function explainError(e){
  const msg = String((e && (e.message || e.details || e.hint)) || e || ""), code = String((e && e.code) || "");
  if (code === "42P01" || code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(msg))
    return "Máy chủ chưa có bảng dữ liệu. Chủ trang cần chạy tệp supabase/schema.sql trong Supabase → SQL Editor.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg))
    return "Máy chủ từ chối ghi dữ liệu (quy tắc bảo mật). Chủ trang cần chạy lại tệp supabase/schema.sql.";
  if (/invalid api key|no api key|jwt|apikey/i.test(msg) || code === "PGRST301")
    return "Khóa kết nối Supabase không đúng. Chủ trang cần kiểm tra SUPABASE_ANON_KEY trong js/config.js.";
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(msg) || (e instanceof TypeError))
    return navigator.onLine === false
      ? "Thiết bị đang mất mạng. Tiến độ tạm lưu trên máy này và sẽ tự đồng bộ khi có mạng."
      : "Không kết nối được máy chủ (mạng bị chặn, hoặc dự án Supabase đang tạm dừng). Tiến độ tạm lưu trên máy này.";
  return "Chưa lưu được lên máy chủ" + (msg ? ` (${msg.slice(0, 120)})` : "") + ". Tiến độ tạm lưu trên máy này.";
}
function setSave(mode){
  const el = $("#save-status"); if (!el) return;
  el.className = "save" + (mode==="cloud" ? " cloud" : mode==="retry" ? " warn" : "");
  const text = mode==="cloud" ? "Tiến độ được lưu vào tài khoản của bạn" :
    mode==="loading" ? "Đang tải tiến độ…" : explainError(LAST_ERR);
  el.querySelector("span").textContent = text;
  el.title = mode==="retry" && LAST_ERR ? "Chi tiết lỗi: " + (LAST_ERR.code ? LAST_ERR.code + " · " : "") + (LAST_ERR.message || LAST_ERR) : "";
}
window.addEventListener("online", () => { if (MY_ID && !online) flush(); });
function avatarFor(id, name){
  const colors = ["#22A262","#2F80ED","#F2A20C","#7C5CE0","#E5484D","#0F9D9A"];
  let h = 0; for (const c of String(id)) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const ini = (String(name||"").trim().split(/\s+/).filter(Boolean).map(x => x[0]).slice(-2).join("") || "?").toUpperCase().replace(/[<>&"']/g, "");
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${colors[h % colors.length]}"/><text x="40" y="51" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`);
}
function showSetup(){
  panel.className = "panel";
  panel.innerHTML = `<div class="empty"><h2>Chưa kết nối máy chủ</h2><p>Mở tệp <b>js/config.js</b> và điền <b>SUPABASE_URL</b>, <b>SUPABASE_ANON_KEY</b> theo hướng dẫn trong README.md, rồi tải lại trang.</p></div>`;
}
async function startSession(){
  if (!SB){ showSetup(); return false; }
  const { data: { session } } = await SB.auth.getSession();
  if (!session){ location.replace("login.html"); return false; }
  MY_ID = session.user.id;
  LS_KEY = "vc-progress-" + MY_ID;
  P = Object.assign(fresh(), loadLocal() || {});
  const meta = session.user.user_metadata || {};
  const { data: prof } = await SB.from("profiles").select("display_name, avatar_url").eq("id", MY_ID).maybeSingle();
  const name = (prof && prof.display_name) || meta.full_name || meta.name || (session.user.email || "").split("@")[0];
  ME = {id: MY_ID, email: session.user.email || "", name, avatarUrl: (prof && prof.avatar_url) || meta.avatar_url || avatarFor(MY_ID, name)};
  PROFILES[MY_ID] = {name: ME.name, avatarUrl: ME.avatarUrl};
  const { data: row, error } = await SB.from("progress").select("data").eq("user_id", MY_ID).maybeSingle();
  if (!error && row && row.data) P = mergeProgress(P, row.data);
  online = !error;
  if (error){ LAST_ERR = error; console.error("[Vocabulary Challenge] Không đọc được tiến độ:", error); }
  SB.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") location.replace("login.html"); });
  SB.channel("board-changes").on("postgres_changes", {event:"*", schema:"public", table:"board"}, () => scheduleBoard()).subscribe();
  return true;
}
let boardTimer = null;
function scheduleBoard(){ clearTimeout(boardTimer); boardTimer = setTimeout(loadBoard, 800); }
async function loadBoard(){
  if (!SB || !MY_ID) return;
  const { data, error } = await SB.from("board").select("*").order("learned", {ascending:false}).limit(500);
  if (error){ BOARD = BOARD || []; }
  else BOARD = data.map(r => ({id:r.user_id, learned:r.learned, strong:r.strong, lessons:r.lessons, streak:{n:r.streak_n, last:r.streak_last}, t:Date.parse(r.updated_at)}));
  const ids = BOARD.map(r => r.id).filter(id => !PROFILES[id]);
  if (ids.length){
    const { data: ps } = await SB.from("profiles").select("id, display_name, avatar_url").in("id", ids);
    (ps||[]).forEach(p => { PROFILES[p.id] = {name: p.display_name || "", avatarUrl: p.avatar_url || avatarFor(p.id, p.display_name)}; });
  }
  BOARD.forEach(r => { if (!PROFILES[r.id]) PROFILES[r.id] = {name:"", avatarUrl: avatarFor(r.id, "")}; });
  renderMe();
  if (tab==="rank" && !view) renderRank();
}

function touchStreak(){
  const t = today();
  if (P.streak.last === t) return;
  P.streak = {n: P.streak.last === t-1 ? P.streak.n+1 : 1, last: t};
}
const learnedWords = () => Object.keys(P.srs).filter(w => WORDS[w]);
const dueWords = (day=today()) => learnedWords().filter(w => P.srs[w][1] <= day);
function grade(w, ok){
  const t = today(); let [box, , learned] = P.srs[w] || [0,t,t];
  box = ok ? Math.min(MAX_BOX, box+1) : 1;
  P.srs[w] = [box, t + INTERVAL[box], learned];
}

/* ---------- speech (the browser's own English voice) ---------- */
function say(text){
  try{
    const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = .9;
    const v = speechSynthesis.getVoices().find(v => /^en[-_]US/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- header ---------- */
function renderStats(){
  const due = dueWords().length;
  const nL = learnedWords().length;
  $("#st-learned").textContent = nL;
  $("#rt-n").textContent = nL;
  const pct = nL/2000*100;
  $("#rt-pct").textContent = (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "%";
  $("#rt-bar").style.width = Math.max(nL ? 1.5 : 0, pct) + "%";
  $("#st-due").textContent = due;
  $("#st-streak").textContent = P.streak.last >= today()-1 ? P.streak.n : 0;
  const b = $("#tab-due"); b.hidden = !due; b.textContent = due;
}

/* ---------- routing ---------- */
const panel = $("#panel");
let tab = "lesson", view = null;
function setTab(t){
  tab = t; view = null;
  if (t==="rank") loadBoard();
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab===t));
  rerender();
}
function rerender(){
  renderStats();
  if (view) return;
  if (tab==="lesson") renderLesson();
  else if (tab==="recall") renderRecallHome();
  else if (tab==="rank") renderRank();
  else renderPlan();
}


/* ---------- icons ---------- */
const ic = (p, cls="") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const I = {
  cal: ic('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  chev: ic('<path d="m9 6 6 6-6 6"/>', "chev"),
  check: ic('<path d="m5 12 5 5L20 7"/>'),
  book: ic('<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'),
  chat: ic('<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'),
  head: ic('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
  layers: ic('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>'),
  bulb: ic('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"/>'),
  bolt: ic('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  play: ic('<path d="m9 6 6 6-6 6"/>'),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
};
const SPARKLES = `<svg class="deco" viewBox="0 0 120 90" aria-hidden="true">
  <circle cx="78" cy="44" r="34" fill="#EAF6EE"/><circle cx="96" cy="26" r="16" fill="#FFF3C4"/>
  <path d="M30 16l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FFC21A"/><path d="M104 58l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FFC21A"/>
  <path d="M60 64l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#7CCB9C"/>
  <text x="78" y="56" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="34" fill="#22A262">Aa</text></svg>`;

/* ---------- lesson tab ---------- */
let sel = null, selFam = null, pickWeek = null, famOpen = false;
let qi = 0, Q = null; const qHist = [];
function renderWeekbar(){
  if (pickWeek == null) pickWeek = lessonById(P.cur).week;
  const wk = WEEKS.find(w => w.n===pickWeek) || WEEKS[0];
  const ls = LESSONS.filter(l => l.week===wk.n), d = ls.filter(l => P.done[l.id]).length;
  return `<div class="weekbar card">
    <button class="wkbtn" data-act="week-next" title="Chuyển sang tuần tiếp theo">${I.cal}
      <span><b>Tuần ${wk.n}</b><small>${esc(wk.title)} · ${d}/${ls.length} bài</small>
      <span class="wkdots">${WEEKS.map(w => `<i class="${w.n===wk.n?"on":""}"></i>`).join("")}</span></span>${I.chev}</button>
    <div class="days5">${ls.map(l => {
      const n = (P.seen[l.id]||[]).length;
      return `<button class="dayc ${P.done[l.id]?"done":""} ${P.cur===l.id?"current":""}" data-lesson="${l.id}">
        <span class="dt"><b>Bài ${l.day}</b><small>${P.done[l.id] ? "Đã học" : n ? `Đã xem ${n}/10` : "Chưa học"}</small></span>
        <span class="dn"><i class="dot">${P.done[l.id] ? I.check : ""}</i>${esc(l.title)}</span></button>`;
    }).join("")}</div>
  </div>`;
}
function renderLesson(){
  panel.className = "panel bare";
  const L = lessonById(P.cur);
  if (!sel || WORDS[sel]?.lesson !== L.id){ sel = L.words[0].w; selFam = null; qi = 0; Q = null; famOpen = false; }
  markSeen(L, sel);
  const nx = nextLesson(L);
  panel.innerHTML = `
    ${renderWeekbar()}
    <div class="lgrid">
      <section class="card cloud-card" aria-label="Từ vựng của bài">
        <div class="card-head"><h3>${I.chat}Từ vựng bài học · ${esc(L.title)}</h3><span class="seen-chip" id="seen-chip"></span></div>
        <p class="cloud-sub">Bấm vào một từ để xem nghĩa, phát âm và ví dụ.</p>
        <div class="cloud-area"><div class="cloud" id="cloud"></div></div>
      </section>
      <section class="card wcard" id="detail" aria-label="Chi tiết từ"></section>
      <section class="card qcard" id="quick" aria-label="Bài tập nhanh"></section>
      <section class="card fcard" id="fam-box" aria-label="Gia đình từ và từ liên quan"></section>
    </div>
    <div class="actbar card">
      <div class="tip">${I.bulb}${P.done[L.id] ? `<span class="done-tag">Đã hoàn thành bài này ngày ${fmtDay(P.done[L.id])}. Bạn có thể kiểm tra lại bất cứ lúc nào.</span>` : `<span>Xem hết 10 từ, nghe phát âm, đọc to câu ví dụ, rồi làm bài kiểm tra nhanh.</span>`}</div>
      <div class="btns">
        ${nx ? `<button class="btn white" data-lesson="${nx.id}">Bài sau ${I.arrow}</button>` : ""}
        <button class="btn primary big" data-act="lesson-check">${I.bolt}${P.done[L.id] ? "Kiểm tra lại" : "Kiểm tra nhanh & hoàn thành"}</button>
      </div>
    </div>`;
  updateSeenChip(L);
  renderDetail();
  renderQuick();
  layoutCloud(L);
}
function nextLesson(L){ const i = LESSONS.indexOf(L); return LESSONS[i+1]; }
function markSeen(L, w){
  const s = P.seen[L.id] || [];
  if (!s.includes(w)){ s.push(w); P.seen[L.id] = s; save(); }
}
function updateSeenChip(L){
  const c = $("#seen-chip"); if (c) c.textContent = `Đã xem ${(P.seen[L.id]||[]).length}/${L.words.length}`;
}
const exBold = s => esc(s).replace(/\*(.+?)\*/g, "<b>$1</b>");
function renderDetail(){
  const w = WORDS[sel], box = P.srs[w.w];
  const forms = w.forms ? `<div class="forms-row">
      <span class="fbadge ${w.forms.irr?"":"reg"}">Dạng động từ ${w.forms.irr?"bất quy tắc":"có quy tắc"}:</span>
      <span class="flist">${[[w.w,w.ipa,"V1"],[w.forms.v2,w.forms.ipa2,"V2"],[w.forms.v3,w.forms.ipa3,"V3"]].map(([f,ip,k]) =>
        `<button class="fchip" data-say="${esc(f)}" title="${k} · bấm để nghe"><b>${esc(f)}</b><span class="ipa">${esc(ip)}</span></button>`).join('<span class="sl">/</span>')}</span>
    </div>` : "";
  $("#detail").innerHTML = `${SPARKLES}
    <div class="whead"><span class="wicon">${I.book}</span>
      <div style="min-width:0"><div class="d-word">${esc(w.w)}</div>
        <div class="d-ipa"><span class="ipa">${esc(w.ipa)}</span>${speakBtn(w.w,"sm")}<span class="pos">${esc(w.pos)}</span></div>
        <div class="d-vi">${esc(w.vi)}</div></div></div>
    ${forms}
    <div class="exs">${w.exs.map(e => `
      <div class="exr"><span class="lvt lv${e.lv}" title="${LEVELS[e.lv]}">${["A1","A2","B1"][e.lv]}</span>
        <div><p class="en">${exBold(e.en)}</p><p class="vi">${esc(e.vi)}</p></div>${speakBtn(exPlain(e.en),"sm")}</div>`).join("")}</div>
    ${box ? `<div class="next-rv">${I.clock}Lần ôn tiếp theo: ${box[1]<=today()?"hôm nay":fmtDay(box[1])}</div>` : ""}`;
  renderFam(w);
}
function renderFam(w){
  const items = [
    ...w.fam.map(f => ({form:f.form, tag:f.pos, cls:"k-pos", vi:f.vi, ipa:f.ipa, note:false})),
    ...w.rel.map(r => ({form:r.form, tag:r.kind, cls:"k-"+(KIND_CLS[r.kind]||"rel"), vi:r.vi, ipa:r.ipa, note:r.kind==="lưu ý"}))
  ];
  if (selFam && items.findIndex(x => x.form===selFam) >= 4) famOpen = true;
  const shown = famOpen ? items : items.slice(0, 4);
  $("#fam-box").innerHTML = `
    <div class="card-head"><h3>${I.layers}Gia đình từ & từ liên quan</h3>
      ${items.length > 4 ? `<button class="link" data-act="fam-toggle">${famOpen ? "Thu gọn" : `Xem thêm (${items.length-4})`} →</button>` : ""}</div>
    ${items.length ? `<div class="fgrid">${shown.map(it => `
      <div class="fitem ${it.note?"note":""} ${selFam===it.form?"hot":""}">
        <div class="ft"><b>${esc(it.form)}</b><span class="rk ${it.cls}">${esc(it.tag)}</span>${it.ipa ? `<span class="ipa sm">${esc(it.ipa)}</span>` : ""}</div>
        ${it.note ? "" : speakBtn(it.form.replace(/\s*\(.*?\)/g,""),"sm")}<p>${esc(it.vi)}</p></div>`).join("")}</div>`
      : `<p class="muted" style="margin:0">Từ này chưa có từ liên quan.</p>`}`;
}

/* quick exercise: one gap-fill per lesson word, in order; options are other forms of the same word */
function plural(s){ return /(s|sh|ch|x|z)$/.test(s) ? s+"es" : /[^aeiou]y$/.test(s) ? s.slice(0,-1)+"ies" : s+"s"; }
function quickOpts(w, ans, L){
  const a = ans.toLowerCase(), base = w.w.toLowerCase();
  let c = [base, ...w.fam.filter(f => !/\s/.test(f.form) && FAM_POS.includes(f.pos)).map(f => f.form)];
  if (w.forms && a !== base) c.push(w.forms.v2, w.forms.v3);
  if (/^(v|n)/.test(w.pos)) c.push(plural(base));
  c = [...new Set(c.filter(Boolean).map(x => x.toLowerCase()))].filter(x => x !== a);
  c = shuffle(c).slice(0, 3);
  for (const x of shuffle(L.words)) { if (c.length >= 3) break; const m = marked((x.exs[1]||x.exs[0]).en).toLowerCase(); if (m !== a && !c.includes(m)) c.push(m); }
  return shuffle([a, ...c]);
}
function renderQuick(){
  const L = lessonById(P.cur), w = L.words[qi % L.words.length], e = w.exs[1] || w.exs[0];
  if (!Q || Q.key !== L.id + qi){ const ans = marked(e.en); Q = {key:L.id+qi, w, e, ans, opts:quickOpts(w, ans, L), picked:null}; }
  const done = Q.picked != null, ok = done && Q.opts[Q.picked] === Q.ans.toLowerCase();
  const sent = esc(e.en).replace(/\*(.+?)\*/, done ? `<b class="fill ${ok?"ok":"no"}">${esc(Q.ans)}</b>` : '<span class="blank"></span>');
  const hist = qHist.slice(-3); while (hist.length < 3) hist.push(null);
  $("#quick").innerHTML = `
    <div class="card-head"><h3>${I.head}Bài tập nhanh: Điền từ còn thiếu</h3><button class="link" data-act="lesson-check">Làm bài kiểm tra →</button></div>
    <div class="qbody">
      <div class="qhist" aria-label="Kết quả 3 câu gần nhất">${hist.map(h => `<span class="qh ${h===true?"ok":h===false?"no":""}">${h===true?"✓":h===false?"✗":""}</span>`).join("")}</div>
      <div class="qmain">
        <div class="qq"><span class="qn">${I.play}</span><span>${qi % L.words.length + 1}. ${sent}</span></div>
        <div class="qopts">${Q.opts.map((o,i) => `<button class="qopt ${done && o===Q.ans.toLowerCase() ? "right" : done && i===Q.picked ? "wrong" : ""}" data-q="${i}" ${done?"disabled":""}>${"ABCD"[i]}. ${esc(o)}</button>`).join("")}</div>
        ${done ? `<div class="qfb"><span class="${ok?"ok":"no"}">${ok ? "Chính xác!" : `Đáp án: ${esc(Q.ans)}`}</span><span class="muted">${esc(e.vi)}</span><button class="link" data-act="q-next">Câu tiếp →</button></div>` : ""}
      </div>
    </div>`;
}
function answerQuick(i){
  if (!Q || Q.picked != null) return;
  Q.picked = i;
  qHist.push(Q.opts[i] === Q.ans.toLowerCase());
  say(exPlain(Q.e.en));
  renderQuick();
}

function selectWord(w, fam=null){
  sel = w; selFam = fam;
  const L = lessonById(P.cur); markSeen(L, w);
  document.querySelectorAll(".cw").forEach(el => {
    const isHead = el.classList.contains("head");
    el.classList.toggle("sel", isHead && el.dataset.word===w);
    if (isHead && el.dataset.word===w) el.classList.add("seen");
  });
  updateSeenChip(L);
  renderDetail();
  if (window.matchMedia("(max-width:860px)").matches) $("#detail").scrollIntoView({behavior:"smooth", block:"nearest"});
}

/* word pills: archimedean spiral placement with rectangle collision */
let cloudLesson = null;
function layoutCloud(L){
  cloudLesson = L;
  const box = $("#cloud"); if (!box) return;
  const W = box.clientWidth; if (!W) return;
  const s = Math.max(.6, Math.min(1, W/560));
  const sizes = {3:28, 2:23, 1:20};
  const seen = new Set(P.seen[L.id] || []);
  const heads = [...L.words].sort((a,b)=>b.f-a.f).map((w,i) => ({text:w.w, word:w.w, head:true, size:sizes[w.f]*s, cls:"head c"+(i%4===3?2:i%2)}));
  const fams = shuffle(L.words.flatMap(w => w.fam.slice(0,2).map(f => ({text:f.form, word:w.w, fam:f.form, head:false, size:Math.max(12, 14*s), cls:"fam"}))));
  let H = W < 520 ? 380 : 330;
  for (let attempt=0; attempt<4; attempt++){
    box.style.height = H + "px";
    box.innerHTML = "";
    const placed = []; let failed = 0;
    const ratio = W / H;
    const order = [...heads.filter(h => h.word===sel), ...heads.filter(h => h.word!==sel), ...fams];
    for (const it of order){
      const el = document.createElement("button");
      el.className = "cw " + it.cls + (it.head && seen.has(it.word) ? " seen" : "") + (it.head && it.word===sel ? " sel" : "");
      el.style.fontSize = it.size + "px"; el.textContent = it.text;
      el.dataset.word = it.word; if (it.fam) el.dataset.fam = it.fam;
      el.style.visibility = "hidden"; box.appendChild(el);
      const w = el.offsetWidth, h = el.offsetHeight;
      let ok = false;
      for (let t=0; t<900; t+=0.16){
        const r = 2.4*t;
        const x = W/2 + r*Math.cos(t)*Math.max(1,ratio*.8) - w/2;
        const y = H/2 + r*Math.sin(t) - h/2;
        if (x < 4 || y < 4 || x+w > W-4 || y+h > H-4) continue;
        const pad = it.head ? 10 : 7;
        if (placed.some(p => x < p.x+p.w+pad && x+w+pad > p.x && y < p.y+p.h+pad*.7 && y+h+pad*.7 > p.y)) continue;
        placed.push({x,y,w,h}); el.style.left = x+"px"; el.style.top = y+"px"; el.style.visibility = "visible"; ok = true; break;
      }
      if (!ok){ if (it.head) failed++; el.remove(); }
    }
    if (!failed) break;
    H += 70;
  }
}
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (tab==="lesson" && !view && cloudLesson && $("#cloud")) layoutCloud(cloudLesson); }, 150); });

/* ---------- quiz engine (lesson check + recall) ---------- */
function optionsFor(w, field, n=4){
  const L = lessonById(w.lesson);
  let pool = L.words.filter(x => x.w!==w.w);
  if (pool.length < n-1) pool = pool.concat(Object.values(WORDS).filter(x => x.w!==w.w && !pool.includes(x)));
  const others = shuffle(pool).filter((x,i,a) => a.findIndex(y=>y[field]===x[field])===i && x[field]!==w[field]).slice(0,n-1);
  return shuffle([w, ...others]);
}
const FAM_POS = ["n.","v.","adj.","adv.","số nhiều"];
const famCandidates = w => w.fam.filter(f => FAM_POS.includes(f.pos) && !/\s/.test(f.form));
function exerciseFor(w, mode){
  if (mode==="lesson") return {kind:"mc", w};
  const box = (P.srs[w.w]||[1])[0];
  let kinds = box<=1 ? ["mc","listen"] : box===2 ? ["mc","listen","type","gap","forms"] : ["type","gap","family","forms"];
  if (!famCandidates(w).length) kinds = kinds.filter(k => k!=="family");
  if (!(w.forms && w.forms.irr)) kinds = kinds.filter(k => k!=="forms");
  const kind = pick(kinds);
  const ex = {kind, w};
  if (kind==="family") ex.fam = pick(famCandidates(w));
  if (kind==="gap") ex.ex = w.exs[box<=2 ? pick([0,1]) : pick([1,2])] || w.exs[0];
  if (kind==="forms") ex.which = w.forms.v2===w.forms.v3 ? "both" : pick(["v2","v3"]);
  return ex;
}
function startQuiz(words, mode, title){
  const items = words.map(w => exerciseFor(WORDS[w] || w, mode));
  view = {type:"quiz", mode, title, items:shuffle(items), i:0, right:0, wrong:[], answered:false, hints:0, retry:new Set()};
  renderQuiz();
}
function renderQuiz(){
  panel.className = "panel";
  const v = view;
  if (v.i >= v.items.length) return renderSummary();
  const it = v.items[v.i], w = it.w;
  v.answered = false; v.hints = 0;
  const total = v.items.length;
  const head = `<div class="ex-head"><span>${esc(v.title)}</span><div class="meter"><i style="width:${v.i/total*100}%"></i></div><span>${v.i+1}/${total}</span></div>`;
  let body = "";
  if (it.kind==="mc"){
    it.opts = it.opts || optionsFor(w, "vi");
    body = `<div class="prompt"><span class="kind">Chọn nghĩa đúng</span><div class="big">${esc(w.w)}</div><div><span class="ipa">${esc(w.ipa)}</span> <span class="pos">${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>
      <div class="options">${it.opts.map((o,i) => `<button class="opt" data-opt="${i}"><kbd>${i+1}</kbd><span>${esc(o.vi)}</span></button>`).join("")}</div>`;
  } else if (it.kind==="listen"){
    it.opts = it.opts || optionsFor(w, "w");
    body = `<div class="prompt"><span class="kind">Nghe và chọn từ bạn nghe được</span>${speakBtn(w.w,"big")}<span class="muted">Bấm loa để nghe lại</span></div>
      <div class="options">${it.opts.map((o,i) => `<button class="opt" data-opt="${i}"><kbd>${i+1}</kbd><span>${esc(o.w)}</span></button>`).join("")}</div>`;
  } else if (it.kind==="type"){
    body = `<div class="prompt"><span class="kind">Gõ từ tiếng Anh</span><div class="mid">${esc(w.vi)}</div><span class="pos">${esc(w.pos)}</span><div class="mask" id="mask"></div></div>`+inputBlock();
  } else if (it.kind==="gap"){
    const sent = esc(it.ex.en).replace(/\*(.+?)\*/, '<span class="gap"></span>');
    body = `<div class="prompt"><span class="kind">Điền từ còn thiếu · ${LEVELS[it.ex.lv]}</span><div class="sent">${sent}</div><div class="muted">${esc(it.ex.vi)}</div><div class="mask" id="mask"></div></div>`+inputBlock();
  } else if (it.kind==="forms"){
    const lab = it.which==="v2" ? "V2 · quá khứ đơn" : it.which==="v3" ? "V3 · quá khứ phân từ" : "V2 = V3 (giống nhau)";
    body = `<div class="prompt"><span class="kind">Động từ bất quy tắc</span><div class="mid">${esc(w.w)} → ?</div><span class="pos">${lab}</span><div class="muted">${esc(w.vi)}</div><div class="mask" id="mask"></div></div>`+inputBlock();
  } else if (it.kind==="family"){
    body = `<div class="prompt"><span class="kind">Gia đình từ</span><div class="mid">${esc(w.w)} <span class="pos">${esc(w.pos)}</span> → ? <span class="pos">${esc(it.fam.pos)}</span></div><div class="muted">Nghĩa cần tìm: “${esc(it.fam.vi)}”</div><div class="mask" id="mask"></div></div>`+inputBlock();
  }
  panel.innerHTML = `<div class="ex-wrap">${head}${body}<div class="feedback" id="fb"></div><div class="actions" id="acts">${
    ["type","gap","family","forms"].includes(it.kind) ? `<button class="btn ghost" data-act="hint">Gợi ý 1 chữ</button><button class="btn primary" data-act="check">Kiểm tra</button>` : ""}
    <button class="btn ghost" data-act="quit">Dừng</button></div></div>`;
  updateMask();
  if (it.kind==="listen") setTimeout(() => say(w.w), 250);
  const inp = $("#ans"); if (inp) inp.focus();
}
const inputBlock = () => `<input class="answer" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Gõ câu trả lời…" aria-label="Câu trả lời">`;
function expected(it){
  if (it.kind==="gap") return marked(it.ex.en);
  if (it.kind==="family") return it.fam.form;
  if (it.kind==="forms") return it.which==="v3" ? it.w.forms.v3 : it.w.forms.v2;
  return it.w.w;
}
function updateMask(){
  const m = $("#mask"); if (!m) return;
  const it = view.items[view.i], ans = expected(it);
  m.textContent = ans.split("").map((c,i) => c===" " ? "  " : (i<Math.max(1,view.hints) ? c : "_")).join("");
}
function finishAnswer(ok){
  const v = view, it = v.items[v.i], w = it.w;
  v.answered = true;
  const first = !v.retry.has(v.i);
  if (ok) v.right += first ? 1 : 0;
  if (v.mode==="recall" && first){ grade(w.w, ok && v.hints===0); touchStreak(); save(); renderStats(); }
  if (!ok && first){ v.wrong.push(w.w); if (v.mode==="recall"){ v.items.push({...it, opts:null}); v.retry.add(v.items.length-1); } }
  const fb = $("#fb");
  fb.className = "feedback " + (ok ? "ok" : "no");
  fb.innerHTML = (ok ? "Chính xác!" : `Đáp án: ${esc(expected(it))}`) +
    `<small><b>${esc(w.w)}</b> ${esc(w.ipa)} · ${esc(w.vi)}${!ok && v.mode==="recall" && first ? " · từ này sẽ được hỏi lại cuối lượt" : ""}</small>`;
  $("#acts").innerHTML = `<button class="btn primary" data-act="next">${v.i+1>=v.items.length ? "Xem kết quả" : "Tiếp theo →"}</button>`;
  $("#acts button").focus();
  say(expected(it));
}
function answerOpt(i){
  const v = view; if (v.answered) return;
  const it = v.items[v.i]; if (!it.opts || !it.opts[i]) return;
  const ok = it.opts[i].w === it.w.w;
  document.querySelectorAll(".opt").forEach((b,j) => { b.disabled = true; if (it.opts[j].w===it.w.w) b.classList.add("right"); else if (j===i) b.classList.add("wrong"); });
  finishAnswer(ok);
}
function answerText(){
  const v = view; if (v.answered) return;
  const inp = $("#ans"); const val = norm(inp.value); if (!val) return;
  const it = v.items[v.i];
  const ok = val === norm(expected(it)) || (it.kind==="gap" && val===norm(it.w.w) && norm(it.w.w)===norm(expected(it)));
  inp.classList.add(ok ? "ok" : "no"); inp.readOnly = true;
  finishAnswer(ok);
}
function renderSummary(){
  const v = view, n = new Set(v.items.map(x=>x.w.w)).size;
  let extra = "";
  if (v.mode==="lesson"){
    const L = lessonById(P.cur), t = today();
    L.words.forEach(w => { if (!P.srs[w.w]) P.srs[w.w] = [1, t+1, t]; });
    if (!P.done[L.id]) P.done[L.id] = t;
    touchStreak(); save(); renderStats();
    const nx = nextLesson(L);
    extra = `<p>10 từ của bài đã vào lịch ôn. Lần Recall đầu tiên: <b>ngày mai (${fmtDay(t+1)})</b>.</p>
      <div class="actions">${nx ? `<button class="btn primary" data-act="goto-next">Sang bài tiếp: ${esc(nx.title)}</button>` : ""}<button class="btn" data-act="back">Về bài học</button></div>`;
  } else {
    const nextDue = Math.min(...learnedWords().map(w => P.srs[w][1]));
    extra = `<p>${dueWords().length ? `Còn ${dueWords().length} từ đến hạn ôn hôm nay.` : `Bạn đã ôn xong hôm nay. Lượt ôn tiếp theo: <b>${nextDue<=today()+1?"ngày mai":fmtDay(nextDue)}</b>.`}</p>
      <div class="actions"><button class="btn primary" data-act="back">Về Recall</button></div>`;
  }
  const pct = n ? v.right/n : 0;
  panel.innerHTML = `<div class="summary">
    <div class="label">${esc(v.title)}</div>
    <div class="score">${v.right}/${n}</div>
    <p style="margin:0">${pct===1 ? "Tuyệt vời! Bạn nhớ hết." : pct>=.7 ? "Tốt lắm! Vài từ cần ôn thêm." : "Không sao. Ôn đi ôn lại chính là cách để nhớ lâu."}</p>
    ${v.wrong.length ? `<div class="label">Từ cần chú ý</div><div class="chips">${[...new Set(v.wrong)].map(w => `<span class="chip">${esc(w)} · ${esc(WORDS[w].vi)}</span>`).join("")}</div>` : ""}
    ${extra}</div>`;
  if (v.mode==="lesson"){ view = {type:"done", mode:"lesson"}; }
  else view = {type:"done", mode:"recall"};
}

/* ---------- recall tab ---------- */
function renderRecallHome(){
  panel.className = "panel";
  const learned = learnedWords();
  if (!learned.length){
    panel.innerHTML = `<div class="empty"><h2>Chưa có từ nào để ôn</h2><p>Hoàn thành bài học đầu tiên (xem 10 từ và làm bài kiểm tra nhanh). Các từ sẽ tự vào lịch ôn từ ngày hôm sau.</p><button class="btn primary" data-tab="lesson">Đi đến Bài học</button></div>`;
    return;
  }
  const t = today(), due = dueWords();
  const week = learned.filter(w => P.srs[w][2] >= t-6);
  const byWeek = WEEKS.map(wk => ({n:wk.n, words: learned.filter(w => lessonById(WORDS[w].lesson).week===wk.n)}));
  panel.innerHTML = `
    <div><h2 style="font-size:26px">Recall</h2><p class="muted" style="margin:4px 0 0">Mỗi từ được hỏi lại sau 1, 3, 7, 14, 30 rồi 60 ngày. Trả lời sai thì từ đó quay lại ôn từ ngày mai.</p></div>
    <div class="modes">
      <div class="mode main"><span class="label">Mỗi ngày · ~5 phút</span><h3>Ôn đến hạn hôm nay</h3><div class="n">${due.length}</div>
        <p>${due.length ? "Những từ bạn sắp quên. Ôn ngay để giữ chúng lâu hơn." : "Không còn từ nào đến hạn. Quay lại vào ngày mai nhé."}</p>
        <button class="btn primary push" data-act="recall-due" ${due.length?"":"disabled"}>Bắt đầu ôn</button></div>
      <div class="mode"><span class="label">Thứ 7 · ~10 phút</span><h3>Recall 7 ngày qua</h3><div class="n">${week.length}</div>
        <p>Tất cả từ bạn học trong 7 ngày, kể cả từ vừa học hôm nay. Dùng được ngay sau khi xong bài.</p>
        <button class="btn push" data-act="recall-week" ${week.length?"":"disabled"}>Ôn cả tuần</button></div>
      <div class="mode"><span class="label">Khi muốn ôn sâu</span><h3>Ôn theo tuần học</h3>
        <p>Chọn một tuần trong lộ trình để ôn lại các từ đã học.</p>
        <div class="wk-btns push">${byWeek.map(b => `<button class="btn" data-act="recall-wk" data-wk="${b.n}" ${b.words.length?"":"disabled"}>Tuần ${b.n} · ${b.words.length}</button>`).join("")}</div></div>
    </div>`;
}
function startRecall(words, title){
  const list = shuffle(words).sort((a,b) => P.srs[a][0]-P.srs[b][0]).slice(0, 20);
  view = {type:"cards", title, items:list.map(w => ({w, again:0, graded:false})), i:0, flipped:false, tally:{hard:0, ok:0, easy:0}};
  renderCards();
}
const POS_VI = {"n.":"Danh từ","v.":"Động từ","adj.":"Tính từ","adv.":"Trạng từ","conj.":"Liên từ","prep.":"Giới từ"};
const posVi = p => p.split("/").map(x => POS_VI[x.trim()] || x.trim()).join(" / ");
const LV_SHORT = ["A1","A2","B1"];
function renderCards(){
  panel.className = "panel";
  const v = view;
  if (v.i >= v.items.length) return renderCardsSummary();
  const it = v.items[v.i], w = WORDS[it.w];
  const firstRound = v.items.filter(x => !x.again).length;
  const pos = Math.min(v.i + 1, v.items.length);
  const exList = (withVi) => `<div class="fc-exs">${w.exs.map(e => `
      <div class="fc-ex"><span class="lvt lv${e.lv}" title="${LEVELS[e.lv]}">${LV_SHORT[e.lv]}</span>
        <div><p class="en">${exBold(e.en)}</p>${withVi ? `<p class="vi">${esc(e.vi)}</p>` : ""}</div>${speakBtn(exPlain(e.en),"sm")}</div>`).join("")}</div>`;
  const forms = w.forms ? `<div class="fc-forms">V1 – V2 – V3: <b>${esc(w.w)}</b> · <b>${esc(w.forms.v2)}</b> <span class="ipa">${esc(w.forms.ipa2)}</span> · <b>${esc(w.forms.v3)}</b> <span class="ipa">${esc(w.forms.ipa3)}</span></div>` : "";
  const [box] = P.srs[it.w] || [1];
  const easyDays = INTERVAL[Math.min(MAX_BOX, box+1)];
  panel.innerHTML = `<div class="fc-wrap">
    <div class="fc-top"><span class="fc-tag">Spaced repetition • Ôn tập chủ động</span><span class="fc-count">Thẻ ${pos} / ${v.items.length}</span></div>
    <div class="fc-bar"><i style="width:${v.i/v.items.length*100}%"></i></div>
    <div class="flip ${v.flipped?"on":""}" data-act="flip" tabindex="0" role="button" aria-label="Lật thẻ" aria-pressed="${v.flipped}">
      <div class="flip-in">
        <div class="face front">
          <span class="fc-pos">${esc(posVi(w.pos))}</span>
          <div class="fc-word">${esc(w.w)}</div>
          <div class="fc-ipa"><span class="ipa">${esc(w.ipa)}</span>${speakBtn(w.w,"solid")}</div>
          ${exList(false)}
          <div class="fc-hint">${ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}Bấm vào thẻ để lật xem nghĩa tiếng Việt</div>
        </div>
        <div class="face back">
          <span class="fc-pos">${esc(posVi(w.pos))}</span>
          <div class="fc-word sm">${esc(w.w)} <span class="ipa" style="font-size:.5em">${esc(w.ipa)}</span></div>
          <div class="fc-vi">${esc(w.vi)}</div>
          ${forms}
          ${exList(true)}
          <div class="fc-hint">${ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}Bấm để lật lại mặt trước</div>
        </div>
      </div>
    </div>
    <div class="rate">
      <button class="rbtn hard" data-r="hard">😓 Khó (Ôn lại ngay)<small>Hỏi lại cuối lượt · ôn lại ngày mai</small><kbd>Phím 1</kbd></button>
      <button class="rbtn ok" data-r="ok">🤔 Tạm ổn (1 ngày)<small>Giữ mức nhớ · ôn lại sau 1 ngày</small><kbd>Phím 2</kbd></button>
      <button class="rbtn easy" data-r="easy">🤩 Dễ (Đã thuộc)<small>Ôn lại sau ${easyDays} ngày</small><kbd>Phím 3</kbd></button>
    </div>
    <div class="fc-foot"><span>${esc(v.title)} · ${firstRound} từ${v.items.length > firstRound ? ` · ${v.items.length - firstRound} lượt ôn lại` : ""}</span><span>Phím tắt: <b>Space</b> lật thẻ · <b>1 2 3</b> đánh giá</span><button class="btn ghost" data-act="quit">Dừng</button></div>
  </div>`;
}
function rateCard(r){
  const v = view; if (!v || v.type!=="cards") return;
  const it = v.items[v.i]; if (!it) return;
  if (!it.graded){
    const t = today(); let [box, , learned] = P.srs[it.w] || [1,t,t];
    if (r==="hard") box = 1;
    else if (r==="easy") box = Math.min(MAX_BOX, box+1);
    else box = Math.max(1, box);
    P.srs[it.w] = [box, t + (r==="easy" ? INTERVAL[box] : 1), learned];
    v.tally[r]++; it.graded = true;
    touchStreak(); save(); renderStats();
  }
  if (r==="hard" && it.again < 2) v.items.push({w:it.w, again:it.again+1, graded:true});
  v.i++; v.flipped = false;
  renderCards();
}
function renderCardsSummary(){
  const v = view, n = v.items.filter(x => !x.again).length;
  const nextDue = learnedWords().length ? Math.min(...learnedWords().map(w => P.srs[w][1])) : today()+1;
  panel.innerHTML = `<div class="summary">
    <div class="label">${esc(v.title)}</div>
    <div class="score">${n} thẻ</div>
    <div class="tally"><span class="t-hard">😓 Khó: ${v.tally.hard}</span><span class="t-ok">🤔 Tạm ổn: ${v.tally.ok}</span><span class="t-easy">🤩 Dễ: ${v.tally.easy}</span></div>
    <p style="margin:0">${v.tally.hard ? "Các từ khó sẽ quay lại vào ngày mai." : "Tuyệt vời! Bạn nắm khá chắc các từ này."}
      ${dueWords().length ? ` Còn ${dueWords().length} từ đến hạn hôm nay.` : ` Lượt ôn tiếp theo: <b>${nextDue<=today()+1?"ngày mai":fmtDay(nextDue)}</b>.`}</p>
    <div class="actions"><button class="btn primary" data-act="back">Về Recall</button></div></div>`;
  view = {type:"done", mode:"recall"};
}

/* ---------- plan tab ---------- */
function renderPlan(){
  panel.className = "panel bare";
  const learned = learnedWords(), t = today();
  const strong = learned.filter(w => P.srs[w][0] >= STRONG).length;
  const doneN = Object.keys(P.done).filter(id => LESSONS.some(l=>l.id===id)).length;
  const pct = Math.round(doneN / LESSONS.length * 100);
  const C = 2*Math.PI*26;
  const next7 = Array.from({length:7}, (_,i) => ({d:t+i, n: learned.filter(w => i===0 ? P.srs[w][1]<=t : P.srs[w][1]===t+i).length}));
  const maxN = Math.max(1, ...next7.map(x=>x.n));
  const boxes = Array.from({length:MAX_BOX}, (_,i) => learned.filter(w => P.srs[w][0]===i+1).length);
  const maxB = Math.max(1, ...boxes);
  const calI = ic('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>');
  const steps = [
    ["<b>Mỗi tuần 5 bài, mỗi bài 10 từ gốc.</b> Nên học 1 bài mỗi ngày. Mỗi từ kèm dạng V2/V3 (nếu là động từ), gia đình từ, từ liên quan và 3 câu ví dụ từ dễ đến khó.", "m1"],
    ["<b>Khoảng 20 phút mỗi ngày:</b> 12–15 phút học bài mới (nghe phát âm, đọc to câu ví dụ) và 5 phút Recall các từ đến hạn.", "m2"],
    ["<b>Thứ 7:</b> Recall 7 ngày qua. <b>Chủ nhật:</b> nghỉ, hoặc chỉ ôn các từ đến hạn.", "m3"],
    ["<b>Ôn trước, học mới sau.</b> Nếu hôm nay có hơn 30 từ đến hạn, hãy chỉ ôn và tạm dừng bài mới.", "m4"],
    ["Theo nhịp này, 2000 từ mất khoảng <b>40 tuần</b> (9–10 tháng). Hiện đã mở 2 đợt đầu (8 tuần, 400 từ).", "m5"]
  ];
  panel.innerHTML = `
    <div class="pl-kpis">
      <div class="pk g"><span class="pk-ic">${calI}</span><div class="pk-tx"><b>${doneN}/${LESSONS.length}</b><span>Bài đã hoàn thành</span></div>
        <div class="ring" aria-label="${pct}% số bài"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="#E3EFE7" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="#22A262" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(pct/100*C).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${pct}%</b></div></div>
      <div class="pk w"><span class="pk-ic">${ic('<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>')}</span><div class="pk-tx"><b>${learned.length}</b><span>Từ đã học<br>(đã mở: ${Object.keys(WORDS).length} từ)</span></div></div>
      <div class="pk o"><span class="pk-ic">${ic('<path d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z"/>')}</span><div class="pk-tx"><b>${learned.length-strong}</b><span>Từ đang ghi nhớ</span></div></div>
      <div class="pk r"><span class="pk-ic">${ic('<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/>')}</span><div class="pk-tx"><b>${strong}</b><span>Từ đã vững<br>(ôn đúng ≥ 4 lần)</span></div></div>
    </div>
    <div class="pl-grid">
      <section class="card pl-card">
        <div class="card-head"><h3>${ic('<path d="M4 20v-6M9 20v-9M14 20v-5M19 20V9"/><path d="m4 10 5-4 5 3 6-5"/>')}Lịch ôn 7 ngày tới</h3><button class="link pill" data-tab="recall">Xem chi tiết →</button></div>
        <div class="drows">${next7.map((x,i) => `<div class="drow ${i===0?"today":""}"><span class="dic">${calI}</span><span>${i===0?"Hôm nay":WEEKDAY[wdOf(x.d)]+" "+fmtDay(x.d)}</span><span class="trk"><i style="width:${x.n/maxN*100}%"></i></span><b>${x.n}</b></div>`).join("")}</div>
        <div class="bx-title">${ic('<path d="M5 20V11M12 20V5M19 20v-7"/>')}Mức ghi nhớ (Hộp 1 → 6)</div>
        <div class="bxs">${boxes.map((n,i) => `<div><span class="n">${n}</span><i style="height:${n/maxB*80}px"></i><span class="k">${i+1}</span></div>`).join("")}</div>
      </section>
      <section class="card pl-card">
        <div class="card-head"><h3>${ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>','i-red')}Cách học đề xuất cho người đi làm</h3></div>
        <div class="steps">${steps.map(([tx,img],i) => `<div class="step s${i+1}"><span class="num">${i+1}</span><p>${tx}</p><img src="img/${img}.webp" alt="" loading="lazy"></div>`).join("")}</div>
      </section>
    </div>
    <div class="card resetbar">
      <span class="tip">${I.bulb}Xóa toàn bộ tiến độ để học lại từ đầu.</span>
      <div class="confirm" id="reset-area"><button class="btn redline" data-act="reset-ask">${ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}Xóa tiến độ</button></div>
    </div>`;
}


/* ---------- learner + leaderboard ---------- */
const effStreak = st => st && st.last >= today()-1 ? (st.n||0) : 0;
function boardStats(){
  const learned = learnedWords();
  return {learned: learned.length, strong: learned.filter(w => P.srs[w][0] >= STRONG).length,
    lessons: Object.keys(P.done).filter(id => LESSONS.some(l=>l.id===id)).length,
    streak: {n: P.streak.n||0, last: P.streak.last||0}};
}
function writeBoard(){
  if (!online || !MY_ID || !DATA) return;
  const st = boardStats();
  if (!st.learned && !st.lessons) return;
  const key = JSON.stringify(st);
  if (key === lastBoard) return;
  lastBoard = key;
  boardWrite = boardWrite.then(async () => {
    const { error } = await SB.from("board").upsert({user_id: MY_ID, learned: st.learned, strong: st.strong, lessons: st.lessons,
      streak_n: st.streak.n, streak_last: st.streak.last || 0, updated_at: new Date().toISOString()});
    if (error) lastBoard = "";
  });
}
const RANK_KEYS = {learned:"Từ đã học", streak:"Chuỗi ngày", lessons:"Bài đã xong", strong:"Từ đã vững"};
let rankBy = "learned";
const rankVal = (r, k) => k==="streak" ? effStreak(r.streak) : (r[k]||0);
function rankedBoard(k = rankBy){
  return (BOARD||[]).slice().sort((a,b) => rankVal(b,k)-rankVal(a,k) || (b.learned||0)-(a.learned||0) || (a.t||0)-(b.t||0));
}
function renderMe(){
  const el = $("#me"); if (!el || !ME) return;
  $("#me-av").src = ME.avatarUrl;
  $("#me-name").textContent = ME.name || (ME.id ? "Bạn" : "Khách");
  let sub = ME.id ? "Đang học" : "Chưa đăng nhập";
  if (BOARD && MY_ID){ const i = rankedBoard("learned").findIndex(r => r.id===MY_ID); if (i >= 0) sub = `Hạng #${i+1} · ${BOARD.length} người học`; }
  $("#me-sub").textContent = sub;
  $("#me").title = ($("#me-name").textContent) + " · " + sub;
  $("#mm-av").src = ME.avatarUrl; $("#mm-name").textContent = ME.name || "Bạn"; $("#mm-email").textContent = ME.email || "";
  if (document.activeElement !== $("#mm-input")) $("#mm-input").value = ME.name || "";
  const h = $("#hello");
  if (ME.id){
    h.hidden = false; h.textContent = "";
    h.append("Chào ", Object.assign(document.createElement("b"), {textContent: ME.name || "bạn"}), "!");
    if (BOARD && MY_ID){ const i = rankedBoard("learned").findIndex(r => r.id===MY_ID);
      if (i >= 0) h.append(Object.assign(document.createElement("span"), {className:"rk", textContent:`Hạng #${i+1} / ${BOARD.length} người học`}));
      else h.append(" Học xong bài đầu tiên để lên bảng xếp hạng."); }
  } else h.hidden = true;
}
let rankToken = 0;
async function renderRank(){
  panel.className = "panel bare";
  const tok = ++rankToken;
  const trophy = ic('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>');
  const info = ic('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>');
  const head = `<div class="rk-head"><h2>${trophy}Bảng xếp hạng</h2>
    <div class="sorts" role="group" aria-label="Xếp theo">${Object.entries(RANK_KEYS).map(([k,l]) => `<button data-act="rank-by" data-k="${k}" aria-pressed="${k===rankBy}">${l}</button>`).join("")}</div></div>`;
  const note = `<p class="rk-note">${info}<span>Mỗi người chỉ thấy tiến độ chi tiết của riêng mình. Bảng này chỉ hiện các con số tổng: số từ đã học, từ đã vững, số bài đã xong và chuỗi ngày học. Hoàn thành bài học đầu tiên để xuất hiện trên bảng.</span></p>`;
  if (!BOARD){
    panel.innerHTML = `<div class="card rk-wrap">${head}<p class="muted" style="margin:0">Đang tải bảng xếp hạng…</p>${note}</div>`;
    return;
  }
  const rows = rankedBoard();
  if (!rows.length){
    panel.innerHTML = `<div class="card rk-wrap">${head}<div class="empty"><h2>Chưa có ai trên bảng</h2><p>Hoàn thành bài học đầu tiên để trở thành người đầu tiên trên bảng xếp hạng.</p><button class="btn primary" data-tab="lesson">Đi đến Bài học</button></div>${note}</div>`;
    return;
  }
  const ps = PROFILES;
  if (tok !== rankToken || tab!=="rank" || view) return;
  const nm = r => (ps[r.id] && ps[r.id].name) || (r.id===MY_ID ? (ME && ME.name) || "Bạn" : "Người học");
  const av = r => (ps[r.id] && ps[r.id].avatarUrl) || "";
  const unit = {learned:"từ", streak:"ngày", lessons:"bài", strong:"từ"}[rankBy];
  const top = rows.slice(0,3);
  panel.innerHTML = `<div class="card rk-wrap">${head}
    <div class="podium">${top.map((r,i) => `<div class="pod p${i+1}"><span class="medal">${i+1}</span><img data-av="${i}" alt=""><div class="nm" data-nm="${i}"></div>${r.id===MY_ID?'<span class="you">Bạn</span>':""}<div class="val">${rankVal(r,rankBy)}<small>${unit}</small></div></div>`).join("")}</div>
    <div class="rk-list" role="table" aria-label="Bảng xếp hạng">
      <div class="rk-row hd" role="row"><span>#</span><span></span><span>Người học</span>${Object.entries(RANK_KEYS).map(([k,l]) => `<span class="${k===rankBy?"on":""}">${l}</span>`).join("")}</div>
      ${rows.map((r,i) => `<div class="rk-row ${r.id===MY_ID?"me-row":""}" role="row"><span class="rpos">${i+1}</span><img data-avr="${i}" alt=""><span class="nm" data-nmr="${i}"></span>${Object.keys(RANK_KEYS).map(k => `<span class="c ${k===rankBy?"on":""}">${rankVal(r,k)}</span>`).join("")}</div>`).join("")}
    </div>${note}</div>`;
  top.forEach((r,i) => { const im = panel.querySelector(`[data-av="${i}"]`); if (av(r)) im.src = av(r); else im.remove(); panel.querySelector(`[data-nm="${i}"]`).textContent = nm(r); });
  rows.forEach((r,i) => { const im = panel.querySelector(`[data-avr="${i}"]`); if (av(r)) im.src = av(r); else im.style.visibility = "hidden"; const n = panel.querySelector(`[data-nmr="${i}"]`); n.textContent = nm(r); if (r.id===MY_ID){ const y = document.createElement("span"); y.className = "you"; y.textContent = "Bạn"; n.appendChild(y); } });
}

/* ---------- events ---------- */
function toggleMenu(open){
  const m = $("#me-menu"); if (!m) return;
  m.hidden = !open; $("#me").setAttribute("aria-expanded", String(open));
  if (open){ $("#mm-msg").textContent = ""; renderMe(); }
}
document.addEventListener("click", e => {
  if (!e.target.closest(".me-wrap") && $("#me-menu") && !$("#me-menu").hidden) toggleMenu(false);
  if (e.target.closest("#me-menu [data-tab]")) toggleMenu(false);
  const s = e.target.closest("[data-say]"); if (s){ say(s.dataset.say); return; }
  const tb = e.target.closest("[data-tab]"); if (tb){ setTab(tb.dataset.tab); return; }
  const cw = e.target.closest(".cw"); if (cw){ selectWord(cw.dataset.word, cw.dataset.fam || null); return; }
  const wb = e.target.closest("[data-week]"); if (wb){ pickWeek = +wb.dataset.week; renderLesson(); return; }
  const ls = e.target.closest("[data-lesson]");
  if (ls){ P.cur = ls.dataset.lesson; pickWeek = lessonById(P.cur).week; sel = null; save(); view = null; renderLesson(); return; }
  const op = e.target.closest("[data-opt]"); if (op){ answerOpt(+op.dataset.opt); return; }
  const qb = e.target.closest("[data-q]"); if (qb){ answerQuick(+qb.dataset.q); return; }
  const rb = e.target.closest("[data-r]"); if (rb){ rateCard(rb.dataset.r); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act==="me-toggle"){ toggleMenu($("#me-menu").hidden); }
  else if (act==="logout"){ toggleMenu(false); SB.auth.signOut().finally(() => location.replace("login.html")); }
  else if (act==="save-name"){
    const v = $("#mm-input").value.trim().slice(0, 40), msg = $("#mm-msg");
    if (!v){ msg.textContent = "Tên không được để trống."; return; }
    SB.from("profiles").update({display_name: v}).eq("id", MY_ID).then(({error}) => {
      if (error){ msg.textContent = "Chưa lưu được, vui lòng thử lại."; return; }
      ME.name = v; if (ME.avatarUrl.startsWith("data:")) ME.avatarUrl = avatarFor(MY_ID, v);
      PROFILES[MY_ID] = {name: v, avatarUrl: ME.avatarUrl}; msg.textContent = "Đã lưu tên mới.";
      renderMe(); if (tab==="rank" && !view) renderRank();
    });
  }
  else if (act==="rank-by"){ rankBy = a.dataset.k; renderRank(); }
  else if (act==="flip"){ if (view && view.type==="cards"){ view.flipped = !view.flipped; const f = $(".flip"); f.classList.toggle("on", view.flipped); f.setAttribute("aria-pressed", view.flipped); if (view.flipped) say(view.items[view.i].w); } }
  else if (act==="week-next"){ pickWeek = pickWeek % WEEKS.length + 1; renderLesson(); }
  else if (act==="fam-toggle"){ famOpen = !famOpen; renderFam(WORDS[sel]); }
  else if (act==="q-next"){ qi++; Q = null; renderQuick(); }
  else if (act==="lesson-check"){ const L = lessonById(P.cur); startQuiz(L.words.map(w=>w.w), "lesson", "Kiểm tra nhanh · " + L.title); }
  else if (act==="check") answerText();
  else if (act==="hint"){ const it = view.items[view.i]; if (view.hints < expected(it).length-1){ view.hints = Math.max(1,view.hints)+1; updateMask(); $("#ans")?.focus(); } }
  else if (act==="next"){ view.i++; renderQuiz(); }
  else if (act==="quit" || act==="back"){ view = null; rerender(); }
  else if (act==="goto-next"){ const nx = nextLesson(lessonById(P.cur)); if (nx){ P.cur = nx.id; pickWeek = nx.week; sel = null; save(); } view = null; setTab("lesson"); }
  else if (act==="recall-due") startRecall(dueWords(), "Ôn đến hạn hôm nay");
  else if (act==="recall-week") startRecall(learnedWords().filter(w => P.srs[w][2] >= today()-6), "Recall 7 ngày qua");
  else if (act==="recall-wk"){ const n = +a.dataset.wk; startRecall(learnedWords().filter(w => lessonById(WORDS[w].lesson).week===n), "Ôn tuần " + n); }
  else if (act==="reset-ask") $("#reset-area").innerHTML = `<span style="font-size:14px;font-weight:600">Xóa hết tiến độ? Không thể hoàn tác.</span><button class="btn red" data-act="reset-yes">Xóa</button><button class="btn ghost" data-act="reset-no">Hủy</button>`;
  else if (act==="reset-no") renderPlan();
  else if (act==="reset-yes"){ P = fresh(); save(); sel = null; renderStats(); renderPlan(); }
});
document.addEventListener("keydown", e => {
  if (view && view.type==="cards"){
    if (e.target.tagName==="BUTTON" && e.target.dataset.act!=="flip" && (e.key===" "||e.key==="Enter")) return;
    if (e.key===" " || e.key==="Enter"){ e.preventDefault(); $(".flip")?.click(); }
    else if (e.key==="1") rateCard("hard"); else if (e.key==="2") rateCard("ok"); else if (e.key==="3") rateCard("easy");
    return;
  }
  if (!view || view.type!=="quiz") return;
  const it = view.items[view.i]; if (!it) return;
  if (e.key==="Enter"){
    if (e.target.tagName==="BUTTON") return;
    if (view.answered){ e.preventDefault(); view.i++; renderQuiz(); }
    else if (e.target.id==="ans"){ e.preventDefault(); answerText(); }
  } else if (/^[1-4]$/.test(e.key) && it.opts && e.target.id!=="ans") answerOpt(+e.key-1);
});

/* ---------- boot ---------- */
async function main(){
  renderStats(); setSave("loading");
  let ok = false;
  try{ ok = await startSession(); }catch(e){ ok = false; panel.className = "panel"; panel.innerHTML = `<div class="empty"><h2>Không kết nối được máy chủ</h2><p>Kiểm tra mạng rồi tải lại trang.</p></div>`; }
  if (!ok) return;
  renderMe();
  try{
    const r = await fetch("data/lessons.json"); if (!r.ok) throw new Error(r.status);
    buildIndex(await r.json());
  }catch(e){ panel.className = "panel"; panel.innerHTML = `<div class="empty"><h2>Không tải được bài học</h2><p>Tải lại trang để thử lại.</p></div>`; return; }
  if (!LESSONS.some(l=>l.id===P.cur)) P.cur = LESSONS[0].id;
  rerender();
  setSave(online ? "cloud" : "retry");
  if (online){ if (P.t > 0) flush(); loadBoard(); }
  else if (P.t > 0) flush();
}
main();
