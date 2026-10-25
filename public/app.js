const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const RULE = "Each chore goes to whoever asks the lowest price to do it, and everyone else pays them that price. Most coins at the end wins.";
const PACK_NAMES = ["Home", "Couple / Roommates", "Hostel room", "Diwali cleaning", "Group project", "Trip planning"];
let state, roomCode = "", playerId = "", token = "", nickname = "", bid = 10, serverOffset = 0, revealShown = 0;
let toastTimer, pollTimer, pollBusy = false, lastNotItSequence = null;
const endpoint = "/.netlify/functions/game";
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function send(action, data = {}) { return request(action, data); }
async function request(action, data = {}) {
  const body = { action, ...data };
  if (action !== "createRoom") Object.assign(body, { roomCode, playerId, token });
  if (action === "poll") body.version = state?.version ?? 0;
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(body) });
    const result = await response.json();
    if (result.serverNow) serverOffset = result.serverNow - Date.now();
    if (result.roomCode) roomCode = result.roomCode;
    if (result.playerId) playerId = result.playerId;
    if (result.token) token = result.token;
    if (roomCode && playerId && token) localStorage.setItem(`notit:${roomCode}`, JSON.stringify({ playerId, token }));
    if (result.state && roomCode && nickname) localStorage.setItem("notit:lastRoom", JSON.stringify({ roomCode, nickname }));
    if (result.unchanged) { if (result.version != null && state) state.version = result.version; return result; }
    if (result.state) {
      const old = state;
      const next = result.state;
      if (old?.phase !== next.phase || old?.roundIndex !== next.roundIndex) revealShown = 0;
      acceptNotItEvents(next.notItEvents || []);
      state = next;
      roomCode = next.roomCode || roomCode;
      render();
    }
    if (!result.ok && action !== "poll") showToast(result.error || "Could not update the room");
    if (!result.ok && action === "poll" && response.status === 404) { clearTimeout(pollTimer); state = null; roomCode = ""; playerId = ""; token = ""; home(); }
    return result;
  } catch (error) {
    if (action !== "poll") showToast("Connection problem. Please try again.");
    return { ok: false, error };
  } finally {
    if (action !== "poll") schedulePoll();
  }
}
function acceptNotItEvents(events) {
  const newest = events.at(-1)?.sequence ?? 0;
  if (lastNotItSequence == null) { lastNotItSequence = newest; return; }
  for (const event of events.filter((x) => x.sequence > lastNotItSequence)) {
    document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake");
    showToast(`🙅 ${event.player}: NOT IT!`, "notit");
  }
  lastNotItSequence = Math.max(lastNotItSequence, newest);
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!state || document.hidden) return;
  const delay = ["BIDDING", "REVEAL"].includes(state.phase) ? 1000 : 3000;
  pollTimer = setTimeout(poll, delay);
}
async function poll() {
  if (!state || document.hidden || pollBusy) return;
  pollBusy = true;
  try { await request("poll"); }
  finally { pollBusy = false; schedulePoll(); }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(pollTimer);
  else { render(); poll(); }
});
function showToast(message, kind = "") { toast.textContent = message; toast.classList.toggle("notit", kind === "notit"); toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3200); }
function home() {
  app.innerHTML = `<section class="home"><div class="brand">🧹 <span>Not It!</span><span class="home-diya" aria-hidden="true">🪔</span></div><p class="subtitle">The chores are up for auction.</p>
    <article class="panel"><h1>Start a room</h1><label>Your nickname<input id="create-name" maxlength="12" placeholder="e.g. Sam" autocomplete="nickname"></label><button class="primary" id="create">Create room</button></article>
    <article class="panel"><h2>Join a room</h2><label>4-letter room code<input id="join-code" maxlength="4" placeholder="ABCD" autocapitalize="characters"></label><label>Your nickname<input id="join-name" maxlength="12" placeholder="e.g. Alex" autocomplete="nickname"></label><button class="secondary" id="join">Join room</button></article>
    <p class="fine">No account. No install. Just send the room code.</p></section>`;
  document.querySelector("#create").onclick = async () => {
    const name = document.querySelector("#create-name").value.trim(); if (!name) return showToast("Add your nickname first");
    nickname = name; await request("createRoom", { nickname });
  };
  document.querySelector("#join").onclick = () => { const code = document.querySelector("#join-code").value.trim().toUpperCase(); const name = document.querySelector("#join-name").value.trim(); if (!name || code.length !== 4) return showToast("Enter a 4-letter code and nickname"); connect(code, name); };
}
async function connect(code, name) {
  clearTimeout(pollTimer); state = null; lastNotItSequence = null; roomCode = code; nickname = name;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`notit:${code}`) || "null"); } catch { localStorage.removeItem(`notit:${code}`); }
  playerId = saved?.playerId || ""; token = saved?.token || "";
  localStorage.setItem("notit:lastRoom", JSON.stringify({ roomCode, nickname }));
  await request("join", { roomCode, nickname, ...(playerId && token ? { playerId, token } : {}) });
}
function resumeRoom() {
  try {
    const saved = JSON.parse(localStorage.getItem("notit:lastRoom") || "null");
    if (saved?.roomCode && saved?.nickname) { connect(saved.roomCode, saved.nickname); return; }
  } catch { localStorage.removeItem("notit:lastRoom"); }
  home();
}
function playerCard(p, me = false) { return `<div class="player ${p.connected ? "" : "offline"} ${p.spectator ? "spectator" : ""}"><span class="avatar">${p.connected ? "🟢" : "⚪"}</span><strong>${escapeHTML(p.name)}${p.host ? " 👑" : ""}${me ? " (you)" : ""}</strong>${p.spectator ? `<small>Watching</small>` : state.phase === "BIDDING" ? `<small>${p.notItThisRound ? "NOT IT! 🙅" : p.locked ? "Locked in ✓" : "Choosing…"}</small>` : `<small class="${p.coins < 0 ? "negative" : ""}">🪙 ${p.coins}</small>`}</div>`; }
function render() {
  if (!state) return;
  const me = state.players.find((p) => p.id === state.yourId) || { name: nickname, id: playerId };
  if (state.phase === "LOBBY") return lobby(me);
  if (state.phase === "BIDDING") return bidding(me);
  if (state.phase === "REVEAL") return reveal(me);
  if (state.phase === "FINAL") return finalScreen(me);
}
function topBar() { return `<header class="top"><div class="mini-brand">🧹 Not It!</div><div class="room-pill">ROOM <b>${state.roomCode || roomCode}</b></div></header>`; }
function lobby(me) {
  const host = me.id === state.hostId;
  const packControl = host ? `<label>Start from a pack<select id="pack">${PACK_NAMES.map(x=>`<option ${state.pack===x?"selected":""}>${x}</option>`).join("")}</select></label>` : `<p class="fine">Pack: ${escapeHTML(state.pack || "Home")}</p>`;
  const startControl = host ? `<label class="switch-row"><span>Share fairly <small>Limit repeat chores where possible</small></span><input id="fair" type="checkbox" ${state.shareFairly ? "checked" : ""}></label><button id="start" class="primary full" ${state.players.filter(p=>!p.spectator).length<2 || state.chores.length<2 ? "disabled" : ""}>Start game →</button>` : `<p class="waiting">Waiting for the host to start…</p>`;
  app.innerHTML = `${topBar()}<section class="screen"><div class="room-code"><small>ROOM CODE</small><strong>${state.roomCode || roomCode}</strong><button class="icon-btn" id="copy-code" aria-label="Copy room code">⧉</button></div><p class="one-rule">${RULE}</p>
    <div class="layout"><section class="panel"><div class="section-title"><h2>Players</h2><span class="counter">${state.players.filter(p=>!p.spectator).length}/8</span></div><div class="players">${state.players.map(p=>playerCard(p,p.id===me.id)).join("")}</div>
      <h3>How to play</h3><ol class="how"><li>Everyone secretly bids 0–30 coins for each chore.</li><li>The lowest bidder does it; everyone else pays them that price.</li><li>Tap NOT IT! to escape, but you pay double.</li></ol></section>
      <section class="panel chore-panel"><div class="section-title"><h2>Chore list</h2><span class="counter">${state.chores.length}/12</span></div>
        ${packControl}
        <div class="chores">${state.chores.map(c=>`<div class="chore-row"><span>${escapeHTML(c.emoji)} ${escapeHTML(c.name)}</span>${host?`<button class="remove" data-remove="${c.id}" aria-label="Remove ${escapeHTML(c.name)}">×</button>`:""}</div>`).join("")}</div>
        <form id="add-form" class="add-form"><input id="emoji" maxlength="4" value="🧹" aria-label="Chore emoji"><input id="chore-name" maxlength="40" placeholder="Add a custom chore"><button class="add" ${state.chores.length>=12?"disabled":""}>+</button></form><small class="fine">Each player can add up to 3 chores.</small>
        ${startControl}</section></div></section>`;
  document.querySelector("#copy-code").onclick = () => navigator.clipboard?.writeText(state.roomCode || roomCode).then(()=>showToast("Room code copied"));
  if (host) { document.querySelector("#pack").onchange = e => send("selectPack", { pack: e.target.value }); document.querySelector("#fair").onchange = e => send("setShareFairly", { on: e.target.checked }); document.querySelector("#start").onclick = () => send("start"); }
  document.querySelectorAll("[data-remove]").forEach(el=>el.onclick=()=>send("removeChore",{choreId:el.dataset.remove}));
  document.querySelector("#add-form").onsubmit = e => { e.preventDefault(); send("addChore",{emoji:document.querySelector("#emoji").value.trim()||"🧹",name:document.querySelector("#chore-name").value}); document.querySelector("#chore-name").value=""; };
}
function bidding(me) {
  const chore = state.chores[state.roundIndex]; const active=state.players.filter(p=>!p.spectator); const locked=active.filter(p=>p.locked).length;
  const othersNotIt = active.filter(p=>p.id!==me.id).every(p=>p.notItUsed || p.locked);
  const blocked = !me.spectator && !me.notItUsed && !state.yourBid && active.filter(p=>p.id!==me.id).every(p=>p.locked && p.notItUsed);
  const seconds = Math.max(0,Math.ceil(((state.endsAt||Date.now()+30000)-(Date.now()+serverOffset))/1000));
  app.innerHTML = `${topBar()}<section class="screen game-screen"><div class="round-head"><span>ROUND ${state.roundIndex+1} OF ${state.chores.length}</span><strong id="timer" data-low="${seconds<=5}"><svg class="diya" viewBox="0 0 36 36" aria-hidden="true"><path class="diya-flame" d="M18 2c-1 6-7 8-6 14 1 4 3 5 6 5s6-2 6-6c0-4-3-7-6-13Z"/><path class="diya-bowl" d="M5 21h26c-1 8-6 12-13 12S6 29 5 21Z"/><path class="diya-rim" d="M4 21h28"/></svg><span id="timer-value">00:${String(seconds).padStart(2,"0")}</span></strong></div>${me.spectator?`<div class="spectator-banner">Watching — you'll join next game</div>`:""}
    <div class="players compact">${state.players.map(p=>playerCard(p,p.id===me.id)).join("")}</div><div class="big-chore"><div>${escapeHTML(chore?.emoji||"🧹")}</div><h1>${escapeHTML(chore?.name||"Chore")}</h1></div>
    ${me.spectator?"":`<div class="bid-box"><p>Your price to do it</p><div class="bid-control"><button id="minus" class="stepper">−</button><strong>${bid}</strong><button id="plus" class="stepper">+</button></div><div class="keypad">${Array.from({length:31},(_,n)=>n).map(n=>`<button data-bid="${n}" class="${n===bid?"selected":""}">${n}</button>`).join("")}</div><button id="lock" class="primary full" ${state.yourBid?"disabled":""}>${state.yourBid?"Locked in ✓":"Lock in " + bid}</button><button id="notit" class="notit full" ${state.yourBid||me.notItUsed||blocked?"disabled":""}>🙅 NOT IT!</button>${blocked?`<p class="last-one">You're the last one, so someone has to do it!</p>`:me.notItUsed?`<p class="fine">Your NOT IT! card has been used this game.</p>`:""}</div>`}
    <div class="locked-count">${locked} of ${active.length} locked in or tapped NOT IT!</div><p class="coins ${me.coins<0?"negative":""}">Your coins: 🪙 ${me.coins}</p></section>`;
  document.querySelector("#minus")?.addEventListener("click",()=>{bid=Math.max(0,bid-1);render()}); document.querySelector("#plus")?.addEventListener("click",()=>{bid=Math.min(30,bid+1);render()});
  document.querySelectorAll("[data-bid]").forEach(x=>x.onclick=()=>{bid=Number(x.dataset.bid);render()});
  document.querySelector("#lock")?.addEventListener("click",()=>send("lockBid",{price:bid})); document.querySelector("#notit")?.addEventListener("click",()=>send("notIt"));
  clearInterval(window.tick); window.tick=setInterval(()=>{const t=document.querySelector("#timer-value"); if(t){const left=Math.max(0,Math.ceil(((state.endsAt||Date.now())-(Date.now()+serverOffset))/1000));t.textContent=`00:${String(left).padStart(2,"0")}`;t.parentElement.dataset.low=String(left<=5);}},250);
}
function reveal(me) {
  clearInterval(window.tick); const r=state.reveal; if(!r) return;
  const visible=r.bids.slice().sort((a,b)=>(b.price??-1)-(a.price??-1));
  const elapsed = Math.max(0, Date.now() + serverOffset - (state.revealStartedAt || Date.now() + serverOffset));
  revealShown = Math.max(revealShown, Math.min(visible.length, Math.floor(elapsed / 800) + 1));
  const rows=visible.slice(0,revealShown).map(x=>`<div class="reveal-row"><span>${x.kind==="notIt"?"🙅 NOT IT!":x.kind==="timeout"?`⌛ Timeout · 🪙 ${x.price}`:`🪙 ${x.price}`} </span><strong>${escapeHTML(x.name)}</strong></div>`).join("");
  app.innerHTML=`${topBar()}<section class="screen reveal-screen"><div class="round-head"><span>ROUND ${r.roundNumber} OF ${state.chores.length}</span><span>REVEAL</span></div>${me.spectator?`<div class="spectator-banner">Watching — you'll join next game</div>`:""}<div class="big-chore"><div>${escapeHTML(r.chore.emoji)}</div><h1>${escapeHTML(r.chore.name)}</h1></div><h2>Prices revealed</h2><div class="reveal-list">${rows||`<p class="waiting">Opening the envelopes…</p>`}</div>${revealShown>=visible.length?`<div class="winner-card"><small>THIS CHORE GOES TO</small><strong>${escapeHTML(r.doerName)} 🎉</strong><p>They asked for <b>${r.price} coins</b>.</p><p class="decision">${r.tieBreak?escapeHTML(r.tieBreak):"Lowest eligible price wins."}</p></div><div class="payments">${state.players.filter(p=>p.id!==r.doerId&&!p.spectator).map(p=>`<div>🪙 ${escapeHTML(p.name)} <span>−${r.payments[p.id]}</span></div>`).join("")}<div class="recipient">🪙 ${escapeHTML(r.doerName)} <span>+${Object.values(r.payments).reduce((a,b)=>a+b,0)}</span></div></div>${me.id===state.hostId?`<button class="primary full" id="next">${state.roundIndex+1===state.chores.length?"See final scores →":"Next chore →"}</button>`:`<p class="waiting">Waiting for the host…</p>`}`:""}</section>`;
  if(revealShown<visible.length) { const expected=revealShown; const nextBoundary=800-(elapsed%800); setTimeout(()=>{if(state?.phase==="REVEAL"&&revealShown===expected)render();},Math.max(40,nextBoundary)); }
  document.querySelector("#next")?.addEventListener("click",()=>send("next"));
}
function finalScreen(me) {
  clearInterval(window.tick); const players=state.players.filter(p=>!p.spectator).slice().sort((a,b)=>b.coins-a.coins); const winner=players[0];
  const list=`Not It! chore list — Room ${state.roomCode||roomCode}\n${state.chores.map(c=>{const owner=players.find(p=>p.chores.some(x=>x.id===c.id)); const record=owner?.chores.find(x=>x.id===c.id);return `${c.emoji} ${c.name}: ${owner?`${owner.name} (${record.price} coins)`:"—"}`;}).join("\n")}\n\nCoins: ${players.map(p=>`${p.name} ${p.coins}`).join(" · ")}`;
  app.innerHTML=`${topBar()}<section class="screen final-screen">${me.spectator?`<div class="spectator-banner">Watching — you'll join next game</div>`:""}<div class="final-lanterns" aria-hidden="true"><span>🏮</span><span>🏮</span></div><p class="eyebrow">GAME OVER</p><h1>${escapeHTML(winner?.name||"Everyone")} wins! 🏆</h1><div class="leaderboard">${players.map((p,i)=>`<div class="leader ${i===0?"first":""}"><span>${i+1}.</span><strong>${escapeHTML(p.name)}</strong><span class="${p.coins<0?"negative":""}">🪙 ${p.coins}</span></div>`).join("")}</div><h2>Chores done</h2><div class="final-chores">${players.map(p=>`<article><h3>${escapeHTML(p.name)}</h3>${p.chores.length?p.chores.map(c=>`<p>${escapeHTML(c.emoji)} ${escapeHTML(c.name)} <small>· ${c.price} coins</small></p>`).join(""):`<p class="fine">No chores</p>`}</article>`).join("")}</div><h2>Fun awards</h2><div class="awards"><div>🦸 <b>Chore Hero</b><small>${escapeHTML(state.awards?.choreHero||"—")}</small></div><div>👑 <b>Royalty</b><small>${escapeHTML(state.awards?.royalty||"—")}</small></div><div>🎯 <b>Sharp Bidder</b><small>${escapeHTML(state.awards?.sharpBidder||"—")}</small></div></div><button id="copy-list" class="secondary full">Copy list for WhatsApp</button>${me.id===state.hostId?`<button id="again" class="primary full">Play again</button>`:`<p class="waiting">Waiting for the host to play again…</p>`}</section>`;
  document.querySelector("#copy-list").onclick=()=>navigator.clipboard?.writeText(list).then(()=>showToast("Chore list copied")); document.querySelector("#again")?.addEventListener("click",()=>send("playAgain"));
}
resumeRoom();
