---
name: mnesia
description: >-
  Guide and best practices for storing, querying, and sharing persistent memories,
  knowledge graphs, and skills across multi-agent fleets using the Mnesia Supabase Edge MCP Memory System.
---

# Mnesia: Multi-Agent Shared Memory, Knowledge Graph & Skills System

This skill instructs agents on how to leverage the Supabase Edge MCP Memory server (`MnesiaMemorySystem`) to coordinate with other agents, persist critical discoveries, ground knowledge graph entities and relations, avoid duplicate work, and share operational skills across sessions.

---

## 🎯 When to Call Memory & Graph Tools

Agent Action | Appropriate MCP Tool | Example Scope / Category
:--- | :--- | :---
**Starting a subtask** | `recall_shared_memories(query=...)` | Multi-agent coordination
**Exploring concepts & links** | `search_graph(query=..., max_depth=1)` | Knowledge graph traversal
**Inspecting an entity** | `get_entity(name=...)` | Inspect entity, edges & memories
**Discovering an environment/code fact** | `store_memory(content=..., category='fact', entities=[...], relations=[...])` | `fact`
**Making a design/architecture choice** | `store_memory(content=..., category='decision', entities=[...], relations=[...])` | `decision`
**Linking two known entities** | `link_entities(src=..., dst=..., predicate=...)` | Direct knowledge graph link
**Clearing obsolete graph links & dead entities** | `clear_obsolete_data(...)` | Knowledge base maintenance
**Deleting or deprecating memories** | `delete_memory(id=..., soft_delete=...)` | Targeted memory deletion
**Removing or invalidating graph links** | `delete_relation(src=..., dst=..., predicate=...)` | Directed link removal
**Updating or marking memory obsolete** | `update_memory(id=..., is_obsolete=True)` | In-place correction & obsolescence
**Recording user constraints/instructions** | `store_memory(content=..., category='preference')` | `preference`
**Finishing a task & preparing handover** | `store_memory(content=..., category='summary')` | `summary`
**Learning a reusable procedural workflow** | `publish_skill(name=..., instructions=...)` | Runbook publication

---

## 🔄 Core Workflows

### 1. Pre-Task Reconnaissance (Peer Memory Recall & Graph Exploration)
Before inspecting files or writing code, check if a peer agent has already investigated the topic:

```python
# 1. Query shared knowledge (excluding memories authored by yourself)
results = recall_shared_memories(
    query="authentication tokens storage AES",
    current_agent_id="coder_agent",
    exclude_self=True,
    session_id="project_alpha"
)

# 2. Explore related entities and architecture decisions in the knowledge graph
graph_info = search_graph(
    query="TokenVault",
    max_depth=1
)
```

### 2. Storing Grounded Findings with Knowledge Graph Entities & Relations
Do **not** flood the memory store with raw terminal dumps or trivial logs. Only persist high-value insights. When storing memories, **always supply `entities` and `relations`** when technical concepts or relationships are identified—this populates the knowledge graph with zero extra LLM overhead:

```python
store_memory(
    content="TokenVault requires AES-256-GCM encryption with PBKDF2 key derivation for OAuth tokens",
    agent_id="coder_agent",
    category="decision",
    tags=["security", "oauth", "crypto"],
    session_id="project_alpha",
    entities=[
        {"name": "TokenVault", "type": "component"},
        {"name": "AES-256-GCM", "type": "technology"},
        {"name": "OAuth", "type": "concept"}
    ],
    relations=[
        {"src": "TokenVault", "dst": "AES-256-GCM", "predicate": "uses"},
        {"src": "TokenVault", "dst": "OAuth", "predicate": "protects"}
    ],
    metadata={"verified": True, "ticket": "SEC-104"}
)
```

### 3. Knowledge Graph Entity Lookup & Direct Linking
To inspect an entity's outgoing/incoming relations or directly assert a relationship:

```python
# 1. Retrieve entity details and grounded memories
entity = get_entity(name="TokenVault")

# 2. Link entities directly (e.g. when establishing dependencies or superseding an architecture)
link_entities(
    src="ServiceAPI",
    dst="TokenVault",
    predicate="depends_on",
    invalidate_previous=False
)
```

### 4. Executing or Publishing a Team Skill
When an operational procedure must be executed consistently across agents:

```python
# 1. Fetch available skills
skills = list_skills()

# 2. Read full instructions
skill = get_skill(name="agent-handover")

# 3. Publish a new skill when a novel procedure is solved
publish_skill(
    name="deploy-supabase-migration",
    description="Run and verify schema migrations in Supabase using CLI",
    instructions="1. Run `supabase db push` ...",
    tags=["database", "devops"],
    author_agent="devops_agent"
)
```

### 5. Clearing Unused or Obsolete Memories & KG Links
When systems evolve, architectural choices change, or tasks complete, prune outdated links and memories to maintain high retrieval quality:

```python
# 1. Preview pruning of superseded links & orphaned entities (safe dry run)
preview = clear_obsolete_data(
    clear_invalidated_relations=True,
    clear_orphaned_entities=True,
    dry_run=True
)

# 2. Purge superseded KG links and dead entity nodes (valid_to <= now)
clear_obsolete_data(
    clear_invalidated_relations=True,
    clear_orphaned_entities=True
)

# 3. Prune obsolete memories from an old or temporary session
clear_obsolete_data(
    clear_memories=True,
    session_id="temp_investigation_session",
    obsolete_memories_only=False
)

# 4. Remove or invalidate a specific outdated knowledge graph link
delete_relation(
    src="ServiceAPI",
    dst="LegacyAuthService",
    predicate="depends_on",
    invalidate_only=True # Soft-invalidate (sets valid_to=now) or False to hard-delete
)

# 5. Delete specific obsolete memories or mark them obsolete
delete_memory(id="uuid-here", purge_orphaned_entities=True)

# or mark in-place as obsolete for deferred pruning
update_memory(id="uuid-here", is_obsolete=True)
```

---

## 📌 Memory Categories Taxonomy

- `fact`: Concrete truths about the codebase, system, or infrastructure.
- `decision`: Explicit architectural, technical, or design choices agreed upon.
- `preference`: User-specified constraints, style preferences, or guidelines.
- `instruction`: Ongoing commands or prompt directives.
- `reflection`: Retrospective notes on what worked or what failed during a task.
- `summary`: Milestone or session handover overview.
