import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCfCookieStore } from "../src/lib/cf-cookie.js";

// Test tidak boleh membaca/menulis cookie file sungguhan (diisi oleh .env).
process.env.CF_COOKIE_FILE = "";

const SOLVER = "http://solver.test";

function okPayload(overrides: Record<string, unknown> = {}) {
	return {
		success: true,
		cookies: [
			{ name: "cf_clearance", value: "clearance-123" },
			{ name: "__cf_bm", value: "bm-456" },
		],
		user_agent: "UA-Test/1.0",
		headers: { "Accept-Language": "id-ID,id;q=0.9" },
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function makeFetch(handler: () => Response | Promise<Response>) {
	let calls = 0;
	const fetchImpl = (async () => {
		calls += 1;
		return handler();
	}) as unknown as typeof fetch;
	return { fetchImpl, calls: () => calls };
}

function silent() {
	return () => {};
}

describe("cf-cookie", () => {
	test("solver dimatikan: tidak memanggil fetch dan mengembalikan null", async () => {
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
		const store = createCfCookieStore({ solverUrl: "", fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
		expect(calls()).toBe(0);
	});

	test("solve sekali lalu memakai cache", async () => {
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		const first = await store.getCookie("https://contoh.test");
		const second = await store.getCookie("https://contoh.test/");

		expect(first?.cookie).toContain("cf_clearance=clearance-123");
		expect(first?.userAgent).toBe("UA-Test/1.0");
		expect(first?.acceptLanguage).toBe("id-ID,id;q=0.9");
		expect(second?.cookie).toBe(first?.cookie ?? "");
		expect(calls()).toBe(1);
	});

	test("permintaan bersamaan memakai satu solve (single-flight)", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { fetchImpl, calls } = makeFetch(async () => {
			await gate;
			return jsonResponse(okPayload());
		});
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		const pending = Array.from({ length: 5 }, () => store.getCookie("https://contoh.test"));
		expect(calls()).toBe(1);
		release();

		const results = await Promise.all(pending);
		expect(results.every((r) => r?.cookie.includes("cf_clearance"))).toBe(true);
		expect(calls()).toBe(1);
	});

	test("invalidate memaksa solve ulang", async () => {
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		await store.getCookie("https://contoh.test");
		store.invalidate("https://contoh.test");
		await store.getCookie("https://contoh.test");

		expect(calls()).toBe(2);
	});

	test("cookie kedaluwarsa di-solve ulang", async () => {
		let clock = 1_000_000;
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
		const store = createCfCookieStore({
			solverUrl: SOLVER,
			fetchImpl,
			ttlMs: 1_000,
			now: () => clock,
			log: silent(),
		});

		await store.getCookie("https://contoh.test");
		clock += 999;
		await store.getCookie("https://contoh.test");
		expect(calls()).toBe(1);

		clock += 2;
		await store.getCookie("https://contoh.test");
		expect(calls()).toBe(2);
	});

	test("solve gagal: null, lalu percobaan berikutnya mencoba lagi", async () => {
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload({ success: false })));
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
		expect(await store.getCookie("https://contoh.test")).toBeNull();
		expect(calls()).toBe(2);
	});

	test("tanpa cf_clearance dianggap gagal", async () => {
		const { fetchImpl } = makeFetch(() =>
			jsonResponse(okPayload({ cookies: [{ name: "__cf_bm", value: "bm" }] })),
		);
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
	});

	test("error HTTP solver tidak melempar, hanya null", async () => {
		const { fetchImpl } = makeFetch(() => jsonResponse({ detail: "solve timed out after 60s" }, 408));
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
	});

	test("dua penolakan menutup sumber sementara (circuit breaker)", async () => {
		let clock = 1_000_000;
		const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
		const store = createCfCookieStore({
			solverUrl: SOLVER,
			fetchImpl,
			breakerMs: 60_000,
			now: () => clock,
			log: silent(),
		});

		expect(await store.getCookie("https://contoh.test")).not.toBeNull();
		store.markRejected("https://contoh.test");
		store.markRejected("https://contoh.test");

		// Selama ditutup: null tanpa memanggil solver lagi.
		expect(await store.getCookie("https://contoh.test")).toBeNull();
		expect(calls()).toBe(1);
		expect(store.size).toBe(0);

		clock += 61_000;
		expect(await store.getCookie("https://contoh.test")).not.toBeNull();
		expect(calls()).toBe(2);
	});

	test("fetch solver melempar error: null, tidak crash", async () => {
		const { fetchImpl } = makeFetch(() => {
			throw new Error("connection refused");
		});
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
	});

	test("cookie disimpan ke disk dan dipakai lagi setelah restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cf-cookie-"));
		const file = join(dir, "cookies.json");

		try {
			const first = makeFetch(() => jsonResponse(okPayload()));
			const storeA = createCfCookieStore({
				solverUrl: SOLVER,
				fetchImpl: first.fetchImpl,
				cookieFile: file,
				log: silent(),
			});

			const entry = await storeA.getCookie("https://contoh.test");
			expect(entry?.cookie).toContain("cf_clearance");
			expect(first.calls()).toBe(1);
			expect(statSync(file).mode & 0o777).toBe(0o600);

			const saved = JSON.parse(readFileSync(file, "utf8"));
			expect(saved["https://contoh.test"].cookie).toContain("cf_clearance");

			// Store baru = proses baru; tidak boleh solve lagi.
			const second = makeFetch(() => jsonResponse(okPayload()));
			const storeB = createCfCookieStore({
				solverUrl: SOLVER,
				fetchImpl: second.fetchImpl,
				cookieFile: file,
				log: silent(),
			});

			const restored = await storeB.getCookie("https://contoh.test");
			expect(restored?.cookie).toBe(entry?.cookie ?? "");
			expect(second.calls()).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("cookie kedaluwarsa di disk tidak dimuat", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cf-cookie-"));
		const file = join(dir, "cookies.json");

		try {
			const first = makeFetch(() => jsonResponse(okPayload()));
			const storeA = createCfCookieStore({
				solverUrl: SOLVER,
				fetchImpl: first.fetchImpl,
				cookieFile: file,
				ttlMs: 1_000,
				log: silent(),
			});
			await storeA.getCookie("https://contoh.test");

			const { fetchImpl, calls } = makeFetch(() => jsonResponse(okPayload()));
			const storeB = createCfCookieStore({
				solverUrl: SOLVER,
				fetchImpl,
				cookieFile: file,
				now: () => Date.now() + 60_000,
				log: silent(),
			});

			await storeB.getCookie("https://contoh.test");
			expect(calls()).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
