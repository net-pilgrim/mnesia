// Supabase Edge Function: Multi-Agent MCP Memory Server (Mnesia)
// Runtime: Deno / Edge Runtime
// Zero Containers, Zero Tunnels, $0/mo on Supabase Free Tier

import { McpServer } from "npm:@modelcontextprotocol/sdk@^1.6.0/server/mcp.js";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@^2.49.1";
import { z } from "npm:zod@^3.24.2";

// Active SSE sessions in memory
const sessions = new Map<string, {
  server: McpServer;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
}>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Generate vector embeddings with OpenAI or fallback
 */
async function generateEmbedding(text: string, apiKey?: string): Promise<number[] | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
    console.error("Embedding generation error:", err);
    return null;
  }
}

/**
 * Configure McpServer with all multi-agent memory and skill tools
 */
function createMcpServer(supabase: SupabaseClient, openaiApiKey?: string) {
  const server = new McpServer({
    name: "MnesiaMemorySystem-SupabaseEdge",
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
      const embedding = await generateEmbedding(content, openaiApiKey);
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
      const embedding = await generateEmbedding(query, openaiApiKey);

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
    "List recent memories stored in Supabase",
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

// Main Edge Function HTTP Handler
Deno.serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // Supabase automatically injects these into Edge Functions
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Healthcheck endpoint
  if (req.method === "GET" && (pathname.endsWith("/health") || pathname === "/")) {
    return new Response(
      JSON.stringify({ status: "healthy", server: "MnesiaMemorySystem", runtime: "supabase-edge" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 1. GET /sse -> Establish Server-Sent Events stream
  if (req.method === "GET" && (pathname.endsWith("/sse") || url.searchParams.get("transport") === "sse")) {
    const sessionId = crypto.randomUUID();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const server = createMcpServer(supabase, openaiApiKey);
    sessions.set(sessionId, { server, writer, encoder });

    // Send initial SSE endpoint URI
    const endpointUri = `${url.origin}${url.pathname.replace(/\/sse$/, "")}/message?sessionId=${sessionId}`;
    await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUri}\n\n`));

    // Handle client disconnect
    req.signal?.addEventListener("abort", () => {
      sessions.delete(sessionId);
      writer.close().catch(() => {});
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // 2. POST /message?sessionId=... -> Client message handler
  if (req.method === "POST" && (pathname.endsWith("/message") || url.searchParams.has("sessionId"))) {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !sessions.has(sessionId)) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Direct JSON-RPC over HTTP POST
  if (req.method === "POST") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: { status: "ready" } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});
