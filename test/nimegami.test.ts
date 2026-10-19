import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import * as parser from "../src/parsers/nimegami.js";
import * as scraper from "../src/scrapers/nimegami.js";
import { fixture } from "./helpers.js";

const raw = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

describe("nimegami parser", () => {
	test("beranda: rilis terbaru dan rekomendasi", () => {
		const home = parser.parseHome(fixture("nimegami-home.html"));
		expect(home.latest).toHaveLength(12);
		expect(home.recommended).toHaveLength(6);
		const first = home.latest[0];
		expect(first.slug).toBe("kanata-kara-sub-indo");
		expect(first.poster).toStartWith("https://nimegami.id/assets/");
		expect(first.status).toBe("Ongoing");
	});

	test("katalog genre: 24 kartu dan paginasi dari tautan terakhir", () => {
		const doc = fixture("nimegami-category.html");
		const cards = parser.parseAnimeList(doc);
		expect(cards).toHaveLength(24);
		for (const card of cards) {
			expect(card.title).not.toBe("");
			expect(card.slug).not.toBe("");
		}
		expect(parser.parsePagination(doc, 1)).toMatchObject({ totalPages: 60, hasNextPage: true, nextPage: 2 });
	});

	test("daftar genre beserta jumlah judul", () => {
		const genres = parser.parseGenreCategories(fixture("nimegami-genre.html"));
		expect(genres.length).toBeGreaterThan(50);
		expect(genres[0]).toEqual({ title: "Action (1420)", url: "https://nimegami.id/category/action/" });
	});

	test("detail anime dari JSON-LD dan info", () => {
		const html = raw("nimegami-anime.html");
		const detail = parser.parseAnimeDetails(fixture("nimegami-anime.html"), html);
		expect(detail.title).toBe("Kanata kara");
		expect(detail.studio).toBe("Studio Deen");
		expect(detail.categories.map((genre) => genre.title)).toContain("Fantasy");
		expect(detail.episodeList.map((episode) => episode.episode)).toEqual([1, 2, 3]);
	});

	test("episode: stream embed, unduhan, dan navigasi", () => {
		const html = raw("nimegami-anime.html");
		const episode = parser.parseEpisodeDetails(fixture("nimegami-anime.html"), html, "kanata-kara-sub-indo", 2);
		expect(episode.streamSources.length).toBeGreaterThan(0);
		expect(episode.downloadLinks.length).toBeGreaterThan(0);
		expect(episode.navigation).toEqual({ prev: 1, next: 3 });
	});
});

describe("nimegami player", () => {
	test("pembungkus desustream di worker dikenali, pemutar lain tidak", () => {
		expect(scraper.isWrappedPlayer("https://workers-anime.berkasdrive.com/https://desustream.net/dstream/odcdn/?id=x")).toBe(true);
		expect(scraper.isWrappedPlayer("https://video.example.workers.dev/https://desustream.net/dstream/arcg/?id=x")).toBe(true);
		expect(scraper.isWrappedPlayer("https://workers-anime.berkasdrive.com/https://cdn.odcloud.net/anime/a.mp4")).toBe(false);
		expect(scraper.isWrappedPlayer("https://odvidhide.com/embed/abc")).toBe(false);
	});
});
