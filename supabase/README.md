# Supabase Edge Function: Mnesia MCP Memory Server

Run your MCP Memory System natively inside **Supabase Edge Functions**.
- ❌ No Docker containers
- ❌ No VPS to maintain
- ❌ No Cloudflare account needed
- ❌ No tunnels
- ✅ **$0.00 / month** on your existing Supabase project
- ✅ **Google Gemini 768-dim Embeddings** (1,500 req/min free tier)
- ✅ Direct, zero-latency access to your Postgres database & `pgvector`

---

## 🏗️ Architecture

```
[Agent: AGY / Claude / Cursor]
              │
              │  Model Context Protocol (SSE / JSON-RPC over HTTPS)
              ▼
[Supabase Edge Function: /functions/v1/mcp]
   ├─ Auth: Verifies Supabase API Key (service_role or anon)
   ├─ Embeddings: Calls Google Gemini (gemini-embedding-001 @ 768 dims)
   └─ Postgres: Executes pgvector HNSW match_memories RPC & FTS
```

---

## ⚙️ Configuration

### 1. Configure Supabase Database
In your [Supabase Dashboard](https://supabase.com/dashboard) -> **SQL Editor**, run the entire [`schema.sql`](../schema.sql) script to enable `pgvector` (768 dimensions), create the tables, indexes, and RPC functions.

### 2. Configure Google AI Studio (Gemini)
1. Go to [Google AI Studio](https://aistudio.google.com).
2. Click **Get API key** -> **Create API key**.
3. Set the key into your Supabase project secrets:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=AIzaSy... --project-ref <YOUR_PROJECT_REF>
   ```

### 3. Deploy Function
- **Via GitHub Actions (Recommended)**: Set `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`, and `GEMINI_API_KEY` in your GitHub repository secrets. Every push to `main` deploys automatically.
- **Via CLI**:
  ```bash
  npx supabase login
  npx supabase link --project-ref <YOUR_PROJECT_REF>
  npx supabase functions deploy mcp --no-verify-jwt
  ```

---

## 🤖 How to Use on Your Agent

Configure your MCP client:

### Method A: HTTP Header (Standard)
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

### Method B: URL Query Parameter
```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse?apikey=YOUR_SUPABASE_SERVICE_ROLE_KEY"
    }
  }
}
```

### Test Deployment
```bash
curl https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/health?test=embedding
```
