create table if not exists public.event_logs (
  id bigint generated always as identity primary key,
  event text not null,
  ip text,
  user_agent text,
  user_id text,
  user_name text,
  details text,
  category text not null default 'site',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_event_logs_event on public.event_logs (event);
create index if not exists idx_event_logs_category on public.event_logs (category);
create index if not exists idx_event_logs_created_at on public.event_logs (created_at desc);
create index if not exists idx_event_logs_ip on public.event_logs (ip);

alter table public.event_logs enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists deny_all_event_logs_api_access on public.event_logs';
    execute $policy$
      create policy deny_all_event_logs_api_access
        on public.event_logs
        as restrictive
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
    execute 'revoke all on table public.event_logs from anon, authenticated';
  end if;
end $$;

create table if not exists public.users (
  id text primary key,
  auth_provider text not null default 'google',
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz
);

create unique index if not exists idx_users_email_unique
  on public.users (email)
  where email is not null and email <> '';

create index if not exists idx_users_last_seen_at
  on public.users (last_seen_at desc);

alter table public.users enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists deny_all_users_api_access on public.users';
    execute $policy$
      create policy deny_all_users_api_access
        on public.users
        as restrictive
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
    execute 'revoke all on table public.users from anon, authenticated';
  end if;
end $$;

create table if not exists public.player_profiles (
  user_id text primary key references public.users(id) on delete cascade,
  nickname text not null,
  outfit_color text not null default '#2563eb',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_player_profiles_nickname
  on public.player_profiles (nickname);

alter table public.player_profiles enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists deny_all_player_profiles_api_access on public.player_profiles';
    execute $policy$
      create policy deny_all_player_profiles_api_access
        on public.player_profiles
        as restrictive
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
    execute 'revoke all on table public.player_profiles from anon, authenticated';
  end if;
end $$;

create table if not exists public.actor_stats (
  actor_id text not null,
  actor_type text not null,
  current_score integer not null default 0,
  best_score integer not null default 0,
  deaths integer not null default 0,
  respawns integer not null default 0,
  soccer_goals integer not null default 0,
  last_death_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint actor_stats_actor_type_check check (actor_type in ('player', 'ai')),
  constraint actor_stats_nonnegative_check check (
    current_score >= 0
    and best_score >= 0
    and deaths >= 0
    and respawns >= 0
    and soccer_goals >= 0
  ),
  primary key (actor_id, actor_type)
);

create index if not exists idx_actor_stats_best_score
  on public.actor_stats (best_score desc, updated_at desc);

create index if not exists idx_actor_stats_soccer_goals
  on public.actor_stats (soccer_goals desc, updated_at desc);

alter table public.actor_stats enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists deny_all_actor_stats_api_access on public.actor_stats';
    execute $policy$
      create policy deny_all_actor_stats_api_access
        on public.actor_stats
        as restrictive
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
    execute 'revoke all on table public.actor_stats from anon, authenticated';
  end if;
end $$;

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id text references public.users(id) on delete set null,
  player_name text not null,
  message text not null,
  moderation_status text not null default 'visible',
  moderation_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_messages_moderation_status_check check (moderation_status in ('visible', 'blocked'))
);

create index if not exists idx_chat_messages_created_at
  on public.chat_messages (created_at desc, id desc);

create index if not exists idx_chat_messages_visible_created_at
  on public.chat_messages (moderation_status, created_at desc, id desc);

alter table public.chat_messages enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'drop policy if exists deny_all_chat_messages_api_access on public.chat_messages';
    execute $policy$
      create policy deny_all_chat_messages_api_access
        on public.chat_messages
        as restrictive
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
    execute 'revoke all on table public.chat_messages from anon, authenticated';
  end if;
end $$;

-- V3 - Agent tables
create table if not exists public.agents (
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

create index if not exists idx_agents_owner_status_created
  on public.agents (owner_user_id, status, created_at desc);

create table if not exists public.agent_secrets (
  id bigserial primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  payload text not null,
  fingerprint text not null,
  created_at timestamptz not null default timezone('utc', now()),
  rotated_at timestamptz
);

create unique index if not exists uq_agent_secrets_agent_id
  on public.agent_secrets (agent_id);

create table if not exists public.agent_endpoints (
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

create unique index if not exists uq_agent_endpoints_agent_id
  on public.agent_endpoints (agent_id);

alter table public.agent_endpoints
  add column if not exists auth_secret_payload text;

alter table public.agent_endpoints
  add column if not exists auth_secret_fingerprint text;

create table if not exists public.agent_runs (
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

create index if not exists idx_agent_runs_agent_created
  on public.agent_runs (agent_id, created_at desc);

create table if not exists public.agent_usage_daily (
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

create table if not exists public.agent_endpoint_health (
  agent_id text primary key references public.agents(id) on delete cascade,
  failure_count integer not null default 0,
  suspicious_count integer not null default 0,
  last_error_code text,
  last_reason text,
  quarantined_until timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_agent_endpoint_health_quarantined
  on public.agent_endpoint_health (quarantined_until desc, updated_at desc);

-- V5 - Realm lease
create table if not exists public.realm_leases (
  realm_id text primary key,
  owner_instance_id text not null,
  lease_token text not null,
  acquired_at timestamptz not null default timezone('utc', now()),
  renewed_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  meta_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_realm_leases_owner_expires
  on public.realm_leases (owner_instance_id, expires_at);

-- V6 - API/Worker runtime storage
create table if not exists public.world_runtime_snapshots (
  realm_id text primary key,
  snapshot_version bigint not null default 0,
  snapshot_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.world_actor_runtime_snapshots (
  realm_id text not null,
  actor_id text not null,
  actor_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (realm_id, actor_id)
);

create index if not exists idx_world_actor_runtime_snapshots_actor_type
  on public.world_actor_runtime_snapshots (realm_id, actor_type, updated_at desc);

create table if not exists public.world_command_queue (
  id bigserial primary key,
  realm_id text not null,
  command_type text not null,
  actor_id text,
  actor_type text not null default 'player',
  payload_json jsonb not null default '{}'::jsonb,
  dedupe_key text,
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error_code text,
  status text not null default 'pending',
  available_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  claimed_by text,
  completed_at timestamptz,
  result_json jsonb
);

create index if not exists idx_world_command_queue_pending
  on public.world_command_queue (realm_id, status, available_at, created_at);

create index if not exists idx_world_command_queue_actor
  on public.world_command_queue (realm_id, actor_id, created_at desc);

create unique index if not exists idx_world_command_queue_dedupe_pending
  on public.world_command_queue (realm_id, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'processing');

alter table public.world_command_queue
  add column if not exists priority integer not null default 100;

alter table public.world_command_queue
  add column if not exists attempts integer not null default 0;

alter table public.world_command_queue
  add column if not exists max_attempts integer not null default 5;

alter table public.world_command_queue
  add column if not exists last_error_code text;

-- V8 - Runtime event feed
create table if not exists public.world_runtime_events (
  seq bigserial primary key,
  realm_id text not null,
  event_type text not null,
  visibility text not null default 'public',
  actor_id text,
  actor_type text,
  snapshot_version bigint not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_world_runtime_events_realm_seq
  on public.world_runtime_events (realm_id, seq desc);

create index if not exists idx_world_runtime_events_realm_created
  on public.world_runtime_events (realm_id, created_at desc);

-- V10 - Revocable auth sessions
create table if not exists public.auth_sessions (
  id text primary key,
  user_id text not null,
  user_email text,
  user_name text,
  ip text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now()),
  issued_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  revoke_reason text
);

create index if not exists idx_auth_sessions_user_id
  on public.auth_sessions (user_id, revoked_at, expires_at desc);

create index if not exists idx_auth_sessions_last_seen_at
  on public.auth_sessions (last_seen_at desc);

-- Lock down V3+ tables from Supabase Data API roles (anon/authenticated)
do $$
declare
  table_name text;
  policy_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach table_name in array array[
      'agents',
      'agent_secrets',
      'agent_endpoints',
      'agent_runs',
      'agent_usage_daily',
      'agent_endpoint_health',
      'realm_leases',
      'world_runtime_snapshots',
      'world_actor_runtime_snapshots',
      'world_command_queue',
      'world_runtime_events',
      'auth_sessions'
    ] loop
      policy_name := format('deny_all_%s_api_access', table_name);
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        policy_name,
        table_name
      );
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
    end loop;
  end if;
end $$;
