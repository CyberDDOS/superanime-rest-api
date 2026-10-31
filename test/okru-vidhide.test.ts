import { describe, expect, test } from "bun:test";
import { extractOkruOptions, isOkruEmbed, resolveOkru } from "../src/lib/okru.js";
import { extractM3u8, resolveVidhide } from "../src/lib/vidhide.js";

// HTML fixture ok.ru: data-options berisi flashvars.metadata sebagai string JSON ter-escape
const metadataJson = JSON.stringify({
	videos: [
		{ name: "mobile", url: "https://vd1.example/video.mp4" },
		{ name: "full", url: "https://vd1.example/full.mp4" },
	],
	movie: { title: "[ANICHIN] Test [1080p]", duration: 468 },
});
const optionsObj = {
	playerId: "vp",
	flashvars: { metadata: metadataJson },
};
const OKRU_HTML = `<!DOCTYPE html><html><body><div id="video_node" data-options="${escapeHtml(
	JSON.stringify(optionsObj),
)}"></div></body></html>`;

// p: 'var l="1://2.3/4.5";' — token 1..5 diganti kata dari k
const VIDHIDE_HTML = `<html><script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('var l="1://2.3/4.5";',6,6,'|https|cdn|com|master|m3u8'.split('|')))</script></html>`;

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mockFetch(html: string, status = 200): typeof fetch {
	return (async () => new Response(html, { status })) as unknown as typeof fetch;
}

describe("okru resolver", () => {
	test("isOkruEmbed mengenali host ok.ru saja", () => {
		expect(isOkruEmbed("https://ok.ru/videoembed/123")).toBe(true);
		expect(isOkruEmbed("https://www.ok.ru/videoembed/123")).toBe(true);
		expect(isOkruEmbed("https://ok.ru.evil.com/videoembed/123")).toBe(false);
		expect(isOkruEmbed("bukan url")).toBe(false);
	});

	test("extractOkruOptions membaca JSON dari data-options", () => {
		const options = extractOkruOptions(OKRU_HTML);
		expect(options.playerId).toBe("vp");
	});

	test("resolveOkru mengembalikan kualitas dan bestUrl", async () => {
		const src = await resolveOkru(
			"https://ok.ru/videoembed/123",
			mockFetch(OKRU_HTML),
		);
		expect(Object.keys(src.qualities).sort()).toEqual(["full", "mobile"]);
		expect(src.bestQuality).toBe("full");
		expect(src.bestUrl).toBe("https://vd1.example/full.mp4");
		expect(src.title).toContain("1080p");
		expect(src.duration).toBe(468);
	});

	test("resolveOkru menerima metadata object (bukan string)", async () => {
		const html = `<!DOCTYPE html><html><body><div data-options="${escapeHtml(
			JSON.stringify({ flashvars: { metadata: JSON.parse(metadataJson) } }),
		)}"></div></body></html>`;
		const src = await resolveOkru("https://ok.ru/videoembed/1", mockFetch(html));
		expect(src.bestQuality).toBe("full");
	});

	test("resolveOkru menolak host selain ok.ru", async () => {
		await expect(
			resolveOkru("https://evil.com/videoembed/1", mockFetch("x")),
		).rejects.toThrow(/bukan embed ok\.ru/);
	});

	test("resolveOkru menolak tanpa metadata", async () => {
		await expect(
			resolveOkru("https://ok.ru/videoembed/1", mockFetch("<html></html>")),
		).rejects.toThrow(/data-options/);
	});

	test("resolveOkru meneruskan status error", async () => {
		await expect(
			resolveOkru("https://ok.ru/videoembed/1", mockFetch("gone", 404)),
		).rejects.toThrow(/404/);
	});
});

describe("vidhide resolver", () => {
	test("extractM3u8 menemukan url m3u8", () => {
		expect(extractM3u8('var a = "https://cdn.example/master.m3u8?t=1";')).toBe(
			"https://cdn.example/master.m3u8?t=1",
		);
		expect(extractM3u8("tidak ada url")).toBe("");
	});

	test("resolveVidhide mengembalikan m3u8 dari packer", async () => {
		const src = await resolveVidhide(
			"https://morencius.com/embed/abc",
			mockFetch(VIDHIDE_HTML),
		);
		expect(src.url).toBe("https://cdn.com/master.m3u8");
	});

	test("resolveVidhide menolak tanpa packer", async () => {
		await expect(
			resolveVidhide("https://morencius.com/embed/abc", mockFetch("<html></html>")),
		).rejects.toThrow(/packer/);
	});

	test("resolveVidhide menolak URL embed tidak valid", async () => {
		await expect(resolveVidhide("bukan url", mockFetch(""))).rejects.toThrow(
			/URL embed tidak valid/,
		);
	});
});
