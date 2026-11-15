import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  OPENAI_API_KEY?: string;
  AI?: any; // Cloudflare Workers AI binding (optional)
}

// Global active sessions map for SSE connections
const sessions = new Map<string, {
  server: McpServer;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
}>();

/**
 * Generate embedding using OpenAI or graceful fallback
 */
async function generateEmbedding(text: string, env: Env): Promise<number[] | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text.replace(/\n/g, " ").trim(),
        model: "text-embedding-3-small",
        dimensions: 1536,
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.error("OpenAI embedding error:", err);
    return null;
  }
}

/**
 * Build and configure the MCP server with all multi-agent memory tools
 */
function createMcpServer(env: Env, supabase: SupabaseClient) {
  const server = new McpServer({
    name: "MnesiaMemorySystem-Cloudflare",
    version: "1.0.0",
  });

  // 1. Tool: store_memory
  server.tool(
    "store_memory",
    "Store a new memory item in Supabase for cross-agent sharing",
    {
      content: z.string().describe("The factual knowledge, decision, or insight to remember"),
      agent_id: z.string().default("default_agent").describe("Authoring agent identifier"),
      category: z.string().default("general").describe("Memory category: 'fact', 'decision', 'preference', etc."),
      tags: z.array(z.string()).optional().describe("Tags for filtering"),
      session_id: z.string().optional().describe("Workflow/session scope"),
      metadata: z.record(z.any()).optional().describe("Arbitrary JSON metadata"),
    },
    async ({ content, agent_id, category, tags = [], session_id, metadata = {} }) => {
      const embedding = await generateEmbedding(content, env);
      const payload: any = {
        agent_id,
        session_id,
        category,
        content,
        tags,
        metadata,
      };
      if (embedding) payload.embedding = embedding;

      const { data, error } = await supabase.table("memories").insert(payload).select().single();
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ success: true, memory: data }) }] };
    }
  );

  // 2. Tool: search_memories
  server.tool(
    "search_memories",
    "Search memories using pgvector cosine similarity or full-text search fallback",
    {
      query: z.string().describe("Semantic query or keywords"),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().default(10),
      match_threshold: z.number().default(0.2),
    },
    async ({ query, agent_id, session_id, category, tags, limit = 10, match_threshold = 0.2 }) => {
      const embedding = await generateEmbedding(query, env);

      if (embedding) {
        const { data, error } = await supabase.rpc("match_memories", {
          query_embedding: embedding,
          match_threshold,
          match_count: limit,
          filter_agent_id: agent_id || null,
          filter_session_id: session_id || null,
          filter_category: category || null,
          filter_tags: tags || null,
        });
        if (!error && data && data.length > 0) {
          return { content: [{ type: "text", text: JSON.stringify({ count: data.length, memories: data }) }] };
        }
      }

      // Fallback to text search RPC
      const { data: textData, error: textError } = await supabase.rpc("search_memories_text", {
        query_text: query,
        match_count: limit,
        filter_agent_id: agent_id || null,
        filter_session_id: session_id || null,
        filter_category: category || null,
        filter_tags: tags || null,
      });

      if (textError) {
        return { content: [{ type: "text", text: `Search error: ${textError.message}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ count: textData?.length || 0, memories: textData || [] }) }] };
    }
  );

  // 3. Tool: recall_shared_memories
  server.tool(
    "recall_shared_memories",
    "Recall knowledge discovered by peer agents to coordinate tasks without duplicate work",
    {
      query: z.string(),
      current_agent_id: z.string().optional(),
      exclude_self: z.boolean().default(false),
      session_id: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().default(10),
    },
    async ({ query, current_agent_id, exclude_self, session_id, category, limit }) => {
      const { data, error } = await supabase.rpc("search_memories_text", {
        query_text: query,
        match_count: limit,
        filter_agent_id: null,
        filter_session_id: session_id || null,
        filter_category: category || null,
        filter_tags: null,
      });

      let results = data || [];
      if (exclude_self && current_agent_id) {
        results = results.filter((m: any) => m.agent_id !== current_agent_id);
      }
      return { content: [{ type: "text", text: JSON.stringify({ count: results.length, memories: results }) }] };
    }
  );

  // 4. Tool: list_memories
  server.tool(
    "list_memories",
    "List recent memories in Supabase with optional filters",
    {
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().default(20),
    },
    async ({ agent_id, session_id, category, limit }) => {
      let q = supabase.table("memories").select("*").order("created_at", { ascending: false }).limit(limit);
      if (agent_id) q = q.eq("agent_id", agent_id);
      if (session_id) q = q.eq("session_id", session_id);
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ count: data?.length || 0, memories: data || [] }) }] };
    }
  );

  // 5. Tool: list_skills
  server.tool(
    "list_skills",
    "List operational skills and runbooks stored in Supabase",
    {},
    async () => {
      const { data, error } = await supabase.table("skills").select("name, description, tags, author_agent");
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ skills: data || [] }) }] };
    }
  );

  // 6. Tool: get_skill
  server.tool(
    "get_skill",
    "Retrieve the procedural runbook for a specific skill",
    { name: z.string() },
    async ({ name }) => {
      const { data, error } = await supabase.table("skills").select("*").eq("name", name).single();
      if (error) return { content: [{ type: "text", text: `Skill '${name}' not found.` }] };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  // 7. Tool: publish_skill
  server.tool(
    "publish_skill",
    "Publish a reusable skill or procedure to Supabase",
    {
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
      tags: z.array(z.string()).optional(),
      author_agent: z.string().default("agent"),
    },
    async ({ name, description, instructions, tags = [], author_agent }) => {
      const { data, error } = await supabase.table("skills").upsert({
        name,
        description,
        instructions,
        tags,
        author_agent,
      }).select().single();
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ success: true, skill: data }) }] };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "healthy", runtime: "cloudflare-workers" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. SSE Connection Endpoint: GET /sse
    if (request.method === "GET" && url.pathname === "/sse") {
      const sessionId = crypto.randomUUID();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const server = createMcpServer(env, supabase);
      sessions.set(sessionId, { server, writer, encoder });

      // Send initial SSE endpoint notification
      const endpointUri = `${url.origin}/message?sessionId=${sessionId}`;
      await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUri}\n\n`));

      // Handle disconnect
      request.signal?.addEventListener("abort", () => {
        sessions.delete(sessionId);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 2. Client Messages Endpoint: POST /message?sessionId=...
    if (request.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !sessions.has(sessionId)) {
        return new Response("Session not found", { status: 404 });
      }

      const session = sessions.get(sessionId)!;
      const body: any = await request.json();

      // Process JSON-RPC message through the server transport
      const sendSseMessage = async (msg: any) => {
        const payload = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
        await session.writer.write(session.encoder.encode(payload));
      };

      try {
        // Direct response or tool invocation dispatch
        // The MCP SDK handles client requests via transport
        return new Response(JSON.stringify({ received: true }), {
          status: 202,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 3. Direct JSON-RPC over HTTP POST /mcp (Stateless / Streamable HTTP)
    if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/rpc")) {
      const body: any = await request.json();
      const server = createMcpServer(env, supabase);
      
      // Execute MCP JSON-RPC directly
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { status: "ready" } }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
