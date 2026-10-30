import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchDOM, DEFAULT_USER_AGENT } from "../src/lib/fetcher.js";
import { cfCookies } from "../src/lib/cf-cookie.js";

const realFetch = globalThis.fetch;
const SOLVER = "http://solver.test";
const HTML = `<html><body><h1>Judul</h1><p>${"isi ".repeat(20)}</p></body></html>`;

interface Recorded {
	url: string;
	headers: Record<string, string>;
}

let recorded: Recorded[] = [];

function mockFetch(handler: (url: string, headers: Record<string, string>) => Response | Promise<Response>) {
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const headers = (init?.headers ?? {}) as Record<string, string>;
		recorded.push({ url, headers });
		return handler(url, headers);
	}) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function html(body = HTML, status = 200): Response {
	return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

function solverPayload(cookie: string, ua = "UA-Solver/1.0") {
	return {
		success: true,
		cookies: [
			{ name: "cf_clearance", value: cookie },
			{ name: "__cf_bm", value: "bm" },
		],
		user_agent: ua,
		headers: { "Accept-Language": "id-ID,id;q=0.9" },
	};
}

beforeEach(() => {
	recorded = [];
	cfCookies.clear();
	process.env.SOLVER_URL = SOLVER;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.SOLVER_URL;
	cfCookies.clear();
});

describe("fetcher + cf-cookie", () => {
	test("tanpa cf: tidak ada Cookie, memakai UA default", async () => {
		mockFetch(() => html());

		const dom = await fetchDOM("https://contoh.test/halaman");
		expect(dom.querySelector("h1")?.text).toBe("Judul");

		expect(recorded).toHaveLength(1);
		expect(recorded[0]!.headers.Cookie).toBeUndefined();
		expect(recorded[0]!.headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
	});

	test("cf: solve dulu, lalu kirim cookie + UA solver", async () => {
		mockFetch((url) => (url.endsWith("/solve") ? json(solverPayload("abc")) : html()));

		await fetchDOM("https://contoh.test/halaman", { cf: true });

		// solve harus sebelum request halaman
		expect(recorded.map((r) => r.url)).toEqual([
			`${SOLVER}/solve`,
			"https://contoh.test/halaman",
		]);

		const page = recorded[1]!;
		expect(page.headers.Cookie).toContain("cf_clearance=abc");
		expect(page.headers["User-Agent"]).toBe("UA-Solver/1.0");
		expect(page.headers["Accept-Language"]).toBe("id-ID,id;q=0.9");
	});

	test("403 dengan cookie basi: solve ulang dan ulangi sekali", async () => {
		let solveCount = 0;

		mockFetch((url, headers) => {
			if (url.endsWith("/solve")) {
				solveCount += 1;
				return json(solverPayload(solveCount === 1 ? "lama" : "baru"));
			}
			return headers.Cookie?.includes("cf_clearance=baru") ? html() : html("blocked", 403);
		});

		const dom = await fetchDOM("https://contoh.test/halaman", { cf: true });

		expect(dom.querySelector("h1")?.text).toBe("Judul");
		expect(solveCount).toBe(2);
		expect(recorded.filter((r) => r.url === "https://contoh.test/halaman")).toHaveLength(2);
	});

	test("403 dan solver mengembalikan cookie yang sama: tidak mengulang tanpa akhir", async () => {
		mockFetch((url) => (url.endsWith("/solve") ? json(solverPayload("sama")) : html("blocked", 403)));

		await expect(fetchDOM("https://contoh.test/halaman", { cf: true })).rejects.toThrow(/403/);

		const pageCalls = recorded.filter((r) => r.url === "https://contoh.test/halaman");
		expect(pageCalls).toHaveLength(1);
	});

	test("solver mati: tetap fetch biasa, error 403 jelas", async () => {
		delete process.env.SOLVER_URL;
		mockFetch(() => html("Attention Required! Cloudflare", 403));

		await expect(fetchDOM("https://contoh.test/halaman", { cf: true })).rejects.toThrow(/403/);

		expect(recorded).toHaveLength(1);
		expect(recorded[0]!.headers.Cookie).toBeUndefined();
	});

	test("solver gagal (500): fetch tanpa cookie, bukan crash", async () => {
		mockFetch((url) => (url.endsWith("/solve") ? json({ detail: "solver down" }, 500) : html("blocked", 403)));

		await expect(fetchDOM("https://contoh.test/halaman", { cf: true })).rejects.toThrow(/403/);

		expect(recorded[0]!.url).toBe(`${SOLVER}/solve`);
		expect(recorded[1]!.headers.Cookie).toBeUndefined();
	});
});
