# Mnesia: Serverless Multi-Agent Memory & Skills System

[![Deploy MCP Edge Function to Supabase](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml/badge.svg)](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml)
[![Supabase Edge Runtime](https://img.shields.io/badge/Runtime-Supabase%20Edge%20(Deno)-3ECF8E?logo=supabase)](https://supabase.com)
[![Embeddings: Gemini](https://img.shields.io/badge/Embeddings-Google%20Gemini%20(Free)-4285F4?logo=google)](https://aistudio.google.com)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-orange)](https://modelcontextprotocol.io)

**Mnesia** is a persistent, shared memory and skill store for fleets of autonomous AI agents (Antigravity/AGY, Claude Desktop, Cursor, LangGraph, AutoGen, etc.). Built natively on **Supabase Edge Functions** (Deno) and **PostgreSQL with `pgvector`**, it enables agents across different sessions and devices to store discoveries, recall peer knowledge, and execute shared runbooks.

- ❌ **No Docker containers or local daemon processes**
- ❌ **No VPS servers to maintain or pay for**
- ❌ **No SSH tunnels, Ngrok, or public IP exposure**
- ✅ **100% Serverless Edge execution** ($0.00/mo on Supabase Free Tier)
- ✅ **Google Gemini 768-dim Embeddings** (1,500 req/min completely free)
- ✅ **Dual Retrieval Engine**: Cosine vector similarity (`pgvector` HNSW) + English full-text search (GIN)
- ✅ **Turnkey Multi-Agent Skill Store** (`public.skills`)
- ✅ **Automated CI/CD** via GitHub Actions

---

## 🏗️ Architecture & How It Works

```
                                ┌─────────────────────────────────────────┐
                                │            AI AGENT FLEET               │
                                │   • Google Antigravity (AGY CLI / IDE)  │
                                │   • Claude Desktop / Cursor             │
                                │   • Autonomous Python / LangGraph fleets│
                                └────────────────────┬────────────────────┘
                                                     │ Model Context Protocol
                                                     │ (SSE / JSON-RPC over HTTPS)
                                                     ▼
                                ┌─────────────────────────────────────────┐
                                │         SUPABASE EDGE FUNCTION          │
                                │          (/functions/v1/mcp)            │
                                │                                         │
                                │ • Deno Serverless Runtime (EU/Global)   │
                                │ • Supabase Key Auth Guard (Option 1)    │
                                │ • MCP Protocol Dispatcher (7 Tools)     │
                                └─────────┬─────────────────────┬─────────┘
                                          │                     │
                1. Compute 768-dim Vector │                     │ 2. Query / Store Records
                                          ▼                     ▼
               ┌───────────────────────────────┐   ┌───────────────────────────────┐
               │     GOOGLE GEMINI AI STUDIO   │   │       SUPABASE POSTGRESQL     │
               │  • Model: gemini-embedding-001│   │                               │
               │  • Output Dimension: 768      │   │  • Table: public.memories     │
               │  • Free Rate: 1,500 req/min   │   │  • Table: public.skills       │
               │  • (Fallback: OpenAI / FTS)   │   │  • Index: HNSW Vector Cosine  │
               └───────────────────────────────┘   │  • Index: GIN Full-Text Search│
                                                   │  • RPC: match_memories        │
                                                   └───────────────────────────────┘
```

### Architectural Flow:
1. **Agent Request**: Your agent initiates an MCP call (e.g. `search_memories`, `store_memory`, or `publish_skill`) over a secure HTTPS Server-Sent Events (SSE) connection.
2. **Authentication Guard**: The Edge Function validates incoming requests against your Supabase `service_role` (secret) or `anon` (publishable) key via the HTTP `Authorization` header, `apikey` header, or URL query parameter.
3. **Embedding Generation**: When saving or searching memories, the Edge Function queries Google Gemini's `gemini-embedding-001` endpoint with `outputDimensionality: 768` (Matryoshka representation) to generate vector embeddings instantly.
4. **PostgreSQL Dual Storage**:
   - Vector embeddings are indexed in Postgres using an **HNSW cosine index** (`vector_cosine_ops`) for semantic search.
   - Content is also indexed with a **GIN English tsvector index** (`to_tsvector('english', content)`) for exact keyword and symbol search.
5. **Team Skills Catalog**: Solved procedures and runbooks are stored in the `public.skills` table, allowing agents to dynamically look up and execute complex workflows created by other agents.

---

## ⚙️ Configuration Guide

Setting up Mnesia requires three simple steps: Supabase, Google Gemini, and GitHub CI/CD.

### 1. Supabase Setup
1. Create a free account and project at [supabase.com](https://supabase.com).
2. In the Supabase Dashboard, navigate to the **SQL Editor**.
3. Open [`schema.sql`](schema.sql) from this repository, paste its contents into the SQL Editor, and click **Run**. This:
   - Enables the `vector` extension.
   - Creates the `memories` table with a `vector(768)` column.
   - Creates the `skills` table.
   - Sets up HNSW vector indexes, GIN full-text search indexes, and the `match_memories` search RPC.
4. Collect your credentials under **Project Settings** -> **API**:
   - **Project URL**: `https://<YOUR_PROJECT_REF>.supabase.co`
   - **Service Role Key** (secret): `eyJhbGciOi...` (or use your `anon` public key)
   - **Project Ref**: The 20-character identifier in your URL (e.g. `zmocedvkqrcxwkthmwql`).

### 2. Google AI Studio Setup (Gemini Embeddings)
Mnesia uses Google's `gemini-embedding-001` model, which provides 768-dimensional embeddings with a generous free tier of **1,500 requests per minute** at $0 cost.
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

3. Trigger the deployment: either push a commit to `main` or go to **Actions** -> **Deploy MCP Edge Function to Supabase** -> **Run workflow**.

---

## 🤖 How to Configure Mnesia on Your Agent

Configure your MCP client to connect to your live Supabase Edge Function URL:
`https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse`

### A. Google Antigravity (AGY CLI / IDE)
Edit `~/.gemini/config/mcp_config.json` (or your project's `.gemini/mcp_config.json`):
```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

### B. Claude Desktop
Edit `claude_desktop_config.json` (`~/.config/Claude/claude_desktop_config.json` on Linux, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
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
If your MCP client does not support HTTP headers, append your key directly as a URL parameter:
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

## 🧠 How to Use Mnesia on Your Agent

Once connected, your agent has access to 7 MCP tools. The repository includes an agent skill definition at [`.agents/skills/mnesia/SKILL.md`](.agents/skills/mnesia/SKILL.md).

### The Recommended Agent Lifecycle

```
[Agent Starts Task]
       │
       ▼
1. RECALL PEER MEMORIES  ──►  Did another agent solve or research this already?
       │                      recall_shared_memories(query="...", exclude_self=True)
       ▼
2. PERFORM WORK          ──►  Agent writes code, tests, debugs, or analyzes.
       │
       ▼
3. PERSIST KNOWLEDGE     ──►  Store critical facts, decisions, and gotchas.
       │                      store_memory(content="...", category="fact|decision|preference")
       ▼
4. SHARE PROCEDURES      ──►  Store complex multi-step workflows as reusable skills.
                              publish_skill(name="...", instructions="...")
```

### Concrete Examples

#### 1. Checking Prior Work Before Starting
```json
{
  "name": "recall_shared_memories",
  "arguments": {
    "query": "authentication JWT expiration rotation",
    "current_agent_id": "backend_dev",
    "exclude_self": true
  }
}
```

#### 2. Storing High-Value Findings (Semantic Vectorized)
```json
{
  "name": "store_memory",
  "arguments": {
    "content": "Postgres HNSW vector index requires column vector(768) to match Gemini gemini-embedding-001 output.",
    "agent_id": "devops_agent",
    "category": "fact",
    "tags": ["supabase", "gemini", "pgvector"]
  }
}
```

#### 3. Semantic Vector Search Across All Fleet Knowledge
```json
{
  "name": "search_memories",
  "arguments": {
    "query": "how do we compute embeddings for agents?",
    "limit": 5,
    "match_threshold": 0.3
  }
}
```

#### 4. Publishing & Sharing Reusable Team Runbooks
```json
{
  "name": "publish_skill",
  "arguments": {
    "name": "supabase-db-migration",
    "description": "How to run and verify Supabase schema migrations in CI/CD",
    "instructions": "1. Add SQL script to migrations directory...\n2. Run supabase db push --yes...\n3. Verify tables with curl health endpoint.",
    "tags": ["database", "ci-cd"],
    "author_agent": "infra_agent"
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Arguments | Description |
|---|---|---|
| `store_memory` | `content`, `agent_id`, `category`, `tags`, `session_id`, `metadata` | Computes Gemini 768-dim embeddings and stores knowledge in Supabase. |
| `search_memories` | `query`, `agent_id`, `session_id`, `category`, `tags`, `limit`, `match_threshold` | Dual semantic cosine vector similarity + full-text search. |
| `recall_shared_memories` | `query`, `current_agent_id`, `exclude_self`, `session_id`, `category`, `limit` | Specifically retrieves peer agents' memories to eliminate duplicate work. |
| `list_memories` | `agent_id`, `session_id`, `category`, `limit` | Chronological paginated memory inspection. |
| `list_skills` | *(none)* | Discovers team operational runbooks and shared procedures. |
| `get_skill` | `name` | Fetches step-by-step instructions for a published team skill. |
| `publish_skill` | `name`, `description`, `instructions`, `tags`, `author_agent` | Publishes a novel procedure to Supabase for all agents to execute. |

---

## 🩺 Health Check & Diagnostics

You can verify the status and embedding engine of your deployed edge function at any time:

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
  "runtime": "supabase-edge",
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

## 📁 Repository Structure

```
.
├── supabase/
│   ├── functions/
│   │   └── mcp/
│   │       └── index.ts          # Serverless MCP Edge Function (TypeScript/Deno)
│   ├── config.toml               # Edge Function settings
│   └── README.md                 # Supabase deployment details
├── schema.sql                    # Postgres schema, pgvector 768 dims, HNSW & FTS indexes
├── .github/
│   └── workflows/
│       └── deploy.yml            # Automated CI/CD deployment workflow
├── .agents/
│   └── skills/
│       └── mnesia/
│           └── SKILL.md          # Antigravity agent skill definition
├── .env.example                  # Environment configuration template
└── README.md
```

---

## 📄 License
MIT License. Free to use, adapt, and distribute across personal and enterprise agent fleets.
