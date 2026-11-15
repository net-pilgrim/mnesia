# Hosting Your FastMCP Server: Cloudflare, Serverless, and Containers

This guide covers the best ways to deploy and host the **FastMCP Supabase Memory System** so remote agents can access it securely over HTTPS/SSE.

---

## 🧭 Architectural Options at a Glance

| Approach | Platform | Pricing | Setup Difficulty | Best For |
|---|---|---|---|---|
| **1. Cloudflare Tunnel + Docker (Recommended)** | Cloudflare + Hetzner / VPS | Free CF + ~$4/mo VPS | ⭐ Low | Maximum control, zero open firewall ports, free automated SSL, Cloudflare Access auth. |
| **2. Serverless Containers (Scale to Zero)** | Google Cloud Run / Fly.io / Railway | Pay-per-use (Free tier available) | ⭐ Very Low | Zero server maintenance, automatic scaling, no VPS management. |
| **3. Cloudflare Edge Gateway** | Cloudflare Workers (TS Proxy) | Free tier | ⭐⭐ Moderate | Protecting your backend with edge JWT validation or rate limiting. |

---

## 🚀 Approach 1: Cloudflare Tunnel + Hetzner Docker (Best Overall)

By pairing a cheap Hetzner cloud server (e.g., CX22 for ~€3.50/mo) with a free **Cloudflare Tunnel (`cloudflared`)**, you get:
- **No open inbound ports**: Your VPS firewall can block all incoming ports. `cloudflared` creates an outbound encrypted tunnel to Cloudflare.
- **Automated SSL/TLS**: Cloudflare handles certificates on your custom domain (`https://mcp.yourdomain.com`).
- **Cloudflare Zero Trust Access**: Easily gate the MCP server with service tokens, API keys, or team SSO.

### Step-by-Step Setup:

1. **Create a Cloudflare Tunnel**:
   - Go to [Cloudflare One Dashboard](https://one.dash.cloudflare.com/) -> **Networks** -> **Tunnels**.
   - Click **Add a Tunnel** -> choose **Cloudflared**.
   - Name your tunnel (e.g. `mnesia-mcp`).
   - Copy the provided `TUNNEL_TOKEN`.

2. **Configure Public Hostname in Cloudflare**:
   - In the Tunnel settings, add a Public Hostname:
     - Subdomain: `mcp` (or your preferred subdomain)
     - Domain: `yourdomain.com`
     - Service Type: `HTTP`
     - URL: `mnesia-mcp:8000` (matches the Docker container name)
   - Under **Additional application settings** -> **HTTP Settings**:
     - Enable **HTTP2** / **Chunked transfer encoding** (required for SSE).

3. **Deploy on Hetzner / VPS via Docker Compose**:
   ```bash
   git clone <your-repo> /opt/mnesia
   cd /opt/mnesia

   # Create your production .env
   cp .env.example .env
   nano .env
   ```
   Add your `CLOUDFLARE_TUNNEL_TOKEN` to `.env`:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-supabase-service-key
   OPENAI_API_KEY=sk-...
   CLOUDFLARE_TUNNEL_TOKEN=eyJh...
   ```

4. **Launch both the MCP Server and Tunnel**:
   ```bash
   docker compose --profile cloudflare up -d --build
   ```

5. **Connect Your Agents**:
   Your agents now connect over HTTPS SSE at:
   ```
   https://mcp.yourdomain.com/sse
   ```

---

## ⚡ Approach 2: Serverless Containers (Cloud Run / Fly.io)

If you don't want to maintain a VPS or patch an OS, use a serverless container platform that natively supports Server-Sent Events (SSE).

### A. Google Cloud Run (Scale-to-Zero, Pay-per-Request)
Google Cloud Run can scale completely to zero instances when idle, meaning it costs virtually $0 when agents aren't actively calling it.

1. **Install & Authenticate Google Cloud SDK**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_GCP_PROJECT_ID
   ```

2. **Deploy directly from the local directory**:
   ```bash
   gcloud run deploy mnesia-mcp \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars SUPABASE_URL="https://...",SUPABASE_KEY="...",OPENAI_API_KEY="sk-..." \
     --port 8000
   ```
3. Cloud Run provides an instant HTTPS URL with streaming support:
   ```
   https://mnesia-mcp-xyz-uc.a.run.app/sse
   ```

---

### B. Fly.io (Global Edge Containers)
Fly.io runs Docker containers near your users/agents with native persistent SSE connections.

1. **Install Fly CLI and Login**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```

2. **Launch Application**:
   ```bash
   fly launch --no-deploy
   ```

3. **Set Secrets and Deploy**:
   ```bash
   fly secrets set \
     SUPABASE_URL="https://your-project.supabase.co" \
     SUPABASE_KEY="your-key" \
     OPENAI_API_KEY="sk-..."

   fly deploy
   ```
   Accessible at `https://your-app-name.fly.dev/sse`.

---

## 🌐 Approach 3: What About Cloudflare Workers?

### Why Not Run FastMCP Directly Inside Cloudflare Workers?
- **Runtime Differences**: FastMCP is written in Python and uses `uvicorn`, `asyncio`, and persistent HTTP/SSE sockets.
- Cloudflare Workers is a JavaScript/V8 edge runtime. While Cloudflare offers experimental Python support via Pyodide (Wasm), Pyodide does not yet support the long-running socket servers and C-extensions used by FastMCP/uvicorn.

### The Cloudflare Workers Solution: Edge Auth Gateway
You can put a lightweight Cloudflare Worker in front of your Hetzner or Cloud Run container to act as an **Edge Authentication & Rate-Limiting Gateway**:

```javascript
// Cloudflare Worker: auth-gateway.js
export default {
  async fetch(request, env) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${env.AGENT_SECRET_TOKEN}`) {
      return new Response("Unauthorized Agent", { status: 401 });
    }

    // Forward request to your backend MCP server
    const backendUrl = new URL(request.url);
    backendUrl.hostname = "backend-mcp.yourdomain.com";

    return fetch(backendUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  }
};
```

---

## 🔒 Security Best Practices for Remote MCP

1. **Supabase Service Key Protection**:
   - Never expose your `service_role` key in public client configs. Keep it strictly inside the MCP container environment.
2. **Cloudflare Zero Trust / Service Tokens**:
   - If using Cloudflare Tunnel, navigate to **Cloudflare Zero Trust** -> **Access** -> **Applications**.
   - Create an Access Rule requiring a **Service Token** (Client ID + Client Secret headers) so only authorized agents can communicate with `/sse`.
3. **Session Scoping**:
   - Instruct agents to provide unique `session_id`s to avoid cross-project contamination unless intentionally querying shared facts.
