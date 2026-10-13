import { describe, expect, test } from "bun:test";
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
