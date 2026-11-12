import { bearerFrom, resolveToken } from "./context";
import { CORS, optionsResponse, resourceMetadataUrl } from "./oauth";
import { TOOLS, ToolError } from "./tools";

// A small, stateless MCP server over Streamable HTTP: each POST carries JSON-RPC
// messages and gets a plain JSON reply. No sessions or server-sent events.

const SUPPORTED_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const SERVER_INFO = {
  name: "modulnor-configurator",
  title: "Modulnor School Configurator",
  version: "0.1.0",
};
const INSTRUCTIONS =
  "Modulnor School Configurator: modular school buildings laid out from prefabricated 6 × 2.44 × 3 m modules " +
  "(classroom strips, restrooms, corridors) stacked in storeys. Projects are shared by the team and open live in the web app. " +
  "Call get_overview first for the catalogue and coordinate conventions, then list_projects and get_project. " +
  "get_bom gives quantities, links, bill of materials and fee exactly as the app calculates them; check_layout finds overlaps and missing kits; " +
  "export_archicad_placement gives the data for placing the Archicad hotlinks with Tapir. " +
  "This connection can make changes. Before changing anything, tell the user exactly what you will change and wait for them to confirm. " +
  "Each change returns a change_id; undo_change reverts it. After editing, run check_layout and report any errors.";

type RpcId = string | number | null;
interface RpcMessage {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
const rpcError = (id: RpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export { optionsResponse };

export function getResponse(req: Request): Response {
  return new Response(
    JSON.stringify({
      name: "Modulnor School Configurator MCP server",
      usage:
        "Add this address as a custom connector in Claude (Settings → Connectors).",
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(req)}"`,
        ...CORS,
      },
    },
  );
}

export async function handleMcpPost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const auth = await resolveToken(bearerFrom(req));
  if (!auth.ok) {
    const id =
      !Array.isArray(body) && body && typeof body === "object"
        ? ((body as RpcMessage).id ?? null)
        : null;
    const res = json(rpcError(id, -32001, auth.message), auth.status);
    if (auth.status === 401)
      res.headers.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${resourceMetadataUrl(req)}"`,
      );
    return res;
  }
  const ctx = auth.ctx;

  const handle = async (msg: RpcMessage): Promise<unknown | null> => {
    const isRequest = msg && msg.id !== undefined && msg.id !== null;
    if (!msg || typeof msg.method !== "string")
      return isRequest
        ? rpcError(msg?.id ?? null, -32600, "Invalid request")
        : null;
    if (!isRequest) return null; // notifications need no reply
    const id = msg.id as RpcId;

    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion || "");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: SUPPORTED_VERSIONS.includes(asked)
              ? asked
              : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOLS.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: {
                title: t.title,
                readOnlyHint: !t.writes,
                destructiveHint: !!t.destructive,
                idempotentHint: !t.writes,
                openWorldHint: false,
              },
            })),
          },
        };
      case "tools/call": {
        const name = String(msg.params?.name || "");
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
        const args = (
          msg.params?.arguments && typeof msg.params.arguments === "object"
            ? msg.params.arguments
            : {}
        ) as Record<string, unknown>;
        try {
          const result = await tool.run(args, ctx);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              isError: false,
            },
          };
        } catch (e) {
          const known = e instanceof ToolError;
          const message = known
            ? (e as Error).message
            : "Something went wrong in the configurator. Check list_recent_changes before retrying a change.";
          if (!known) console.error("MCP tool error", name, e);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          };
        }
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      default:
        return rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  };

  if (Array.isArray(body)) {
    const replies = (
      await Promise.all(body.map((m) => handle(m as RpcMessage)))
    ).filter((r) => r !== null);
    return replies.length
      ? json(replies)
      : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handle(body as RpcMessage);
  return reply === null
    ? new Response(null, { status: 202, headers: CORS })
    : json(reply);
}
