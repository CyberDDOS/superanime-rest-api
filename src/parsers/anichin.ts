import type { HTMLElement } from "node-html-parser";
import { Text, Id, Src, Attr, AnimeSrc } from "./utils.js";
import { sources } from "../config/index.js";
import type { Anichin, Server } from "../types/index.js";

const baseUrl = sources.anichin.baseUrl;

/** Ubah path relatif ("", "/anime/foo/") menjadi absolut. */
function abs(path: string | undefined): string {
	if (!path) return "";
	if (/^https?:/.test(path)) return path;
	return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

function slugFromUrl(url: string | undefined): string {
	if (!url) return "";
	try {
		const path = new URL(abs(url)).pathname;
		return path.split("/").filter(Boolean).pop() ?? "";
	} catch {
		return "";
	}
}

function parseCard(el: HTMLElement): Anichin.AnimeCard {
	const linkEl = el.querySelector("a");
	const titleEl = el.querySelector(".tt, h2");
	return {
		title: Text(linkEl) || Text(titleEl),
		slug: Id(linkEl),
		poster: Src(el.querySelector("img")),
		type: Text(el.querySelector(".typez")),
		episode: Text(el.querySelector(".epx, .sb")),
		sourceUrl: AnimeSrc(linkEl, baseUrl) ?? "",
	};
}

/** Parse daftar card anime dari section berita (theme WordPress Anichin). */
export function parseCards(doc: HTMLElement): Anichin.AnimeCard[] {
	return doc.querySelectorAll("article.bs").map(parseCard);
}

export function parsePagination(doc: HTMLElement) {
	const numbers = [
		...doc.querySelectorAll(".pagination .page-numbers"),
	].map((el) => Number.parseInt(el.text.trim(), 10));
	const current = Number.parseInt(
		doc.querySelector(".pagination .current")?.text.trim() ?? "1",
		10,
	);
	const max = numbers.length ? Math.max(...numbers) : 1;
	return {
		currentPage: Number.isFinite(current) && current > 0 ? current : 1,
		totalPages: Math.max(1, max),
	};
}

/** Info episode (bento) dari halaman anime: { title, slug }[]. */
export function parseEpisodeLinks(
	doc: HTMLElement,
): Anichin.EpisodeItem[] {
	const seen = new Set<string>();
	const items: Anichin.EpisodeItem[] = [];
	for (const a of doc.querySelectorAll("a")) {
		const href = a.getAttribute("href") ?? "";
		if (!/-episode-\d+-subtitle-indonesia\/?$/i.test(href)) continue;
		const slug = slugFromUrl(href);
		if (!slug || seen.has(slug)) continue;
		seen.add(slug);
		items.push({ title: a.text.trim(), slug });
	}
	return items;
}

function infoValue(doc: HTMLElement, label: RegExp): string {
	for (const el of doc.querySelectorAll(".tsinfo i, .spe span, .infox span")) {
		const text = el.text.trim();
		if (label.test(text)) {
			return text.replace(label, "").replace(/^:\s*/, "").trim();
		}
	}
	return "";
}

export function parseAnimeDetails(doc: HTMLElement): Anichin.AnimeDetails {
	const genreList: Anichin.GenreCard[] = [];
	for (const a of doc.querySelectorAll(".mgen a, .genres a, .genxed a")) {
		const href = a.getAttribute("href") ?? "";
		genreList.push({
			title: a.text.trim(),
			genreId: slugFromUrl(href),
		});
	}

	const episodeList = parseEpisodeLinks(doc);

	return {
		title: Text(doc.querySelector("h1")),
		japanese: infoValue(doc, /^Japanese/i),
		poster: Src(doc.querySelector(".thumb img, img.wp-post-image")),
		status: infoValue(doc, /^Status/i),
		type: infoValue(doc, /^Type/i),
		studio: infoValue(doc, /^Studio/i),
		network: infoValue(doc, /^Network/i),
		releaseDate: infoValue(doc, /Tanggal Rilis/i),
		duration: infoValue(doc, /^Durasi/i),
		season: infoValue(doc, /^Season/i),
		synopsis: Text(doc.querySelector(".entry-content"))
			.replace(/Tonton streaming.*$/s, "")
			.trim(),
		genreList,
		episodeList,
		sourceUrl: "",
	};
}

/**
 * Parse serverList dari halaman episode.
 *
 * Anichin menyimpan tiap mirror sebagai <option value="<base64>"> berisi
 * iframe HTML. serverId yang diekspos ke klien adalah base64-nya; embed URL
 * didecode ulang saat resolve (mirip pola serverId Otakudesu).
 */
export function parseEpisodeDetails(
	doc: HTMLElement,
	sourceUrl: string,
): Anichin.EpisodeDetails {
	const serverList: Server[] = [];
	for (const opt of doc.querySelectorAll("select.mirror option")) {
		const value = opt.getAttribute("value") ?? "";
		const title = opt.text.trim();
		if (!value || !title) continue;
		serverList.push({ title, serverId: value });
	}

	// fallback: pembeda antar halaman theme kadang tidak punya select.mirror
	if (!serverList.length) {
		for (const opt of doc.querySelectorAll("option")) {
			const value = opt.getAttribute("value") ?? "";
			const title = opt.text.trim();
			if (!value || !title) continue;
			serverList.push({ title, serverId: value });
		}
	}

	const nav = (sel: string): string | null => {
		const href = Attr(doc.querySelector(sel), "href");
		return href ? slugFromUrl(href) : null;
	};

	return {
		title: Text(doc.querySelector("h1")),
		animeSlug: slugFromUrl(
			doc.querySelector('a[href*="/anime/"]')?.getAttribute("href") ?? "",
		),
		navigation: {
			prev: nav(".epchnav .nvsprc a, .prev a, a.prev"),
			next: nav(".epchnav .nvsnxc a, .next a, a.next"),
		},
		serverList,
		defaultStreaming: "",
		sourceUrl,
	};
}

export function parseSearch(doc: HTMLElement): Anichin.AnimeCard[] {
	return parseCards(doc);
}

/** Daftar genre dari halaman /genre/. */
export function parseGenreList(
	doc: HTMLElement,
): Anichin.GenreCard[] {
	const seen = new Set<string>();
	const genres: Anichin.GenreCard[] = [];
	for (const a of doc.querySelectorAll("a")) {
		const href = a.getAttribute("href") ?? "";
		const m = href.match(/\/genres\/([a-z0-9-]+)\/?/i);
		if (!m) continue;
		const genreId = m[1];
		if (seen.has(genreId)) continue;
		seen.add(genreId);
		genres.push({ title: a.text.trim() || genreId, genreId });
	}
	return genres;
}

export function parseSchedule(
	doc: HTMLElement,
): Anichin.ScheduleGroup[] {
	const groups: Anichin.ScheduleGroup[] = [];
	for (const section of doc.querySelectorAll(".schedule, .airs")) {
		const day = Text(section.querySelector("h2, h3, .day"));
		if (!day) continue;
		const animeList = parseCards(section);
		groups.push({ day, animeList });
	}
	return groups;
}
