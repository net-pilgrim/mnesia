-- ==============================================================================
-- Supabase Schema for Multi-Agent MCP Memory System (Mnesia)
-- ==============================================================================

-- 1. Enable pgvector extension (for vector similarity search)
create extension if not exists vector;

-- 2. Create the memories table
create table if not exists public.memories (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    agent_id text not null,                       -- ID/Name of the agent that created/owns the memory
    session_id text,                              -- Optional session/workflow/conversation scope
    category text default 'general' not null,     -- e.g. 'fact', 'decision', 'preference', 'instruction', 'reflection', 'summary'
    content text not null,                         -- The memory content / knowledge snippet
    tags text[] default '{}'::text[] not null,    -- Tags for filtering and grouping
    metadata jsonb default '{}'::jsonb not null,  -- Arbitrary metadata (confidence, context, sources, etc.)
    embedding vector(768)                         -- Vector embedding (768 dimensions for Gemini gemini-embedding-001)
);

-- 3. Automatic timestamp updater trigger
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_memories_updated_at on public.memories;
create trigger set_memories_updated_at
    before update on public.memories
    for each row
    execute function update_updated_at_column();

-- 4. Indexes for high performance querying
create index if not exists idx_memories_agent_id on public.memories(agent_id);
create index if not exists idx_memories_session_id on public.memories(session_id);
create index if not exists idx_memories_category on public.memories(category);
create index if not exists idx_memories_created_at on public.memories(created_at desc);
create index if not exists idx_memories_tags on public.memories using gin(tags);
create index if not exists idx_memories_metadata on public.memories using gin(metadata);

-- Full-text search index on content
create index if not exists idx_memories_fts on public.memories using gin(to_tsvector('english', content));

-- HNSW Vector index on embedding (using cosine similarity)
create index if not exists idx_memories_embedding on public.memories 
    using hnsw (embedding vector_cosine_ops);

-- 5. RPC function: match_memories (Vector Semantic Search)
create or replace function match_memories (
    query_embedding vector(768),
    match_threshold float default 0.2,
    match_count int default 10,
    filter_agent_id text default null,
    filter_session_id text default null,
    filter_category text default null,
    filter_tags text[] default null
)
returns table (
    id uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    agent_id text,
    session_id text,
    category text,
    content text,
    tags text[],
    metadata jsonb,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        m.id,
        m.created_at,
        m.updated_at,
        m.agent_id,
        m.session_id,
        m.category,
        m.content,
        m.tags,
        m.metadata,
        1 - (m.embedding <=> query_embedding) as similarity
    from public.memories m
    where m.embedding is not null
      and (filter_agent_id is null or m.agent_id = filter_agent_id)
      and (filter_session_id is null or m.session_id = filter_session_id)
      and (filter_category is null or m.category = filter_category)
      and (filter_tags is null or m.tags && filter_tags)
      and (1 - (m.embedding <=> query_embedding)) >= match_threshold
    order by m.embedding <=> query_embedding asc
    limit match_count;
end;
$$;

-- 6. RPC function: search_memories_text (Full-Text & Keyword Search fallback)
create or replace function search_memories_text (
    query_text text,
    match_count int default 10,
    filter_agent_id text default null,
    filter_session_id text default null,
    filter_category text default null,
    filter_tags text[] default null
)
returns table (
    id uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    agent_id text,
    session_id text,
    category text,
    content text,
    tags text[],
    metadata jsonb,
    rank float
)
language plpgsql
as $$
begin
    return query
    select
        m.id,
        m.created_at,
        m.updated_at,
        m.agent_id,
        m.session_id,
        m.category,
        m.content,
        m.tags,
        m.metadata,
        ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', query_text))::float as rank
    from public.memories m
    where (filter_agent_id is null or m.agent_id = filter_agent_id)
      and (filter_session_id is null or m.session_id = filter_session_id)
      and (filter_category is null or m.category = filter_category)
      and (filter_tags is null or m.tags && filter_tags)
      and (
          query_text is null 
          or query_text = ''
          or to_tsvector('english', m.content) @@ plainto_tsquery('english', query_text)
          or m.content ilike '%' || query_text || '%'
      )
    order by rank desc, m.created_at desc
    limit match_count;
end;
$$;

-- 7. Row Level Security (RLS) - enabled by default; configure policies based on your auth model
alter table public.memories enable row level security;

-- Allow service role full access:
create policy "Allow service role full access" on public.memories
    for all
    to service_role
    using (true)
    with check (true);

-- Allow public read/write if using anon key in a trusted/local server environment:
create policy "Allow anon access for development" on public.memories
    for all
    to anon
    using (true)
    with check (true);

-- ==============================================================================
-- 8. Skills Table (Dynamic Skills Registry exposed via MCP)
-- ==============================================================================
create table if not exists public.skills (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name text unique not null,                     -- Unique identifier e.g. 'agent-handover'
    description text not null,                    -- Brief summary of what the skill does
    instructions text not null,                   -- Step-by-step instructions / runbook (Markdown)
    tags text[] default '{}'::text[] not null,    -- Tags for discovery
    author_agent text default 'system' not null,  -- Agent that created or published the skill
    metadata jsonb default '{}'::jsonb not null   -- Arbitrary metadata (version, examples, etc.)
);

drop trigger if exists set_skills_updated_at on public.skills;
create trigger set_skills_updated_at
    before update on public.skills
    for each row
    execute function update_updated_at_column();

create index if not exists idx_skills_name on public.skills(name);
create index if not exists idx_skills_tags on public.skills using gin(tags);

alter table public.skills enable row level security;
create policy "Allow service role full access on skills" on public.skills for all to service_role using (true) with check (true);
create policy "Allow anon access on skills" on public.skills for all to anon using (true) with check (true);

