import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import * as parser from "../src/parsers/anichin.js";

const scheduleDoc = () =>
	parse(readFileSync(join(import.meta.dir, "fixtures", "anichin-schedule.html"), "utf8"));

describe("anichin schedule parser", () => {
	test("membaca 8 hari dari .listSchh", () => {
		const days = parser.parseSchedule(scheduleDoc());
		expect(days).toHaveLength(8);
		expect(days.map((d) => d.day)).toContain("Senin");
		expect(days.map((d) => d.day)).toContain("Acak");
	});

	test("tiap hari punya anime dengan slug bersih", () => {
		const days = parser.parseSchedule(scheduleDoc());
		for (const day of days) {
			expect(day.animeList.length).toBeGreaterThan(0);
			for (const anime of day.animeList) {
				expect(anime.title).not.toBe("");
				expect(anime.slug).not.toBe("");
				// slug tidak boleh berawalan/trailing slash, dan prefix /anime/ dibuang
				expect(anime.slug.startsWith("/")).toBe(false);
				expect(anime.slug.endsWith("/")).toBe(false);
				expect(anime.slug.startsWith("anime/")).toBe(false);
			}
		}
	});

	test("total anime schedule > 30 dan tanpa duplikat dalam satu hari", () => {
		const days = parser.parseSchedule(scheduleDoc());
		const total = days.reduce((n, d) => n + d.animeList.length, 0);
		expect(total).toBeGreaterThan(30);
		for (const day of days) {
			const slugs = day.animeList.map((a) => a.slug);
			expect(new Set(slugs).size).toBe(slugs.length);
		}
	});

	test("slug campuran /anime/<slug>/ dan /<slug>/ ternormalisasi", () => {
		const days = parser.parseSchedule(scheduleDoc());
		const all = days.flatMap((d) => d.animeList);
		// Supreme God Emperor memakai /anime/supreme-god-emperor/
		const sge = all.find((a) => a.title.includes("Supreme God Emperor"));
		expect(sge?.slug).toBe("supreme-god-emperor");
		// Apotheosis memakai /apotheosis/ (tanpa prefix /anime/)
		const apo = all.find((a) => a.title.includes("Apotheosis"));
		expect(apo?.slug).toBe("apotheosis");
	});

	test("html tanpa .listSchh menghasilkan array kosong", () => {
		expect(parser.parseSchedule(parse("<div></div>"))).toEqual([]);
	});
});
