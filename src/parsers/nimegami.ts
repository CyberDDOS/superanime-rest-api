import type { HTMLElement } from "node-html-parser";
import { NotFoundError } from "../lib/errors.js";
import { Text, Attr } from "./utils.js";
import type { Nimegami, UrlLink, Format, Pagination } from "../types/index.js";
import { sources } from "../config/index.js";

const baseUrl = sources.nimegami.baseUrl;


function absolute(url: string): string {
	if (!url) return "";
	return url.startsWith("http") ? url : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function slugFromHref(href: string): string {
	return href.split("/").filter(Boolean).pop() ?? "";
}

/** `/_next/image/?url=%2Fassets%2F...&w=..` → URL gambar asli. */
function posterFromImg(img: HTMLElement | null): string {
	const src = Attr(img, "src");
	if (!src) return "";
	const match = src.match(/[?&]url=([^&]+)/);
	return absolute(match ? decodeURIComponent(match[1]) : src);
}

function slugifyGenre(name: string): string {
	return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function genreLink(name: string): UrlLink {
	return { title: name, url: `${baseUrl}/category/${slugifyGenre(name)}/` };
}

function parseCard(el: HTMLElement): Nimegami.AnimeCard {
	const titleEl = el.querySelector("a.card-title");
	const href = Attr(titleEl, "href") || Attr(el.querySelector("a.poster-link"), "href");
	if (!titleEl || !href) throw new NotFoundError("Anime card title not found");

	const isOngoing = !!el.querySelector(".ongoing-badge");
	const bottom = Text(el.querySelector(".poster-bottom"));
	const lastEpisode = Text(el.querySelector(".card-last-episode strong"));
	const bottomEpisode = bottom.match(/(\d+)\s*episode/i)?.[1] ?? "";

	const meta = el.querySelector(".card-meta");
	const metaParts = meta
		? meta.childNodes.map((node) => node.text.trim()).filter(Boolean)
		: [];
	const date = metaParts.find((part) => /^\d{4}$/.test(part)) ?? "";
	const genres = metaParts.filter((part) => !/^\d{4}$/.test(part));

	return {
		title: Text(titleEl),
		slug: slugFromHref(href),
		poster: posterFromImg(el.querySelector("img.poster-image")),
		rating: Text(el.querySelector(".score-badge")),
		episode: lastEpisode || bottomEpisode,
		studio: "",
		categories: genres.map(genreLink),
		status: isOngoing ? "Ongoing" : bottomEpisode ? "Completed" : "",
		type: Text(el.querySelector(".format-badge")),
		isBatch: false,
		isStreaming: true,
		sourceUrl: absolute(href),
		date,
	};
}

function parseCards(root: HTMLElement | null): Nimegami.AnimeCard[] {
	if (!root) return [];
	const cards: Nimegami.AnimeCard[] = [];
	const seen = new Set<string>();
	for (const el of root.querySelectorAll("article.anime-card")) {
		try {
			const card = parseCard(el);
			if (seen.has(card.slug)) continue;
			seen.add(card.slug);
			cards.push(card);
		} catch {
			continue;
		}
	}
	return cards;
}

function findSection(doc: HTMLElement, heading: RegExp): HTMLElement | null {
	return (
		doc
			.querySelectorAll("section")
			.find((section) => heading.test(Text(section.querySelector("h1, h2")))) ?? null
	);
}

export function parseHome(doc: HTMLElement): Nimegami.Home {
	const latest = parseCards(findSection(doc, /rilis terbaru/i));
	const recommended = parseCards(findSection(doc, /sayang kalau dilewatkan/i));

	if (latest.length === 0 && recommended.length === 0) {
		throw new NotFoundError("No anime found on home page");
	}

	return { latest, recommended };
}

/** Halaman katalog: `/anime/`, `/category/:slug/`, hasil filter dan pencarian. */
export function parseAnimeList(doc: HTMLElement): Nimegami.AnimeCard[] {
	return parseCards(doc);
}

export function parseSearchResults(doc: HTMLElement): Nimegami.AnimeCard[] {
	return parseAnimeList(doc);
}

export function parseAnimeByGenre(doc: HTMLElement): Nimegami.AnimeCard[] {
	return parseAnimeList(doc);
}

/** Tautan paginasi berbentuk `?page=N` atau `/page/N/`; total diambil dari nomor terbesar. */
export function parsePagination(doc: HTMLElement, currentPage = 1): Pagination | null {
	let totalPages = currentPage;
	for (const link of doc.querySelectorAll("a[href]")) {
		const href = Attr(link, "href");
		const match = href.match(/[?&]page=(\d+)/) ?? href.match(/\/page\/(\d+)\/?$/);
		if (match) totalPages = Math.max(totalPages, parseInt(match[1], 10));
	}

	const hasPrevPage = currentPage > 1;
	const hasNextPage = currentPage < totalPages;

	return {
		currentPage,
		prevPage: hasPrevPage ? currentPage - 1 : null,
		nextPage: hasNextPage ? currentPage + 1 : null,
		totalPages,
		hasPrevPage,
		hasNextPage,
	};
}

export function parseGenreCategories(doc: HTMLElement): UrlLink[] {
	return doc.querySelectorAll("a.genre-tile").map((tile) => {
		const count = Text(tile.querySelector("p")).match(/[\d.]+/)?.[0]?.replace(/\./g, "");
		const name = Text(tile.querySelector("h2"));
		return {
			title: count ? `${name} (${count})` : name,
			url: absolute(Attr(tile, "href")),
		};
	});
}

/* ===== Detail & episode ===== */

type LdNode = Record<string, unknown> & { "@type"?: string | string[] };

function readJsonLd(doc: HTMLElement): LdNode[] {
	const nodes: LdNode[] = [];
	for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
		try {
			const json = JSON.parse(script.text);
			const graph = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
			nodes.push(...graph);
		} catch {
			continue;
		}
	}
	return nodes;
}

function isType(node: LdNode, types: string[]): boolean {
	const value = node["@type"];
	const list = Array.isArray(value) ? value : [value];
	return list.some((type) => typeof type === "string" && types.includes(type));
}

function infoValue(doc: HTMLElement, label: string): string {
	const row = doc
		.querySelectorAll("dl div")
		.find((div) => Text(div.querySelector("dt")).toLowerCase() === label.toLowerCase());
	const value = Text(row?.querySelector("dd") ?? null);
	return /^belum tersedia$/i.test(value) ? "" : value;
}

interface RscLink {
	id: string;
	url?: string;
	playUrl?: string;
	mode?: string;
	provider?: string;
	label?: string;
	quality?: string;
	kind?: string;
	episode?: number;
	filename?: string;
}

function readRscPayload(html: string): string {
	const marker = 'self.__next_f.push([1,"';
	let payload = "";
	let start = html.indexOf(marker);
	while (start !== -1) {
		const from = start + marker.length;
		let end = from;
		while (end < html.length && html[end] !== '"') {
			end += html[end] === "\\" ? 2 : 1;
		}
		try {
			payload += JSON.parse(`"${html.slice(from, end)}"`);
		} catch {}
		start = html.indexOf(marker, end);
	}
	return payload;
}

function readLinks(html: string): RscLink[] {
	const payload = readRscPayload(html);
	const links = new Map<string, RscLink>();
	for (const raw of payload.match(/\{"id":"[^{}]*"playUrl"[^{}]*\}/g) ?? []) {
		try {
			const link = JSON.parse(raw) as RscLink;
			if (link.id && !links.has(link.id)) links.set(link.id, link);
		} catch {
			continue;
		}
	}
	return [...links.values()];
}

function qualityRank(quality = ""): number {
	return parseInt(quality, 10) || 0;
}

function toDownloadFormats(links: RscLink[]): Format[] {
	const formats = new Map<string, Map<string, UrlLink[]>>();
	for (const link of links) {
		const url = link.url || link.playUrl;
		if (!url) continue;
		const isMkv = /\.mkv\b/i.test(link.filename ?? "") || /mkv/i.test(link.label ?? "");
		const format = isMkv ? "MKV" : "MP4";
		const quality = link.quality || "Default";
		const byQuality = formats.get(format) ?? new Map<string, UrlLink[]>();
		const list = byQuality.get(quality) ?? [];
		list.push({ title: link.label || link.provider || "Download", url });
		byQuality.set(quality, list);
		formats.set(format, byQuality);
	}

	return [...formats].map(([title, byQuality]) => ({
		title,
		qualityList: [...byQuality]
			.sort(([a], [b]) => qualityRank(a) - qualityRank(b))
			.map(([quality, urlList]) => ({ title: quality, size: "", urlList })),
	}));
}

function episodeNumbers(ld: LdNode[], links: RscLink[]): Nimegami.EpisodeItem[] {
	const episodes = new Map<number, string>();
	for (const node of ld) {
		if (!isType(node, ["TVEpisode"])) continue;
		const number = Number(node.episodeNumber);
		if (Number.isFinite(number)) episodes.set(number, `Episode ${number}`);
	}
	for (const link of links) {
		if (typeof link.episode === "number" && !episodes.has(link.episode)) {
			episodes.set(link.episode, `Episode ${link.episode}`);
		}
	}
	if (episodes.size === 0 && links.length > 0) episodes.set(1, "Episode 1");

	return [...episodes]
		.sort(([a], [b]) => a - b)
		.map(([episode, title]) => ({ episode, title, url: "" }));
}

function linksForEpisode(links: RscLink[], episode: number, total: number): RscLink[] {
	return links.filter((link) =>
		typeof link.episode === "number" ? link.episode === episode : total <= 1,
	);
}

export function parseAnimeDetails(doc: HTMLElement, html: string): Nimegami.AnimeDetails {
	const ld = readJsonLd(doc);
	const series = ld.find((node) => isType(node, ["TVSeries", "Movie", "CreativeWork"]));
	const title = Text(doc.querySelector("h1")) || String(series?.name ?? "");
	if (!title) throw new NotFoundError("Anime not found");

	const links = readLinks(html);
	const episodeList = episodeNumbers(ld, links).map((item) => ({
		...item,
		url: `${baseUrl}/${slugFromHref(String(series?.url ?? ""))}/#episode_${item.episode}`,
	}));
	const genres = Array.isArray(series?.genre) ? (series.genre as string[]) : [];
	const rating = Text(doc.querySelector('[data-rating-score="info"]')).match(/[\d.]+/)?.[0] ?? "";

	return {
		title,
		alternativeTitle: infoValue(doc, "Judul alternatif") || infoValue(doc, "Judul asli"),
		poster: absolute(String(series?.image ?? "")),
		rating,
		studio: infoValue(doc, "Studio"),
		season: infoValue(doc, "Musim") || infoValue(doc, "Mulai tayang"),
		type: infoValue(doc, "Tipe"),
		series: infoValue(doc, "Status"),
		categories: genres.map(genreLink),
		credit: "",
		synopsis: String(series?.description ?? ""),
		duration: infoValue(doc, "Durasi"),
		downloadLinks: toDownloadFormats(links),
		episodeList,
	};
}

export function parseEpisodeDetails(
	doc: HTMLElement,
	html: string,
	animeSlug: string,
	episode: number,
): Nimegami.EpisodeDetails {
	const ld = readJsonLd(doc);
	const series = ld.find((node) => isType(node, ["TVSeries", "Movie", "CreativeWork"]));
	const links = readLinks(html);
	const episodes = episodeNumbers(ld, links).map((item) => item.episode);

	if (!episodes.includes(episode)) {
		throw new NotFoundError(`Episode ${episode} not found`);
	}

	const episodeLinks = linksForEpisode(links, episode, episodes.length);
	const streamSources = episodeLinks
		.filter((link) => link.mode === "embed" && link.playUrl)
		.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
		.map((link) => ({
			format: [link.label || link.provider, link.quality].filter(Boolean).join(" "),
			url: link.playUrl as string,
		}));

	const index = episodes.indexOf(episode);
	const animeTitle = Text(doc.querySelector("h1")) || String(series?.name ?? "");

	return {
		title: `${animeTitle} Episode ${episode}`,
		episode,
		poster: absolute(String(series?.image ?? "")),
		animeSlug,
		streamSources,
		downloadLinks: toDownloadFormats(episodeLinks),
		navigation: {
			prev: index > 0 ? episodes[index - 1] : null,
			next: index < episodes.length - 1 ? episodes[index + 1] : null,
		},
	};
}
