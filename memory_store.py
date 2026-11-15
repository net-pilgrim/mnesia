"""Supabase Memory Store for multi-agent memory operations."""

import logging
from typing import Any, Dict, List, Optional
from supabase import create_client, Client
from config import settings
from embeddings import generate_embedding

logger = logging.getLogger(__name__)


class MemoryStore:
    def __init__(self):
        self._client: Optional[Client] = None

    @property
    def client(self) -> Client:
        if self._client is None:
            if not settings.supabase_url or not settings.supabase_key:
                raise ValueError(
                    "SUPABASE_URL and SUPABASE_KEY must be configured in environment or .env file."
                )
            self._client = create_client(settings.supabase_url, settings.supabase_key)
        return self._client

    def store_memory(
        self,
        content: str,
        agent_id: Optional[str] = None,
        category: str = "general",
        tags: Optional[List[str]] = None,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Store a new memory item in Supabase with optional vector embedding."""
        tags = tags or []
        metadata = metadata or {}
        agent_id = agent_id or settings.default_agent_id

        # Generate embedding if enabled
        embedding = generate_embedding(content)

        payload = {
            "agent_id": agent_id,
            "session_id": session_id,
            "category": category,
            "content": content,
            "tags": tags,
            "metadata": metadata,
        }
        if embedding is not None:
            payload["embedding"] = embedding

        response = self.client.table("memories").insert(payload).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]
        return {}

    def search_memories(
        self,
        query: str,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10,
        match_threshold: float = 0.2,
    ) -> List[Dict[str, Any]]:
        """Search memories using vector similarity (pgvector) or fallback to text search."""
        query_embedding = generate_embedding(query)

        if query_embedding is not None:
            try:
                rpc_params = {
                    "query_embedding": query_embedding,
                    "match_threshold": match_threshold,
                    "match_count": limit,
                    "filter_agent_id": agent_id,
                    "filter_session_id": session_id,
                    "filter_category": category,
                    "filter_tags": tags,
                }
                res = self.client.rpc("match_memories", rpc_params).execute()
                if res.data:
                    return res.data
            except Exception as e:
                logger.warning("Vector search RPC failed, falling back to text search: %s", e)

        # Fallback to full-text / ILIKE search RPC
        try:
            rpc_params = {
                "query_text": query,
                "match_count": limit,
                "filter_agent_id": agent_id,
                "filter_session_id": session_id,
                "filter_category": category,
                "filter_tags": tags,
            }
            res = self.client.rpc("search_memories_text", rpc_params).execute()
            return res.data or []
        except Exception as e:
            logger.warning("Text search RPC failed, querying table directly: %s", e)

        # Basic fallback directly on the table
        query_builder = self.client.table("memories").select(
            "id, created_at, updated_at, agent_id, session_id, category, content, tags, metadata"
        )
        if agent_id:
            query_builder = query_builder.eq("agent_id", agent_id)
        if session_id:
            query_builder = query_builder.eq("session_id", session_id)
        if category:
            query_builder = query_builder.eq("category", category)
        if query:
            query_builder = query_builder.ilike("content", f"%{query}%")

        res = query_builder.order("created_at", desc=True).limit(limit).execute()
        return res.data or []

    def recall_shared_memories(
        self,
        query: str,
        current_agent_id: Optional[str] = None,
        exclude_self: bool = False,
        session_id: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Recall memories across agents to facilitate multi-agent collaboration."""
        results = self.search_memories(
            query=query,
            agent_id=None,  # query across all agents
            session_id=session_id,
            category=category,
            tags=tags,
            limit=limit,
        )

        if exclude_self and current_agent_id:
            results = [m for m in results if m.get("agent_id") != current_agent_id]

        return results

    def list_memories(
        self,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List memories with optional filtering and pagination."""
        builder = self.client.table("memories").select(
            "id, created_at, updated_at, agent_id, session_id, category, content, tags, metadata"
        )
        if agent_id:
            builder = builder.eq("agent_id", agent_id)
        if session_id:
            builder = builder.eq("session_id", session_id)
        if category:
            builder = builder.eq("category", category)

        res = builder.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return res.data or []

    def get_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific memory by its ID."""
        res = self.client.table("memories").select(
            "id, created_at, updated_at, agent_id, session_id, category, content, tags, metadata"
        ).eq("id", memory_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def update_memory(
        self,
        memory_id: str,
        content: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update an existing memory item."""
        updates: Dict[str, Any] = {}
        if content is not None:
            updates["content"] = content
            embedding = generate_embedding(content)
            if embedding is not None:
                updates["embedding"] = embedding
        if category is not None:
            updates["category"] = category
        if tags is not None:
            updates["tags"] = tags
        if metadata is not None:
            updates["metadata"] = metadata

        if not updates:
            return self.get_memory(memory_id)

        res = self.client.table("memories").update(updates).eq("id", memory_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def delete_memory(self, memory_id: str) -> bool:
        """Delete a memory item by ID."""
        res = self.client.table("memories").delete().eq("id", memory_id).execute()
        return bool(res.data and len(res.data) > 0)

    def clear_session(self, session_id: str) -> int:
        """Delete all memories in a given session."""
        res = self.client.table("memories").delete().eq("session_id", session_id).execute()
        return len(res.data) if res.data else 0

    def list_agents(self) -> List[str]:
        """Return a list of all distinct agent IDs that have stored memories."""
        res = self.client.table("memories").select("agent_id").execute()
        if not res.data:
            return []
        agents = sorted(list({row["agent_id"] for row in res.data if row.get("agent_id")}))
        return agents

    # ==============================================================================
    # Skills Management
    # ==============================================================================

    BUILTIN_SKILLS: Dict[str, Dict[str, Any]] = {
        "agent-handover": {
            "name": "agent-handover",
            "description": "Protocol for passing context, decisions, and constraints between agents.",
            "tags": ["collaboration", "handover", "orchestration"],
            "author_agent": "system",
            "instructions": """## Agent Handover Skill
Follow this workflow when passing a task to another agent:
1. **Summarize**: Call `store_memory` with `category='summary'` to record key achievements and open questions.
2. **Tag & Scope**: Ensure the `session_id` and tags (e.g. `['handover', '<component>']`) are set.
3. **Receive**: The next agent calls `recall_shared_memories(query=..., session_id=..., exclude_self=True)` prior to executing tools.
4. **Build, Don't Repeat**: Adhere to documented architectural decisions already stored in memory.""",
        },
        "memory-consolidation": {
            "name": "memory-consolidation",
            "description": "Synthesizes fragmented scratchpad memories into clean, long-term architectural knowledge.",
            "tags": ["curation", "cleanup", "synthesis"],
            "author_agent": "system",
            "instructions": """## Memory Consolidation Skill
Use this workflow to compress and curate accumulated session memories:
1. **Fetch**: Retrieve all recent session memories using `list_memories(session_id=..., limit=50)`.
2. **Deduplicate**: Identify repeated facts, transient errors, and superseded temporary notes.
3. **Synthesize**: Call `store_memory` with `category='decision'` or `'fact'` containing the unified knowledge.
4. **Prune**: Use `delete_memory` or `clear_session_memories` to remove obsolete scratchpads.""",
        },
        "conflict-resolution": {
            "name": "conflict-resolution",
            "description": "Detects and reconciles contradictory memories or decisions between peer agents.",
            "tags": ["validation", "consistency", "consensus"],
            "author_agent": "system",
            "instructions": """## Conflict Resolution Skill
When multiple agents record conflicting assertions:
1. **Search**: Run `search_memories(query=topic)` to retrieve conflicting records.
2. **Compare**: Examine timestamps (`created_at`) and `metadata.confidence` to see which is newer or higher priority.
3. **Reconcile**: Store a new consensus record with `category='decision'` explaining the resolution.
4. **Deprecate**: Call `update_memory` on outdated records to set `metadata.status='deprecated'`.""",
        },
    }

    def list_skills(self, tag: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all available skills (built-in + Supabase custom skills)."""
        skills = dict(self.BUILTIN_SKILLS)
        try:
            builder = self.client.table("skills").select("*")
            res = builder.order("name").execute()
            if res.data:
                for row in res.data:
                    skills[row["name"]] = row
        except Exception as e:
            logger.debug("Could not query skills table (using built-in skills): %s", e)

        results = list(skills.values())
        if tag:
            results = [s for s in results if tag in s.get("tags", [])]
        return results

    def get_skill(self, name: str) -> Optional[Dict[str, Any]]:
        """Retrieve a specific skill by name."""
        try:
            res = self.client.table("skills").select("*").eq("name", name).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
        except Exception:
            pass
        return self.BUILTIN_SKILLS.get(name)

    def create_or_update_skill(
        self,
        name: str,
        description: str,
        instructions: str,
        tags: Optional[List[str]] = None,
        author_agent: str = "system",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Save a new skill or update an existing skill in Supabase."""
        payload = {
            "name": name,
            "description": description,
            "instructions": instructions,
            "tags": tags or [],
            "author_agent": author_agent,
            "metadata": metadata or {},
        }
        try:
            res = self.client.table("skills").upsert(payload, on_conflict="name").execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
        except Exception as e:
            logger.debug("Could not upsert skill to Supabase (saving in local fallback): %s", e)

        # Fallback to local memory if offline
        self.BUILTIN_SKILLS[name] = payload
        return payload

    def delete_skill(self, name: str) -> bool:
        """Delete a custom skill from Supabase."""
        if name in self.BUILTIN_SKILLS:
            # Cannot delete core built-ins, but can remove from local dict
            del self.BUILTIN_SKILLS[name]
        try:
            res = self.client.table("skills").delete().eq("name", name).execute()
            return bool(res.data and len(res.data) > 0)
        except Exception:
            return True


# Singleton instance
memory_store = MemoryStore()
