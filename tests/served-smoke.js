const origin = process.env.NETLIFY_TEST_URL || "http://localhost:8888";
const endpoint = `${origin}/.netlify/functions/game`;

async function post(payload) {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${payload.action} failed (${response.status}): ${result.error || "unknown error"}`);
  return result;
}

const healthResponse = await fetch(endpoint, { cache: "no-store" });
if (!healthResponse.ok || JSON.stringify(await healthResponse.json()) !== JSON.stringify({ ok: true })) throw new Error("Function GET health check failed");

const created = await post({ action: "createRoom", nickname: "A" });
const a = { roomCode: created.roomCode, playerId: created.playerId, token: created.token };
const joined = await post({ action: "join", roomCode: created.roomCode, nickname: "B" });
const b = { roomCode: created.roomCode, playerId: joined.playerId, token: joined.token };
for (const chore of joined.state.chores.slice(3)) await post({ action: "removeChore", ...a, choreId: chore.id });
await post({ action: "start", ...a });

await post({ action: "lockBid", ...a, price: 5 });
let result = await post({ action: "lockBid", ...b, price: 12 });
if (result.state.reveal.doerId !== a.playerId) throw new Error("Round 1 winner mismatch");
await post({ action: "next", ...a });
await post({ action: "notIt", ...a });
const refused = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "notIt", ...b }) });
const refusedBody = await refused.json();
if (refused.ok || !/last one/.test(refusedBody.error || "")) throw new Error("Last-player NOT IT check failed");
await post({ action: "lockBid", ...b, price: 10 });
result = await post({ action: "poll", ...a, version: 0 });
if (result.state.reveal.doerId !== b.playerId) throw new Error("Round 2 winner mismatch");
await post({ action: "next", ...a });
await post({ action: "lockBid", ...a, price: 8 });
result = await post({ action: "lockBid", ...b, price: 3 });
if (result.state.reveal.doerId !== b.playerId) throw new Error("Round 3 winner mismatch");
await post({ action: "next", ...a });
result = await post({ action: "poll", ...a, version: 0 });
const summary = {
  roomCode: created.roomCode,
  phase: result.state.phase,
  coins: Object.fromEntries(result.state.players.map((p) => [p.name, p.coins])),
  awards: result.state.awards,
};
if (JSON.stringify(summary.coins) !== JSON.stringify({ A: 82, B: 118 })) throw new Error(`Coin totals mismatch: ${JSON.stringify(summary.coins)}`);
if (summary.awards.choreHero !== "B" || summary.awards.royalty !== "A" || summary.awards.sharpBidder !== "B") throw new Error(`Awards mismatch: ${JSON.stringify(summary.awards)}`);
console.log(JSON.stringify({ health: "ok", localBlobsGame: summary }, null, 2));
