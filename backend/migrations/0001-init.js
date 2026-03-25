exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.event_logs (
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

    CREATE INDEX IF NOT EXISTS idx_event_logs_event ON public.event_logs (event);
    CREATE INDEX IF NOT EXISTS idx_event_logs_category ON public.event_logs (category);
    CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON public.event_logs (created_at desc);
    CREATE INDEX IF NOT EXISTS idx_event_logs_ip ON public.event_logs (ip);

    CREATE TABLE IF NOT EXISTS public.users (
      id text primary key,
      auth_provider text not null default 'google',
      email text,
      display_name text,
      avatar_url text,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      last_seen_at timestamptz
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON public.users (email)
      WHERE email IS NOT NULL AND email <> '';

    CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON public.users (last_seen_at desc);

    CREATE TABLE IF NOT EXISTS public.player_profiles (
      user_id text primary key references public.users(id) on delete cascade,
      nickname text not null,
      outfit_color text not null default '#2563eb',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    CREATE INDEX IF NOT EXISTS idx_player_profiles_nickname
      ON public.player_profiles (nickname);

    CREATE TABLE IF NOT EXISTS public.actor_stats (
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

    CREATE INDEX IF NOT EXISTS idx_actor_stats_best_score
      ON public.actor_stats (best_score desc, updated_at desc);

    CREATE INDEX IF NOT EXISTS idx_actor_stats_soccer_goals
      ON public.actor_stats (soccer_goals desc, updated_at desc);

    CREATE TABLE IF NOT EXISTS public.chat_messages (
      id bigint generated always as identity primary key,
      user_id text references public.users(id) on delete set null,
      player_name text not null,
      message text not null,
      moderation_status text not null default 'visible',
      moderation_reason text,
      created_at timestamptz not null default timezone('utc', now()),
      constraint chat_messages_moderation_status_check check (moderation_status in ('visible', 'blocked'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
      ON public.chat_messages (created_at desc, id desc);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_visible_created_at
      ON public.chat_messages (moderation_status, created_at desc, id desc);

    ALTER TABLE public.event_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.actor_stats ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
        AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'DROP POLICY IF EXISTS deny_all_event_logs_api_access ON public.event_logs';
        EXECUTE $policy$
          CREATE POLICY deny_all_event_logs_api_access
            ON public.event_logs
            AS RESTRICTIVE
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false)
        $policy$;

        EXECUTE 'DROP POLICY IF EXISTS deny_all_users_api_access ON public.users';
        EXECUTE $policy$
          CREATE POLICY deny_all_users_api_access
            ON public.users
            AS RESTRICTIVE
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false)
        $policy$;

        EXECUTE 'DROP POLICY IF EXISTS deny_all_player_profiles_api_access ON public.player_profiles';
        EXECUTE $policy$
          CREATE POLICY deny_all_player_profiles_api_access
            ON public.player_profiles
            AS RESTRICTIVE
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false)
        $policy$;

        EXECUTE 'DROP POLICY IF EXISTS deny_all_actor_stats_api_access ON public.actor_stats';
        EXECUTE $policy$
          CREATE POLICY deny_all_actor_stats_api_access
            ON public.actor_stats
            AS RESTRICTIVE
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false)
        $policy$;

        EXECUTE 'DROP POLICY IF EXISTS deny_all_chat_messages_api_access ON public.chat_messages';
        EXECUTE $policy$
          CREATE POLICY deny_all_chat_messages_api_access
            ON public.chat_messages
            AS RESTRICTIVE
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false)
        $policy$;

        EXECUTE 'REVOKE ALL ON TABLE public.event_logs FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON TABLE public.users FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON TABLE public.player_profiles FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON TABLE public.actor_stats FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON TABLE public.chat_messages FROM anon, authenticated';
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS public.chat_messages;
    DROP TABLE IF EXISTS public.actor_stats;
    DROP TABLE IF EXISTS public.player_profiles;
    DROP TABLE IF EXISTS public.users;
    DROP TABLE IF EXISTS public.event_logs;
  `);
};
