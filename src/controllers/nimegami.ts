import type { Request, Response, NextFunction } from "express";
import { parse as safeParse } from "valibot";
import * as schema from "../schemas/nimegami.js";
import * as scraper from "../scrapers/nimegami.js";
import * as parser from "../parsers/nimegami.js";
import { setPayload } from "../lib/response.js";
import { BadRequestError } from "../lib/errors.js";

function getPageFromQuery(query: Record<string, unknown>): number {
	try {
		return parseInt(safeParse(schema.PageSchema, query.page), 10) || 1;
	} catch {
		return 1;
	}
}

function getSearchQuery(query: Record<string, unknown>): string {
	try {
		return safeParse(schema.SearchSchema, query.q as string);
	} catch {
		throw new BadRequestError("Invalid search query");
	}
}

function catalogPath(params: Record<string, string>, page: number): string {
	const search = new URLSearchParams(params);
	if (page > 1) search.set("page", String(page));
	const query = search.toString();
	return `/anime/${query ? `?${query}` : ""}`;
}

async function sendCatalog(res: Response, path: string, page: number) {
	const { doc } = await scraper.scrapePage(path);
	const data = parser.parseAnimeList(doc);
	const pagination = parser.parsePagination(doc, page);
	res.json(setPayload(res, { data, pagination }));
}

export async function getRoutes(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const routes = [
			{ path: "/home", description: "Home - latest & recommended anime" },
			{ path: "/anime", description: "Anime catalog (query: page)" },
			{ path: "/anime/:slug", description: "Anime details" },
			{ path: "/episode/:slug/:episode", description: "Episode streams & downloads" },
			{ path: "/search", description: "Search anime (query: q, page)" },
			{ path: "/genre", description: "Genre list" },
			{ path: "/genre/:genreId", description: "Anime filtered by genre (query: page)" },
			{ path: "/ongoing", description: "Ongoing anime (query: page)" },
			{ path: "/completed", description: "Completed anime (query: page)" },
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
		const { doc } = await scraper.scrapePage("/");
		res.json(setPayload(res, { data: parser.parseHome(doc) }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimeList(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const page = getPageFromQuery(req.query);
		await sendCatalog(res, catalogPath({ sort: "updated" }, page), page);
	} catch (err) {
		next(err);
	}
}

export async function getOngoing(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const page = getPageFromQuery(req.query);
		await sendCatalog(res, catalogPath({ status: "RELEASING", sort: "updated" }, page), page);
	} catch (err) {
		next(err);
	}
}

export async function getCompleted(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const page = getPageFromQuery(req.query);
		await sendCatalog(res, catalogPath({ status: "FINISHED", sort: "updated" }, page), page);
	} catch (err) {
		next(err);
	}
}

export async function searchAnimes(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const q = getSearchQuery(req.query);
		const page = getPageFromQuery(req.query);
		await sendCatalog(res, catalogPath({ q }, page), page);
	} catch (err) {
		next(err);
	}
}

export async function getGenres(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { doc } = await scraper.scrapePage("/genre/");
		res.json(setPayload(res, { data: parser.parseGenreCategories(doc) }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimesByGenre(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { genreId } = req.params;
		if (!genreId) throw new BadRequestError("Genre ID is required");
		const page = getPageFromQuery(req.query);
		const slug = encodeURIComponent(String(genreId));
		const path = page > 1 ? `/category/${slug}/page/${page}/` : `/category/${slug}/`;
		await sendCatalog(res, path, page);
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
		const { slug } = req.params;
		if (!slug) throw new BadRequestError("Slug is required");
		const { doc, html } = await scraper.scrapePage(`/${encodeURIComponent(String(slug))}/`);
		res.json(setPayload(res, { data: parser.parseAnimeDetails(doc, html) }));
	} catch (err) {
		next(err);
	}
}

/** Semua episode ada di halaman anime, jadi episode disaring dari halaman yang sama. */
export async function getEpisodeDetails(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const { slug, episode } = req.params;
		if (!slug) throw new BadRequestError("Slug is required");

		const episodeNumber = parseInt(String(episode), 10);
		if (isNaN(episodeNumber)) throw new BadRequestError("Episode must be a number");

		const { doc, html } = await scraper.scrapePage(`/${encodeURIComponent(String(slug))}/`);
		const data = parser.parseEpisodeDetails(doc, html, String(slug), episodeNumber);
		const resolved = await Promise.all(
			data.streamSources.map(async (source) => ({
				...source,
				url: await scraper.resolveWrappedPlayer(source.url),
			})),
		);
		data.streamSources = resolved.filter((source) => !scraper.isWrappedPlayer(source.url));
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}
