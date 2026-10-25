import type { Context } from "@netlify/functions";
import { handleGameRequest } from "../../src/server/handler.js";

export default async (req: Request, _context: Context): Promise<Response> => handleGameRequest(req);
