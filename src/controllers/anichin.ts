import type { Request, Response, NextFunction } from "express";
import * as scraper from "../scrapers/anichin.js";
import * as parser from "../parsers/anichin.js";
import { setPayload } from "../lib/response.js";
import { BadGatewayError, BadRequestError, NotFoundError } from "../lib/errors.js";
import { isFiledonEmbed, resolveFiledon } from "../lib/filedon.js";
import { isOkruEmbed, resolveOkru } from "../lib/okru.js";
import { resolveVidhide } from "../lib/vidhide.js";
import type { Anichin, Pagination } from "../types/index.js";

function getPage(query: Record<string, unknown>): number {
	const page = Number.parseInt(String(query.page ?? "1"), 10);
	return Number.isFinite(page) && page > 0 ? page : 1;
}

function paginationOf(current: number, total: number): Pagination {
	return {
		currentPage: current,
		prevPage: current > 1 ? current - 1 : null,
		nextPage: current < total ? current + 1 : null,
		totalPages: total,
		hasPrevPage: current > 1,
		hasNextPage: current < total,
	};
}

async function listPage(
	req: Request,
	res: Response,
	next: NextFunction,
	pathname: string,
): Promise<void> {
	try {
		const page = getPage(req.query);
		const path = page > 1 ? `${pathname}page/${page}/` : `${pathname.replace(/\/$/, "")}/`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseCards(doc);
		const { totalPages } = parser.parsePagination(doc);
		res.json(
			setPayload(res, {
				data,
				pagination: paginationOf(page, totalPages),
			}),
		);
	} catch (err) {
		next(err);
	}
}

export async function getRoutes(req: Request, res: Response, next: NextFunction) {
	try {
		const routes = [
			{ path: "/home", description: "Home page" },
			{ path: "/ongoing", description: "Ongoing donghua (query: page)" },
			{ path: "/completed", description: "Completed donghua (query: page)" },
			{ path: "/anime/:slug", description: "Anime details + episode list" },
			{ path: "/episode/:slug", description: "Episode details + server list" },
			{ path: "/server/:serverId", description: "Resolve server → direct stream" },
			{ path: "/search", description: "Search (query: q, page)" },
			{ path: "/genre", description: "All genres" },
			{ path: "/genres/:genreId", description: "Donghua by genre (query: page)" },
		];
		res.json(setPayload(res, { data: routes }));
	} catch (err) {
		next(err);
	}
}

export async function getHome(req: Request, res: Response, next: NextFunction) {
	try {
		const doc = await scraper.scrapeDOM("/");
		const cards = parser.parseCards(doc);
		res.json(setPayload(res, { data: cards }));
	} catch (err) {
		next(err);
	}
}

export async function getOngoing(req: Request, res: Response, next: NextFunction) {
	await listPage(req, res, next, "/ongoing/");
}

export async function getCompleted(req: Request, res: Response, next: NextFunction) {
	await listPage(req, res, next, "/completed/");
}

export async function getAnimeDetails(req: Request, res: Response, next: NextFunction) {
	try {
		const { slug } = req.params;
		const path = `/anime/${slug}/`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseAnimeDetails(doc);
		if (!data.title) throw new NotFoundError(`Anime ${slug} not found`);
		data.sourceUrl = `${path}`;
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getEpisodeDetails(req: Request, res: Response, next: NextFunction) {
	try {
		const { slug } = req.params;
		const path = `/${slug}/`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseEpisodeDetails(doc, path);
		if (!data.title) throw new NotFoundError(`Episode ${slug} not found`);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

/** Resolve serverId (base64 iframe) → direct stream. */
export async function getServerDetails(req: Request, res: Response, next: NextFunction) {
	try {
		const { serverId } = req.params;
		if (!serverId) throw new BadRequestError("serverId is required");

		let html: string;
		try {
			html = Buffer.from(String(serverId), "base64").toString("utf-8");
		} catch {
			throw new BadRequestError("serverId is not valid base64");
		}

		const embedUrl = html.match(/src="([^"]+)"/i)?.[1];
		if (!embedUrl) throw new BadGatewayError("Server stream URL not found");

		// OK.ru → direct .mp4 per kualitas
		if (isOkruEmbed(embedUrl)) {
			try {
				const src = await resolveOkru(embedUrl);
				const data: Anichin.ResolvedStream = {
					title: src.title,
					url: src.bestUrl,
					type: "direct",
					mimeType: "video/mp4",
					qualities: src.qualities,
				};
				res.json(setPayload(res, { data }));
				return;
			} catch {
				// jatuh ke embed apa adanya
			}
		}

		// VidHide → HLS m3u8
		try {
			const src = await resolveVidhide(embedUrl);
			const data: Anichin.ResolvedStream = {
				title: "VidHide",
				url: src.url,
				type: "hls",
				mimeType: "application/vnd.apple.mpegurl",
			};
			res.json(setPayload(res, { data }));
			return;
		} catch {
			// jatuh ke embed apa adanya
		}

		// Filedon (kalau muncul di daftar mirror) → direct .mp4
		if (isFiledonEmbed(embedUrl)) {
			try {
				const src = await resolveFiledon(embedUrl);
				const data: Anichin.ResolvedStream = {
					title: src.name,
					url: src.url,
					type: "direct",
					mimeType: src.mimeType,
				};
				res.json(setPayload(res, { data }));
				return;
			} catch {
				// jatuh ke embed apa adanya
			}
		}

		const data: Anichin.ResolvedStream = {
			title: "Server",
			url: embedUrl,
			type: "embed",
		};
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function searchAnimes(req: Request, res: Response, next: NextFunction) {
	try {
		const q = String(req.query.q ?? "").trim();
		if (!q) throw new BadRequestError("Query parameter q is required");
		const page = getPage(req.query);
		const path = `/?s=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseSearch(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getGenreList(req: Request, res: Response, next: NextFunction) {
	try {
		const doc = await scraper.scrapeDOM("/genre/");
		const data = parser.parseGenreList(doc);
		res.json(setPayload(res, { data }));
	} catch (err) {
		next(err);
	}
}

export async function getAnimesByGenre(req: Request, res: Response, next: NextFunction) {
	try {
		const { genreId } = req.params;
		const page = getPage(req.query);
		const path = `/genres/${genreId}/${page > 1 ? `page/${page}/` : ""}`;
		const doc = await scraper.scrapeDOM(path);
		const data = parser.parseCards(doc);
		const { totalPages } = parser.parsePagination(doc);
		res.json(
			setPayload(res, { data, pagination: paginationOf(page, totalPages) }),
		);
	} catch (err) {
		next(err);
	}
}
