export const STARTING_COINS = 100;
export const MAX_BID = 30;
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
export const RETURN_TTL_MS = 10 * 60 * 1000;
export const HOST_HANDOVER_MS = 30 * 1000;
export const ROUND_MS = 30 * 1000;
export const PRESENCE_WRITE_MS = 5 * 1000;
export const ONLINE_MS = 8 * 1000;
export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function canUseNotIt(players, bids, playerId) {
  const player = players.find((p) => p.id === playerId);
  if (!player || player.spectator || player.notItUsed || bids[playerId]) return false;
  const others = players.filter((p) => !p.spectator && p.id !== playerId);
  return others.length > 0 && !others.every((p) => bids[p.id]?.kind === "notIt");
}

function tiedWinner(group, choreCounts, random) {
  if (group.length < 2) return { player: group[0], reason: null };
  const leastChores = Math.min(...group.map((p) => choreCounts[p.id] || 0));
  const fairest = group.filter((p) => (choreCounts[p.id] || 0) === leastChores);
  if (fairest.length === 1) return { player: fairest[0], reason: "fewer chores so far" };
  const pick = Math.min(fairest.length - 1, Math.floor(random() * fairest.length));
  return { player: fairest[pick], reason: "random among tied players with the fewest chores" };
}

export function settleRound({ players, bids, shareFairly, choreCount, random = Math.random }) {
  const active = players.filter((p) => !p.spectator);
  const eligible = active.filter((p) => ["bid", "timeout"].includes(bids[p.id]?.kind));
  if (!eligible.length) throw new Error("At least one player must bid");
  const counts = Object.fromEntries(active.map((p) => [p.id, p.chores?.length || 0]));
  const ordered = [...eligible].sort((a, b) => bids[a.id].price - bids[b.id].price);
  const priceGroups = [];
  for (const p of ordered) {
    const price = bids[p.id].price;
    const last = priceGroups.at(-1);
    if (!last || last.price !== price) priceGroups.push({ price, players: [p] });
    else last.players.push(p);
  }

  const candidates = priceGroups.map((group) => ({
    price: group.price,
    ...tiedWinner(group.players, counts, random),
    group,
  }));
  const original = candidates[0];
  const cap = Math.ceil(choreCount / Math.max(1, active.length)) + 1;
  let selected = original;
  let shareMoved = false;
  if (shareFairly && counts[original.player.id] >= cap) {
    const alternative = candidates.find((candidate) => counts[candidate.player.id] < cap);
    if (alternative) { selected = alternative; shareMoved = true; }
  }

  const doer = selected.player;
  const price = bids[doer.id].price;
  const payments = Object.fromEntries(players.map((p) => {
    if (p.spectator || p.id === doer.id) return [p.id, 0];
    const amount = bids[p.id]?.kind === "notIt" ? price * 2 : price;
    return [p.id, amount];
  }));
  const updatedPlayers = players.map((p) => ({
    ...p,
    coins: p.coins - payments[p.id] + (p.id === doer.id ? Object.values(payments).reduce((sum, n) => sum + n, 0) : 0),
  }));
  const higher = eligible.map((p) => bids[p.id].price).filter((n) => n > price).sort((a, b) => a - b)[0];
  const sharpGap = higher === undefined ? null : higher - price;
  const reasons = [];
  if (selected.reason) reasons.push(selected.reason);
  if (shareMoved) reasons.push("Share fairly moved the chore to the next-lowest eligible bidder");
  const revealBids = active.map((p) => ({
    playerId: p.id,
    name: p.name,
    kind: bids[p.id]?.kind || "timeout",
    price: bids[p.id]?.kind === "notIt" ? null : (bids[p.id]?.price ?? MAX_BID),
  }));
  return {
    doerId: doer.id,
    doerName: doer.name,
    price,
    payments,
    players: updatedPlayers,
    bids: revealBids,
    tieBreak: reasons.join(". ") || null,
    shareMoved,
    sharpGap: sharpGap > 0 ? sharpGap : null,
  };
}

export function awardsFor(players) {
  const active = players.filter((p) => !p.spectator);
  const maxChores = Math.max(0, ...active.map((p) => p.chores.length));
  const maxPaid = Math.max(0, ...active.map((p) => p.avoidedCoins || 0));
  const choreHero = active.find((p) => p.chores.length === maxChores && maxChores > 0)?.name || "—";
  const royalty = active.find((p) => (p.avoidedCoins || 0) === maxPaid && maxPaid > 0)?.name || "—";
  const sharpest = active.flatMap((p) => p.chores.map((c) => ({ name: p.name, gap: c.sharpGap })))
    .filter((x) => x.gap > 0).sort((a, b) => a.gap - b.gap)[0];
  return { choreHero, royalty, sharpBidder: sharpest?.name || "—" };
}
