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
