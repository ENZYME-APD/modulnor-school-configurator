import { getResponse, handleMcpPost, optionsResponse } from "../server/dist/handlers.mjs";

// MCP endpoint (Streamable HTTP, stateless JSON). Sign-in is OAuth 2.1 via Supabase Auth.
// Source: server/mcp/*.ts, bundled at build time (npm run build:api).
export const config = { maxDuration: 60 };

export const POST = (req) => handleMcpPost(req);
export const GET = (req) => getResponse(req);
export const OPTIONS = () => optionsResponse();
