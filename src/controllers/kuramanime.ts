import type { Request, Response, NextFunction } from "express";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { parse as safeParse, ValiError } from "valibot";
import * as schema from "../schemas/kuramanime.js";
import * as scraper from "../scrapers/kuramanime.js";
import * as parser from "../parsers/kuramanime.js";
import { setPayload } from "../lib/response.js";
import { AppError, BadRequestError } from "../lib/errors.js";

/** Nilai `sort` pada API dipetakan ke `order_by` yang dipahami Kuramanime. */
const ORDER_BY: Record<string, string> = {
	"a-z": "ascending",
	"z-a": "descending",
	oldest: "oldest",
	latest: "latest",
	popular: "popular",
	most_viewed: "popular",
	updated: "latest",
};

function getPageFromQuery(query: Record<string, unknown>): string {
	try {
		return safeParse(schema.PageSchema, query.page);
	} catch {
		return "1";
	}
}

export async function getRoutes(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const routes = [
			{ path: "/", description: "Home - ongoing, completed & movie anime" },
			{ path: "/anime", description: "All anime list (query: page, sort, search, status)" },
			{ path: "/schedule", description: "Schedule (query: scheduled_day, page)" },
			{ path: "/properties/:propertyType", description: "Properties list (genre, season, studio, type, quality, source, country)" },
			{ path: "/properties/:propertyType/:propertyId", description: "Anime by property (query: page)" },
			{ path: "/anime/:animeId/:animeSlug", description: "Anime details" },
			{ path: "/anime/:animeId/:animeSlug/episode/:episodeId", description: "Episode details" },
			{ path: "/anime/:animeId/:animeSlug/batch/:batchId", description: "Batch details" },
		];
		res.json(setPayload(res, { data: routes }));
	} catch (err) {
		next(err);
	}
}

export async function getHome(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const doc = await scraper.scrapeDOM("/");
		const data = parser.parseHome(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimes(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		let search: string | undefined;
		let status: string | undefined;
		let sort: string | undefined;
		let page = "1";

		try {
			search = safeParse(schema.SearchSchema, req.query.search);
		} catch { /* optional param */ }

		try {
			status = safeParse(schema.StatusSchema, req.query.status);
		} catch { /* optional param */ }

		try {
			sort = safeParse(schema.SortSchema, req.query.sort);
		} catch { /* optional param */ }

		try {
			page = safeParse(schema.PageSchema, req.query.page);
		} catch { /* fallback to 1 */ }

		// /anime hanya mengenal `search` dan `order_by`. Tidak ada filter status
		// di sini — ongoing/completed hanya tersedia lewat /home.
		const query = new URLSearchParams({ page });
		if (search) query.set("search", search);
		query.set("order_by", ORDER_BY[sort ?? ""] ?? "latest");

		const pathname = `/anime?${query.toString()}`;

		const doc = await scraper.scrapeDOM(pathname);
		const data = parser.parseAnimes(doc);
		const pagination = parser.parsePagination(doc);
		res.json(setPayload(res, { data, pagination }));
	} catch (err) {
		next(err);
	}
}

export async function getSchedule(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		let day = "all";
		let page = "1";

		try {
			day = safeParse(schema.DaySchema, req.query.day);
		} catch { /* fallback to all */ }

		try {
			page = safeParse(schema.PageSchema, req.query.page);
		} catch { /* fallback to 1 */ }

		const path = `/schedule?scheduled_day=${day}&page=${page}`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseAnimes(doc);
		const pagination = parser.parsePagination(doc);
		res.json(setPayload(res, { data, pagination }));
	} catch (err) {
		next(err);
	}
}

export async function getEpisodes(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { animeId, animeSlug } = req.query as Record<string, string | undefined>;
		if (!animeId || !animeSlug) {
			res.json(setPayload(res, { data: [], message: "Specify animeId and animeSlug as query params to list episodes" }));
			return;
		}

		const doc = await scraper.scrapeDOM(`/anime/${animeId}/${animeSlug}`);
		const data = parser.parseEpisodes(doc, { animeId, animeSlug });
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getProperties(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		let propertyType: string;
		try {
			propertyType = safeParse(schema.PropertyTypeSchema, req.params.propertyType);
		} catch {
			throw new BadRequestError("Invalid property type. Must be one of: genre, season, studio, type, quality, source, country");
		}

		const path = `/properties/${propertyType}`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseProperties(doc);
		const pagination = parser.parsePagination(doc);
		res.json(setPayload(res, { data, pagination }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimesByProperty(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		let propertyType: string;
		try {
			propertyType = safeParse(schema.PropertyTypeSchema, req.params.propertyType);
		} catch {
			throw new BadRequestError("Invalid property type");
		}

		const { propertyId } = req.params;
		if (!propertyId) {
			throw new BadRequestError("Property ID is required");
		}

		const page = getPageFromQuery(req.query);

		const path = `/properties/${propertyType}/${propertyId}`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseAnimes(doc);
		const pagination = parser.parsePagination(doc);
		res.json(setPayload(res, { data, pagination }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimeDetails(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { animeId, animeSlug } = req.params;
		if (!animeId || !animeSlug) {
			throw new BadRequestError("animeId and animeSlug are required");
		}

		const doc = await scraper.scrapeDOM(`/anime/${animeId}/${animeSlug}`);
		const data = parser.parseAnimeDetails(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getBatchDetails(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { animeId, animeSlug, batchId } = req.params;
		if (!animeId || !animeSlug || !batchId) {
			throw new BadRequestError("animeId, animeSlug, and batchId are required");
		}

		const doc = await scraper.scrapeProtectedPage("batch", String(animeId), String(animeSlug), String(batchId));
		const data = parser.parseBatchDetails(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getEpisodeDetails(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { animeId, animeSlug, episodeId } = req.params;
		if (!animeId || !animeSlug || !episodeId) {
			throw new BadRequestError("animeId, animeSlug, and episodeId are required");
		}

		const doc = await scraper.scrapeProtectedPage("episode", String(animeId), String(animeSlug), String(episodeId));
		const data = parser.parseEpisodeDetails(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

/** Proxy video mirror kdrive dengan dukungan Range (lihat `isKdriveMirror`). */
export async function streamVideo(req: Request, res: Response, next: NextFunction) {
	try {
		const url = typeof req.query.url === "string" ? req.query.url : "";
		if (!scraper.isKdriveMirror(url)) throw new BadRequestError("Query 'url' must be a Kuramadrive mirror URL");

		const controller = new AbortController();
		res.on("close", () => controller.abort());

		const upstream = await scraper.fetchStream(url, req.get("range"), controller.signal);
		res.status(upstream.status);
		for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
			const value = upstream.headers.get(name);
			if (value) res.setHeader(name, value);
		}
		res.setHeader("Cache-Control", "private, max-age=300");

		if (!upstream.body) {
			res.end();
			return;
		}
		Readable.fromWeb(upstream.body as unknown as NodeReadableStream).on("error", () => res.destroy()).pipe(res);
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
		next(err);
	}
}
