import { getStore } from "@netlify/blobs";
import { createGameService, GameError } from "./game-service.js";

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function createHandler({ store, clock, random, sleep, makeId, makeToken } = {}) {
  return async function handleRequest(request) {
    if (request.method === "GET") return Response.json({ ok: true }, { headers: HEADERS });
    if (request.method !== "POST") return Response.json({ ok: false, error: "Use POST" }, { status: 405, headers: { ...HEADERS, allow: "GET, POST" } });
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: HEADERS }); }
    try {
      const game = createGameService(store || getStore({ name: "rooms", consistency: "strong" }), { clock, random, sleep, makeId, makeToken });
      const result = await game.handle(body);
      const status = result.status || 200;
      delete result.status;
      return Response.json(result, { status, headers: HEADERS });
    } catch (error) {
      const status = error instanceof GameError ? error.status : 500;
      return Response.json({ ok: false, error: error.message || "Game request failed" }, { status, headers: HEADERS });
    }
  };
}

export const handleGameRequest = createHandler();
