exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.agents (
      id text primary key,
      owner_user_id text not null,
      name text not null,
      mode text not null check (mode in ('hosted_api_key', 'remote_endpoint', 'server_managed')),
      provider text not null,
      status text not null default 'active' check (status in ('active', 'paused', 'revoked', 'error', 'quarantined')),
      route_hint text,
      policy_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    CREATE INDEX IF NOT EXISTS idx_agents_owner_status_created
      ON public.agents (owner_user_id, status, created_at desc);

    CREATE TABLE IF NOT EXISTS public.agent_secrets (
      id bigserial primary key,
      agent_id text not null references public.agents(id) on delete cascade,
      payload text not null,
      fingerprint text not null,
      created_at timestamptz not null default timezone('utc', now()),
      rotated_at timestamptz
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_secrets_agent_id
      ON public.agent_secrets (agent_id);

    CREATE TABLE IF NOT EXISTS public.agent_endpoints (
      id bigserial primary key,
      agent_id text not null references public.agents(id) on delete cascade,
      base_url text not null,
      auth_mode text not null default 'none',
      auth_secret text,
      auth_secret_payload text,
      auth_secret_fingerprint text,
      timeout_ms integer not null default 2500,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_endpoints_agent_id
      ON public.agent_endpoints (agent_id);

    ALTER TABLE public.agent_endpoints
      ADD COLUMN IF NOT EXISTS auth_secret_payload text;

    ALTER TABLE public.agent_endpoints
      ADD COLUMN IF NOT EXISTS auth_secret_fingerprint text;

    CREATE TABLE IF NOT EXISTS public.agent_runs (
      id bigserial primary key,
      agent_id text not null references public.agents(id) on delete cascade,
      status text not null,
      error_code text,
      latency_ms integer,
      provider_mode text,
      provider_name text,
      estimated_input_tokens integer,
      estimated_output_tokens integer,
      count_towards_budget boolean not null default true,
      created_at timestamptz not null default timezone('utc', now())
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
      ON public.agent_runs (agent_id, created_at desc);

    CREATE TABLE IF NOT EXISTS public.agent_usage_daily (
      agent_id text not null references public.agents(id) on delete cascade,
      usage_date date not null,
      run_count integer not null default 0,
      success_count integer not null default 0,
      error_count integer not null default 0,
      blocked_count integer not null default 0,
      total_latency_ms bigint not null default 0,
      estimated_input_tokens bigint not null default 0,
      estimated_output_tokens bigint not null default 0,
      updated_at timestamptz not null default timezone('utc', now()),
      primary key (agent_id, usage_date)
    );

    CREATE TABLE IF NOT EXISTS public.agent_endpoint_health (
      agent_id text primary key references public.agents(id) on delete cascade,
      failure_count integer not null default 0,
      suspicious_count integer not null default 0,
      last_error_code text,
      last_reason text,
      quarantined_until timestamptz,
      updated_at timestamptz not null default timezone('utc', now())
    );

    CREATE INDEX IF NOT EXISTS idx_agent_endpoint_health_quarantined
      ON public.agent_endpoint_health (quarantined_until desc, updated_at desc);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS public.agent_endpoint_health;
    DROP TABLE IF EXISTS public.agent_usage_daily;
    DROP TABLE IF EXISTS public.agent_runs;
    DROP TABLE IF EXISTS public.agent_endpoints;
    DROP TABLE IF EXISTS public.agent_secrets;
    DROP TABLE IF EXISTS public.agents;
  `);
};
