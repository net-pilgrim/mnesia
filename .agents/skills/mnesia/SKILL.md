---
name: mnesia
description: >-
  Guide and best practices for storing, querying, and sharing persistent memories and skills
  across multi-agent fleets using the Mnesia Supabase Edge MCP Memory System.
---

# Mnesia: Multi-Agent Shared Memory & Skills System

This skill instructs agents on how to leverage the Supabase Edge MCP Memory server (`MnesiaMemorySystem`) to coordinate with other agents, persist critical discoveries, avoid duplicate work, and share skills across sessions.

---

## 🎯 When to Call Memory Tools

Agent Action | Appropriate MCP Tool | Example Category
:--- | :--- | :---
**Starting a subtask** | `recall_shared_memories(query=...)` | -
**Discovering an environment/code fact** | `store_memory(content=..., category='fact')` | `fact`
**Making a design/architecture choice** | `store_memory(content=..., category='decision')` | `decision`
**Recording user constraints/instructions** | `store_memory(content=..., category='preference')` | `preference`
**Finishing a task & preparing handover** | `store_memory(content=..., category='summary')` | `summary`
**Learning a reusable procedural workflow** | `publish_skill(name=..., instructions=...)` | -

---

## 🔄 Core Workflows

### 1. Pre-Task Reconnaissance (Peer Memory Recall)
Before inspecting files or writing code, check if a peer agent has already investigated the topic:

```python
# Query shared knowledge (excluding memories authored by yourself)
results = recall_shared_memories(
    query="authentication tokens storage AES",
    current_agent_id="coder_agent",
    exclude_self=True,
    session_id="project_alpha"
)
```

### 2. Storing High-Value Findings
Do **not** flood the memory store with raw terminal dumps or trivial logs. Only persist:
- High-level architectural decisions
- Non-obvious bug root causes
- Port, configuration, or environment constants
- Verified user requirements

```python
store_memory(
    content="Production database requires SSL mode verify-full with custom CA at /etc/ssl/certs/supabase.crt",
    agent_id="infra_agent",
    category="fact",
    tags=["database", "ssl", "postgres"],
    session_id="project_alpha",
    metadata={"verified": True, "ticket": "INFRA-42"}
)
```

### 3. Executing or Publishing a Team Skill
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

---

## 📌 Memory Categories Taxonomy

- `fact`: Concrete truths about the codebase, system, or infrastructure.
- `decision`: Explicit architectural, technical, or design choices agreed upon.
- `preference`: User-specified constraints, style preferences, or guidelines.
- `instruction`: Ongoing commands or prompt directives.
- `reflection`: Retrospective notes on what worked or what failed during a task.
- `summary`: Milestone or session handover overview.
