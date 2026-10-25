import { awardsFor, canUseNotIt, CODE_CHARS, HOST_HANDOVER_MS, MAX_BID, ONLINE_MS, PRESENCE_WRITE_MS, RETURN_TTL_MS, ROOM_TTL_MS, ROUND_MS, STARTING_COINS, settleRound } from "./rules.js";
import { PACKS, packChores } from "./packs.js";

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomCode = (random) => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join("");
const clone = (x) => structuredClone(x);

function newPlayer(id, token, name, now, { host = false, spectator = false } = {}) {
  return { id, token, name, host, spectator, joinedAt: now, lastSeen: now, coins: STARTING_COINS, chores: [], notItUsed: false, avoidedCoins: 0, customChoresAdded: 0 };
}

function createRoomState(code, player, now) {
  return {
    roomCode: code, phase: "LOBBY", version: 1, createdAt: now, lastActivity: now,
    hostId: player.id, players: [player], chores: [], pack: "Home", packChosen: false,
    shareFairly: true, roundIndex: 0, bids: {}, endsAt: null, reveal: null,
    notItSequence: 0, notItEvents: [], awards: null,
  };
}

function defaultPackFor(room) {
  const count = room.players.filter((p) => !p.spectator).length;
  const pack = count === 2 ? "Couple / Roommates" : "Home";
  if (room.pack === pack && room.chores.length) return false;
  const custom = room.chores.filter((c) => c.customBy);
  room.pack = pack;
  room.chores = [...packChores(pack), ...custom].slice(0, 12);
  return true;
}

function connected(player, now) { return now - player.lastSeen <= ONLINE_MS; }

function resolveRound(room, now, random) {
  if (room.phase !== "BIDDING") return false;
  for (const p of room.players.filter((x) => !x.spectator)) {
    if (!room.bids[p.id]) room.bids[p.id] = { kind: "timeout", price: MAX_BID };
  }
  const result = settleRound({ players: room.players, bids: room.bids, shareFairly: room.shareFairly, choreCount: room.chores.length, random });
  room.players = result.players.map((p) => p.id === result.doerId
    ? { ...p, chores: [...p.chores, { ...room.chores[room.roundIndex], price: result.price, sharpGap: result.sharpGap }] }
    : { ...p, avoidedCoins: (p.avoidedCoins || 0) + result.payments[p.id] });
  room.phase = "REVEAL";
  room.revealStartedAt = now;
  room.endsAt = null;
  room.reveal = {
    doerId: result.doerId, doerName: result.doerName, price: result.price,
    payments: result.payments, bids: result.bids, tieBreak: result.tieBreak,
    shareMoved: result.shareMoved, tie: result.bids.filter((b) => b.kind !== "notIt" && b.price === result.price).length > 1,
    roundNumber: room.roundIndex + 1, chore: clone(room.chores[room.roundIndex]),
  };
  return true;
}

function maintain(room, now, random, requesterId = "") {
  let changed = false;
  if (room.phase === "LOBBY") {
    const retained = room.players.filter((p) => now - p.lastSeen <= RETURN_TTL_MS);
    if (retained.length !== room.players.length) { room.players = retained; changed = true; }
    if (!room.packChosen && defaultPackFor(room)) changed = true;
  }
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || now - host.lastSeen >= HOST_HANDOVER_MS) {
    const next = room.players.filter((p) => p.id !== host?.id && !p.spectator && (p.id === requesterId || connected(p, now))).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) { room.hostId = next.id; changed = true; }
  }
  if (room.phase === "BIDDING" && now >= room.endsAt) changed = resolveRound(room, now, random) || changed;
  return changed;
}

function publicState(room, playerId, now) {
  const me = room.players.find((p) => p.id === playerId);
  return {
    roomCode: room.roomCode, phase: room.phase, version: room.version,
    hostId: room.hostId, yourId: playerId, pack: room.pack, shareFairly: room.shareFairly,
    chores: room.chores.map(({ id, name, emoji }) => ({ id, name, emoji })),
    roundIndex: room.roundIndex, endsAt: room.endsAt, revealStartedAt: room.revealStartedAt || null,
    reveal: room.reveal ? clone(room.reveal) : null,
    awards: room.awards ? clone(room.awards) : null,
    yourBid: Boolean(me && room.bids[me.id]),
    notItEvents: room.notItEvents.slice(-12).map((e) => ({ sequence: e.sequence, playerId: e.playerId, player: e.player, at: e.at })),
    players: room.players.map((p) => ({
      id: p.id, playerId: p.id, name: p.name, host: p.id === room.hostId,
      spectator: Boolean(p.spectator), connected: connected(p, now),
      locked: Boolean(room.bids[p.id]), notItUsed: Boolean(p.notItUsed), notItThisRound: room.bids[p.id]?.kind === "notIt", coins: p.coins,
      chores: clone(p.chores),
    })),
  };
}

export function createGameService(store, {
  clock = Date.now,
  random = Math.random,
  sleep = sleepDefault,
  makeId = () => crypto.randomUUID(),
  makeToken = () => crypto.randomUUID() + crypto.randomUUID(),
} = {}) {
  async function read(code) {
    const result = await store.getWithMetadata(code, { consistency: "strong", type: "json" });
    if (!result?.data) return null;
    return { room: result.data, etag: result.etag };
  }

  async function transact(code, callback, { create = false } = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let current = create ? null : await read(code);
      if (!create && !current) throw new GameError("Room not found", 404);
      const now = clock();
      if (current && now - current.room.lastActivity >= ROOM_TTL_MS) {
        const expired = { ...current.room, expired: true, version: current.room.version + 1 };
        const tombstone = await store.setJSON(code, expired, { onlyIfMatch: current.etag });
        if (tombstone.modified) {
          await store.delete(code);
          throw new GameError("Room expired", 404);
        }
        await sleep(4 + Math.floor(random() * 20));
        continue;
      }
      const room = current?.room ? clone(current.room) : null;
      const result = await callback(room, now);
      if (!result.changed) return { room, result, now, etag: current?.etag };
      if (room) { room.version += 1; }
      const write = room
        ? await store.setJSON(code, room, { onlyIfMatch: current.etag })
        : await store.setJSON(code, result.room, { onlyIfNew: true });
      if (write.modified) return { room: room || result.room, result, now, etag: write.etag };
      if (create) return null;
      await sleep(4 + Math.floor(random() * 20));
    }
    throw new GameError("Room changed while you were acting. Please try again.", 409);
  }

  async function createRoom(name) {
    const nickname = cleanName(name);
    await cleanupExpiredRooms();
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomCode(random);
      const now = clock();
      const playerId = makeId();
      const token = makeToken();
      const player = newPlayer(playerId, token, nickname, now, { host: true });
      const room = createRoomState(code, player, now);
      const result = await transact(code, () => ({ changed: true, room, value: null }), { create: true });
      if (!result) continue;
      return { room, playerId, token, now };
    }
    throw new GameError("Could not find an available room code. Try again.", 503);
  }

  function authorize(room, body) {
    const player = room.players.find((p) => p.id === body.playerId);
    if (!player || typeof body.token !== "string" || !safeEqual(player.token, body.token)) throw new GameError("Your player session is invalid. Join the room again.", 401);
    return player;
  }

  async function dispatch(body) {
    const action = String(body.action || "");
    if (action === "createRoom") {
      const { room, playerId, token, now } = await createRoom(body.nickname);
      return { ok: true, roomCode: room.roomCode, playerId, token, version: room.version, serverNow: now, state: publicState(room, playerId, now) };
    }
    const code = String(body.roomCode || "").trim().toUpperCase();
    if (!/^[A-HJ-KMNP-Z]{4}$/.test(code)) throw new GameError("Enter a valid 4-letter room code");
    if (action === "join") return join(code, body);
    if (action === "poll") return poll(code, body);

    let actionError = null;
    const result = await transact(code, async (room, now) => {
      actionError = null;
      let changed = false;
      let player;
      try {
        const authorized = authorize(room, body);
        changed = maintain(room, now, random, authorized.id);
        player = room.players.find((p) => p.id === authorized.id);
        if (!player) throw new GameError("Your return window has expired. Join the room again.", 401);
        player.lastSeen = now;
        room.lastActivity = now;
        changed = true;
        applyAction(room, player, action, body, now);
      } catch (error) { actionError = error; }
      return { changed, value: null };
    });
    const room = result.room;
    const player = room.players.find((p) => p.id === body.playerId);
    if (actionError) return { ok: false, error: actionError.message, status: actionError.status || 400, version: room.version, serverNow: result.now, state: player ? publicState(room, player.id, result.now) : undefined };
    if (action === "poll" && Number(body.version) === room.version) return { ok: true, unchanged: true, version: room.version, serverNow: result.now };
    return { ok: true, version: room.version, serverNow: result.now, state: publicState(room, player.id, result.now) };
  }

  async function poll(code, body) {
    let actionError;
    const result = await transact(code, async (room, now) => {
      actionError = null;
      let changed = false;
      try {
        const authorized = authorize(room, body);
        changed = maintain(room, now, random, authorized.id);
        if (!room.players.some((p) => p.id === authorized.id)) throw new GameError("Your return window has expired. Join the room again.", 401);
      }
      catch (error) { actionError = error; }
      return { changed, value: null };
    });
    let room = result.room;
    if (actionError) return { ok: false, error: actionError.message, status: actionError.status || 400, version: room.version, serverNow: result.now };
    let etag = result.etag;
    const player = room.players.find((p) => p.id === body.playerId);
    if (result.now - player.lastSeen >= PRESENCE_WRITE_MS) {
      const next = clone(room);
      next.players.find((p) => p.id === player.id).lastSeen = result.now;
      next.lastActivity = result.now;
      next.version += 1;
      try {
        const write = await store.setJSON(code, next, { onlyIfMatch: etag });
        if (write.modified) { room = next; etag = write.etag; }
        else {
          const latest = await read(code);
          if (latest) { room = latest.room; etag = latest.etag; }
        }
      } catch { /* Presence is best-effort and intentionally does not retry. */ }
    }
    if (Number(body.version) === room.version) return { ok: true, unchanged: true, version: room.version, serverNow: result.now };
    return { ok: true, version: room.version, serverNow: result.now, state: publicState(room, player.id, result.now) };
  }

  async function join(code, body) {
    const nickname = cleanName(body.nickname);
    const requestedId = typeof body.playerId === "string" ? body.playerId : "";
    const requestedToken = typeof body.token === "string" ? body.token : "";
    let credentials;
    let actionError;
    const result = await transact(code, async (room, now) => {
      actionError = null;
      let changed = maintain(room, now, random);
      try {
        let player = requestedId ? room.players.find((p) => p.id === requestedId) : null;
        if (player) {
          if (!safeEqual(player.token, requestedToken)) throw new GameError("Your player session is invalid. Join with a new nickname.", 401);
          if (now - player.lastSeen > RETURN_TTL_MS) {
            if (room.phase !== "LOBBY") throw new GameError("Your return window has expired. You can rejoin after this game.", 401);
            room.players = room.players.filter((p) => p.id !== player.id);
            player = null;
            changed = true;
          }
        }
        if (!player) {
          if (room.players.length >= 8) throw new GameError("Room full", 409);
          if (room.players.some((p) => p.name.toLowerCase() === nickname.toLowerCase())) throw new GameError("Nickname taken", 409);
          const spectator = room.phase !== "LOBBY";
          const playerId = makeId();
          const token = makeToken();
          player = newPlayer(playerId, token, nickname, now, { spectator });
          if (!room.hostId && !spectator) room.hostId = playerId;
          room.players.push(player);
          credentials = { playerId, token };
          changed = true;
        } else {
          const owner = room.players.find((p) => p.id !== player.id && p.name.toLowerCase() === nickname.toLowerCase());
          if (owner) throw new GameError("Nickname taken", 409);
          player.name = nickname;
          player.lastSeen = now;
          changed = true;
          credentials = { playerId: player.id, token: player.token };
        }
        if (!room.packChosen) defaultPackFor(room);
        room.lastActivity = now;
      } catch (error) { actionError = error; }
      return { changed, value: null };
    });
    const playerId = credentials?.playerId || requestedId;
    const output = { ok: !actionError, version: result.room.version, serverNow: result.now, state: playerId && result.room.players.some((p) => p.id === playerId) ? publicState(result.room, playerId, result.now) : undefined };
    if (actionError) { output.error = actionError.message; output.status = actionError.status || 400; }
    if (credentials) Object.assign(output, credentials);
    return output;
  }

  function applyAction(room, player, action, body, now) {
    const requireHost = () => { if (room.hostId !== player.id) throw new GameError("Only the host can do that", 403); };
    const requireLobby = () => { if (room.phase !== "LOBBY") throw new GameError("The lobby is closed", 409); };
    switch (action) {
      case "addChore": {
        requireLobby();
        if (player.spectator) throw new GameError("Spectators cannot add chores", 403);
        if (player.customChoresAdded >= 3) throw new GameError("You can add up to 3 custom chores");
        if (room.chores.length >= 12) throw new GameError("A room can have at most 12 chores");
        const name = String(body.name || "").trim().slice(0, 40);
        const emoji = Array.from(String(body.emoji || "🧹")).slice(0, 2).join("");
        if (!name) throw new GameError("Enter a chore name");
        room.chores.push({ id: makeId(), name, emoji, customBy: player.id });
        player.customChoresAdded += 1;
        return;
      }
      case "removeChore":
        requireHost(); requireLobby();
        if (!room.chores.some((c) => c.id === body.choreId)) throw new GameError("Chore not found", 404);
        room.chores = room.chores.filter((c) => c.id !== body.choreId);
        return;
      case "selectPack": {
        requireHost(); requireLobby();
        if (!Object.hasOwn(PACKS, body.pack)) throw new GameError("Choose a listed chore pack");
        const customs = room.chores.filter((c) => c.customBy);
        room.pack = body.pack;
        room.chores = [...packChores(room.pack, makeId), ...customs].slice(0, 12);
        room.packChosen = true;
        return;
      }
      case "setShareFairly": requireHost(); requireLobby(); room.shareFairly = Boolean(body.on); return;
      case "start": {
        requireHost(); requireLobby();
        if (room.players.filter((p) => !p.spectator).length < 2) throw new GameError("Need at least 2 players");
        if (room.chores.length < 2 || room.chores.length > 12) throw new GameError("Choose 2–12 chores");
        for (const p of room.players) { p.chores = []; p.notItUsed = false; p.avoidedCoins = 0; }
        room.roundIndex = 0;
        beginRound(room, now);
        return;
      }
      case "lockBid": {
        requireBidding(room, player);
        const price = body.price;
        if (!Number.isInteger(price) || price < 0 || price > MAX_BID) throw new GameError("Bid a whole number from 0 to 30");
        if (room.bids[player.id]) throw new GameError("You already locked in");
        room.bids[player.id] = { kind: "bid", price };
        if (everyoneDone(room)) resolveRound(room, now, random);
        return;
      }
      case "notIt": {
        requireBidding(room, player);
        if (!canUseNotIt(room.players, room.bids, player.id)) throw new GameError("You're the last one, so someone has to do it!");
        room.bids[player.id] = { kind: "notIt" };
        player.notItUsed = true;
        room.notItSequence += 1;
        room.notItEvents.push({ sequence: room.notItSequence, playerId: player.id, player: player.name, at: now });
        room.notItEvents = room.notItEvents.slice(-20);
        if (everyoneDone(room)) resolveRound(room, now, random);
        return;
      }
      case "next": {
        requireHost();
        if (room.phase !== "REVEAL") throw new GameError("The round is not ready to advance", 409);
        if (room.roundIndex + 1 >= room.chores.length) {
          room.phase = "FINAL";
          room.awards = awardsFor(room.players);
        } else {
          room.roundIndex += 1;
          beginRound(room, now);
        }
        return;
      }
      case "playAgain": {
        requireHost();
        if (room.phase !== "FINAL") throw new GameError("The game is not finished", 409);
        room.players = room.players.filter((p) => now - p.lastSeen <= RETURN_TTL_MS);
        for (const p of room.players) {
          p.coins = STARTING_COINS; p.chores = []; p.notItUsed = false; p.avoidedCoins = 0;
          p.spectator = false;
        }
        room.phase = "LOBBY"; room.roundIndex = 0; room.bids = {}; room.reveal = null; room.endsAt = null; room.awards = null;
        if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id;
        if (!room.packChosen) defaultPackFor(room);
        return;
      }
      default: throw new GameError("Unknown action");
    }
  }

  async function cleanupExpiredRooms() {
    if (typeof store.list !== "function") return;
    const result = await store.list();
    for (const blob of result.blobs || []) {
      try {
        await transact(blob.key, () => ({ changed: false }), {});
      } catch (error) {
        if (!(error instanceof GameError) || error.status !== 404) throw error;
      }
    }
  }

  async function handle(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameError("Invalid request");
    return dispatch(body);
  }

  return { handle, read, transact, publicState };
}

function beginRound(room, now) { room.phase = "BIDDING"; room.bids = {}; room.reveal = null; room.endsAt = now + ROUND_MS; delete room.revealStartedAt; }
function everyoneDone(room) { return room.players.filter((p) => !p.spectator).every((p) => Boolean(room.bids[p.id])); }
function requireBidding(room, player) {
  if (room.phase !== "BIDDING") throw new GameError("Bidding is not open", 409);
  if (player.spectator) throw new GameError("Spectators cannot bid", 403);
}
function cleanName(value) {
  const name = String(value || "").trim().slice(0, 12);
  if (!name) throw new GameError("Enter a nickname");
  return name;
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.name = "GameError"; this.status = status; }
}
