import { handleMcp, tokenOk } from "@/lib/mcp";

// Authenticatie met header: Authorization: Bearer <MCP_TOKEN>
async function handler(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!tokenOk(token)) return new Response("Unauthorized", { status: 401 });
  return handleMcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
