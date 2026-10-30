import { HTMLElement } from "node-html-parser";
import { NotFoundError } from "../lib/errors.js";
import { Text, Id, Src, Num, Attr, AnimeSrc } from "./utils.js";
import type { Kuramanime, Format, Quality, UrlLink, Pagination } from "../types/index.js";
import { sources } from "../config/index.js";

const baseUrl = sources.kuramanime.baseUrl;

function parseAnimeId(el: HTMLElement): string {
	const href = Attr(el, "href");
	const match = href.match(/\/anime\/(\d+)/);
	return match?.[1] || "";
}

function slide(el: HTMLElement | null, attr: string): string {
	if (!el) return "";
	return el.getAttribute(`data-${attr}`) || el.getAttribute(attr) || "";
}

function getPoster(el: HTMLElement): string {
	const picEl = el.querySelector(".product__item__pic");
	if (picEl) {
		const dataBg = slide(picEl, "setbg");
		if (dataBg) return dataBg;
		const style = Attr(picEl, "style") || "";
		const bgMatch = style.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/i);
		if (bgMatch) return bgMatch[1];
	}
	const img = el.querySelector("img");
	if (img) return Src(img);
	return "";
}

function parseAnimeCard(el: HTMLElement): Kuramanime.AnimeCard {
	const titleEl = el.querySelector(".product__item__text h5 a");
	if (!titleEl) throw new NotFoundError("Anime card title not found");

	return {
		title: Text(titleEl),
		slug: parseAnimeId(titleEl) || Id(titleEl),
		poster: getPoster(el),
		type: Text(el.querySelector(".product__item__text .type")),
		quality: Text(el.querySelector(".product__item__text .quality")),
		highlight: Text(el.querySelector(".ep")),
		sourceUrl: AnimeSrc(titleEl, baseUrl),
	};
}

function parseBatchQualityList(container: HTMLElement): Quality[] {
	const qualityList: Quality[] = [];
	const items = container.querySelectorAll("ul li, p");
	for (const item of items) {
		const text = Text(item);
		if (!text) continue;

		const sizeMatch = text.match(/([\d.]+)\s*(Mb|MB|GB|KB)/i);
		const size = sizeMatch ? sizeMatch[0] : "";

		const strongEl = item.querySelector("strong");
		const qualityTitle = strongEl ? Text(strongEl) : text.split(/[-–]/)[0]?.trim() || text;

		const urlList: UrlLink[] = [];
		const links = item.querySelectorAll("a");
		for (const link of links) {
			urlList.push({
				title: Text(link),
				url: AnimeSrc(link, baseUrl) || "",
			});
		}

		if (urlList.length) {
			qualityList.push({ title: qualityTitle, size, urlList });
		}
	}
	return qualityList;
}

export function parseHome(doc: HTMLElement): Kuramanime.Home {
	const sections = doc.querySelectorAll(".trending__product");
	if (!sections.length) throw new NotFoundError("No trending sections found");

	const result: Kuramanime.Home = { ongoing: [], completed: [], movie: [] };

	for (const section of sections) {
		const heading = Text(section.querySelector("h4")).toLowerCase();
		const items = section.querySelectorAll(".product__item");
		if (!items.length) continue;

		const cards: Kuramanime.AnimeCard[] = [];
		for (const item of items) {
			cards.push(parseAnimeCard(item));
		}

		if (heading.includes("sedang") || heading.includes("ongoing")) {
			result.ongoing = cards;
		} else if (heading.includes("selesai") || heading.includes("completed")) {
			result.completed = cards;
		} else if (heading.includes("film") || heading.includes("movie")) {
			result.movie = cards;
		}
	}

	if (!result.ongoing.length && !result.completed.length && !result.movie.length) {
		throw new NotFoundError("No anime found on home page");
	}

	return result;
}

export function parseAnimes(doc: HTMLElement): Kuramanime.AnimeCard[] {
	const items = doc.querySelectorAll("#animeList .product__item");
	if (!items.length) throw new NotFoundError("No anime cards found");

	const result: Kuramanime.AnimeCard[] = [];
	for (const item of items) {
		result.push(parseAnimeCard(item));
	}
	return result;
}

export function parseScheduledAnimes(doc: HTMLElement): Kuramanime.ScheduledAnime[] {
	const items = doc.querySelectorAll(".schedule__item, .schedule-item, table tr");
	if (!items.length) throw new NotFoundError("No scheduled anime found");

	const result: Kuramanime.ScheduledAnime[] = [];
	for (const item of items) {
		if (item.tagName === "TR" || item.tagName === "tr") {
			const th = item.querySelector("th");
			if (th) continue;
		}

		const titleEl = item.querySelector("a");
		if (!titleEl) continue;

		result.push({
			title: Text(titleEl),
			slug: parseAnimeId(titleEl) || Id(titleEl),
			poster: Src(item.querySelector("img")) || getPoster(item),
			day: Text(item.querySelector(".day")),
			releaseTime: Text(item.querySelector(".time, .release-time")),
			type: Text(item.querySelector(".type")),
			sourceUrl: AnimeSrc(titleEl, baseUrl),
		});
	}

	if (!result.length) throw new NotFoundError("No scheduled anime found");
	return result;
}

/**
 * Daftar episode di halaman detail Kuramanime tidak selalu berupa elemen:
 * sebagian halaman menyimpannya sebagai markup ter-escape di
 * `#episodeLists[data-content]`. `parseEpisodeNumbers` sudah membaca bentuk itu
 * untuk `episodeRange`, jadi dipakai juga di sini sebagai cadangan.
 */
export function parseEpisodes(
	doc: HTMLElement,
	context?: { animeId?: string; animeSlug?: string; poster?: string },
): Kuramanime.EpisodeCard[] {
	const items = doc.querySelectorAll(".episode__item, .episode-item");

	if (items.length) {
		const result: Kuramanime.EpisodeCard[] = [];
		for (const item of items) {
			const titleEl = item.querySelector("a");
			if (!titleEl) continue;

			result.push({
				title: Text(titleEl),
				slug: parseAnimeId(titleEl) || Id(titleEl),
				episode: Num(item.querySelector(".episode-badge, .ep-badge")),
				total: Num(item.querySelector(".total-badge, .total")),
				poster: Src(item.querySelector("img")) || getPoster(item),
				sourceUrl: AnimeSrc(titleEl, baseUrl),
			});
		}

		if (result.length) return result;
	}

	const numbers = parseEpisodeNumbers(doc);
	if (!numbers.length) throw new NotFoundError("No episodes found");

	// Tanpa elemen, judul dan poster diambil dari halaman detail anime itu sendiri.
	const animeTitle =
		Text(doc.querySelector(".anime__details__title h3")) ||
		Text(doc.querySelector(".anime__details__title"));
	const poster =
		context?.poster || Attr(doc.querySelector(".anime__details__pic"), "data-setbg");
	const total = numbers[numbers.length - 1] ?? 0;

	return numbers.map((episode) => ({
		title: animeTitle ? `${animeTitle} Episode ${episode}` : `Episode ${episode}`,
		slug: context?.animeId ?? "",
		episode,
		total,
		poster,
		sourceUrl: context?.animeId && context.animeSlug
			? `${baseUrl}/anime/${context.animeId}/${context.animeSlug}/episode/${episode}`
			: undefined,
	}));
}

/**
 * Tautan properti Kuramanime membawa query (`action?order_by=text&…`) yang
 * ikut terbaca sebagai id. Query dibuang supaya id bisa dipakai kembali di URL.
 */
function cleanPropertyId(value: string): string {
	return value.split("?")[0] ?? value;
}

export function parseProperties(doc: HTMLElement): Kuramanime.PropertyCard[] {
	const items = doc.querySelectorAll("#animeList ul li a");
	if (!items.length) throw new NotFoundError("No properties found");

	const result: Kuramanime.PropertyCard[] = [];
	for (const item of items) {
		const href = Attr(item, "href") || "";
		let propertyType = "";
		if (href.includes("/genres/") || href.includes("/genre/")) propertyType = "genre";
		else if (href.includes("/studios/") || href.includes("/studio/")) propertyType = "studio";
		else if (href.includes("/themes/") || href.includes("/theme/")) propertyType = "theme";
		else if (href.includes("/demos/") || href.includes("/demo/")) propertyType = "demo";

		result.push({
			title: Text(item),
			propertyId: cleanPropertyId(Id(item)),
			propertyType,
			sourceUrl: AnimeSrc(item, baseUrl)?.trim(),
		});
	}

	return result;
}

/**
 * Blok info detail berbentuk `<li><div class="row"><div class="col-3"><span>
 * Label:</span></div><div class="col-9">nilai</div></div></li>`.
 * Dibaca berdasarkan label, bukan urutan indeks.
 */
function parseDetailWidget(doc: HTMLElement): {
	values: Record<string, string>;
	links: Record<string, Kuramanime.PropertyCard[]>;
} {
	const values: Record<string, string> = {};
	const links: Record<string, Kuramanime.PropertyCard[]> = {};

	for (const row of doc.querySelectorAll(".anime__details__widget li .row, .anime__details__widget .row")) {
		const cols = row.querySelectorAll("div");
		if (cols.length < 2) continue;

		const label = Text(cols[0]).replace(/\s*:\s*$/, "").trim().toLowerCase();
		if (!label || values[label] !== undefined) continue;

		values[label] = Text(cols[1]).replace(/\s+/g, " ").trim();

		const anchors = cols[1].querySelectorAll("a");
		if (anchors.length) {
			links[label] = anchors.map((link) => ({
				title: Text(link).replace(/,\s*$/, "").trim(),
				propertyId: cleanPropertyId(Id(link)),
				propertyType: label,
				sourceUrl: AnimeSrc(link, baseUrl)?.trim(),
			}));
		}
	}

	return { values, links };
}

/**
 * Daftar episode tersimpan sebagai markup ter-escape di atribut `data-content`
 * milik `#episodeLists`, bukan sebagai elemen biasa — jadi harus di-parse ulang.
 */
function parseEpisodeNumbers(doc: HTMLElement): number[] {
	const el = doc.querySelector("#episodeLists");
	const raw = el ? Attr(el, "data-content") : "";
	if (!raw) return [];

	const numbers = new Set<number>();
	for (const match of raw.matchAll(/\/episode\/(\d+)/g)) {
		const n = parseInt(match[1], 10);
		if (!isNaN(n)) numbers.add(n);
	}

	return [...numbers].sort((a, b) => a - b);
}

export function parseAnimeDetails(doc: HTMLElement): Kuramanime.AnimeDetails {
	const detailContainer = doc.querySelector(".anime__details__content");
	if (!detailContainer) throw new NotFoundError("Anime detail container not found");

	const titleEl = detailContainer.querySelector(".anime__details__title h3");
	if (!titleEl) throw new NotFoundError("Anime detail title not found");

	// `h3` juga memuat span kosong untuk badge, jadi ambil span pertama yang berisi.
	const altTitle = detailContainer
		.querySelectorAll(".anime__details__title span")
		.map((el) => Text(el))
		.find((text) => text.length > 0) ?? "";

	// Poster disimpan di atribut `data-setbg`, bukan sebagai <img>.
	const picEl = detailContainer.querySelector(".anime__details__pic");
	const poster = picEl ? Attr(picEl, "data-setbg") : "";

	const paragraphList: string[] = [];
	const synopsisEl = doc.querySelector("#synopsisField");
	if (synopsisEl) {
		for (const part of Text(synopsisEl).split(/\n+/)) {
			const t = part.trim();
			if (t) paragraphList.push(t);
		}
	}

	const episodes = parseEpisodeNumbers(doc);
	const episodeRange = episodes.length
		? { first: episodes[0], last: episodes[episodes.length - 1] }
		: { first: 0, last: 0 };

	const { values, links } = parseDetailWidget(doc);

	const info: Record<string, string> = {
		type: values["tipe"] ?? "",
		status: values["status"] ?? "",
		season: values["musim"] ?? "",
		quality: values["kualitas"] ?? "",
		country: values["negara"] ?? "",
		source: values["adaptasi"] ?? "",
		aired: values["tayang"] ?? "",
		duration: values["durasi"] ?? "",
		totalEpisodes: values["episode"] ?? "",
		score: values["skor"] ?? "",
		producer: values["kredit"] ?? "",
		studio: values["studio"] ?? "",
	};

	const batchList: UrlLink[] = [];
	for (const b of doc.querySelectorAll("[href*='batch']")) {
		batchList.push({
			title: Text(b),
			url: AnimeSrc(b, baseUrl) || "",
		});
	}

	const similarAnime: Kuramanime.AnimeCard[] = [];
	for (const item of doc.querySelectorAll(".anime__item, .product__item")) {
		try {
			similarAnime.push(parseAnimeCard(item));
		} catch {
			// lewati kartu yang tidak lengkap
		}
	}

	return {
		title: Text(titleEl),
		alternativeTitle: altTitle,
		poster,
		synopsis: { paragraphList },
		episodeRange,
		info,
		properties: links,
		genreList: links["genre"] ?? [],
		themeList: links["tema"] ?? [],
		demoList: links["demografis"] ?? [],
		studioList: links["studio"] ?? [],
		batchList,
		similarAnime,
	};
}

export function parseBatchDetails(doc: HTMLElement): Kuramanime.BatchDetails {
	const titleEl = doc.querySelector("h1");
	if (!titleEl) throw new NotFoundError("Batch title not found");

	const posterEl = doc.querySelector(".poster img, .product__details__pic img");

	const formatList: Format[] = [];
	const formatContainers = doc.querySelectorAll(".batch__download .format, .download-format");
	if (!formatContainers.length) {
		const downloadLinks = doc.querySelectorAll("#animeDownloadLink h6, .download-link h6");
		for (const link of downloadLinks) {
			const parent = link.parentNode as HTMLElement | null;
			if (!parent) continue;
			const qualityList = parseBatchQualityList(parent);
			if (qualityList.length) {
				formatList.push({ title: Text(link), qualityList });
			}
		}
	} else {
		for (const container of formatContainers) {
			const formatTitleEl = container.querySelector("h4, h5, strong");
			if (!formatTitleEl) continue;
			const qualityList = parseBatchQualityList(container);
			formatList.push({ title: Text(formatTitleEl), qualityList });
		}
	}

	if (!formatList.length) throw new NotFoundError("No batch download links found");

	return {
		title: Text(titleEl),
		poster: Src(posterEl),
		formatList,
	};
}

/**
 * `#animeDownloadLink` berisi deretan `<h6>` ("MKV 480p (Softsub) — (147.85 MB)")
 * yang masing-masing diikuti tautan unduhannya. Tautan yang belum aktif
 * (`link-disabled`, tanpa href) dilewati.
 */
function parseDownloadSection(doc: HTMLElement): Format[] {
	const container = doc.querySelector("#animeDownloadLink");
	if (!container) return [];

	const formats = new Map<string, Quality[]>();
	let current: Quality | null = null;

	for (const el of container.childNodes) {
		if (!(el instanceof HTMLElement)) continue;
		if (el.tagName === "H6") {
			const heading = Text(el);
			const match = heading.match(/^(\S+)\s+(.+?)\s*(?:—|-)\s*\(([^)]+)\)\s*$/);
			const format = match?.[1] ?? "Download";
			current = { title: match?.[2] ?? heading, size: match?.[3] ?? "", urlList: [] };
			formats.set(format, [...(formats.get(format) ?? []), current]);
		} else if (el.tagName === "A" && current) {
			const href = Attr(el, "href");
			if (href && !href.startsWith("javascript")) current.urlList?.push({ title: Text(el), url: href });
		}
	}

	return [...formats]
		.map(([title, qualityList]) => ({ title, qualityList: qualityList.filter((q) => q.urlList?.length) }))
		.filter((format) => format.qualityList.length);
}

export function parseEpisodeDetails(doc: HTMLElement): Kuramanime.EpisodeDetails {
	const titleEl = doc.querySelector("#episodeTitle, h1");
	const title = titleEl
		? Text(titleEl)
		: Text(doc.querySelector("title")).replace(/\s*-\s*Kuramanime\s*$/i, "");
	if (!title) throw new NotFoundError("Episode title not found");

	// Tautan yang tidak tersedia tetap dirender, tapi diberi `nav__disabled`
	// dan menunjuk ke episode yang sedang dibuka.
	const navLinks = doc.querySelectorAll(
		".episode__navigations a.before__nav, .episode__navigations a.after__nav, .episode__nav a, .episode-navigation a",
	);
	let prev: Kuramanime.EpisodeCard | null = null;
	let next: Kuramanime.EpisodeCard | null = null;
	for (const link of navLinks) {
		const text = Text(link).toLowerCase();
		const href = Attr(link, "href");
		if (!href || href.includes("javascript") || link.classList.contains("nav__disabled")) continue;

		const card: Kuramanime.EpisodeCard = {
			title: Text(link),
			slug: parseAnimeId(link) || Id(link),
			episode: Num(link),
			total: 0,
			poster: "",
			sourceUrl: AnimeSrc(link, baseUrl),
		};

		if (link.classList.contains("before__nav") || text.includes("prev") || text.includes("sebelumnya")) {
			prev = card;
		} else if (link.classList.contains("after__nav") || text.includes("next") || text.includes("selanjutnya")) {
			next = card;
		}
	}

	const streaming: UrlLink[] = [];
	const hlsSrc = Attr(doc.querySelector("#player"), "data-hls-src");
	if (hlsSrc) streaming.push({ title: "HLS", url: hlsSrc });

	// Kuramadrive menaruh tiap resolusi sebagai <source size="720">.
	for (const src of doc.querySelectorAll("#player source")) {
		const url = Attr(src, "src");
		if (!url) continue;
		const size = Attr(src, "size");
		streaming.push({ title: size ? `${size}p` : Attr(src, "type") || "Unknown", url });
	}
	if (!streaming.length) {
		const iframes = doc.querySelectorAll("#player iframe, .player iframe");
		for (const iframe of iframes) {
			const url = Attr(iframe, "src");
			if (url) streaming.push({ title: "iframe", url });
		}
	}

	const downloadLinks: Format[] = parseDownloadSection(doc);
	const downloadContainers = doc.querySelectorAll(".download-format, .episode__download");
	for (const container of downloadContainers) {
		const formatTitleEl = container.querySelector("h4, h5, strong");
		if (!formatTitleEl) continue;
		const qualityList = parseBatchQualityList(container);
		downloadLinks.push({ title: Text(formatTitleEl), qualityList });
	}

	const lastUpdatedEl = doc.querySelector(".last-updated, .update-date, .episode__info .date");
	const lastUpdated = lastUpdatedEl ? Text(lastUpdatedEl) : "";

	const infoEl = doc.querySelector(".episode__info, .episode-info");
	const info = infoEl ? Text(infoEl) : "";

	return {
		title: Text(titleEl),
		navigation: { prev, next },
		streaming,
		downloadLinks,
		lastUpdated,
		info,
	};
}

export function parsePagination(doc: HTMLElement): Pagination | null {
	const nav = doc.querySelector(".product__pagination");
	if (!nav) return null;

	const links = nav.querySelectorAll("a, span");
	if (!links.length) return null;

	let currentPage = 1;
	let totalPages = 1;
	let hasPrev = false;
	let hasNext = false;

	for (const link of links) {
		const cls = link.classNames || "";
		const text = Text(link);
		const href = Attr(link, "href");
		const num = parseInt(text, 10);

		if (cls.includes("current") || cls.includes("active") || (!isNaN(num) && !href)) {
			currentPage = num || currentPage;
		}

		if (cls.includes("prev") || /^(prev|previous)$/i.test(text)) {
			hasPrev = !!href;
		}

		if (cls.includes("next") || /^next$/i.test(text)) {
			hasNext = !!href;
		}

		if (!isNaN(num) && num > totalPages) {
			totalPages = num;
		}
	}

	if (hasPrev || hasNext || totalPages > 1) {
		return {
			currentPage,
			prevPage: hasPrev ? currentPage - 1 : null,
			nextPage: hasNext ? currentPage + 1 : null,
			totalPages,
			hasPrevPage: hasPrev,
			hasNextPage: hasNext,
		};
	}

	return null;
}
