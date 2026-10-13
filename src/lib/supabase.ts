import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
// Tabel konten hanya boleh ditulis dari server, jadi backend memakai service
// role key (melewati RLS). Key ini TIDAK boleh dipakai di frontend.
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseKey = serviceRoleKey || anonKey;

if (supabaseUrl && !serviceRoleKey && anonKey) {
	console.warn(
		"[supabase] SUPABASE_SERVICE_ROLE_KEY belum diisi; memakai anon key yang hanya bisa membaca, jadi sync ke database akan gagal.",
	);
}

export const supabase = supabaseUrl && supabaseKey
	? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
	: null;

/** Cek apakah Supabase terkonfigurasi */
export function isSupabaseReady(): boolean {
	return supabase !== null;
}
