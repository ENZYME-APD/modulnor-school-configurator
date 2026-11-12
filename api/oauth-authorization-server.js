import { authorizationServerMetadata, optionsResponse } from "../server/dist/handlers.mjs";

// Some MCP clients look for the authorization server's metadata on the resource origin.
export const GET = () => authorizationServerMetadata();
export const OPTIONS = () => optionsResponse();
