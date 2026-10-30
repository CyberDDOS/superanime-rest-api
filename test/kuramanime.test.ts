import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import * as parser from "../src/parsers/kuramanime.js";
import { isKdriveMirror } from "../src/scrapers/kuramanime.js";
import { fixture } from "./helpers.js";

describe("kuramanime episode parser", () => {
	const data = parser.parseEpisodeDetails(fixture("kuramanime-episode.html"));

	test("judul diambil dari #episodeTitle", () => {
		expect(data.title).toContain("Shinja Zero no Megami-sama");
		expect(data.title).toContain("Episode 01");
	});

	test("tiap resolusi <source size> jadi satu stream", () => {
		expect(data.streaming.map((stream) => stream.title)).toEqual(["720p", "480p", "360p"]);
		for (const stream of data.streaming) {
			expect(stream.url).toStartWith("https://");
			expect(stream.url).not.toContain("&amp;");
		}
	});

	test("tautan navigasi yang nonaktif diabaikan", () => {
		expect(data.navigation).toEqual({ prev: null, next: null });
	});

	test("tautan unduhan dikelompokkan per format", () => {
		const mp4 = data.downloadLinks.find((format) => format.title === "MP4");
		expect(mp4).toBeDefined();
		expect(mp4?.qualityList[0]?.size).toMatch(/MB$/);
		expect(mp4?.qualityList[0]?.urlList?.length).toBeGreaterThan(0);
	});
});

describe("kuramanime episode list", () => {
	test("halaman detail tanpa elemen episode memakai #episodeLists", () => {
		const doc = fixture("kuramanime-detail-episodes.html");
		const data = parser.parseEpisodes(doc, { animeId: "5123", animeSlug: "dongda-gao-wu-xueyuan" });

		expect(data).toHaveLength(3);
		expect(data.map((ep) => ep.episode)).toEqual([1, 2, 3]);
		expect(data[0]?.slug).toBe("5123");
		expect(data[0]?.title).toContain("Dongda Gao Wu Xueyuan");
		expect(data[0]?.poster).toBe("https://r2.nyomo.my.id/images/contoh.jpg");
		expect(data[0]?.sourceUrl).toBe(
			"https://v20.kuramanime.ing/anime/5123/dongda-gao-wu-xueyuan/episode/1",
		);
	});

	test("total diisi episode terakhir", () => {
		const doc = fixture("kuramanime-detail-episodes.html");
		const data = parser.parseEpisodes(doc, { animeId: "5123", animeSlug: "dongda-gao-wu-xueyuan" });
		expect(data[2]?.total).toBe(3);
	});

	test("jalur elemen .episode__item tetap dipakai lebih dulu", () => {
		const doc = parse(
			'<div class="episode__item"><a href="/anime/99/contoh/episode/5">Episode 5</a><span class="episode-badge">5</span></div>',
		);
		const data = parser.parseEpisodes(doc, { animeId: "99", animeSlug: "contoh" });
		expect(data).toHaveLength(1);
		expect(data[0]?.episode).toBe(5);
		expect(data[0]?.title).toBe("Episode 5");
	});

	test("tanpa data episode sama sekali tetap NotFound", () => {
		const doc = fixture("kuramanime-detail-episodes.html");
		doc.querySelector("#episodeLists")?.setAttribute("data-content", "");
		expect(() => parser.parseEpisodes(doc)).toThrow();
	});
});

describe("isKdriveMirror", () => {
	test("hanya mirror kdrive yang boleh diproxy", () => {
		expect(isKdriveMirror("https://komari.my.id/kdrive/abc/x.mp4?lud=1")).toBe(true);
		expect(isKdriveMirror("https://v1.kuramadrive.com/kdrive/abc")).toBe(true);
		expect(isKdriveMirror("https://example.com/kdrive/x.mp4")).toBe(false);
		expect(isKdriveMirror("http://komari.my.id/kdrive/x.mp4")).toBe(false);
		expect(isKdriveMirror("https://komari.my.id/other/x.mp4")).toBe(false);
		expect(isKdriveMirror("not a url")).toBe(false);
	});
});
