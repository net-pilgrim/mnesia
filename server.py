"""FastMCP Memory Server with Supabase Backend for Multi-Agent Collaboration.

This server enables multiple AI agents to store, search, and share memories
persistently across sessions using Supabase with pgvector similarity search
and PostgreSQL full-text search fallback.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from fastmcp import FastMCP
from memory_store import memory_store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mnesia-memory-server")

# Initialize FastMCP Server
mcp = FastMCP(
    name="MnesiaMemorySystem",
    instructions="A multi-agent shared memory system backed by Supabase with pgvector and semantic search.",
)


# ==============================================================================
# MCP Tools
# ==============================================================================


@mcp.tool()
def store_memory(
    content: str,
    agent_id: str = "default_agent",
    category: str = "general",
    tags: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Store a new memory in Supabase.
    
    Use this to persist facts, user preferences, architectural decisions,
    code patterns, agent reflections, or task states. Other agents can search
    and recall these memories.

    Args:
        content: The factual information, knowledge, or decision to store.
        agent_id: Identifier of the agent creating the memory (e.g. 'researcher', 'coder').
        category: Memory category ('fact', 'decision', 'preference', 'instruction', 'reflection', 'summary', 'general').
        tags: Optional list of keyword tags for categorization (e.g. ['database', 'auth', 'frontend']).
        session_id: Optional session/workflow/task ID to scope memories.
        metadata: Optional dictionary of additional context (confidence, source file, timestamp, etc.).
    """
    try:
        record = memory_store.store_memory(
            content=content,
            agent_id=agent_id,
            category=category,
            tags=tags or [],
            session_id=session_id,
            metadata=metadata or {},
        )
        return {
            "success": True,
            "message": "Memory stored successfully.",
            "memory": record,
        }
    except Exception as e:
        logger.error("Error storing memory: %s", e)
        return {"success": False, "error": str(e)}


@mcp.tool()
def search_memories(
    query: str,
    agent_id: Optional[str] = None,
    session_id: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    limit: int = 10,
    match_threshold: float = 0.2,
) -> Dict[str, Any]:
    """Search memories using semantic similarity (pgvector) or full-text search.

    Queries across all agents by default, allowing agents to benefit from knowledge
    discovered by peer agents.

    Args:
        query: The semantic search query or keywords to look for.
        agent_id: Optional filter by specific agent ID. Leave None to search across all agents.
        session_id: Optional filter by specific session/workflow ID.
        category: Optional filter by category (e.g. 'decision', 'fact').
        tags: Optional filter by one or more tags.
        limit: Maximum number of memories to return (default: 10).
        match_threshold: Minimum cosine similarity score 0.0 - 1.0 (default: 0.2).
    """
    try:
        results = memory_store.search_memories(
            query=query,
            agent_id=agent_id,
            session_id=session_id,
            category=category,
            tags=tags,
            limit=limit,
            match_threshold=match_threshold,
        )
        return {
            "success": True,
            "count": len(results),
            "memories": results,
        }
    except Exception as e:
        logger.error("Error searching memories: %s", e)
        return {"success": False, "error": str(e), "memories": []}


@mcp.tool()
def recall_shared_memories(
    query: str,
    current_agent_id: Optional[str] = None,
    exclude_self: bool = False,
    session_id: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    limit: int = 10,
) -> Dict[str, Any]:
    """Recall memories discovered or recorded by other agents in the multi-agent team.

    Use this when starting a new subtask to check if another agent (e.g., researcher, planner,
    verifier) has already found relevant documentation, architecture rules, or decisions.

    Args:
        query: What knowledge or context you are looking for.
        current_agent_id: The ID of the currently acting agent.
        exclude_self: If True, filters out memories authored by current_agent_id to see only peers' findings.
        session_id: Optional filter for the current session/task.
        category: Optional category filter.
        tags: Optional tags filter.
        limit: Maximum number of memories to return (default: 10).
    """
    try:
        results = memory_store.recall_shared_memories(
            query=query,
            current_agent_id=current_agent_id,
            exclude_self=exclude_self,
            session_id=session_id,
            category=category,
            tags=tags,
            limit=limit,
        )
        return {
            "success": True,
            "count": len(results),
            "memories": results,
        }
    except Exception as e:
        logger.error("Error recalling shared memories: %s", e)
        return {"success": False, "error": str(e), "memories": []}


@mcp.tool()
def list_memories(
    agent_id: Optional[str] = None,
    session_id: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """List recent memories in Supabase with optional filters and pagination.

    Args:
        agent_id: Optional filter by authoring agent ID.
        session_id: Optional filter by session/workflow ID.
        category: Optional filter by category.
        limit: Number of memories to return (default: 20).
        offset: Pagination offset (default: 0).
    """
    try:
        results = memory_store.list_memories(
            agent_id=agent_id,
            session_id=session_id,
            category=category,
            limit=limit,
            offset=offset,
        )
        return {
            "success": True,
            "count": len(results),
            "memories": results,
        }
    except Exception as e:
        logger.error("Error listing memories: %s", e)
        return {"success": False, "error": str(e), "memories": []}


@mcp.tool()
def get_memory(memory_id: str) -> Dict[str, Any]:
    """Retrieve a single memory by its unique UUID.

    Args:
        memory_id: The UUID of the memory item.
    """
    try:
        record = memory_store.get_memory(memory_id)
        if not record:
            return {"success": False, "error": f"Memory {memory_id} not found."}
        return {"success": True, "memory": record}
    except Exception as e:
        logger.error("Error retrieving memory: %s", e)
        return {"success": False, "error": str(e)}


@mcp.tool()
def update_memory(
    memory_id: str,
    content: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update an existing memory item. If content changes, vector embeddings are recalculated.

    Args:
        memory_id: The UUID of the memory to update.
        content: New content for the memory (optional).
        category: New category (optional).
        tags: New list of tags (optional).
        metadata: New metadata dictionary (optional).
    """
    try:
        updated = memory_store.update_memory(
            memory_id=memory_id,
            content=content,
            category=category,
            tags=tags,
            metadata=metadata,
        )
        if not updated:
            return {"success": False, "error": f"Failed to update memory {memory_id}."}
        return {"success": True, "memory": updated}
    except Exception as e:
        logger.error("Error updating memory: %s", e)
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_memory(memory_id: str) -> Dict[str, Any]:
    """Permanently delete a memory by its UUID.

    Args:
        memory_id: The UUID of the memory to delete.
    """
    try:
        success = memory_store.delete_memory(memory_id)
        return {"success": success, "message": f"Memory {memory_id} deleted." if success else "Not found."}
    except Exception as e:
        logger.error("Error deleting memory: %s", e)
        return {"success": False, "error": str(e)}


@mcp.tool()
def clear_session_memories(session_id: str) -> Dict[str, Any]:
    """Delete all memories associated with a specific session ID.

    Args:
        session_id: The session ID whose memories should be wiped.
    """
    try:
        deleted_count = memory_store.clear_session(session_id)
        return {
            "success": True,
            "session_id": session_id,
            "deleted_count": deleted_count,
            "message": f"Cleared {deleted_count} memories from session {session_id}.",
        }
    except Exception as e:
        logger.error("Error clearing session memories: %s", e)
        return {"success": False, "error": str(e)}


# ==============================================================================
# Skill Management Tools (Exposing & Publishing Skills via MCP)
# ==============================================================================


@mcp.tool()
def list_skills(tag: Optional[str] = None) -> Dict[str, Any]:
    """List all available agent skills exposed by this MCP server.

    Skills are standardized operational runbooks and procedural guides that
    teach agents specific multi-step workflows (e.g., handover, memory curation,
    conflict resolution).

    Args:
        tag: Optional filter by tag (e.g. 'collaboration', 'curation', 'handover').
    """
    try:
        skills = memory_store.list_skills(tag=tag)
        summary = [
            {
                "name": s["name"],
                "description": s["description"],
                "tags": s.get("tags", []),
                "author_agent": s.get("author_agent", "system"),
            }
            for s in skills
        ]
        return {"success": True, "count": len(summary), "skills": summary}
    except Exception as e:
        logger.error("Error listing skills: %s", e)
        return {"success": False, "error": str(e), "skills": []}


@mcp.tool()
def get_skill(name: str) -> Dict[str, Any]:
    """Retrieve the full instructions and runbook for a specific skill by name.

    Args:
        name: The unique skill name (e.g., 'agent-handover', 'memory-consolidation').
    """
    try:
        skill = memory_store.get_skill(name)
        if not skill:
            return {"success": False, "error": f"Skill '{name}' not found."}
        return {"success": True, "skill": skill}
    except Exception as e:
        logger.error("Error getting skill '%s': %s", name, e)
        return {"success": False, "error": str(e)}


@mcp.tool()
def publish_skill(
    name: str,
    description: str,
    instructions: str,
    tags: Optional[List[str]] = None,
    author_agent: str = "agent",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Publish a new skill or procedure to Supabase for all other agents to discover and execute.

    Use this when an agent learns a novel solution, complex debugging workflow,
    or tool recipe that should become a reusable team skill.

    Args:
        name: Unique slug identifier for the skill (e.g., 'deploy-edge-function').
        description: Brief 1-2 sentence description of when and why to use the skill.
        instructions: Markdown documentation detailing the step-by-step procedure.
        tags: Categorization tags (e.g., ['deployment', 'infra']).
        author_agent: The name/ID of the agent publishing this skill.
        metadata: Optional dictionary with extra context (version, prerequisites).
    """
    try:
        record = memory_store.create_or_update_skill(
            name=name,
            description=description,
            instructions=instructions,
            tags=tags or [],
            author_agent=author_agent,
            metadata=metadata or {},
        )
        return {
            "success": True,
            "message": f"Skill '{name}' published successfully.",
            "skill": record,
        }
    except Exception as e:
        logger.error("Error publishing skill: %s", e)
        return {"success": False, "error": str(e)}



# ==============================================================================
# MCP Resources
# ==============================================================================


@mcp.resource("memory://agents")
def get_agents_resource() -> str:
    """List of all unique agent IDs that have stored memories in the system."""
    try:
        agents = memory_store.list_agents()
        return json.dumps({"agents": agents}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.resource("memory://recent")
def get_recent_memories_resource() -> str:
    """The 20 most recent memories across all agents."""
    try:
        recent = memory_store.list_memories(limit=20)
        return json.dumps({"memories": recent}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.resource("memory://agent/{agent_id}")
def get_agent_memories_resource(agent_id: str) -> str:
    """Memories authored by a specific agent."""
    try:
        agent_memories = memory_store.list_memories(agent_id=agent_id, limit=50)
        return json.dumps({"agent_id": agent_id, "memories": agent_memories}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.resource("skill://catalog")
def get_skills_catalog_resource() -> str:
    """Catalog of all skills exposed by this MCP server."""
    try:
        skills = memory_store.list_skills()
        return json.dumps({"skills": skills}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.resource("skill://{skill_name}")
def get_skill_resource(skill_name: str) -> str:
    """Detailed procedural instructions and runbook for a requested skill."""
    try:
        skill = memory_store.get_skill(skill_name)
        if not skill:
            return f"# Skill '{skill_name}' not found."
        tags_str = ", ".join(skill.get("tags", []))
        return f"# Skill: {skill['name']}\n**Description:** {skill['description']}\n**Tags:** {tags_str}\n\n{skill['instructions']}"
    except Exception as e:
        return f"# Error loading skill '{skill_name}': {e}"


# ==============================================================================
# MCP Prompts
# ==============================================================================


@mcp.prompt()
def execute_skill(skill_name: str, context: Optional[str] = None) -> str:
    """Execute a standardized team skill with specific task context."""
    skill = memory_store.get_skill(skill_name)
    if not skill:
        available = [s["name"] for s in memory_store.list_skills()]
        return f"Error: Skill '{skill_name}' is not registered. Available skills: {', '.join(available)}"

    ctx_str = f"\nTask Context:\n{context}\n" if context else ""
    return f"""## Skill Execution: {skill['name']}
{skill['description']}
{ctx_str}
### Instructions to follow:
{skill['instructions']}
"""



@mcp.prompt()
def agent_handover(task_description: str, session_id: Optional[str] = None) -> str:
    """Generate a prompt summarizing shared memories and decisions for agent handover."""
    try:
        memories = memory_store.search_memories(
            query=task_description,
            session_id=session_id,
            limit=8,
        )
        formatted_memories = "\n".join(
            [f"- [{m.get('agent_id', 'unknown')} | {m.get('category', 'fact')}] {m.get('content')}" for m in memories]
        )
    except Exception:
        formatted_memories = "No existing memories retrieved."

    return f"""You are taking over or continuing work on the following task:
"{task_description}"

Here is the accumulated knowledge and previous decisions recorded by peer agents:
{formatted_memories}

Instructions:
1. Review the existing decisions and discoveries above before taking action.
2. Build upon the work of peer agents rather than repeating it.
3. Record any new key decisions or discoveries using the `store_memory` tool so subsequent agents can reference them.
"""


@mcp.prompt()
def cross_agent_context(query: str, agent_role: str, session_id: Optional[str] = None) -> str:
    """Inject relevant cross-agent knowledge into an agent's reasoning loop."""
    try:
        memories = memory_store.search_memories(
            query=query,
            session_id=session_id,
            limit=6,
        )
        memories_text = "\n".join(
            [f"• [{m.get('agent_id')} - {m.get('category')}]: {m.get('content')}" for m in memories]
        )
    except Exception:
        memories_text = "None available."

    return f"""You are acting in the role of: {agent_role}
Current objective: {query}

Relevant shared memories from the team:
{memories_text}

Use these shared insights to guide your next actions.
"""


# ==============================================================================
# Entry Point
# ==============================================================================

if __name__ == "__main__":
    import os
    transport = os.getenv("MCP_TRANSPORT", "stdio").lower()
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8000"))

    if transport in ("sse", "http"):
        logger.info("Starting FastMCP server with transport=%s on %s:%s", transport, host, port)
        mcp.run(transport=transport, host=host, port=port)
    else:
        mcp.run()
