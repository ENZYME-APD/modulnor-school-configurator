import { jsonResponse, optionsResponse, originOf, protectedResourceMetadata } from "../server/dist/handlers.mjs";

// RFC 9728: tells MCP clients which server to sign in with.
// Served at /.well-known/oauth-protected-resource[/api/mcp] via vercel.json rewrites.
export const GET = (req) =>
  jsonResponse(protectedResourceMetadata(originOf(req)), 200, { "Cache-Control": "public, max-age=3600" });
export const OPTIONS = () => optionsResponse();
