import { describe, expect, test } from "bun:test";
import * as parser from "../src/parsers/otakudesu.js";
import { isUnembeddable } from "../src/scrapers/otakudesu.js";
import { fixture } from "./helpers.js";

describe("otakudesu episode parser", () => {
	const data = parser.parseEpisodeDetails(fixture("otakudesu-episode.html"));

	test("judul dan pemutar default", () => {
		expect(data.title).toBe("Mayo Chiki! Episode 1 Subtitle Indonesia");
		expect(isUnembeddable(data.defaultStreaming)).toBe(true);
	});

	test("hanya mirror yang berisi tautan yang jadi server", () => {
		expect(data.serverList).toEqual([
			{ title: "desuwatch 480p", serverId: "eyJpZCI6NTQ3MjksImkiOjAsInEiOiI0ODBwIn0=" },
		]);
	});
});

describe("isUnembeddable", () => {
	test("mengenali pemutar desustream", () => {
		expect(isUnembeddable("https://desustream.com/dstream/desuwatch/new/index.php?id=x")).toBe(true);
		expect(isUnembeddable("https://www.desustream.info/x")).toBe(true);
		expect(isUnembeddable("https://ondesu.example.com/x")).toBe(false);
	});
});
