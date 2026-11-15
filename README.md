# Mnesia: Serverless Multi-Agent Memory & Skills System

[![Deploy MCP Edge Function to Supabase](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml/badge.svg)](https://github.com/net-pilgrim/mnesia/actions/workflows/deploy.yml)
[![Supabase Edge Runtime](https://img.shields.io/badge/Runtime-Supabase%20Edge%20(Deno)-3ECF8E?logo=supabase)](https://supabase.com)
[![Embeddings: Gemini](https://img.shields.io/badge/Embeddings-Google%20Gemini%20(Free)-4285F4?logo=google)](https://aistudio.google.com)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-orange)](https://modelcontextprotocol.io)

**Mnesia** is a persistent, shared memory and skill store for fleets of autonomous AI agents (Antigravity/AGY, Claude Desktop, Cursor, LangGraph, AutoGen, etc.). Built natively on **Supabase Edge Functions** (Deno) and **PostgreSQL with `pgvector`**, it enables agents across different sessions, machines, and workspaces to store discoveries, recall peer knowledge, and execute shared runbooks.

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
    end

    subgraph Gemini["Google AI Studio"]
        F["gemini-embedding-001 (768 dims, 1,500 req/min Free)"]
    end

    subgraph DB["Supabase PostgreSQL & pgvector"]
        G[("public.memories")]
        H[("public.skills")]
        I["HNSW Cosine Vector Index"]
        J["GIN Full-Text Search Index"]
        K["match_memories Vector Cosine RPC"]
    end

    Fleet -->|"MCP over SSE (HTTPS)"| E
    E --> D
    D -->|"1. Generate 768-dim Embedding"| Gemini
    Gemini -->|"2. Return Vector"| D
    D -->|"3. Match Similarity / Insert"| DB
    DB --- G
    DB --- H
    G --- I
    G --- J
    G --- K
```

### Architectural Flow:
1. **Agent Connection**: Your agent connects to Mnesia over a secure HTTPS Server-Sent Events (SSE) stream using the standard **Model Context Protocol (MCP)**.
2. **Authentication Guard**: The Edge Function validates incoming requests against your Supabase `service_role` (secret) or `anon` (publishable) key via the HTTP `Authorization` header, `apikey` header, or URL query parameter.
3. **Embedding Generation**: When saving or searching memories, the Edge Function calls Google Gemini's `gemini-embedding-001` endpoint with `outputDimensionality: 768` (Matryoshka representation) to generate vector embeddings instantly.
4. **PostgreSQL Dual Storage**:
   - Vector embeddings are indexed in Postgres using an **HNSW cosine index** (`vector_cosine_ops`) for semantic search.
   - Content is also indexed with a **GIN English tsvector index** (`to_tsvector('english', content)`) for exact keyword, tag, and symbol matching.
5. **Dynamic Skill Catalog**: Reusable procedures and operational runbooks are stored in `public.skills`, allowing agents to dynamically look up and execute complex workflows created by other agents.

---

## 📚 Available Skills & How to Use Them

Mnesia provides two levels of skills: the **agent-level skill** that teaches the agent how to coordinate, and the **database-level skill store** where agents publish and retrieve team runbooks dynamically.

```mermaid
flowchart LR
    subgraph AgentLevel["Agent-Level Skill (.agents/skills/mnesia)"]
        S1["SKILL.md Instructions"]
        S2["Memory Taxonomy (fact, decision, etc.)"]
        S3["Lifecycle Rules (Recall -> Work -> Store)"]
    end

    subgraph RemoteLevel["Remote Team Skills Store (public.skills)"]
        R1["agent-coordination Runbook"]
        R2["supabase-db-migration Runbook"]
        R3["Custom Runbooks (Published by Agents)"]
    end

    AgentLevel -->|"Guides Agent Behavior"| RemoteLevel
```

### 1. The Core Agent Skill: `mnesia`
Located at [`.agents/skills/mnesia/SKILL.md`](.agents/skills/mnesia/SKILL.md), this skill instructs autonomous agents on:
- **Taxonomy**: Categorizing memories properly (`fact`, `decision`, `preference`, `instruction`, `reflection`, `summary`).
- **Reconnaissance**: Always calling `recall_shared_memories()` before embarking on a task.
- **Hygiene**: Storing concise, high-value technical facts instead of raw command logs.
- **Handover**: Preparing structured summaries for successor agents.

#### How to Install the Skill on Your Agent:
- **For Google Antigravity (AGY)**: The skill is already located at `.agents/skills/mnesia/SKILL.md`. AGY automatically discovers skills in workspace `.agents/skills/`.
- **For Claude Desktop / Cursor / Custom Agents**: Reference or include the contents of [`.agents/skills/mnesia/SKILL.md`](.agents/skills/mnesia/SKILL.md) in your agent's system prompt or project rules.

---

### 2. Available Team Skills in Supabase (`public.skills`)

These operational runbooks are stored in Postgres and accessible to any connected agent in real time via MCP:

| Skill Name | Description | Tags | Author |
|---|---|---|---|
| `agent-coordination` | Standard protocol for multi-agent swarm task coordination and handover. | `coordination`, `swarm` | `agent` |
| `supabase-db-migration` | Safe process for running, indexing, and verifying schema changes in Supabase. | `database`, `devops` | `infra_agent` |

---

### 3. How Agents Use Remote Skills via MCP

Agents discover, inspect, and contribute skills using three dedicated MCP tools:

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Autonomous Agent
    participant Edge as Supabase Edge Function
    participant PG as PostgreSQL (public.skills)

    Note over Agent,PG: Step 1: Discover available skills
    Agent->>Edge: list_skills()
    Edge->>PG: SELECT name, description, tags, author_agent FROM skills
    PG-->>Edge: [ { name: "agent-coordination", ... }, { name: "supabase-db-migration", ... } ]
    Edge-->>Agent: {"skills": [...]}

    Note over Agent,PG: Step 2: Fetch full instructions
    Agent->>Edge: get_skill(name="supabase-db-migration")
    Edge->>PG: SELECT * FROM skills WHERE name = 'supabase-db-migration'
    PG-->>Edge: Full instruction markdown
    Edge-->>Agent: {"name": "...", "instructions": "1. Run schema.sql...\n2. Check health..."}

    Note over Agent,PG: Step 3: Publish a new team skill
    Agent->>Edge: publish_skill(name="deploy-service", description="...", instructions="...")
    Edge->>PG: UPSERT INTO public.skills (name, description, instructions, ...)
    PG-->>Edge: Success
    Edge-->>Agent: {"success": true, "skill": "deploy-service"}
```

#### A. Discovering Skills (`list_skills`)
```json
{
  "name": "list_skills",
  "arguments": {}
}
```
*Response:*
```json
{
  "skills": [
    {
      "name": "agent-coordination",
      "description": "Standard protocol for multi-agent swarm task coordination",
      "tags": ["coordination", "swarm"],
      "author_agent": "agent"
    },
    {
      "name": "supabase-db-migration",
      "description": "Run and verify schema migrations in Supabase using CLI",
      "tags": ["database", "devops"],
      "author_agent": "infra_agent"
    }
  ]
}
```

#### B. Fetching Skill Instructions (`get_skill`)
```json
{
  "name": "get_skill",
  "arguments": {
    "name": "agent-coordination"
  }
}
```
*Response:*
```json
{
  "name": "agent-coordination",
  "description": "Standard protocol for multi-agent swarm task coordination",
  "instructions": "1. Call recall_shared_memories before work.\n2. Store findings with store_memory.\n3. Hand off cleanly.",
  "tags": ["coordination", "swarm"],
  "author_agent": "agent"
}
```

#### C. Publishing a New Skill (`publish_skill`)
When an agent perfects a new procedure (e.g. configuring a new service, troubleshooting an elusive bug, or deploying a build):
```json
{
  "name": "publish_skill",
  "arguments": {
    "name": "docker-build-multiarch",
    "description": "Cross-compile multi-arch Docker images with buildx and cache",
    "instructions": "1. Run `docker buildx create --use`.\n2. Build with `--platform linux/amd64,linux/arm64`.\n3. Push with `--push` flag.",
    "tags": ["docker", "devops", "ci"],
    "author_agent": "build_agent"
  }
}
```

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

## 🧠 The Agent Lifecycle Workflow

```mermaid
flowchart TD
    Start(["Agent Receives Task"]) --> Recall["1. Recall Peer Knowledge\nrecall_shared_memories(query, exclude_self=true)"]
    Recall --> Found{"Peer memories found?"}
    Found -- "Yes" --> Reuse["Incorporate peer findings &\navoid duplicate work"]
    Found -- "No" --> Execute["2. Execute Task\nInvestigate, edit code, run tests"]
    Reuse --> Execute
    Execute --> Persist["3. Persist Key Learnings\nstore_memory(category='fact|decision|preference')"]
    Persist --> HasRunbook{"Solved a repeatable procedure?"}
    HasRunbook -- "Yes" --> Publish["4. Publish Reusable Skill\npublish_skill(name, instructions)"]
    HasRunbook -- "No" --> Done(["Task Complete & Handover Ready"])
    Publish --> Done
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
