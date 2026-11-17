import { handleMcp, tokenOk } from "@/lib/mcp";

// Authenticatie via geheime URL: /api/mcp/<MCP_TOKEN>
// Nodig voor clients die geen eigen headers kunnen meesturen (zoals een custom connector in Claude).
async function handler(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenOk(token)) return new Response("Not found", { status: 404 });
  return handleMcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
