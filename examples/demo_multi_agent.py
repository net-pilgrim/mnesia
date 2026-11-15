"""Multi-Agent Memory Sharing Demo (Simulated Agents).

This script demonstrates two agents (ResearcherAgent and CoderAgent) collaborating
on a software task by storing and recalling shared memories.

If live Supabase credentials are not configured in .env, this demo runs in
mock/dry-run mode so you can see the multi-agent exchange in action immediately.
"""

import os
import sys
from typing import Dict, Any, List

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import settings

LIVE_MODE = bool(settings.supabase_url and settings.supabase_key)


class MockMemoryStore:
    """In-memory fallback for local demo when Supabase credentials are not set."""
    def __init__(self):
        self.memories = []

    def store_memory(self, content: str, agent_id: str, category: str, tags: List[str] = None, session_id: str = None, metadata: Dict[str, Any] = None):
        import uuid
        from datetime import datetime, timezone
        rec = {
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "agent_id": agent_id,
            "session_id": session_id,
            "category": category,
            "content": content,
            "tags": tags or [],
            "metadata": metadata or {},
        }
        self.memories.append(rec)
        return rec

    def search_memories(self, query: str, agent_id: str = None, session_id: str = None, category: str = None, tags: List[str] = None, limit: int = 10, match_threshold: float = 0.2):
        q = query.lower()
        results = []
        for m in self.memories:
            if agent_id and m["agent_id"] != agent_id:
                continue
            if session_id and m["session_id"] != session_id:
                continue
            if category and m["category"] != category:
                continue
            # Simple keyword match
            if q in m["content"].lower() or any(q in t.lower() for t in m["tags"]):
                results.append(m)
        return results[:limit]

    def recall_shared_memories(self, query: str, current_agent_id: str = None, exclude_self: bool = False, session_id: str = None, category: str = None, tags: List[str] = None, limit: int = 10):
        results = self.search_memories(query=query, agent_id=None, session_id=session_id, category=category, tags=tags, limit=limit)
        if exclude_self and current_agent_id:
            results = [m for m in results if m["agent_id"] != current_agent_id]
        return results


def run_demo():
    print("=" * 70)
    print("   FAST-MCP + SUPABASE MULTI-AGENT MEMORY SYSTEM DEMO")
    print("=" * 70)

    if LIVE_MODE:
        print("Connected to LIVE Supabase instance:", settings.supabase_url)
        from memory_store import memory_store
        store = memory_store
    else:
        print("[Notice] SUPABASE_URL / SUPABASE_KEY not set in .env.")
        print("[Notice] Running with local mock store to demonstrate multi-agent handover.\n")
        store = MockMemoryStore()

    session_id = "session_project_x_2026"

    # Step 1: Agent 1 (ResearcherAgent) performs research and persists findings
    print("🤖 Agent 1: ResearcherAgent starts investigation...")
    
    m1 = store.store_memory(
        content="The target system uses PostgreSQL 16 with pgvector extension enabled. Port is 5432.",
        agent_id="researcher_agent",
        category="fact",
        tags=["database", "postgres", "infra"],
        session_id=session_id,
        metadata={"confidence": 0.98, "source": "infra-manifest.yaml"},
    )
    print(f"  [Researcher] Stored fact: {m1['content']}")

    m2 = store.store_memory(
        content="Decision: We must use AES-256-GCM encryption for storing OAuth tokens in the tokens table.",
        agent_id="researcher_agent",
        category="decision",
        tags=["security", "oauth", "crypto"],
        session_id=session_id,
        metadata={"decided_by": "sec-team-review", "ticket": "SEC-104"},
    )
    print(f"  [Researcher] Stored decision: {m2['content']}")

    print("\n" + "-" * 70 + "\n")

    # Step 2: Agent 2 (CoderAgent) comes online to implement a feature
    print("🤖 Agent 2: CoderAgent is assigned to implement OAuth token storage.")
    print("  [Coder] Calling `recall_shared_memories` for 'OAuth tokens encryption'...")

    shared = store.recall_shared_memories(
        query="OAuth",
        current_agent_id="coder_agent",
        exclude_self=True,
        session_id=session_id,
    )

    print(f"  [Coder] Found {len(shared)} relevant peer memories:")
    for sm in shared:
        print(f"    - From [{sm['agent_id']}] ({sm['category']}): {sm['content']}")
        print(f"      Tags: {sm['tags']} | Metadata: {sm['metadata']}")

    # Step 3: CoderAgent uses the shared context to complete the task and logs an implementation record
    print("\n  [Coder] Adhering to the decision found in memory!")
    m3 = store.store_memory(
        content="Implemented TokenVault class using cryptography.hazmat AES-256-GCM with PBKDF2 key derivation.",
        agent_id="coder_agent",
        category="implementation",
        tags=["crypto", "oauth", "python"],
        session_id=session_id,
        metadata={"file": "src/security/token_vault.py", "tests_passing": True},
    )
    print(f"  [Coder] Stored implementation memory: {m3['content']}")

    print("\n" + "-" * 70 + "\n")

    # Step 4: Agent 3 (ReviewerAgent / Orchestrator) inspects session memories
    print("🤖 Agent 3: ReviewerAgent inspects all memories created in this session:")
    all_session = store.search_memories(query="", session_id=session_id, limit=10)
    for idx, memory in enumerate(all_session, 1):
        print(f"  {idx}. [{memory['agent_id']} | {memory['category']}] {memory['content']}")

    print("\n" + "=" * 70)
    print("Demo completed successfully! Memory was shared across agents without cross-talk.")
    print("=" * 70)


if __name__ == "__main__":
    run_demo()
