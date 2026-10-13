-- Cabut akses tulis publik dari tabel konten.
--
-- Skema lama memberi policy "Allow public write" (FOR ALL USING (true)) ke
-- semua tabel konten, sehingga siapa pun yang memegang anon key — yang memang
-- terekspos di client — bisa mengubah atau menghapus isi database.
--
-- Setelah migrasi ini, publik hanya bisa membaca. Backend menulis memakai
-- SUPABASE_SERVICE_ROLE_KEY, yang melewati RLS. Isi env itu di backend
-- SEBELUM menjalankan migrasi ini, atau sync ke database akan gagal.

DROP POLICY IF EXISTS "Allow public write" ON public.sources;
DROP POLICY IF EXISTS "Allow public write" ON public.anime;
DROP POLICY IF EXISTS "Allow public write" ON public.episodes;
DROP POLICY IF EXISTS "Allow public write" ON public.genres;
DROP POLICY IF EXISTS "Allow public write" ON public.anime_genres;
DROP POLICY IF EXISTS "Allow public write" ON public.home_cache;
DROP POLICY IF EXISTS "Allow public write" ON public.sync_log;
