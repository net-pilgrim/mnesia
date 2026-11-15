# Mnesia: FastMCP Multi-Agent Memory System with Supabase

A persistent, shared memory system for AI agents built with **FastMCP** and **Supabase** (PostgreSQL + `pgvector`). 

It provides vector semantic search, hybrid keyword search, session scoping, and multi-agent knowledge sharing so diverse agents (researchers, coders, reviewers, planners) can coordinate seamlessly without duplicating work or losing context.

---

## 🏗️ Architecture

```
                       ┌─────────────────────────┐
                       │     AI Agents Fleet     │
                       │  (Researcher, Coder,    │
                       │   Planner, Reviewer)    │
                       └────────────┬────────────┘
                                    │ Model Context Protocol (MCP)
                                    ▼
                       ┌─────────────────────────┐
                       │      FastMCP Server     │
                       │       (server.py)       │
                       └────────────┬────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌─────────────────────────┐                       ┌─────────────────────────┐
│     OpenAI Embeddings   │                       │    Supabase Postgres    │
│  (text-embedding-3)     │                       │  • memories table       │
│  *Optional / Fallback   │                       │  • pgvector HNSW index  │
└─────────────────────────┘                       │  • match_memories RPC   │
                                                  │  • FTS & GIN metadata   │
                                                  └─────────────────────────┘
```

### Key Capabilities
- **Cross-Agent Sharing**: Agents can query memories recorded by peers (`recall_shared_memories`), filter by author (`agent_id`), or scope by project (`session_id`).
- **Semantic Vector Search**: Automatically generates vector embeddings (`text-embedding-3-small` / 1536 dim) and searches with pgvector cosine distance.
- **Graceful Fallback**: If no OpenAI API key is supplied, automatically falls back to PostgreSQL Full-Text Search (`tsvector`) and keyword matching.
- **Rich Metadata & Taxonomy**: Categorize memories (`fact`, `decision`, `preference`, `instruction`, `reflection`, `summary`) and attach tags & custom JSON metadata.

---

## 📁 Repository Structure

```
.
├── server.py                   # FastMCP server with tools, resources & prompts
├── memory_store.py             # Supabase database operations & search logic
├── embeddings.py               # Vector embedding generator with fallback
├── config.py                   # Settings loaded from environment & .env
├── schema.sql                  # Supabase PostgreSQL schema & RPC functions
├── requirements.txt            # Python dependencies
├── .env.example                # Template for environment variables
└── examples/
    ├── demo_multi_agent.py     # Multi-agent collaboration simulation
    └── mcp_client_config.json  # Configuration snippet for MCP clients
```

---

## 🚀 Quick Setup

### 1. Database Setup (Supabase)

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and create or select a project.
2. Go to the **SQL Editor**.
3. Copy the entire contents of [`schema.sql`](file:///home/dsv/work/mnesia/schema.sql) and execute it.
   - Enables `pgvector`
   - Creates the `memories` table
   - Sets up HNSW vector, GIN metadata, and Full-Text Search indexes
   - Creates the `match_memories` and `search_memories_text` RPC functions

### 2. Environment Configuration

1. In your Supabase Project:
   - Navigate to **Project Settings** -> **API**
   - Copy the **Project URL** and the **anon** or **service_role** key
2. Create your `.env` file from the template:
   ```bash
   cp .env.example .env
   ```
3. Fill in your credentials:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-supabase-key
   
   # Optional: For semantic vector embeddings
   OPENAI_API_KEY=sk-...
   EMBEDDING_MODEL=text-embedding-3-small
   ```

### 3. Install Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 🏃 Running the Server

### Local Testing / Inspector
FastMCP includes built-in inspection and dev tools:

```bash
# Test the multi-agent simulated workflow
python examples/demo_multi_agent.py

# Inspect the FastMCP server tools and resources
fastmcp inspect server.py

# Start interactive MCP Dev Inspector
fastmcp dev server.py
```

### ⚡ Serverless Deployment: Supabase Edge Functions ($0/mo, No Containers)
Deploy directly to your Supabase project without Docker, VPS, or tunnels:
```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase functions deploy mcp --no-verify-jwt
```
Your live serverless MCP endpoint:
`https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse`
*(See [supabase/README.md](supabase/README.md) for full instructions).*

### Production stdio (Standard MCP Mode)
Run directly via FastMCP:
```bash
fastmcp run server.py
```

### SSE Transport (Local HTTP / Development)
If your agents connect over HTTP / SSE locally:
```bash
fastmcp run --transport sse --port 8000 server.py
```

### Docker & Cloudflare Deployment
Deploy with Docker Compose:
```bash
docker compose up -d --build
```
For detailed hosting guides (Cloudflare Workers, Supabase Edge, GCP Cloud Run, Hetzner), see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 🛠️ MCP API Reference

### Tools

| Tool | Parameters | Description |
|------|------------|-------------|
| `store_memory` | `content`, `agent_id`, `category`, `tags`, `session_id`, `metadata` | Stores a new memory, computes embeddings, and indexes it in Supabase. |
| `search_memories` | `query`, `agent_id`, `session_id`, `category`, `tags`, `limit`, `match_threshold` | Hybrid search (pgvector semantic search + full-text fallback) across all memories. |
| `recall_shared_memories` | `query`, `current_agent_id`, `exclude_self`, `session_id`, `category`, `tags`, `limit` | Specifically queries peer agents' memories to coordinate tasks and prevent duplicate work. |
| `list_memories` | `agent_id`, `session_id`, `category`, `limit`, `offset` | Paginated listing of recent memories. |
| `get_memory` | `memory_id` | Fetches a single memory by UUID. |
| `update_memory` | `memory_id`, `content`, `category`, `tags`, `metadata` | Updates a memory item and recalculates vector embeddings if content changed. |
| `delete_memory` | `memory_id` | Deletes a memory by UUID. |
| `clear_session_memories`| `session_id` | Clears all memories belonging to a specific session or task. |
| `list_skills` | `tag` | Discovers available procedural skills and runbooks exposed by the MCP server. |
| `get_skill` | `name` | Retrieves step-by-step instructions and runbook for a requested skill. |
| `publish_skill` | `name`, `description`, `instructions`, `tags`, `author_agent` | Publishes a novel procedure or workflow to Supabase so other agents can execute it. |

### Resources

- `memory://agents`: JSON array of all unique agent IDs present in the memory store.
- `memory://recent`: List of the 20 most recently saved memories.
- `memory://agent/{agent_id}`: All memories created by a specific agent.
- `skill://catalog`: JSON catalog of all available skills.
- `skill://{skill_name}`: Full markdown procedural runbook for `{skill_name}`.

### Prompts

- `execute_skill`: Executes a standardized team skill with specific task context.
- `agent_handover`: Formats a briefing prompt containing prior decisions and facts for context handoff between agents.
- `cross_agent_context`: Prepares relevant shared memories to inject into an agent's reasoning loop for a specific query.

### 🌟 Built-in & Dynamic Skills

The MCP server comes with built-in skills and allows agents to publish new skills to Supabase:
1. **`agent-handover`**: Protocol for summarizing achievements and handing off tasks cleanly.
2. **`memory-consolidation`**: Synthesizes transient scratchpads into permanent architectural facts.
3. **`conflict-resolution`**: Identifies contradictory memories and reconciles consensus.
4. **Agent Skill Package**: Located at [shared-memory](file:///home/dsv/work/mnesia/.agents/skills/shared-memory/SKILL.md) for Antigravity and compatible agents.

---

## 🤖 Client Configuration

Add this server to your MCP client configuration (e.g. Claude Desktop, Antigravity, Cursor, or Windsurf):

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "supabase-memory": {
      "command": "/absolute/path/to/mnesia/.venv/bin/fastmcp",
      "args": ["run", "/absolute/path/to/mnesia/server.py"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_KEY": "your-supabase-key",
        "OPENAI_API_KEY": "sk-your-openai-key"
      }
    }
  }
}
```

### Python Multi-Agent Framework Integration (LangChain / LangGraph / Autogen)
```python
from fastmcp import Client

# Connect to the FastMCP memory server
async with Client.from_command(
    "/absolute/path/to/mnesia/.venv/bin/fastmcp",
    "run",
    "/absolute/path/to/mnesia/server.py"
) as client:
    # Agent 1 stores finding
    await client.call_tool(
        "store_memory",
        content="User prefers TypeScript over Python for cloud functions.",
        agent_id="researcher_agent",
        category="preference",
        tags=["typescript", "preferences"]
    )

    # Agent 2 queries memories
    memories = await client.call_tool(
        "recall_shared_memories",
        query="cloud functions language",
        current_agent_id="coder_agent",
        exclude_self=True
    )
    print(memories)
```
