# Cloudflare Worker Serverless MCP Memory Server

Run this multi-agent memory MCP server natively on **Cloudflare Workers**. 
- ❌ No Docker containers
- ❌ No VPS to maintain
- ❌ No tunnels
- ✅ 100% Serverless Edge execution
- ✅ Direct connection to Supabase & OpenAI

---

## 🚀 1-Minute Deployment

### 1. Install Wrangler (Cloudflare CLI)
```bash
npm install -g wrangler
wrangler login
```

### 2. Configure Your Supabase Secrets
From inside `cloudflare-worker/`:
```bash
cd cloudflare-worker

# Set your Supabase URL in wrangler.toml or via secret
wrangler secret put SUPABASE_URL
# Enter: https://your-project.supabase.co

wrangler secret put SUPABASE_KEY
# Enter your Supabase service_role key

# (Optional) For vector embeddings
wrangler secret put OPENAI_API_KEY
# Enter your OpenAI sk-... key
```

### 3. Deploy
```bash
npm install
wrangler deploy
```

Wrangler will output your live global edge endpoint:
```
https://mnesia-mcp-memory.<your-subdomain>.workers.dev
```

---

## 🤖 Connecting Remote Agents

In your agent's MCP config:
```json
{
  "mcpServers": {
    "supabase-memory": {
      "url": "https://mnesia-mcp-memory.<your-subdomain>.workers.dev/sse"
    }
  }
}
```
