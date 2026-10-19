import { describe, expect, test } from "bun:test";
import * as parser from "../src/parsers/otakudesu.js";
import { extractPlayerVideoUrl, isUnembeddable } from "../src/scrapers/otakudesu.js";
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

describe("extractPlayerVideoUrl", () => {
	test("desudrive: file Google Drive dari pemanggilan otakudesu()", () => {
		const html = `<script>otakudesu('{"file":"https://www.googleapis.com/drive/v3/files/abc?alt=media&key=k","img":"https://drive.google.com/thumbnail?id=abc"}');</script>`;
		expect(extractPlayerVideoUrl(html)).toBe("https://www.googleapis.com/drive/v3/files/abc?alt=media&key=k");
	});

	test("desuwatch: <source> googlevideo", () => {
		const html = `<video><source src="https://rr1.googlevideo.com/videoplayback?id=1&amp;itag=18" type="video/mp4"></video>`;
		expect(extractPlayerVideoUrl(html)).toBe("https://rr1.googlevideo.com/videoplayback?id=1&itag=18");
	});

	test("tanpa URL video", () => {
		expect(extractPlayerVideoUrl("<script>var file = e.file</script>")).toBeNull();
	});
});
