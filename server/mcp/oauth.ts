import { SUPABASE_URL } from "../../src/cloud/config";

// OAuth discovery for MCP clients. Supabase Auth (OAuth 2.1 server) is the
// authorization server; this app's /api/mcp is the protected resource (RFC 9728).

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

export const authServer = () => `${SUPABASE_URL}/auth/v1`;

export function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const resourceMetadataUrl = (req: Request) =>
  `${originOf(req)}/.well-known/oauth-protected-resource`;

export const protectedResourceMetadata = (origin: string) => ({
  resource: `${origin}/api/mcp`,
  authorization_servers: [authServer()],
  bearer_methods_supported: ["header"],
  scopes_supported: ["openid", "email", "profile"],
  resource_name: "Modulnor School Configurator",
  resource_documentation: `${origin}/`,
});

export const jsonResponse = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

export const optionsResponse = () =>
  new Response(null, { status: 204, headers: CORS });

/** Mirrors Supabase's RFC 8414 metadata for clients that look on the resource origin. */
export async function authorizationServerMetadata(): Promise<Response> {
  const base = new URL(authServer());
  const res = await fetch(
    `${base.origin}/.well-known/oauth-authorization-server${base.pathname}`,
  );
  if (!res.ok)
    return jsonResponse(
      {
        error:
          "The sign-in server isn't enabled yet (Supabase → Authentication → OAuth Server).",
      },
      503,
    );
  return jsonResponse(await res.json(), 200, {
    "Cache-Control": "public, max-age=3600",
  });
}
