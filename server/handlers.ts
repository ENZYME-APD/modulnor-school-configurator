// Entry point bundled (with its dependencies) into server/dist/handlers.mjs by
// `npm run build:api`, so Vercel's Node runtime loads one self-contained ES module.
export { getResponse, handleMcpPost, optionsResponse } from "./mcp/server";
export {
  authorizationServerMetadata,
  jsonResponse,
  originOf,
  protectedResourceMetadata,
} from "./mcp/oauth";
