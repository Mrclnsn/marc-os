import { handleMcp, tokenRole } from "@/lib/mcp";

// Authenticatie via geheime URL: /api/mcp/<token>
// Nodig voor clients die geen eigen headers kunnen meesturen (zoals een custom connector in Claude).
// MCP_TOKEN = Marc (alles direct), HERMES_MCP_TOKEN = Hermes (schrijven via de akkoordwachtrij).
async function handler(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const role = tokenRole(token);
  if (!role) return new Response("Not found", { status: 404 });
  return handleMcp(req, role);
}

export { handler as GET, handler as POST, handler as DELETE };
