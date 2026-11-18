import { handleMcp, tokenRole } from "@/lib/mcp";

// Authenticatie met header: Authorization: Bearer <token>
// MCP_TOKEN = Marc (alles direct), HERMES_MCP_TOKEN = Hermes (schrijven via de akkoordwachtrij).
async function handler(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const role = tokenRole(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!role) return new Response("Unauthorized", { status: 401 });
  return handleMcp(req, role);
}

export { handler as GET, handler as POST, handler as DELETE };
