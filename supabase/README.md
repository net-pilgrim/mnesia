# Supabase Edge Function: Multi-Agent MCP Memory Server

Run your MCP Memory System natively inside **Supabase Edge Functions**.
- ❌ No Docker containers
- ❌ No VPS to maintain
- ❌ No Cloudflare account needed
- ❌ No tunnels
- ✅ **$0.00 / month** on your existing Supabase project
- ✅ Direct, zero-latency access to your Postgres database & `pgvector`

---

## 🚀 3-Minute Deployment Guide

### Step 1: Ensure Your Database Schema is Applied
If you haven't already, go to your [Supabase Dashboard](https://supabase.com/dashboard) -> **SQL Editor**, and run the entire contents of [`schema.sql`](../schema.sql).

---

### Step 2: Link Your Supabase Project
Run this command from your terminal:
```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
```
*(Your project reference is found in your Supabase dashboard URL: `https://supabase.com/dashboard/project/<PROJECT_REF>`)*

---

### Step 3: (Optional) Set OpenAI API Key for Vector Embeddings
If you want semantic vector similarity search via `pgvector`:
```bash
npx supabase secrets set OPENAI_API_KEY=sk-your-openai-api-key
```
*(If omitted, the function automatically uses PostgreSQL Full-Text Search and keyword matching at zero extra cost).*

---

### Step 4: Deploy the Edge Function
Deploy the function with one command:
```bash
npx supabase functions deploy mcp --no-verify-jwt
```

That's it! Your serverless MCP server is live at:
```
https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/sse
```

---

## 🧪 Test Your Deployment

Verify the function is active:
```bash
curl https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/mcp/health
```
Response:
```json
{"status":"healthy","server":"MnesiaMemorySystem","runtime":"supabase-edge"}
```

---

## 🤖 Connect Your Remote Agents

In your agent's MCP configuration (Claude Desktop, Cursor, Antigravity, or custom agents):

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
