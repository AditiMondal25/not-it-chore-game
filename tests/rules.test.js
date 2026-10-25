import test from "node:test";
import assert from "node:assert/strict";
import { awardsFor, canUseNotIt, settleRound } from "../src/server/rules.js";

const players = (...ids) => ids.map((id) => ({ id, name: id, coins: 100, chores: [], avoidedCoins: 0 }));

test("three-player worked example awards 110, 95 and 95 coins", () => {
  const result = settleRound({ players: players("A", "B", "C"), bids: { A: { kind: "bid", price: 5 }, B: { kind: "bid", price: 12 }, C: { kind: "bid", price: 20 } }, shareFairly: true, choreCount: 3 });
  assert.equal(result.doerId, "A");
  assert.deepEqual(result.players.map((p) => p.coins), [110, 95, 95]);
});

test("two-player NOT IT example pays the doer double and excludes the player", () => {
  const ps = players("A", "B");
  assert.equal(canUseNotIt(ps, {}, "A"), true);
  ps[0].notItUsed = true;
  assert.equal(canUseNotIt(ps, { A: { kind: "notIt" } }, "B"), false);
  const result = settleRound({ players: ps, bids: { A: { kind: "notIt" }, B: { kind: "bid", price: 10 } }, shareFairly: true, choreCount: 2 });
  assert.equal(result.doerId, "B");
  assert.deepEqual(result.players.map((p) => p.coins), [80, 120]);
});

test("a lowest bid tie goes to the tied player with fewer chores", () => {
  const ps = players("A", "B", "C");
  ps[0].chores = [{ id: "a" }, { id: "b" }];
  ps[1].chores = [{ id: "c" }];
  const result = settleRound({ players: ps, bids: { A: { kind: "bid", price: 7 }, B: { kind: "bid", price: 7 }, C: { kind: "bid", price: 16 } }, shareFairly: false, choreCount: 5, random: () => 0 });
  assert.equal(result.doerId, "B");
  assert.equal(result.tieBreak, "fewer chores so far");
});

test("Share fairly skips an at-cap lowest bidder and explains the move", () => {
  const ps = players("A", "B", "C");
  ps[0].chores = [{}, {}, {}];
  ps[1].chores = [{}];
  const result = settleRound({ players: ps, bids: { A: { kind: "bid", price: 2 }, B: { kind: "bid", price: 5 }, C: { kind: "bid", price: 18 } }, shareFairly: true, choreCount: 6 });
  assert.equal(result.doerId, "B");
  assert.equal(result.shareMoved, true);
  assert.match(result.tieBreak, /Share fairly moved/);
});

test("NOT IT players are never selected by Share fairly fallback", () => {
  const ps = players("A", "B", "C");
  ps[0].chores = [{}, {}, {}];
  ps[1].chores = [{}, {}, {}];
  ps[2].notItUsed = true;
  const result = settleRound({ players: ps, bids: { A: { kind: "bid", price: 2 }, B: { kind: "bid", price: 5 }, C: { kind: "notIt" } }, shareFairly: true, choreCount: 6 });
  assert.equal(result.doerId, "A");
  assert.equal(result.payments.C, 4);
});

test("Sharp Bidder ignores ties and uses the gap above the doer's price", () => {
  const result = settleRound({ players: players("A", "B", "C"), bids: { A: { kind: "bid", price: 5 }, B: { kind: "bid", price: 5 }, C: { kind: "bid", price: 12 } }, shareFairly: false, choreCount: 3, random: () => 0 });
  assert.equal(result.sharpGap, 7);
  const noGap = settleRound({ players: players("A", "B"), bids: { A: { kind: "bid", price: 5 }, B: { kind: "bid", price: 5 } }, shareFairly: false, choreCount: 2 });
  assert.equal(noGap.sharpGap, null);
});

test("awards choose the most chores, highest avoided spend and narrowest positive gap", () => {
  const ps = players("A", "B");
  ps[0].avoidedCoins = 23;
  ps[0].chores = [{ sharpGap: 7 }];
  ps[1].chores = [{ sharpGap: 5 }, { sharpGap: null }];
  const awards = awardsFor(ps);
  assert.deepEqual(awards, { choreHero: "B", royalty: "A", sharpBidder: "B" });
});
