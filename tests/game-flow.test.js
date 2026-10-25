import test from "node:test";
import assert from "node:assert/strict";
import { createGameService } from "../src/server/game-service.js";
import { createHandler } from "../src/server/handler.js";
import { MemoryStore } from "./helpers/memory-store.js";

function fixture() {
  let now = 1_800_000_000_000;
  let id = 0;
  const store = new MemoryStore();
  const game = createGameService(store, {
    clock: () => now,
    random: () => 0,
    sleep: async () => {},
    makeId: () => `player-${++id}`,
    makeToken: () => `secret-token-${++id}`,
  });
  return { store, game, get now() { return now; }, advance: (ms) => { now += ms; } };
}

const act = (f, player, action, data = {}) => f.game.handle({ action, ...player, ...data });

async function twoPlayers(f, choreCount = 3) {
  const created = await f.game.handle({ action: "createRoom", nickname: "A" });
  const a = { roomCode: created.roomCode, playerId: created.playerId, token: created.token };
  const joined = await f.game.handle({ action: "join", roomCode: created.roomCode, nickname: "B" });
  const b = { roomCode: created.roomCode, playerId: joined.playerId, token: joined.token };
  assert.equal(joined.state.pack, "Couple / Roommates");
  const room = await f.game.read(created.roomCode);
  for (const chore of room.room.chores.slice(choreCount)) await act(f, a, "removeChore", { choreId: chore.id });
  await act(f, a, "start");
  return { a, b, code: created.roomCode };
}

test("full two-player three-round game matches the exact scoring and awards", async () => {
  const f = fixture();
  const { a, b, code } = await twoPlayers(f, 3);
  assert.equal((await f.game.read(code)).room.shareFairly, true);

  await act(f, a, "lockBid", { price: 5 });
  let hidden = await act(f, b, "poll", { version: 0 });
  assert.equal(hidden.state.phase, "BIDDING");
  assert.equal(hidden.state.players.find((p) => p.id === a.playerId).locked, true);
  assert.equal(JSON.stringify(hidden).includes('"price":5'), false);
  let revealed = await act(f, b, "lockBid", { price: 12 });
  assert.equal(revealed.state.reveal.doerId, a.playerId);
  let coins = revealed.state.players.map((p) => p.coins);
  assert.deepEqual(coins, [105, 95]);
  assert.equal(coins.reduce((sum, amount) => sum + amount, 0), 200);

  await act(f, a, "next");
  await act(f, a, "notIt");
  const refused = await act(f, b, "notIt");
  assert.equal(refused.ok, false);
  assert.match(refused.error, /last one/);
  await act(f, b, "lockBid", { price: 10 });
  revealed = await f.game.handle({ action: "poll", ...a, version: 0 });
  assert.equal(revealed.state.reveal.doerId, b.playerId);
  coins = revealed.state.players.map((p) => p.coins);
  assert.deepEqual(coins, [85, 115]);
  assert.equal(coins.reduce((sum, amount) => sum + amount, 0), 200);

  await act(f, a, "next");
  assert.equal((await act(f, a, "notIt")).ok, false);
  await act(f, a, "lockBid", { price: 8 });
  revealed = await act(f, b, "lockBid", { price: 3 });
  assert.equal(revealed.state.reveal.doerId, b.playerId);
  coins = revealed.state.players.map((p) => p.coins);
  assert.deepEqual(coins, [82, 118]);
  assert.equal(coins.reduce((sum, amount) => sum + amount, 0), 200);
  await act(f, a, "next");
  const final = (await act(f, a, "poll", { version: 0 })).state;
  assert.equal(final.phase, "FINAL");
  assert.deepEqual(final.awards, { choreHero: "B", royalty: "A", sharpBidder: "B" });
});

test("both worked scoring examples conserve coins", async () => {
  const f = fixture();
  const { a, b, code } = await twoPlayers(f, 2);
  await act(f, a, "notIt");
  await act(f, b, "lockBid", { price: 10 });
  let room = (await f.game.read(code)).room;
  assert.deepEqual(room.players.map((p) => p.coins), [80, 120]);

  const players = ["A", "B", "C"].map((id) => ({ id, name: id, coins: 100, chores: [], avoidedCoins: 0 }));
  const { settleRound } = await import("../src/server/rules.js");
  const result = settleRound({ players, bids: { A: { kind: "bid", price: 5 }, B: { kind: "bid", price: 12 }, C: { kind: "bid", price: 20 } }, shareFairly: false, choreCount: 3, random: () => 0 });
  assert.equal(result.doerId, "A");
  assert.deepEqual(result.players.map((p) => p.coins), [110, 95, 95]);
});

test("two simultaneous NOT IT requests can only allow one escape", async () => {
  const f = fixture();
  const { a, b } = await twoPlayers(f, 2);
  const results = await Promise.all([act(f, a, "notIt"), act(f, b, "notIt")]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => /last one/.test(r.error || "")).length, 1);
  const room = (await f.game.read(a.roomCode)).room;
  assert.equal(Object.values(room.bids).filter((bid) => bid.kind === "notIt").length, 1);
});

test("a poll after the deadline ends the round once with timeout bids of 30", async () => {
  const f = fixture();
  const { a, b, code } = await twoPlayers(f, 2);
  const bidding = (await f.game.read(code)).room;
  f.advance(bidding.endsAt - f.now + 1);
  const first = await act(f, a, "poll", { version: 0 });
  assert.equal(first.state.phase, "REVEAL");
  assert.deepEqual(first.state.reveal.bids.map((bid) => bid.price), [30, 30]);
  const second = await act(f, a, "poll", { version: first.state.version });
  assert.equal(second.unchanged, true);
  assert.equal((await f.game.read(code)).room.phase, "REVEAL");
});

test("refresh with the same player ID and token rejoins without a duplicate", async () => {
  const f = fixture();
  const created = await f.game.handle({ action: "createRoom", nickname: "A" });
  const again = await f.game.handle({ action: "join", roomCode: created.roomCode, nickname: "A", playerId: created.playerId, token: created.token });
  assert.equal(again.playerId, created.playerId);
  assert.equal(again.token, created.token);
  assert.equal(again.state.players.length, 1);
});

test("GET health check and JSON responses disable caching", async () => {
  const handler = createHandler({ store: new MemoryStore() });
  const response = await handler(new Request("https://example.test/.netlify/functions/game"));
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("stale host handover waits 30 seconds and promotes the next connected player", async () => {
  const f = fixture();
  const { a, b, code } = await twoPlayers(f, 2);
  f.advance(29_999);
  let response = await act(f, b, "poll", { version: 0 });
  assert.equal(response.state.hostId, a.playerId);
  f.advance(30_001);
  response = await act(f, b, "poll", { version: 0 });
  assert.equal(response.state.hostId, b.playerId);
  assert.equal((await f.game.read(code)).room.hostId, b.playerId);
});
