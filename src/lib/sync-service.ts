import { supabase, isSupabaseReady } from "./supabase.js";

function getField(obj: any, ...keys: string[]): string {
	for (const key of keys) {
		if (obj && obj[key] !== undefined && obj[key] !== null) {
			return String(obj[key]);
		}
	}
	return "";
}

export async function syncHome(source: string, data: unknown): Promise<void> {
	if (!isSupabaseReady()) return;

	const sections: Record<string, unknown[]> = {};
	if (typeof data === "object" && data !== null) {
		const d = data as Record<string, unknown>;
		for (const key of Object.keys(d)) {
			if (Array.isArray(d[key])) {
				sections[key] = d[key] as unknown[];
			}
		}
	}

	const rows: Array<Record<string, unknown>> = [];
	for (const [section, items] of Object.entries(sections)) {
		rows.push({
			source_id: source,
			section,
			data: items,
		});
	}

	if (!rows.length) return;

	const { error } = await supabase!
		.from("home_cache")
		.upsert(rows, { onConflict: "source_id,section" });

	if (error) console.error(`[sync] home_cache upsert error: ${error.message}`);
}

export async function syncAnimeList(
	source: string,
	animeList: Array<{
		slug: string;
		title: string;
		poster?: string;
		type?: string;
		status?: string;
		score?: string;
		episode?: string;
	}>,
): Promise<number> {
	if (!isSupabaseReady()) return 0;

	const now = new Date().toISOString();
	// `slug` dan `title` NOT NULL di database, dan seluruh batch ditolak kalau
	// satu baris saja kosong. Entri tak lengkap dibuang lebih dulu supaya sisa
	// datanya tetap tersimpan.
	const rows = animeList
		.filter((a) => a?.slug && a?.title)
		.map((a) => ({
			source_id: source,
			slug: a.slug,
			title: a.title,
			poster: a.poster || null,
			type: a.type || null,
			status: a.status || null,
			score: a.score || null,
			episode_count: a.episode || null,
			updated_at: now,
		}));

	if (!rows.length) return 0;

	// Postgres menolak upsert yang menyentuh baris sama dua kali dalam satu
	// perintah, jadi slug ganda dalam satu batch disatukan dulu.
	const deduped = [...new Map(rows.map((row) => [row.slug, row])).values()];

	const { error } = await supabase!
		.from("anime")
		.upsert(deduped, { onConflict: "source_id,slug" });

	if (error) {
		console.error(`[sync] anime upsert error: ${error.message}`);
		return 0;
	}

	return deduped.length;
}

export async function syncAnimeDetails(
	source: string,
	slug: string,
	details: Record<string, unknown>,
): Promise<void> {
	if (!isSupabaseReady()) return;

	const { error } = await supabase!
		.from("anime")
		.update({
			raw_data: details,
			title: getField(details, "title"),
			poster: getField(details, "poster"),
			type: getField(details, "type"),
			status: getField(details, "status"),
			score: getField(details, "score", "rating"),
			episode_count: getField(details, "episodes", "episode"),
			updated_at: new Date().toISOString(),
		})
		.match({ source_id: source, slug });

	if (error) console.error(`[sync] anime update error: ${error.message}`);
}

export async function syncGenres(
	source: string,
	genres: Array<{ name: string; slug: string }>,
): Promise<void> {
	if (!isSupabaseReady()) return;
	if (!genres.length) return;

	const rows = genres.map((g) => ({
		source_id: source,
		name: g.name,
		slug: g.slug,
	}));

	const { error } = await supabase!
		.from("genres")
		.upsert(rows, { onConflict: "source_id,slug" });

	if (error) console.error(`[sync] genres upsert error: ${error.message}`);
}

export async function syncEpisodes(
	source: string,
	animeSlug: string,
	episodes: Array<{
		episode: string | number;
		title?: string;
		url?: string;
		date?: string;
	}>,
): Promise<void> {
	if (!isSupabaseReady()) return;
	if (!episodes.length) return;

	const rows = episodes.map((ep) => ({
		source_id: source,
		anime_slug: animeSlug,
		episode: String(ep.episode),
		title: ep.title || null,
		url: ep.url || null,
		date: ep.date || null,
	}));

	const { error } = await supabase!
		.from("episodes")
		.upsert(rows, { onConflict: "source_id,anime_slug,episode" });

	if (error) console.error(`[sync] episodes upsert error: ${error.message}`);
}

export async function logSyncStart(
	source: string,
	syncType: string,
): Promise<string | null> {
	if (!isSupabaseReady()) return null;

	const { data, error } = await supabase!
		.from("sync_log")
		.insert({
			source_id: source,
			sync_type: syncType,
			status: "running",
			started_at: new Date().toISOString(),
		})
		.select("id")
		.single();

	if (error) {
		console.error(`[sync] log start error: ${error.message}`);
		return null;
	}

	return data?.id ?? null;
}

export async function logSyncFinish(
	logId: string | null,
	status: "success" | "failed",
	itemsCount?: number,
	error?: string,
): Promise<void> {
	if (!isSupabaseReady() || !logId) return;

	const update: Record<string, unknown> = {
		status,
		finished_at: new Date().toISOString(),
	};

	if (itemsCount !== undefined) update.items_count = itemsCount;
	if (error !== undefined) update.error_message = error;

	const { error: err } = await supabase!
		.from("sync_log")
		.update(update)
		.eq("id", logId);

	if (err) console.error(`[sync] log finish error: ${err.message}`);
}

export async function getLastSync(
	source: string,
	syncType: string,
): Promise<Date | null> {
	if (!isSupabaseReady()) return null;

	const { data, error } = await supabase!
		.from("sync_log")
		.select("started_at")
		.eq("source_id", source)
		.eq("sync_type", syncType)
		.eq("status", "success")
		.order("started_at", { ascending: false })
		.limit(1)
		.single();

	if (error || !data) return null;

	return new Date(data.started_at);
}
