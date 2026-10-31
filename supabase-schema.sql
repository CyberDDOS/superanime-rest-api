-- ============================================================
-- SUPERANIME — Supabase Database Schema
-- Jalankan SQL ini di Supabase SQL Editor
-- ============================================================

-- 1. TABEL SOURCES
CREATE TABLE IF NOT EXISTS public.sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  enabled     BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.sources (id, name, base_url, enabled) VALUES
  ('otakudesu',   'Otakudesu',   'https://otakudesu.blog',     true),
  ('kuramanime',  'Kuramanime',  'https://v18.kuramanime.ing', true),
  ('oploverz',    'Oploverz',    'https://oploverz.fans',      true),
  ('nimegami',    'Nimegami',    'https://nimegami.id',         true),
  ('anichin',     'Anichin',     'https://anichin.moe',        true)
ON CONFLICT (id) DO NOTHING;

-- 2. TABEL ANIME
CREATE TABLE IF NOT EXISTS public.anime (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  poster          TEXT,
  synopsis        TEXT,
  type            TEXT,
  status          TEXT,
  score           TEXT,
  episode_count   TEXT,
  studio          TEXT,
  season          TEXT,
  duration        TEXT,
  aired           TEXT,
  alternative_title TEXT,
  raw_data        JSONB,  -- data mentah dari scraper
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_anime_source ON public.anime(source_id);
CREATE INDEX IF NOT EXISTS idx_anime_updated ON public.anime(updated_at DESC);

-- 3. TABEL EPISODES
CREATE TABLE IF NOT EXISTS public.episodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  anime_slug      TEXT NOT NULL,
  episode_number  TEXT NOT NULL,
  title           TEXT,
  url             TEXT,
  date            TEXT,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, anime_slug, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_anime ON public.episodes(source_id, anime_slug);

-- 4. TABEL GENRES
CREATE TABLE IF NOT EXISTS public.genres (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, slug)
);

-- 5. TABEL ANIME_GENRES (relasi many-to-many)
CREATE TABLE IF NOT EXISTS public.anime_genres (
  anime_id        UUID NOT NULL REFERENCES public.anime(id) ON DELETE CASCADE,
  genre_id        UUID NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  PRIMARY KEY (anime_id, genre_id)
);

-- 6. TABEL HOME_CACHE (data halaman utama per source)
CREATE TABLE IF NOT EXISTS public.home_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  section         TEXT NOT NULL, -- 'ongoing', 'completed', 'popular', 'latest', dll
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, section)
);

-- 7. TABEL SYNC_LOG (tracking sinkronisasi)
CREATE TABLE IF NOT EXISTS public.sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL, -- 'home', 'anime', 'schedule', 'genre', 'full'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'success', 'failed'
  items_count     INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  UNIQUE(source_id, sync_type, started_at)
);

-- 8. FUNCTION: updated_at otomatis
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger untuk anime
CREATE TRIGGER trg_anime_updated_at
  BEFORE UPDATE ON public.anime
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger untuk episodes
CREATE TRIGGER trg_episodes_updated_at
  BEFORE UPDATE ON public.episodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 9. RLS (Row Level Security) — publik hanya boleh membaca.
-- Anon key ikut terekspos di client, jadi tidak boleh punya akses tulis.
-- Backend menulis memakai service role key (SUPABASE_SERVICE_ROLE_KEY), yang
-- melewati RLS, sehingga tabel-tabel ini sengaja tidak punya policy tulis.
ALTER TABLE public.sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anime       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genres      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anime_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"  ON public.sources      FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.anime        FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.episodes     FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.genres       FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.anime_genres FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.home_cache   FOR SELECT USING (true);
CREATE POLICY "Allow public read"  ON public.sync_log     FOR SELECT USING (true);
