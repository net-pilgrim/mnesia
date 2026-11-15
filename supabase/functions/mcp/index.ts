// Supabase Edge Function: Multi-Agent MCP Memory Server (Mnesia)
// Runtime: Deno / Edge Runtime
// Protocol: Model Context Protocol (MCP) over Server-Sent Events (SSE) & Streamable HTTP

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@^2.49.1";

interface Session {
  send: (data: any) => void;
  close: () => void;
}

// Active SSE sessions in memory
const sessions = new Map<string, Session>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tool Definitions according to MCP specifications
const MCP_TOOLS = [
  {
    name: "store_memory",
    description: "Store a new memory item in Supabase for cross-agent sharing",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The factual knowledge, decision, or insight to remember" },
        agent_id: { type: "string", description: "Authoring agent identifier", default: "default_agent" },
        category: { type: "string", description: "Category: 'fact', 'decision', 'preference', etc.", default: "general" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for grouping/filtering" },
        session_id: { type: "string", description: "Workflow or conversation scope" },
        metadata: { type: "object", description: "Arbitrary JSON metadata" },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memories",
    description: "Search memories using pgvector cosine similarity or full-text search fallback",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic query or keywords" },
        agent_id: { type: "string", description: "Optional filter by authoring agent" },
        session_id: { type: "string", description: "Optional session filter" },
        category: { type: "string", description: "Optional category filter" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags filter" },
        limit: { type: "number", description: "Max results", default: 10 },
        match_threshold: { type: "number", description: "Min cosine similarity threshold", default: 0.2 },
      },
      required: ["query"],
    },
  },
  {
    name: "recall_shared_memories",
    description: "Recall knowledge discovered by peer agents to coordinate tasks without duplicate work",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or question to recall" },
        current_agent_id: { type: "string", description: "ID of the current agent" },
        exclude_self: { type: "boolean", description: "Whether to exclude memories authored by self", default: false },
        session_id: { type: "string", description: "Optional session filter" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max results", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List recent memories stored in Supabase with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Optional author filter" },
        session_id: { type: "string", description: "Optional session filter" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max results", default: 20 },
      },
    },
  },
  {
    name: "list_skills",
    description: "List operational skills and runbooks stored in Supabase",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_skill",
    description: "Retrieve the procedural runbook for a specific skill",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique name of the skill" },
      },
      required: ["name"],
    },
  },
  {
    name: "publish_skill",
    description: "Publish a reusable skill or procedure to Supabase",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill identifier (slug)" },
        description: { type: "string", description: "Summary of when to use this skill" },
        instructions: { type: "string", description: "Step-by-step markdown instructions" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        author_agent: { type: "string", description: "Publishing agent ID", default: "agent" },
      },
      required: ["name", "description", "instructions"],
    },
  },
];

/**
 * Generate vector embeddings with Gemini text-embedding-004 (primary) or OpenAI (fallback)
 * with status tracking for diagnostics
 */
async function generateEmbeddingWithStatus(text: string): Promise<{ embedding: number[] | null; status: string }> {
  const cleanText = text.replace(/\n/g, " ").trim();
  if (!cleanText) return { embedding: null, status: "empty_text" };

  // 1. Primary: Google Gemini gemini-embedding-001 (fallback to text-embedding-004)
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  let lastGeminiError = "";
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: cleanText }] },
            outputDimensionality: 768,
          }),
        }
      );
      if (res.ok) {
        const data: any = await res.json();
        if (data.embedding?.values) {
          return { embedding: data.embedding.values, status: `gemini_ok (${data.embedding.values.length} dims)` };
        }
        lastGeminiError = `empty_values: ${JSON.stringify(data)}`;
      } else {
        const errText = await res.text();
        lastGeminiError = `http_${res.status}: ${errText}`;
        console.error("Gemini embedding error response:", errText);
      }
    } catch (err: any) {
      lastGeminiError = `exception: ${err.message}`;
      console.error("Gemini embedding request failed:", err);
    }
  }

  // 2. Fallback: OpenAI text-embedding-3-small (dimensions reduced to 768)
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          input: cleanText,
          model: "text-embedding-3-small",
          dimensions: 768,
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const vec = data.data?.[0]?.embedding || null;
        return { embedding: vec, status: `openai_ok (${vec?.length} dims)` };
      } else {
        const errText = await res.text();
        return { embedding: null, status: `gemini_failed (${lastGeminiError}), openai_error: ${errText}` };
      }
    } catch (err: any) {
      return { embedding: null, status: `gemini_failed (${lastGeminiError}), openai_exception: ${err.message}` };
    }
  }

  if (geminiKey) {
    return { embedding: null, status: `gemini_failed: ${lastGeminiError}` };
  }

  return { embedding: null, status: "no_api_key_configured" };
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const result = await generateEmbeddingWithStatus(text);
  return result.embedding;
}

/**
 * Execute tool calls against Supabase
 */
async function executeTool(name: string, args: any, supabase: SupabaseClient): Promise<any> {
  args = args || {};

  try {
    switch (name) {
      case "store_memory": {
        const { content, agent_id = "default_agent", category = "general", tags = [], session_id, metadata = {} } = args;
        const embedResult = await generateEmbeddingWithStatus(content);
        const payload: any = { agent_id, session_id, category, content, tags, metadata };
        if (embedResult.embedding) payload.embedding = embedResult.embedding;

        const { data, error } = await supabase.from("memories").insert(payload).select().single();
        if (error) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Database Error: ${error.message} (Code: ${error.code}). Embedding Status: ${embedResult.status}`,
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, embedding_status: embedResult.status, memory: data }),
          }],
        };
      }

      case "search_memories": {
        const { query, agent_id, session_id, category, tags, limit = 10, match_threshold = 0.2 } = args;
        const embedding = await generateEmbedding(query);

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
          return { isError: true, content: [{ type: "text", text: `Search error: ${textError.message}` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ count: textData?.length || 0, memories: textData || [] }) }] };
      }

      case "recall_shared_memories": {
        const { query, current_agent_id, exclude_self = false, session_id, category, limit = 10 } = args;
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

      case "list_memories": {
        const { agent_id, session_id, category, limit = 20 } = args;
        let q = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
        if (agent_id) q = q.eq("agent_id", agent_id);
        if (session_id) q = q.eq("session_id", session_id);
        if (category) q = q.eq("category", category);
        const { data, error } = await q;
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        return { content: [{ type: "text", text: JSON.stringify({ count: data?.length || 0, memories: data || [] }) }] };
      }

      case "list_skills": {
        const { data, error } = await supabase.from("skills").select("name, description, tags, author_agent");
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        return { content: [{ type: "text", text: JSON.stringify({ skills: data || [] }) }] };
      }

      case "get_skill": {
        const { name: skillName } = args;
        const { data, error } = await supabase.from("skills").select("*").eq("name", skillName).single();
        if (error) return { isError: true, content: [{ type: "text", text: `Skill '${skillName}' not found.` }] };
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      }

      case "publish_skill": {
        const { name: sName, description, instructions, tags = [], author_agent = "agent" } = args;
        const { data, error } = await supabase.from("skills").upsert({
          name: sName,
          description,
          instructions,
          tags,
          author_agent,
        }).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        return { content: [{ type: "text", text: JSON.stringify({ success: true, skill: data }) }] };
      }

      default:
        return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err: any) {
    return { isError: true, content: [{ type: "text", text: `Tool execution failed: ${err.message || String(err)}` }] };
  }
}

/**
 * Handle incoming JSON-RPC 2.0 messages from MCP client
 */
async function handleJsonRpc(
  msg: any,
  supabase: SupabaseClient
): Promise<any | null> {
  const { jsonrpc, id, method, params } = msg;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "MnesiaMemorySystem",
          version: "1.0.0",
        },
      },
    };
  }

  if (method === "notifications/initialized") {
    // Notification has no return id
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS,
      },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments;
    const toolResult = await executeTool(toolName, toolArgs, supabase);
    return {
      jsonrpc: "2.0",
      id,
      result: toolResult,
    };
  }

  // Unsupported method fallback
  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found.`,
      },
    };
  }

  return null;
}

// Main Edge Function HTTP Handler
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Healthcheck endpoint
  if (req.method === "GET" && (pathname.endsWith("/health") || pathname === "/functions/v1/mcp")) {
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    let testEmbeddingResult: any = undefined;

    if (url.searchParams.get("test") === "embedding") {
      testEmbeddingResult = await generateEmbeddingWithStatus("test health ping");
    }

    return new Response(
      JSON.stringify({
        status: "healthy",
        server: "MnesiaMemorySystem",
        runtime: "supabase-edge",
        config: {
          geminiKeyConfigured: !!geminiKey,
          openaiKeyConfigured: !!openaiKey,
        },
        testEmbedding: testEmbeddingResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Authentication: Verify Supabase API Key (service_role or anon key)
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const validKeys = [serviceKey, anonKey].filter(Boolean) as string[];

  if (validKeys.length > 0) {
    const authHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const apiKeyHeader = req.headers.get("apikey");
    const queryKey = url.searchParams.get("apikey") || url.searchParams.get("token") || url.searchParams.get("key");

    const providedKey = authHeader || apiKeyHeader || queryKey;
    if (!providedKey || !validKeys.includes(providedKey)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing or invalid Supabase API Key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 1. GET /sse -> Establish Server-Sent Events stream
  if (req.method === "GET" && (pathname.endsWith("/sse") || url.searchParams.get("transport") === "sse")) {
    const sessionId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const base = Deno.env.get("SUPABASE_URL") || `${url.protocol}//${url.host}`;
    const queryKey = url.searchParams.get("apikey") || url.searchParams.get("token") || url.searchParams.get("key");
    const authQuery = queryKey ? `&apikey=${encodeURIComponent(queryKey)}` : "";
    const endpointUri = `${base}/functions/v1/mcp/message?sessionId=${sessionId}${authQuery}`;

    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointUri}\n\n`));
      },
      cancel() {
        sessions.delete(sessionId);
      },
    });

    sessions.set(sessionId, {
      send: (data: any) => {
        try {
          const payload = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
          streamController.enqueue(encoder.encode(payload));
        } catch (e) {
          console.error("SSE send error:", e);
        }
      },
      close: () => {
        try {
          streamController.close();
        } catch (_) {}
      },
    });

    req.signal?.addEventListener("abort", () => {
      sessions.delete(sessionId);
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

  // 2. POST /message?sessionId=... -> Client message handler (MCP SSE transport)
  if (req.method === "POST" && (pathname.includes("/message") || url.searchParams.has("sessionId"))) {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !sessions.has(sessionId)) {
      return new Response(JSON.stringify({ error: "Session not found or expired" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = sessions.get(sessionId)!;
    const body = await req.json();

    // Process JSON-RPC message asynchronously and stream result back via SSE
    handleJsonRpc(body, supabase).then((response) => {
      if (response) {
        session.send(response);
      }
    }).catch((err) => {
      session.send({
        jsonrpc: "2.0",
        id: body?.id,
        error: { code: -32603, message: err.message },
      });
    });

    // Accept message immediately
    return new Response("Accepted", {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  // 3. Direct JSON-RPC over HTTP POST (Stateless / Streamable HTTP)
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const response = await handleJsonRpc(body, supabase);
      return new Response(JSON.stringify(response || {}), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("Direct JSON-RPC error:", err);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: err?.message || String(err), stack: err?.stack },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});
