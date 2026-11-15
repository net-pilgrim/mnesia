# Mnesia: Serverless Multi-Agent Memory System on Supabase

A persistent, shared memory system for AI agents built natively on **Supabase Edge Functions** (Deno) and **PostgreSQL with `pgvector`**.

- ❌ **No Docker containers**
- ❌ **No VPS to maintain or pay for**
- ❌ **No tunnels**
- ✅ **100% Serverless Edge execution** ($0/mo on Supabase Free Tier)
- ✅ **Multi-agent memory sharing** with semantic vector similarity and full-text search
- ✅ **Automated CI/CD** via GitHub Actions

---

## 🏗️ Architecture

```
                       ┌─────────────────────────┐
                       │     AI Agents Fleet     │
                       │  (Claude, Cursor, AGY,  │
                       │   LangGraph, AutoGen)   │
                       └────────────┬────────────┘
                                    │ Model Context Protocol (MCP over SSE)
                                    ▼
                       ┌─────────────────────────┐
                       │  Supabase Edge Function │
                       │    (/functions/v1/mcp)  │
                       └────────────┬────────────┘
                                    │ Direct Postgres / pgvector
                                    ▼
                       ┌─────────────────────────┐
                       │    Supabase Postgres    │
                       │  • memories table       │
                       │  • skills table         │
                       │  • pgvector HNSW index  │
                       │  • match_memories RPC   │
                       └─────────────────────────┘
```

---

## 📁 Repository Structure

```
.
├── supabase/
│   ├── functions/
│   │   └── mcp/
│   │       └── index.ts          # Serverless MCP Edge Function
│   ├── config.toml               # Edge Function settings
│   └── README.md                 # Detailed Supabase guide
├── schema.sql                    # Database schema, pgvector, and RPC functions
├── .github/
│   └── workflows/
│       └── deploy.yml            # Automated CI/CD deployment workflow
├── .agents/
│   └── skills/
│       └── shared-memory/
│           └── SKILL.md          # Agent skill for memory & collaboration
├── .env.example                  # Environment configuration template
└── README.md
```

---

## 🚀 Quick Setup & Deployment

### 1. Database Schema
Execute [`schema.sql`](schema.sql) in your [Supabase SQL Editor](https://supabase.com/dashboard) to enable `pgvector` and create the `memories` and `skills` tables.

### 2. Automated GitHub CI/CD Deployment
Add these two secrets to your GitHub repository (**Settings** -> **Secrets and variables** -> **Actions**):

| Secret Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Created at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_URL` | `https://<YOUR_PROJECT_REF>.supabase.co` |
| `MCP_API_KEY` *(Optional)* | Custom secret token to authenticate agents |
| `OPENAI_API_KEY` *(Optional)* | For semantic vector embeddings |

Every push to `main` automatically deploys the Edge Function.

### 3. Manual Local Deployment (via Supabase CLI)
```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase functions deploy mcp --no-verify-jwt
```

---

## 🔒 Authentication

When `MCP_API_KEY` is configured in Supabase secrets, your MCP server requires agents to authenticate.

### Method A: HTTP Header (Standard)
```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

### Method B: URL Token (For clients that don't support custom headers)
```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse?token=YOUR_MCP_API_KEY"
    }
  }
}
```

---

## 🤖 Connect Remote Agents

Add this to your MCP client configuration (Claude Desktop, Cursor, Antigravity, etc.):

```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse"
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Parameters | Description |
|------|------------|-------------|
| `store_memory` | `content`, `agent_id`, `category`, `tags`, `session_id`, `metadata` | Stores a memory, computes embeddings, and indexes it in Supabase. |
| `search_memories` | `query`, `agent_id`, `session_id`, `category`, `tags`, `limit`, `match_threshold` | Vector similarity (pgvector) + full-text search across memories. |
| `recall_shared_memories` | `query`, `current_agent_id`, `exclude_self`, `session_id`, `category`, `limit` | Specifically queries peer agents' findings to prevent duplicate work. |
| `list_memories` | `agent_id`, `session_id`, `category`, `limit` | Paginated listing of recent memories. |
| `list_skills` | - | Discovers team operational skills and runbooks. |
| `get_skill` | `name` | Retrieves step-by-step instructions for a skill. |
| `publish_skill` | `name`, `description`, `instructions`, `tags`, `author_agent` | Publishes a novel procedure to Supabase for all agents to share. |
