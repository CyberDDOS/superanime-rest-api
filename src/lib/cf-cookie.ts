/**
 * Cookie Cloudflare untuk sumber yang menolak IP datacenter.
 *
 * Alurnya: solver membuka browser asli, melewati challenge, lalu mengembalikan
 * `cf_clearance` + User-Agent. Keduanya dipakai ulang untuk fetch biasa.
 *
 * Catatan penting dari lapangan:
 * - `cf_clearance` terikat pada IP + User-Agent. Solver dan fetcher harus
 *   berjalan di IP yang sama, dan UA harus persis sama.
 * - Solve pertama bisa lama (browser cold start), jadi timeout default 150 s.
 * - Beberapa permintaan bersamaan tidak boleh memicu beberapa solve; karena
 *   itu ada single-flight per origin.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CfCookie {
	/** Header Cookie lengkap, mis. "cf_clearance=...; __cf_bm=..." */
	cookie: string;
	userAgent: string;
	acceptLanguage: string;
	/** Epoch ms; setelah ini cookie dianggap basi dan di-solve ulang. */
	expiresAt: number;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CfCookieStoreOptions {
	/** Kosongkan ("") untuk mematikan solver, mis. di test. */
	solverUrl?: string;
	solveTimeoutMs?: number;
	ttlMs?: number;
	now?: () => number;
	fetchImpl?: FetchLike;
	log?: (message: string) => void;
	/** Path penyimpanan cookie. Kosong = tidak disimpan ke disk. */
	cookieFile?: string;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SOLVE_TIMEOUT_MS = 150_000;
/** Kelonggaran di atas timeout solver supaya pesan error datang dari solver. */
const GUARD_MS = 15_000;

function normalizeOrigin(input: string): string {
	try {
		return new URL(input).origin;
	} catch {
		return "";
	}
}

interface SolverCookie {
	name?: string;
	value?: string;
}

interface SolverPayload {
	success?: boolean;
	cookies?: SolverCookie[];
	user_agent?: string;
	headers?: Record<string, string>;
	error?: string;
	detail?: string;
}

export function createCfCookieStore(options: CfCookieStoreOptions = {}) {
	const now = options.now ?? (() => Date.now());
	const log = options.log ?? ((message: string) => console.warn(message));
	const fetchImpl: FetchLike =
		options.fetchImpl ?? ((input, init) => globalThis.fetch(input as RequestInfo, init));

	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const envTimeout = Number.parseInt(process.env.SOLVER_TIMEOUT_S ?? "", 10);
	const solveTimeoutMs =
		options.solveTimeoutMs ??
		(Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout * 1000 : DEFAULT_SOLVE_TIMEOUT_MS);

	const cache = new Map<string, CfCookie>();
	const inflight = new Map<string, Promise<CfCookie | null>>();
	const cookieFile = options.cookieFile ?? process.env.CF_COOKIE_FILE ?? "";
	let diskLoaded = false;

	/** Muat sekali dari disk; file belum ada adalah kondisi normal. */
	function loadFromDisk(): void {
		if (diskLoaded || !cookieFile) return;
		diskLoaded = true;
		try {
			const parsed = JSON.parse(readFileSync(cookieFile, "utf8")) as Record<string, CfCookie>;
			for (const [origin, entry] of Object.entries(parsed)) {
				if (!entry || typeof entry.cookie !== "string" || typeof entry.userAgent !== "string") continue;
				if (typeof entry.expiresAt !== "number" || entry.expiresAt <= now()) continue;
				cache.set(origin, {
					cookie: entry.cookie,
					userAgent: entry.userAgent,
					acceptLanguage:
						typeof entry.acceptLanguage === "string" ? entry.acceptLanguage : "en-US,en;q=0.9",
					expiresAt: entry.expiresAt,
				});
			}
			if (cache.size) log(`[cf-cookie] muat ${cache.size} cookie dari disk`);
		} catch {
			/* ENOENT atau JSON rusak: mulai dengan cache kosong. */
		}
	}

	function saveToDisk(): void {
		if (!cookieFile) return;
		try {
			mkdirSync(dirname(cookieFile), { recursive: true });
			const rows: Record<string, CfCookie> = {};
			for (const [origin, entry] of cache) {
				if (entry.expiresAt > now()) rows[origin] = entry;
			}
			const tmp = `${cookieFile}.tmp-${process.pid}`;
			writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
			chmodSync(tmp, 0o600);
			renameSync(tmp, cookieFile);
		} catch (err) {
			log(`[cf-cookie] gagal menyimpan cookie: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** `undefined` = ikut environment; `""` = solver dimatikan. */
	function solverUrl(): string {
		const raw = options.solverUrl !== undefined ? options.solverUrl : process.env.SOLVER_URL ?? "";
		return raw.replace(/\/+$/, "");
	}

	async function solve(origin: string): Promise<CfCookie | null> {
		const base = solverUrl();
		if (!base) return null;

		const started = now();
		const controller = new AbortController();
		const guard = setTimeout(() => controller.abort(), solveTimeoutMs + GUARD_MS);

		try {
			const res = await fetchImpl(`${base}/solve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "cloudflare",
					url: `${origin}/`,
					timeout_s: Math.ceil(solveTimeoutMs / 1000),
				}),
				signal: controller.signal,
			});

			const raw = await res.text();
			let payload: SolverPayload | null = null;
			try {
				payload = JSON.parse(raw) as SolverPayload;
			} catch {
				payload = null;
			}

			if (!res.ok || !payload) {
				const detail = payload?.detail ?? `HTTP ${res.status}`;
				log(`[cf-cookie] solve gagal host=${origin} detail=${String(detail).slice(0, 160)}`);
				return null;
			}

			if (payload.success !== true) {
				log(
					`[cf-cookie] solve tidak berhasil host=${origin} error=${String(payload.error ?? "unknown").slice(0, 160)}`,
				);
				return null;
			}

			const jar = (Array.isArray(payload.cookies) ? payload.cookies : []).filter(
				(c): c is Required<SolverCookie> =>
					typeof c?.name === "string" && typeof c?.value === "string" && c.name.length > 0 && c.value.length > 0,
			);

			if (!jar.some((c) => c.name === "cf_clearance")) {
				log(`[cf-cookie] solve tanpa cf_clearance host=${origin}`);
				return null;
			}

			const userAgent = typeof payload.user_agent === "string" ? payload.user_agent : "";
			if (!userAgent) {
				log(`[cf-cookie] solve tanpa user_agent host=${origin}`);
				return null;
			}

			const acceptLanguage =
				typeof payload.headers?.["Accept-Language"] === "string"
					? payload.headers["Accept-Language"]
					: "en-US,en;q=0.9";

			const entry: CfCookie = {
				cookie: jar.map((c) => `${c.name}=${c.value}`).join("; "),
				userAgent,
				acceptLanguage,
				expiresAt: now() + ttlMs,
			};

			cache.set(origin, entry);
			saveToDisk();
			log(
				`[cf-cookie] solve ok host=${origin} ms=${Math.round(now() - started)} cookies=${jar.length}`,
			);
			return entry;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : message;
			log(`[cf-cookie] solve error host=${origin} reason=${reason.slice(0, 160)}`);
			return null;
		} finally {
			clearTimeout(guard);
		}
	}

	/** Ambil cookie yang masih berlaku; solve sekali bila belum ada/basi. */
	async function getCookie(originInput: string): Promise<CfCookie | null> {
		const origin = normalizeOrigin(originInput);
		if (!origin) return null;

		loadFromDisk();

		const cached = cache.get(origin);
		if (cached && cached.expiresAt > now()) return cached;

		const pending = inflight.get(origin);
		if (pending) return pending;

		const task = solve(origin).finally(() => {
			inflight.delete(origin);
		});
		inflight.set(origin, task);
		return task;
	}

	/** Buang cookie (mis. setelah 403) supaya permintaan berikutnya solve ulang. */
	function invalidate(originInput: string): void {
		const origin = normalizeOrigin(originInput);
		if (origin && cache.delete(origin)) saveToDisk();
	}

	function clear(): void {
		cache.clear();
		inflight.clear();
		saveToDisk();
	}

	return {
		getCookie,
		invalidate,
		clear,
		get size(): number {
			return cache.size;
		},
	};
}

/** Instance bersama untuk seluruh aplikasi. */
export const cfCookies = createCfCookieStore();

export function isSolverConfigured(): boolean {
	return Boolean((process.env.SOLVER_URL ?? "").trim());
}
