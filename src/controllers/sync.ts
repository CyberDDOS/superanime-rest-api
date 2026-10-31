import type { Request, Response, NextFunction } from "express";
import { setPayload } from "../lib/response.js";
import * as scraper from "../scrapers/otakudesu.js";
import * as parser from "../parsers/otakudesu.js";
import * as syncService from "../lib/sync-service.js";
import { AppError } from "../lib/errors.js";

const SOURCES = ["otakudesu", "kuramanime", "oploverz", "nimegami", "doronime", "nontonanimeid", "anichin"] as const;

/** Slug dari tautan; URL jadwal hanya membawa tautan, bukan slug. */
function slugFromUrl(url: string): string {
	return url.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
}

type SourceMap = Record<string, {
	name: string;
	scraper: typeof import("../scrapers/otakudesu.js");
	parser: typeof import("../parsers/otakudesu.js");
}>;

async function syncSourceHome(source: string): Promise<number> {
	let count = 0;

	switch (source) {
		case "otakudesu": {
			const modScraper = await import("../scrapers/otakudesu.js");
			const modParser = await import("../parsers/otakudesu.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseHome(doc);
			await syncService.syncHome(source, data);
			count += data.ongoing.length + data.completed.length;
			break;
		}
		case "kuramanime": {
			const modScraper = await import("../scrapers/kuramanime.js");
			const modParser = await import("../parsers/kuramanime.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseHome(doc);
			await syncService.syncHome(source, data);
			count += data.ongoing.length + data.completed.length + data.movie.length;
			break;
		}
		case "oploverz": {
			const modScraper = await import("../scrapers/oploverz.js");
			const modParser = await import("../parsers/oploverz.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseHome(doc);
			await syncService.syncHome(source, data);
			count += data.popular.length + data.latest.length + data.recommended.length;
			break;
		}
		case "nimegami": {
			const modScraper = await import("../scrapers/nimegami.js");
			const modParser = await import("../parsers/nimegami.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseHome(doc);
			await syncService.syncHome(source, data);
			count += data.latest.length + data.recommended.length;
			break;
		}
		case "doronime": {
			const modScraper = await import("../scrapers/doronime.js");
			const modParser = await import("../parsers/doronime.js");
			const doc = await modScraper.scrapeDOM("/");
			const latest = modParser.parseAnimeCards(doc);
			await syncService.syncHome(source, { latest });
			count += latest.length;
			break;
		}
		case "nontonanimeid": {
			const modScraper = await import("../scrapers/nontonanimeid.js");
			const modParser = await import("../parsers/nontonanimeid.js");
			const doc = await modScraper.scrapeDOM("/");
			const latest = modParser.parseCards(doc, { required: false });
			await syncService.syncHome(source, { latest });
			count += latest.length;
			break;
		}
		case "anichin": {
			const modScraper = await import("../scrapers/anichin.js");
			const modParser = await import("../parsers/anichin.js");
			const doc = await modScraper.scrapeDOM("/");
			const cards = modParser.parseCards(doc);
			await syncService.syncHome(source, { latest: cards });
			count += cards.length;
			break;
		}
	}

	return count;
}

async function syncSourceAnimeList(source: string): Promise<number> {
	switch (source) {
		case "otakudesu": {
			const modScraper = await import("../scrapers/otakudesu.js");
			const modParser = await import("../parsers/otakudesu.js");
			const doc = await modScraper.scrapeDOM("/anime-list/", undefined, true);
			const data = modParser.parseAllAnimes(doc);
			const flat = data.flatMap((c) =>
				c.animeList.map((a) => ({
					slug: a.url.split("/").filter(Boolean).pop() || a.title.toLowerCase().replace(/\s+/g, "-"),
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "kuramanime": {
			const modScraper = await import("../scrapers/kuramanime.js");
			const modParser = await import("../parsers/kuramanime.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseAnimes(doc);
			const flat = data.map((a) => ({
				slug: a.slug,
				title: a.title,
				poster: a.poster,
				type: a.type,
			}));
			return syncService.syncAnimeList(source, flat);
		}
		case "oploverz": {
			const modScraper = await import("../scrapers/oploverz.js");
			const modParser = await import("../parsers/oploverz.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseAnimeList(doc);
			const flat = data.flatMap((c) =>
				c.animeList.map((a) => ({
					slug: a.url.split("/").filter(Boolean).pop() || a.title.toLowerCase().replace(/\s+/g, "-"),
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "nimegami": {
			const modScraper = await import("../scrapers/nimegami.js");
			const modParser = await import("../parsers/nimegami.js");
			const doc = await modScraper.scrapeDOM("/anime/");
			const data = modParser.parseAnimeList(doc);
			const flat = data.map((a) => ({
				slug: a.slug,
				title: a.title,
				poster: a.poster,
				type: a.type,
				status: a.status,
				score: a.rating,
				episode: a.episode,
			}));
			return syncService.syncAnimeList(source, flat);
		}
		case "doronime": {
			const modScraper = await import("../scrapers/doronime.js");
			const modParser = await import("../parsers/doronime.js");
			const doc = await modScraper.scrapeDOM("/anime?view=list");
			const data = modParser.parseAnimeCollections(doc);
			const flat = data.flatMap((c) =>
				c.animeList.map((a) => ({
					slug: slugFromUrl(a.url),
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "nontonanimeid": {
			const modScraper = await import("../scrapers/nontonanimeid.js");
			const modParser = await import("../parsers/nontonanimeid.js");
			try {
				const doc = await modScraper.scrapeDOM("/anime/?mode=list&sort=series_title");
				const data = modParser.parseAnimeCollections(doc);
				const flat = data.flatMap((c) =>
					c.animeList.map((a) => ({
						slug: a.slug,
						title: a.title,
					})),
				);
				return syncService.syncAnimeList(source, flat);
			} catch (err) {
				// Halaman katalog penuh paling sering ditolak Cloudflare. Jadwal
				// rilis memuat anime yang sama dan tetap bisa diakses, jadi pakai
				// itu sebagai sumber cadangan alih-alih menggagalkan sync.
				console.warn(
					`[sync] nontonanimeid anime-list gagal (${err instanceof Error ? err.message : String(err)}), pakai jadwal`,
				);
				const doc = await modScraper.scrapeDOM("/jadwal-rilis/");
				const data = modParser.parseSchedule(doc);
				const flat = data.flatMap((s) =>
					s.animeList.map((a) => ({
						slug: a.slug,
						title: a.title,
					})),
				);
				return syncService.syncAnimeList(source, flat);
			}
		}
		case "anichin": {
			const modScraper = await import("../scrapers/anichin.js");
			const modParser = await import("../parsers/anichin.js");
			// Anichin tidak punya katalog A-Z satu halaman; katalog penuh
			// diperoleh dari sweep ongoing + completed. Jumlah halaman
			// dibaca dinamis dari pagination supaya entri baru tidak
			// tertinggal saat situs bertambah.
			const sections = ["/ongoing/", "/completed/"] as const;
			const cards = new Map<string, { slug: string; title: string; poster?: string; type?: string }>();
			for (const sectionPath of sections) {
				const firstPage = await modScraper.scrapeDOM(sectionPath);
				const { totalPages } = modParser.parsePagination(firstPage);
				for (let page = 1; page <= totalPages; page++) {
					const pagePath = page === 1 ? sectionPath : `${sectionPath}page/${page}/`;
					const doc = page === 1 ? firstPage : await modScraper.scrapeDOM(pagePath);
					for (const card of modParser.parseCards(doc)) {
						if (card.slug && !cards.has(card.slug)) {
							cards.set(card.slug, {
								slug: card.slug,
								title: card.title,
								poster: card.poster || undefined,
								type: card.type || undefined,
							});
						}
					}
				}
			}
			return syncService.syncAnimeList(source, [...cards.values()]);
		}
	default:
		return 0;
	}
}

async function syncSourceSchedule(source: string): Promise<number> {
	switch (source) {
		case "otakudesu": {
			const modScraper = await import("../scrapers/otakudesu.js");
			const modParser = await import("../parsers/otakudesu.js");
			const doc = await modScraper.scrapeDOM("/jadwal-rilis/");
			const data = modParser.parseSchedules(doc);
			const flat = data.flatMap((s) =>
				s.animeList.map((a) => ({
					slug: a.url.split("/").filter(Boolean).pop() || a.title.toLowerCase().replace(/\s+/g, "-"),
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "kuramanime": {
			const modScraper = await import("../scrapers/kuramanime.js");
			const modParser = await import("../parsers/kuramanime.js");
			const doc = await modScraper.scrapeDOM("/jadwal/");
			const data = modParser.parseScheduledAnimes(doc);
			const flat = data.map((a) => ({
				slug: a.slug,
				title: a.title,
				poster: a.poster,
				type: a.type,
			}));
			return syncService.syncAnimeList(source, flat);
		}
		case "doronime": {
			const modScraper = await import("../scrapers/doronime.js");
			const modParser = await import("../parsers/doronime.js");
			const doc = await modScraper.scrapeDOM("/schedule");
			const data = modParser.parseSchedule(doc);
			const flat = data.flatMap((s) =>
				s.animeList.map((a) => ({
					slug: slugFromUrl(a.url),
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "nontonanimeid": {
			const modScraper = await import("../scrapers/nontonanimeid.js");
			const modParser = await import("../parsers/nontonanimeid.js");
			const doc = await modScraper.scrapeDOM("/jadwal-rilis/");
			const data = modParser.parseSchedule(doc);
			const flat = data.flatMap((s) =>
				s.animeList.map((a) => ({
					slug: a.slug,
					title: a.title,
				})),
			);
			return syncService.syncAnimeList(source, flat);
		}
		case "oploverz":
		case "nimegami":
			return 0;
		default:
			return 0;
	}
}

async function syncSourceGenres(source: string): Promise<number> {
	switch (source) {
		case "otakudesu": {
			const modScraper = await import("../scrapers/otakudesu.js");
			const modParser = await import("../parsers/otakudesu.js");
			const doc = await modScraper.scrapeDOM("/genre-list/");
			const data = modParser.parseAllGenres(doc);
			const genres = data.map((g) => ({ name: g.title, slug: g.genreId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "oploverz": {
			const modScraper = await import("../scrapers/oploverz.js");
			const modParser = await import("../parsers/oploverz.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseGenreList(doc);
			const genres = data.map((g) => ({ name: g.title, slug: g.genreId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "kuramanime": {
			const modScraper = await import("../scrapers/kuramanime.js");
			const modParser = await import("../parsers/kuramanime.js");
			const doc = await modScraper.scrapeDOM("/");
			const data = modParser.parseProperties(doc);
			const genres = data
				.filter((p) => p.propertyType === "genre")
				.map((g) => ({ name: g.title, slug: g.propertyId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "doronime": {
			const modScraper = await import("../scrapers/doronime.js");
			const modParser = await import("../parsers/doronime.js");
			const doc = await modScraper.scrapeDOM("/genre");
			const data = modParser.parseGenreList(doc);
			const genres = data.map((g) => ({ name: g.title, slug: g.genreId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "nontonanimeid": {
			const modScraper = await import("../scrapers/nontonanimeid.js");
			const modParser = await import("../parsers/nontonanimeid.js");
			const doc = await modScraper.scrapeDOM("/genres/");
			const data = modParser.parseGenres(doc);
			const genres = data.map((g) => ({ name: g.title, slug: g.genreId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "nimegami": {
			const modScraper = await import("../scrapers/nimegami.js");
			const modParser = await import("../parsers/nimegami.js");
			const doc = await modScraper.scrapeDOM("/genre/");
			const data = modParser.parseGenreCategories(doc);
			const genres = data.map((g) => ({
				name: g.title,
				slug: g.url.split("/").filter(Boolean).pop() || g.title.toLowerCase().replace(/\s+/g, "-"),
			}));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		case "anichin": {
			const modScraper = await import("../scrapers/anichin.js");
			const modParser = await import("../parsers/anichin.js");
			const doc = await modScraper.scrapeDOM("/genre/");
			const data = modParser.parseGenreList(doc);
			const genres = data.map((g) => ({ name: g.title, slug: g.genreId }));
			await syncService.syncGenres(source, genres);
			return genres.length;
		}
		default:
			return 0;
	}
}

async function syncFullSource(source: string): Promise<Record<string, number>> {
	const result: Record<string, number> = {};

	result.home = await syncSourceHome(source);
	result.animeList = await syncSourceAnimeList(source);
	result.schedule = await syncSourceSchedule(source);
	result.genres = await syncSourceGenres(source);

	return result;
}

export async function syncSource(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { source = "", type = "" } = req.params as Record<string, string>;

		if (!source || !type) {
			throw new AppError(400, "Missing source or type parameter");
		}

		const validSources: string[] = [...SOURCES, "all"];
		if (!validSources.includes(source)) {
			throw new AppError(400, `Invalid source. Must be one of: ${SOURCES.join(", ")} or "all"`);
		}

		const validTypes = ["home", "anime", "schedule", "genres", "full"];
		if (!validTypes.includes(type)) {
			throw new AppError(400, `Invalid type. Must be one of: ${validTypes.join(", ")}`);
		}

		const sourcesToSync: string[] = source === "all" ? [...SOURCES] : [source];
		const summary: Record<string, Record<string, number>> = {};

		for (const src of sourcesToSync) {
			const logId = await syncService.logSyncStart(src, type);

			try {
				let result: Record<string, number>;

				if (type === "full") {
					result = await syncFullSource(src);
				} else {
					const count = await (async () => {
						switch (type) {
							case "home": return syncSourceHome(src);
							case "anime": return syncSourceAnimeList(src);
							case "schedule": return syncSourceSchedule(src);
							case "genres": return syncSourceGenres(src);
							default: return 0;
						}
					})();
					result = { [type]: count };
				}

				const totalItems = Object.values(result).reduce((a, b) => a + b, 0);

				await syncService.logSyncFinish(logId, "success", totalItems);
				summary[src] = result;
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : "Unknown error";
				await syncService.logSyncFinish(logId, "failed", undefined, errMsg);
				summary[src] = { error: 0 };
			}
		}

		res.json(setPayload(res, {
			message: `Sync ${type} completed for ${sourcesToSync.length} source(s)`,
			data: { source, type, summary },
		}));
	} catch (err) {
		next(err);
	}
}

export async function getSyncStatus(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { isSupabaseReady } = await import("../lib/supabase.js");

		if (!isSupabaseReady()) {
			res.json(setPayload(res, {
				message: "Supabase not configured",
				data: { configured: false, history: [] },
			}));
			return;
		}

		const { supabase } = await import("../lib/supabase.js");

		const { data, error } = await supabase!
			.from("sync_log")
			.select("*")
			.order("started_at", { ascending: false })
			.limit(50);

		if (error) {
			throw new AppError(500, `Failed to fetch sync status: ${error.message}`);
		}

		res.json(setPayload(res, {
			message: "Sync status retrieved",
			data: { configured: true, history: data || [] },
		}));
	} catch (err) {
		next(err);
	}
}

export async function getAnimeFromDB(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { isSupabaseReady } = await import("../lib/supabase.js");

		if (!isSupabaseReady()) {
			res.json(setPayload(res, {
				message: "Supabase not configured",
				data: { configured: false, anime: [] },
			}));
			return;
		}

		const { supabase } = await import("../lib/supabase.js");

		const {
			source_id,
			status: statusFilter,
			search,
			page: pageStr,
			limit: limitStr,
		} = req.query as Record<string, string | undefined>;

		const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
		const limit = Math.min(100, Math.max(1, parseInt(limitStr || "20", 10) || 20));
		const offset = (page - 1) * limit;

		let query = supabase!
			.from("anime")
			.select("*", { count: "exact" });

		if (source_id) {
			query = query.eq("source_id", source_id);
		}

		if (statusFilter) {
			query = query.ilike("status", `%${statusFilter}%`);
		}

		if (search) {
			query = query.ilike("title", `%${search}%`);
		}

		const { data, error, count } = await query
			.order("updated_at", { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			throw new AppError(500, `Failed to query anime: ${error.message}`);
		}

		const totalPages = count ? Math.ceil(count / limit) : 0;

		res.json(setPayload(res, {
			message: "Anime data retrieved",
			data: { configured: true, anime: data || [] },
			pagination: {
				currentPage: page,
				prevPage: page > 1 ? page - 1 : null,
				nextPage: page < totalPages ? page + 1 : null,
				totalPages,
				hasPrevPage: page > 1,
				hasNextPage: page < totalPages,
			},
		}));
	} catch (err) {
		next(err);
	}
}
