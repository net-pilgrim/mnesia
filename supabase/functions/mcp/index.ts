// Supabase Edge Function: Multi-Agent MCP Memory Server (Mnesia)
// Runtime: Deno / Edge Runtime
// Protocol: Model Context Protocol (MCP) over Server-Sent Events (SSE) & Streamable HTTP
// Features: Dual Vector/Text Retrieval + Knowledge Graph Grounding & Multi-Hop Traversal

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
    description: "Store a new memory item in Supabase with optional Knowledge Graph entities and relations",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The factual knowledge, decision, or insight to remember" },
        agent_id: { type: "string", description: "Authoring agent identifier", default: "default_agent" },
        category: { type: "string", description: "Category: 'fact', 'decision', 'preference', etc.", default: "general" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for grouping/filtering" },
        session_id: { type: "string", description: "Workflow or conversation scope" },
        metadata: { type: "object", description: "Arbitrary JSON metadata" },
        entities: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", default: "concept" },
                  aliases: { type: "array", items: { type: "string" } },
                },
                required: ["name"],
              },
            ],
          },
          description: "Optional entities mentioned in or grounded by this memory",
        },
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              src: { type: "string", description: "Source entity name" },
              dst: { type: "string", description: "Destination entity name" },
              predicate: { type: "string", description: "Relation predicate (depends_on, implements, uses, etc.)" },
              invalidate_previous: { type: "boolean", description: "Set valid_to on existing active edges between src and dst with this predicate" },
            },
            required: ["src", "dst", "predicate"],
          },
          description: "Optional directed relations between entities grounded in this memory",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memories",
    description: "Search memories using pgvector cosine similarity, full-text fallback, and optional graph expansion",
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
        expand_graph: { type: "boolean", description: "Expand search via Knowledge Graph 1-hop relations", default: false },
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
    name: "get_entity",
    description: "Retrieve a knowledge graph entity, its active relations, and grounded memories",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Entity name to look up" },
        entity_id: { type: "string", description: "Entity UUID if known" },
        active_only: { type: "boolean", description: "Filter out superseded/invalidated relations", default: true },
      },
    },
  },
  {
    name: "search_graph",
    description: "Search the knowledge graph around matching entities and traverse relations up to N hops",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Entity name, keyword, or concept to search" },
        max_depth: { type: "number", description: "Traversal depth in hops (1 or 2)", default: 1 },
        active_only: { type: "boolean", description: "Filter out superseded/invalidated relations", default: true },
      },
      required: ["query"],
    },
  },
  {
    name: "link_entities",
    description: "Create or update a directed relation between two entities in the knowledge graph",
    inputSchema: {
      type: "object",
      properties: {
        src: { type: "string", description: "Source entity name or UUID" },
        dst: { type: "string", description: "Destination entity name or UUID" },
        predicate: { type: "string", description: "Relationship predicate (e.g., 'depends_on', 'implements', 'uses', 'replaces', 'relates_to')" },
        src_type: { type: "string", description: "Optional entity type for src if created", default: "concept" },
        dst_type: { type: "string", description: "Optional entity type for dst if created", default: "concept" },
        memory_id: { type: "string", description: "Optional memory UUID that evidenced this relation" },
        invalidate_previous: { type: "boolean", description: "Set valid_to on existing relations between src and dst with the same predicate", default: false },
        metadata: { type: "object", description: "Arbitrary JSON metadata for the relation" },
      },
      required: ["src", "dst", "predicate"],
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
 * SHA-256 Hash helper for content deduplication & quota saving
 */
async function sha256Hex(text: string): Promise<string> {
  const clean = text.replace(/\s+/g, " ").trim();
  const msgBuffer = new TextEncoder().encode(clean);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate vector embeddings with Gemini gemini-embedding-001 (primary) or OpenAI (fallback)
 * with status tracking for diagnostics
 */
async function generateEmbeddingWithStatus(text: string): Promise<{ embedding: number[] | null; status: string }> {
  const cleanText = text.replace(/\n/g, " ").trim();
  if (!cleanText) return { embedding: null, status: "empty_text" };

  // 1. Primary: Google Gemini gemini-embedding-001
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
        // Special marker for quota exceeded (429) to permit graceful non-fatal degradation
        if (res.status === 429) {
          return { embedding: null, status: "gemini_429_quota_exceeded" };
        }
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
 * Knowledge Graph Helper: Resolve or Create an Entity
 */
interface EntityInput {
  name: string;
  type?: string;
  aliases?: string[];
  metadata?: Record<string, any>;
}

async function resolveOrCreateEntity(
  supabase: SupabaseClient,
  entityInput: string | EntityInput,
  explicitType?: string
): Promise<{ id: string; name: string; type: string } | null> {
  const name = typeof entityInput === "string" ? entityInput.trim() : entityInput.name?.trim();
  const type = typeof entityInput === "object" && entityInput.type ? entityInput.type.trim() : (explicitType || "concept");
  const hasExplicitType = Boolean(typeof entityInput === "object" ? entityInput.type : explicitType);
  const aliases = typeof entityInput === "object" && Array.isArray(entityInput.aliases) ? entityInput.aliases : [];
  const metadata = typeof entityInput === "object" && entityInput.metadata ? entityInput.metadata : {};

  if (!name) return null;

  // 1. Try PostgreSQL RPC resolve_or_create_entity if present
  try {
    const { data: rpcId, error: rpcErr } = await supabase.rpc("resolve_or_create_entity", {
      entity_name: name,
      entity_type: type,
      entity_aliases: aliases,
    });
    if (!rpcErr && rpcId) {
      return { id: rpcId, name, type };
    }
  } catch (_) {
    // Fall back to direct table access
  }

  // 2. Direct lookup: try matching by name and type if explicit type given
  let existing: any = null;
  if (hasExplicitType) {
    const { data: typedMatch } = await supabase
      .from("entities")
      .select("id, name, type, aliases")
      .ilike("name", name)
      .eq("type", type)
      .limit(1);
    if (typedMatch && typedMatch.length > 0) existing = typedMatch[0];
  }

  // If not found or no explicit type, match by name across any type to reuse existing entities
  if (!existing) {
    const { data: nameMatch } = await supabase
      .from("entities")
      .select("id, name, type, aliases")
      .ilike("name", name)
      .limit(1);
    if (nameMatch && nameMatch.length > 0) existing = nameMatch[0];
  }

  if (existing) {
    if (aliases.length > 0) {
      const merged = Array.from(new Set([...(existing.aliases || []), ...aliases]));
      if (merged.length > (existing.aliases || []).length) {
        await supabase.from("entities").update({ aliases: merged }).eq("id", existing.id);
      }
    }
    return { id: existing.id, name: existing.name, type: existing.type };
  }

  // 3. Check if name exists in any entity's aliases array
  const { data: aliasMatches } = await supabase
    .from("entities")
    .select("id, name, type, aliases")
    .contains("aliases", [name])
    .limit(1);

  if (aliasMatches && aliasMatches.length > 0) {
    const aliasMatch = aliasMatches[0];
    return { id: aliasMatch.id, name: aliasMatch.name, type: aliasMatch.type };
  }

  // 4. Insert new entity
  const { data: inserted, error: insertErr } = await supabase
    .from("entities")
    .insert({
      name,
      type,
      aliases,
      metadata,
    })
    .select("id, name, type")
    .single();

  if (insertErr || !inserted) {
    console.error("Entity insertion failed:", insertErr);
    return null;
  }

  return { id: inserted.id, name: inserted.name, type: inserted.type };
}

/**
 * Knowledge Graph Helper: Link Two Entities
 */
interface RelationInput {
  src: string;
  dst: string;
  predicate: string;
  src_type?: string;
  dst_type?: string;
  invalidate_previous?: boolean;
  metadata?: Record<string, any>;
}

async function linkEntitiesHelper(
  supabase: SupabaseClient,
  rel: RelationInput,
  memoryId?: string
): Promise<any> {
  const srcEntity = await resolveOrCreateEntity(supabase, rel.src, rel.src_type);
  const dstEntity = await resolveOrCreateEntity(supabase, rel.dst, rel.dst_type);

  if (!srcEntity || !dstEntity) {
    throw new Error(`Failed to resolve entities for relation: '${rel.src}' -> '${rel.dst}'`);
  }

  const predicate = rel.predicate.trim().toLowerCase();

  // If invalidate_previous is true, set valid_to on active matching edges
  if (rel.invalidate_previous) {
    const nowIso = new Date().toISOString();
    await supabase
      .from("relations")
      .update({ valid_to: nowIso })
      .eq("src", srcEntity.id)
      .eq("dst", dstEntity.id)
      .eq("predicate", predicate)
      .is("valid_to", null);
  }

  const payload: any = {
    src: srcEntity.id,
    dst: dstEntity.id,
    predicate,
    memory_id: memoryId || null,
    metadata: rel.metadata || {},
  };

  const { data, error } = await supabase.from("relations").insert(payload).select().single();
  if (error) throw error;

  return {
    ...data,
    src_name: srcEntity.name,
    dst_name: dstEntity.name,
  };
}

/**
 * Execute tool calls against Supabase
 */
async function executeTool(name: string, args: any, supabase: SupabaseClient): Promise<any> {
  args = args || {};

  try {
    switch (name) {
      case "store_memory": {
        const {
          content,
          agent_id = "default_agent",
          category = "general",
          tags = [],
          session_id,
          metadata = {},
          entities = [],
          relations = [],
        } = args;

        // Quota Optimization: Check for existing embedding via SHA-256 content_hash
        const contentHash = await sha256Hex(content);
        let embeddingVector: number[] | null = null;
        let embeddingStatus = "not_generated";

        try {
          const { data: cached } = await supabase
            .from("memories")
            .select("embedding")
            .eq("content_hash", contentHash)
            .not("embedding", "is", null)
            .limit(1)
            .maybeSingle();

          if (cached?.embedding) {
            embeddingVector = cached.embedding;
            embeddingStatus = "reused_from_content_hash_cache";
          }
        } catch (_) {
          // Table column might not have content_hash yet
        }

        // If not cached, generate new embedding
        if (!embeddingVector) {
          const embedResult = await generateEmbeddingWithStatus(content);
          embeddingVector = embedResult.embedding;
          embeddingStatus = embedResult.status;
        }

        const payload: any = {
          agent_id,
          session_id,
          category,
          content,
          tags,
          metadata,
          content_hash: contentHash,
        };
        if (embeddingVector) payload.embedding = embeddingVector;

        const { data: memData, error: memErr } = await supabase
          .from("memories")
          .insert(payload)
          .select()
          .single();

        if (memErr) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Database Error: ${memErr.message} (Code: ${memErr.code}). Embedding Status: ${embeddingStatus}`,
            }],
          };
        }

        // Knowledge Graph Entity Grounding
        const groundedEntities: any[] = [];
        if (Array.isArray(entities) && entities.length > 0) {
          for (const ent of entities) {
            try {
              const resolved = await resolveOrCreateEntity(supabase, ent);
              if (resolved) {
                groundedEntities.push(resolved);
                await supabase
                  .from("memory_entities")
                  .insert({ memory_id: memData.id, entity_id: resolved.id })
                  .maybeSingle();
              }
            } catch (entErr) {
              console.error("Entity grounding error:", entErr);
            }
          }
        }

        // Knowledge Graph Relations Grounding
        const groundedRelations: any[] = [];
        if (Array.isArray(relations) && relations.length > 0) {
          for (const rel of relations) {
            try {
              if (rel.src && rel.dst && rel.predicate) {
                const linked = await linkEntitiesHelper(supabase, rel, memData.id);
                groundedRelations.push(linked);
              }
            } catch (relErr) {
              console.error("Relation grounding error:", relErr);
            }
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              embedding_status: embeddingStatus,
              memory: memData,
              grounded_entities: groundedEntities,
              grounded_relations: groundedRelations,
            }, null, 2),
          }],
        };
      }

      case "search_memories": {
        const {
          query,
          agent_id,
          session_id,
          category,
          tags,
          limit = 10,
          match_threshold = 0.2,
          expand_graph = false,
        } = args;

        let memories: any[] = [];
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
            memories = data;
          }
        }

        // Fallback to text search RPC if vector search yielded no hits
        if (memories.length === 0) {
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
          memories = textData || [];
        }

        // Optional 1-Hop Knowledge Graph Expansion
        let graphExpansion: any[] = [];
        if (expand_graph && memories.length > 0) {
          try {
            const memoryIds = memories.map((m: any) => m.id);
            const { data: memEnts } = await supabase
              .from("memory_entities")
              .select("entity_id")
              .in("memory_id", memoryIds);

            if (memEnts && memEnts.length > 0) {
              const entityIds = Array.from(new Set(memEnts.map((me: any) => me.entity_id)));
              const { data: relatedEdges } = await supabase
                .from("relations")
                .select("id, src, dst, predicate, memory_id")
                .or(`src.in.(${entityIds.join(",")}),dst.in.(${entityIds.join(",")})`)
                .is("valid_to", null)
                .limit(15);

              if (relatedEdges && relatedEdges.length > 0) {
                const neighborEntityIds = Array.from(
                  new Set(
                    relatedEdges.flatMap((r: any) => [r.src, r.dst]).filter((id: string) => !entityIds.includes(id))
                  )
                );

                if (neighborEntityIds.length > 0) {
                  const { data: expMemLinks } = await supabase
                    .from("memory_entities")
                    .select("memory:memory_id(id, category, content, agent_id, session_id, created_at)")
                    .in("entity_id", neighborEntityIds)
                    .limit(5);

                  const extraMemories = (expMemLinks || [])
                    .map((em: any) => em.memory)
                    .filter((m: any) => m && !memoryIds.includes(m.id));

                  graphExpansion = extraMemories;
                }
              }
            }
          } catch (graphErr) {
            console.error("Graph expansion error:", graphErr);
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: memories.length,
              memories,
              graph_expansion_count: graphExpansion.length,
              graph_expanded_memories: graphExpansion,
            }, null, 2),
          }],
        };
      }

      case "get_entity": {
        const { name: entityName, entity_id: entityId, active_only = true, type: entityType } = args;
        if (!entityName && !entityId) {
          return { isError: true, content: [{ type: "text", text: "Must provide either 'name' or 'entity_id'" }] };
        }

        let query = supabase.from("entities").select("*");
        if (entityId) {
          query = query.eq("id", entityId);
        } else {
          query = query.ilike("name", entityName.trim());
          if (entityType) query = query.eq("type", entityType.trim());
        }

        const { data: entityRows, error: entityErr } = await query.limit(1);
        const entity = entityRows && entityRows.length > 0 ? entityRows[0] : null;
        if (entityErr || !entity) {
          return { isError: true, content: [{ type: "text", text: `Entity '${entityName || entityId}' not found.` }] };
        }

        // Outgoing relations
        let outQuery = supabase
          .from("relations")
          .select("id, predicate, valid_from, valid_to, memory_id, dst_entity:dst(id, name, type)")
          .eq("src", entity.id);
        if (active_only) outQuery = outQuery.is("valid_to", null);
        const { data: outgoing } = await outQuery;

        // Incoming relations
        let inQuery = supabase
          .from("relations")
          .select("id, predicate, valid_from, valid_to, memory_id, src_entity:src(id, name, type)")
          .eq("dst", entity.id);
        if (active_only) inQuery = inQuery.is("valid_to", null);
        const { data: incoming } = await inQuery;

        // Grounded memories
        const { data: linkedMems } = await supabase
          .from("memory_entities")
          .select("memory:memory_id(id, category, content, agent_id, session_id, created_at)")
          .eq("entity_id", entity.id)
          .limit(10);

        const memories = (linkedMems || []).map((lm: any) => lm.memory).filter(Boolean);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              entity,
              outgoing_relations: outgoing || [],
              incoming_relations: incoming || [],
              grounded_memories: memories,
            }, null, 2),
          }],
        };
      }

      case "search_graph": {
        const { query: searchQuery, max_depth = 1, active_only = true } = args;
        if (!searchQuery) {
          return { isError: true, content: [{ type: "text", text: "Missing required argument 'query'" }] };
        }

        // Try RPC search_graph_rpc first
        try {
          const { data: rpcResults, error: rpcErr } = await supabase.rpc("search_graph_rpc", {
            query_text: searchQuery,
            max_depth,
            active_only,
          });
          if (!rpcErr && rpcResults && rpcResults.length > 0) {
            return { content: [{ type: "text", text: JSON.stringify({ count: rpcResults.length, edges: rpcResults }, null, 2) }] };
          }
        } catch (_) {
          // Fall back to table walk
        }

        // Direct fallback: find seed entities matching query
        const { data: seeds } = await supabase
          .from("entities")
          .select("id, name, type, aliases")
          .or(`name.ilike.%${searchQuery}%,aliases.cs.{${searchQuery}}`)
          .limit(5);

        if (!seeds || seeds.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ count: 0, seed_entities: [], relations: [] }) }] };
        }

        const seedIds = seeds.map((s: any) => s.id);
        let relQuery = supabase
          .from("relations")
          .select("id, predicate, src, dst, memory_id, valid_from, valid_to, src_entity:src(id, name, type), dst_entity:dst(id, name, type)")
          .or(`src.in.(${seedIds.join(",")}),dst.in.(${seedIds.join(",")})`);
        if (active_only) relQuery = relQuery.is("valid_to", null);
        const { data: relations } = await relQuery;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: relations?.length || 0,
              seed_entities: seeds,
              relations: relations || [],
            }, null, 2),
          }],
        };
      }

      case "link_entities": {
        const {
          src,
          dst,
          predicate,
          src_type,
          dst_type,
          memory_id,
          invalidate_previous = false,
          metadata = {},
        } = args;

        if (!src || !dst || !predicate) {
          return { isError: true, content: [{ type: "text", text: "Arguments 'src', 'dst', and 'predicate' are required." }] };
        }

        const relation = await linkEntitiesHelper(
          supabase,
          {
            src,
            dst,
            predicate,
            src_type,
            dst_type,
            invalidate_previous,
            metadata,
          },
          memory_id
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, relation }, null, 2),
          }],
        };
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
        return { content: [{ type: "text", text: JSON.stringify({ count: results.length, memories: results }, null, 2) }] };
      }

      case "list_memories": {
        const { agent_id, session_id, category, limit = 20 } = args;
        let q = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
        if (agent_id) q = q.eq("agent_id", agent_id);
        if (session_id) q = q.eq("session_id", session_id);
        if (category) q = q.eq("category", category);
        const { data, error } = await q;
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        return { content: [{ type: "text", text: JSON.stringify({ count: data?.length || 0, memories: data || [] }, null, 2) }] };
      }

      case "list_skills": {
        const { data, error } = await supabase.from("skills").select("name, description, tags, author_agent");
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        return { content: [{ type: "text", text: JSON.stringify({ skills: data || [] }, null, 2) }] };
      }

      case "get_skill": {
        const { name: skillName } = args;
        const { data, error } = await supabase.from("skills").select("*").eq("name", skillName).single();
        if (error) return { isError: true, content: [{ type: "text", text: `Skill '${skillName}' not found.` }] };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
        return { content: [{ type: "text", text: JSON.stringify({ success: true, skill: data }, null, 2) }] };
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
          version: "1.1.0",
        },
      },
    };
  }

  if (method === "notifications/initialized") {
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
        version: "1.1.0",
        runtime: "supabase-edge",
        features: ["vector_search", "full_text_search", "knowledge_graph", "skill_registry"],
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
