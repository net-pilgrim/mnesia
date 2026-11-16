# Mnesia: Serverless Multi-Agent Memory, Knowledge Graph & Skills System

[![Deploy MCP Edge Function to Supabase](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml/badge.svg)](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml)
[![Supabase Edge Runtime](https://img.shields.io/badge/Runtime-Supabase%20Edge%20(Deno)-3ECF8E?logo=supabase)](https://supabase.com)
[![Embeddings: Gemini](https://img.shields.io/badge/Embeddings-Google%20Gemini%20(Free)-4285F4?logo=google)](https://aistudio.google.com)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-orange)](https://modelcontextprotocol.io)

**Mnesia** is a persistent, shared memory, knowledge graph, and skill store for fleets of autonomous AI agents (Google Antigravity/AGY, Claude Desktop, Cursor, LangGraph, AutoGen, etc.). Built natively on **Supabase Edge Functions** (Deno) and **PostgreSQL with `pgvector` & `pg_trgm`**, it enables agents across different sessions, machines, and workspaces to store discoveries, ground knowledge graph entities and relations, recall peer knowledge, and execute shared runbooks.

- ❌ **No Docker containers or local daemon processes**
- ❌ **No VPS servers to maintain or pay for**
- ❌ **No SSH tunnels, Ngrok, or public IP exposure**
- ✅ **100% Serverless Edge execution** ($0.00/mo on Supabase Free Tier)
- ✅ **Knowledge Graph Grounding & Multi-Hop Traversal** (`public.entities`, `public.relations`, `public.memory_entities`)
- ✅ **Google Gemini 768-dim Embeddings** (1,500 req/min completely free)
- ✅ **Triple Retrieval Engine**: Cosine vector similarity (`pgvector` HNSW) + English full-text search (GIN) + Knowledge Graph 1-2 hop expansion
- ✅ **Zero-Overhead KG Extraction**: Calling agents populate entities & relations directly during `store_memory`
- ✅ **SHA-256 Content Deduplication**: Reuses vector embeddings on duplicate text to conserve API quota
- ✅ **Turnkey Multi-Agent Skill Store** (`public.skills`)
- ✅ **Automated CI/CD** via GitHub Actions

---

## 🏗️ Architecture & How It Works

```mermaid
flowchart TD
    subgraph Fleet["AI Agent Fleet"]
        A["Google Antigravity (AGY CLI / IDE)"]
        B["Claude Desktop / Cursor"]
        C["Autonomous Agents (LangGraph / Swarm)"]
    end

    subgraph Edge["Supabase Edge Function (/functions/v1/mcp)"]
        D["MCP SSE & JSON-RPC Protocol Dispatcher"]
        E["Supabase API Key Auth Guard"]
        HSH["SHA-256 Deduplication Cache"]
    end

    subgraph Gemini["Google AI Studio"]
        F["gemini-embedding-001 (768 dims, Free)"]
    end

    subgraph DB["Supabase PostgreSQL (pgvector + pg_trgm)"]
        G[("public.memories")]
        ENT[("public.entities")]
        REL[("public.relations")]
        MEM_ENT[("public.memory_entities")]
        SK[("public.skills")]
        HNSW["HNSW Cosine Vector Index"]
        TRGM["GIN Trigram & Full-Text Search"]
        CTE["Recursive Multi-Hop Graph Traversal"]
    end

    Fleet -->|"MCP over SSE (HTTPS)"| E
    E --> D
    D --> HSH
    HSH -->|"Compute Vector on Cache Miss"| F
    F -->|"768-dim Embedding"| D
    D -->|"Vector Match & FTS"| G
    D -->|"Entity Resolution & Link"| ENT
    D -->|"Graph Edges (Valid Range)"| REL
    G --- MEM_ENT
    ENT --- MEM_ENT
    ENT --- REL
    G --- HNSW
    G --- TRGM
    REL --- CTE
    DB --- SK
```

### Architectural Flow:
1. **Agent Connection**: Your agent connects to Mnesia over a secure HTTPS Server-Sent Events (SSE) stream using the standard **Model Context Protocol (MCP)**.
2. **Authentication Guard**: The Edge Function validates incoming requests against your Supabase `service_role` (secret) or `anon` (publishable) key.
3. **Quota-Aware Embedding Generation**:
   - Mnesia hashes memory content using **SHA-256**. If an identical memory has already been embedded, it reuses the vector directly with zero external API calls.
   - On cache miss, it calls Google Gemini's `gemini-embedding-001` endpoint with `outputDimensionality: 768`.
   - On rate limits (HTTP 429), it degrades gracefully by persisting the memory without embedding and falling back to full-text and knowledge graph search.
4. **Knowledge Graph Grounding**:
   - Calling agents can supply `entities` and `relations` when saving memories.
   - Entities are resolved fuzzily via trigram matching and aliases array (`lower(name)`, `type`).
   - Relations maintain temporal validity (`valid_from`, `valid_to`) so contradictions and superseding choices can be tracked without destructive deletes.
5. **Multi-Hop Traversal**: Recursive CTEs expand semantic query results by 1-2 hops across active relations to surface related architecture decisions, components, and facts.

---

## 🕸️ Knowledge Graph Model

```mermaid
erDiagram
    MEMORIES ||--o{ MEMORY_ENTITIES : grounds
    ENTITIES ||--o{ MEMORY_ENTITIES : references
    ENTITIES ||--o{ RELATIONS : source
    ENTITIES ||--o{ RELATIONS : destination
    MEMORIES ||--o| RELATIONS : evidences

    MEMORIES {
        uuid id PK
        text agent_id
        text session_id
        text category
        text content
        text content_hash
        text[] tags
        jsonb metadata
        vector embedding
        timestamptz created_at
    }

    ENTITIES {
        uuid id PK
        text name
        text type
        text[] aliases
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    RELATIONS {
        uuid id PK
        uuid src FK
        uuid dst FK
        text predicate
        uuid memory_id FK
        timestamptz valid_from
        timestamptz valid_to
        jsonb metadata
    }

    MEMORY_ENTITIES {
        uuid memory_id PK,FK
        uuid entity_id PK,FK
        timestamptz created_at
    }
```

---

## 🔍 Retrieval & Knowledge Graph Traversal Flow

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Autonomous Agent
    participant Edge as Supabase Edge Function
    participant Gemini as Google AI Studio
    participant DB as PostgreSQL (pgvector + Graph)

    Agent->>Edge: search_memories(query="TokenVault", expand_graph=true)
    Edge->>Gemini: Generate Query Embedding (768 dims)
    Gemini-->>Edge: Query Vector
    Edge->>DB: match_memories (Vector Cosine Distance) + search_memories_text
    DB-->>Edge: Direct Memory Hits (Top K)
    Note over Edge,DB: Knowledge Graph 1-Hop Expansion
    Edge->>DB: Fetch Linked Entities from memory_entities
    DB-->>Edge: [TokenVault, AES-256-GCM]
    Edge->>DB: Traverse Active Relations (src/dst in entity set)
    DB-->>Edge: [TokenVault --uses--> AES-256-GCM, TokenVault --protects--> OAuth]
    Edge->>DB: Fetch Grounded Memories for Neighbor Entities
    DB-->>Edge: [Associated Architecture & Handover Records]
    Edge-->>Agent: Merged Results (Direct Hits + Graph-Expanded Memories)
```

---

## 📚 Available Skills & How to Use Them

Mnesia provides two levels of skills: the **agent-level skill** that teaches the agent how to coordinate, and the **database-level skill store** where agents publish and retrieve team runbooks dynamically.

```mermaid
flowchart LR
    subgraph AgentLevel["Agent-Level Skill (.agents/skills/mnesia)"]
        S1["SKILL.md Instructions"]
        S2["Memory Taxonomy (fact, decision, etc.)"]
        S3["Knowledge Graph Grounding Rules"]
        S4["Lifecycle Rules (Recall -> Work -> Store)"]
    end

    subgraph RemoteLevel["Remote Team Skills Store (public.skills)"]
        R1["agent-coordination Runbook"]
        R2["supabase-db-migration Runbook"]
        R3["Custom Runbooks (Published by Agents)"]
    end

    AgentLevel -->|"Guides Agent Behavior"| RemoteLevel
```

---

## 🛠️ MCP Tools Reference

| Tool | Arguments | Description |
|---|---|---|
| `store_memory` | `content`, `agent_id`, `category`, `tags`, `session_id`, `metadata`, `entities`, `relations` | Stores knowledge snippet, generates/caches 768-dim embeddings, and grounds entities & relations in the Knowledge Graph. |
| `search_memories` | `query`, `agent_id`, `session_id`, `category`, `tags`, `limit`, `match_threshold`, `expand_graph` | Triple retrieval engine: cosine vector similarity + full-text search + 1-hop Knowledge Graph expansion. |
| `recall_shared_memories` | `query`, `current_agent_id`, `exclude_self`, `session_id`, `category`, `limit` | Specifically retrieves peer agents' memories to eliminate duplicate work. |
| `get_entity` | `name`, `entity_id`, `active_only` | Retrieves a knowledge graph entity, its active incoming/outgoing edges, and grounded memories. |
| `search_graph` | `query`, `max_depth`, `active_only` | Explores the knowledge graph around matching entities up to N hops. |
| `link_entities` | `src`, `dst`, `predicate`, `src_type`, `dst_type`, `memory_id`, `invalidate_previous`, `metadata` | Directly asserts a directed relationship between two entities. |
| `list_memories` | `agent_id`, `session_id`, `category`, `limit` | Chronological paginated memory inspection. |
| `list_skills` | *(none)* | Discovers team operational runbooks and shared procedures. |
| `get_skill` | `name` | Fetches step-by-step instructions for a published team skill. |
| `publish_skill` | `name`, `description`, `instructions`, `tags`, `author_agent` | Publishes a novel procedure to Supabase for all agents to execute. |

---

## ⚙️ Configuration Guide

### 1. Supabase Setup
1. Create a free account and project at [supabase.com](https://supabase.com).
2. In the Supabase Dashboard, navigate to the **SQL Editor**.
3. Open [`schema.sql`](schema.sql) from this repository, paste its contents into the SQL Editor, and click **Run**. This:
   - Enables `vector` and `pg_trgm` extensions.
   - Creates `memories`, `entities`, `relations`, `memory_entities`, and `skills` tables.
   - Sets up HNSW vector indexes, trigram indexes, and recursive CTE graph traversal functions.
4. Collect credentials under **Project Settings** -> **API**:
   - **Project URL**: `https://<YOUR_PROJECT_REF>.supabase.co`
   - **Service Role Key** (secret): `eyJhbGciOi...` (or use your `anon` public key)
   - **Project Ref**: The 20-character identifier in your URL (e.g. `zmocedvkqrcxwkthmwql`).

### 2. Google AI Studio Setup (Gemini Embeddings)
Mnesia uses Google's `gemini-embedding-001` model, providing 768-dimensional embeddings with a generous free tier of **1,500 requests per minute** at $0 cost.
1. Visit [Google AI Studio](https://aistudio.google.com).
2. Click **Get API key** and select **Create API key in new project**.
3. Copy your API key (starts with `AIzaSy...`).

### 3. GitHub CI/CD Automated Deployment
This repository automatically deploys the MCP Edge Function to your Supabase project whenever changes are pushed to `main`.
1. Go to your GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions**.
2. Add the following repository secrets:

| Secret Name | Value | Description |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token | Created at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` | Your Supabase project URL |
| `GEMINI_API_KEY` | `AIzaSy...` | Your Google AI Studio API key |
| `OPENAI_API_KEY` *(Optional)* | `sk-...` | Optional fallback embedding key |

---

## 🤖 How to Configure Mnesia on Your Agent

Configure your MCP client to connect to your live Supabase Edge Function URL:
`https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse`

### A. Google Antigravity (AGY CLI / IDE)
Edit `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "mnesia": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

### B. Claude Desktop
Edit `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mnesia": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

### C. Cursor & Custom Clients
```json
{
  "mcpServers": {
    "mnesia": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse?apikey=YOUR_SUPABASE_SERVICE_ROLE_KEY"
    }
  }
}
```

---

## 🩺 Health Check & Diagnostics

```bash
# Basic health check
curl https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/health

# Embeddings diagnostics (live Gemini ping)
curl https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/health?test=embedding
```

Expected response:
```json
{
  "status": "healthy",
  "server": "MnesiaMemorySystem",
  "version": "1.1.0",
  "runtime": "supabase-edge",
  "features": [
    "vector_search",
    "full_text_search",
    "knowledge_graph",
    "skill_registry"
  ],
  "config": {
    "geminiKeyConfigured": true,
    "openaiKeyConfigured": false
  },
  "testEmbedding": {
    "status": "gemini_ok (768 dims)"
  }
}
```

---

## 📄 License
MIT License. Free to use, adapt, and distribute across personal and enterprise agent fleets.
