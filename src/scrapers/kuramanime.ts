import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { fetchDOM, DEFAULT_USER_AGENT, describeFailure } from "../lib/fetcher.js";
import { BadGatewayError } from "../lib/errors.js";
import { cfCookies, type CfCookie } from "../lib/cf-cookie.js";
import { sources } from "../config/index.js";
import { extractAuthorization } from "./kuramanime-auth.js";

const BASE = sources.kuramanime.baseUrl;
const TIMEOUT = 15_000;

/** Scrape HTML DOM dari path Kuramanime */
export async function scrapeDOM(
	pathname: string,
	ref?: string,
	sanitize = false,
): Promise<HTMLElement> {
	return fetchDOM(`${BASE}${pathname}`, { ref, sanitize, cf: true });
}

/**
 * Request dengan cookie jar sederhana. Halaman stream hanya dibalas lengkap
 * untuk sesi yang sama dengan sesi yang meminta token.
 */
class Session {
	private cookies = new Map<string, string>();

	async request(url: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}): Promise<string> {
		// Cookie clearance dipasang di sesi ini juga: halaman stream hanya
		// dibalas lengkap untuk sesi yang sama, dan Cloudflare memeriksa
		// cookie yang sama sebelum origin sempat melihat permintaan.
		const cf = await cfCookies.getCookie(BASE);

		const send = async (entry: CfCookie | null) => {
			const jar = new Map(this.cookies);
			if (entry) {
				for (const pair of entry.cookie.split("; ")) {
					const index = pair.indexOf("=");
					if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
				}
			}

			const headers: Record<string, string> = {
				"User-Agent": entry?.userAgent ?? DEFAULT_USER_AGENT,
				...init.headers,
			};
			if (jar.size) {
				headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
			}

			// Timer baru per percobaan: solve ulang setelah 403 bisa memakan
			// 10–150 detik, dan tidak boleh memotong percobaan kedua.
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT);
			try {
				return await fetch(url, { ...init, headers, signal: controller.signal });
			} finally {
				clearTimeout(timer);
			}
		};

		const harvest = (response: Response) => {
			for (const cookie of response.headers.getSetCookie()) {
				const [pair] = cookie.split(";");
				const index = pair.indexOf("=");
				if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
			}
		};

		let res = await send(cf);
		harvest(res);

		if (!res.ok && cf && (res.status === 403 || res.status === 503)) {
			cfCookies.invalidate(BASE);
			const fresh = await cfCookies.getCookie(BASE);
			if (fresh && fresh.cookie !== cf.cookie) {
				res = await send(fresh);
				harvest(res);
			}
		}

		if (!res.ok) throw new BadGatewayError(await describeFailure(res, url));
		return await res.text();
	}
}

/** Nilai `process.env` yang dipasang skrip `/assets/js/<data-kk>.js`. */
function readJsEnv(script: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [, key, value] of script.matchAll(/(MIX_[A-Z_]+)\s*:\s*['"]([^'"]*)['"]/g)) {
		env[key] = value;
	}
	return env;
}

/** Nilai `authorization` per URL leviathan.js (URL-nya memuat `?v=` versi). */
const authorizationCache = new Map<string, Promise<string>>();

/**
 * Urutan: override env → hasil ekstraksi leviathan.js (di-cache per versi)
 * → nilai cadangan di config. Ekstraksi yang gagal tidak di-cache, supaya
 * dicoba lagi pada permintaan berikutnya.
 */
async function getStreamAuthorization(session: Session, scriptPath: string | undefined, referer: string): Promise<string> {
	const { streamAuthorizationOverride, streamAuthorizationFallback } = sources.kuramanime;
	if (streamAuthorizationOverride) return streamAuthorizationOverride;
	if (!scriptPath) return streamAuthorizationFallback;

	const scriptUrl = new URL(scriptPath, BASE).toString();
	let pending = authorizationCache.get(scriptUrl);
	if (!pending) {
		pending = session
			.request(scriptUrl, { headers: { Referer: referer } })
			.then(extractAuthorization)
			.then((value) => {
				if (!value) throw new Error("jLoadSecure did not expose an authorization value");
				return value;
			});
		authorizationCache.set(scriptUrl, pending);
	}

	try {
		return await pending;
	} catch (err) {
		authorizationCache.delete(scriptUrl);
		console.warn(`[kuramanime] authorization extraction failed (${scriptUrl}), using fallback:`, err);
		return streamAuthorizationFallback;
	}
}

/**
 * Ambil halaman episode/batch lengkap dengan pemutar dan tautan unduhan.
 *
 * Meniru alur `anime-episode.min.js`: halaman awal hanya kerangka; skrip lalu
 * meminta token dari `MIX_AUTH_ROUTE_PARAM` dan memuat ulang halaman yang sama
 * lewat POST (`jLoadSecure` di leviathan.js) dengan token, server, dan nomor
 * halaman dari `check-episode` / `check-batch`.
 */
export async function scrapeProtectedPage(
	kind: "episode" | "batch",
	animeId: string,
	animeSlug: string,
	id: string,
	streamServer = "kuramadrive",
): Promise<HTMLElement> {
	const session = new Session();
	const episodeUrl = `${BASE}/anime/${animeId}/${animeSlug}/${kind}/${id}`;
	const xhr = { "X-Requested-With": "XMLHttpRequest", Referer: episodeUrl };

	const shell = parseHtml(await session.request(episodeUrl));
	const kk = shell.querySelector("[data-kk]")?.getAttribute("data-kk");
	if (!kk) throw new BadGatewayError("Kuramanime page has no data-kk script");

	const env = readJsEnv(await session.request(`${BASE}/assets/js/${kk}.js`, { headers: xhr }));
	const {
		MIX_PREFIX_AUTH_ROUTE_PARAM: tokenPrefix = "",
		MIX_AUTH_ROUTE_PARAM: tokenRoute,
		MIX_AUTH_KEY: authKey,
		MIX_AUTH_TOKEN: authToken,
		MIX_PAGE_TOKEN_KEY: pageTokenKey,
		MIX_STREAM_SERVER_KEY: streamServerKey,
	} = env;
	if (!tokenRoute || !authKey || !authToken || !pageTokenKey || !streamServerKey) {
		throw new BadGatewayError("Kuramanime stream keys not found");
	}

	const [token, pageText, authorization] = await Promise.all([
		session.request(`${BASE}/${tokenPrefix}${tokenRoute}`, {
			headers: {
				...xhr,
				"X-Fuck-ID": `${authKey}:${authToken}`,
				"X-Request-ID": Math.random().toString(36).slice(2, 8),
				"X-Request-Index": "0",
			},
		}),
		session.request(`${BASE}/anime/${animeId}/${kind}/${id}/check-${kind}`, { headers: xhr }),
		getStreamAuthorization(session, shell.querySelector("#tokenAuthJs")?.getAttribute("value"), episodeUrl),
	]);

	let page = "1";
	try {
		page = String(JSON.parse(pageText) || "1");
	} catch {
		/* biarkan halaman pertama */
	}

	const url = new URL(episodeUrl);
	url.searchParams.set(pageTokenKey, token.trim());
	url.searchParams.set(streamServerKey, streamServer);
	url.searchParams.set("page", page);

	const html = await session.request(url.toString(), {
		method: "POST",
		headers: { ...xhr, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
		body: new URLSearchParams({ authorization }).toString(),
	});
	return parseHtml(html);
}

/**
 * Mirror kdrive (`*.my.id/kdrive/…`, `kuramadrive.com`) membalas video intro
 * ~10 detik untuk request `Sec-Fetch-Mode: no-cors` — yang selalu dikirim tag
 * <video> biasa. Mode CORS memang dibalas video penuh, tapi
 * Access-Control-Allow-Origin-nya dikunci ke domain Kuramanime. Jadi URL ini
 * dialirkan lewat backend (fetch server tidak mengirim Sec-Fetch-*).
 */
export function isKdriveMirror(url: string): boolean {
	try {
		const { protocol, hostname, pathname } = new URL(url);
		return (
			protocol === "https:" &&
			pathname.startsWith("/kdrive/") &&
			(hostname.endsWith(".my.id") || hostname === "kuramadrive.com" || hostname.endsWith(".kuramadrive.com"))
		);
	} catch {
		return false;
	}
}

export function fetchStream(url: string, range?: string, signal?: AbortSignal): Promise<Response> {
	const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT };
	if (range) headers.Range = range;
	return fetch(url, { headers, signal });
}
