import { describe, expect, test } from "bun:test";
import { createCfCookieStore } from "../src/lib/cf-cookie.js";

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

	test("fetch solver melempar error: null, tidak crash", async () => {
		const { fetchImpl } = makeFetch(() => {
			throw new Error("connection refused");
		});
		const store = createCfCookieStore({ solverUrl: SOLVER, fetchImpl, log: silent() });

		expect(await store.getCookie("https://contoh.test")).toBeNull();
	});
});
