import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import sanitizeHtml from "sanitize-html";
import { BadGatewayError } from "./errors.js";
import { cfCookies, type CfCookie } from "./cf-cookie.js";

export const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

export interface FetchOptions {
	ref?: string;
	sanitize?: boolean;
	timeout?: number;
	/** Perbaiki HTML mentah sebelum di-parse, untuk markup upstream yang rusak. */
	transform?: (html: string) => string;
	/** Pakai cookie Cloudflare dari solver untuk origin ini. */
	cf?: boolean;
	/** Header tambahan, mis. X-Requested-With. */
	headers?: Record<string, string>;
}

/** Status yang menandakan cookie Cloudflare basi/ditolak (challenge atau rate limit). */
function isCfBlock(status: number): boolean {
	return status === 401 || status === 403 || status === 429 || status === 503;
}

function originOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return "";
	}
}

/**
 * Ambil cookie Cloudflare bila diminta. Mengembalikan null kalau solver mati
 * atau gagal — pemanggil tetap mencoba fetch biasa supaya pesan errornya jelas.
 */
async function cfEntry(url: string, cf: boolean): Promise<CfCookie | null> {
	if (!cf) return null;
	const origin = originOf(url);
	return origin ? cfCookies.getCookie(origin) : null;
}

/** Susun header; UA wajib sama dengan UA yang dipakai solver. */
function withCfHeaders(
	base: Record<string, string>,
	entry: CfCookie | null,
	ref?: string,
): Record<string, string> {
	const headers: Record<string, string> = { ...base };
	if (entry) {
		headers["User-Agent"] = entry.userAgent;
		headers.Cookie = entry.cookie;
		if (!headers["Accept-Language"]) headers["Accept-Language"] = entry.acceptLanguage;
	}
	if (ref) headers.Referer = ref;
	return headers;
}

/**
 * Ulang sekali dengan cookie baru setelah 403/503. Cloudflare bisa mencabut
 * clearance lebih cepat dari TTL, jadi satu percobaan ulang cukup; lebih dari
 * itu hanya menambah latensi saat sumbernya memang mati.
 */
async function retryWithFreshCookie(
	url: string,
	cf: boolean,
	stale: CfCookie | null,
	res: Response,
	send: (entry: CfCookie | null) => Promise<Response>,
): Promise<{ res: Response; entry: CfCookie | null }> {
	if (!cf || !stale) return { res, entry: stale };

	const origin = originOf(url);
	if (res.ok) {
		cfCookies.markHealthy(origin);
		return { res, entry: stale };
	}
	if (!isCfBlock(res.status)) return { res, entry: stale };

	cfCookies.invalidate(origin);
	const fresh = await cfCookies.getCookie(origin);
	if (!fresh || fresh.cookie === stale.cookie) return { res, entry: stale };

	const retried = await send(fresh);
	if (retried.ok) cfCookies.markHealthy(origin);
	else if (isCfBlock(retried.status)) cfCookies.markRejected(origin);

	return { res: retried, entry: fresh };
}

/**
 * Satu percobaan fetch dengan timeout sendiri.
 *
 * Penting: percobaan ulang setelah 403 bisa memakan waktu solve (10–150 detik),
 * jadi tiap percobaan butuh AbortController baru. Kalau memakai timer yang
 * sama, percobaan kedua sudah keburu abort sebelum sempat dikirim.
 */
async function fetchOnce(url: string, init: RequestInit, timeout: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Susun pesan error yang cukup untuk mendiagnosis penolakan dari upstream.
 *
 * Status saja tidak menjelaskan apa-apa saat sebuah sumber diblokir Cloudflare:
 * 403 bisa berarti aturan firewall (error 1020), tantangan JavaScript ("Just a
 * moment…"), Bot Fight Mode, atau memang penolakan dari origin-nya. Ketiganya
 * butuh penanganan berbeda, dan yang membedakan hanya isi halamannya — jadi
 * potongan teksnya ikut dibawa, bersama `cf-ray` supaya bisa dicocokkan dengan
 * log Cloudflare.
 */
export async function describeFailure(res: Response, url: string): Promise<string> {
	let snippet = "";

	try {
		const body = await res.text();
		snippet = body
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 200);
	} catch {
		/* isi respons tidak selalu bisa dibaca */
	}

	const ray = res.headers.get("cf-ray");
	const server = res.headers.get("server");

	return [
		`Upstream returned ${res.status} for ${url}`,
		server ? `server=${server}` : "",
		ray ? `cf-ray=${ray}` : "",
		snippet ? `body="${snippet}"` : "",
	]
		.filter(Boolean)
		.join(" | ");
}

/**
 * Fetch URL, parse HTML, return DOM root.
 */
export async function fetchDOM(
	url: string,
	options: FetchOptions = {},
): Promise<HTMLElement> {
	const { ref, sanitize = false, timeout = 15_000, transform, cf = false, headers: extra = {} } = options;

	const base: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT, ...extra };
	const entry = await cfEntry(url, cf);

	const send = (current: CfCookie | null) =>
		fetchOnce(url, { headers: withCfHeaders(base, current, ref) }, timeout);

	let res = await send(entry);
	res = (await retryWithFreshCookie(url, cf, entry, res, send)).res;

	if (!res.ok) {
		throw new BadGatewayError(await describeFailure(res, url));
	}

	let html = await res.text();
		if (!html || html.length < 50) {
			throw new BadGatewayError("Empty or too short response from upstream");
		}

		if (transform) html = transform(html);

		if (sanitize) {
			html = sanitizeHtml(html, {
				allowedTags: sanitizeHtml.defaults.allowedTags.concat([
					"img", "video", "source", "iframe", "script",
				]),
				allowVulnerableTags: true,
				allowedAttributes: {
					"*": ["class", "id", "style"],
					...sanitizeHtml.defaults.allowedAttributes,
					img: ["src", "data-src", "alt", "title", "width", "height", "class"],
					a: ["href", "title", "target", "class", "rel"],
					iframe: ["src", "width", "height", "allowfullscreen"],
					source: ["src", "type"],
					video: ["src", "controls", "width", "height"],
					div: ["class", "id"],
					span: ["class"],
					ul: ["class"],
					li: ["class"],
					h1: ["class"], h2: ["class"], h3: ["class"], h4: ["class"], h5: ["class"],
				},
			});
		}

	return parseHtml(html);
}

/**
 * POST request ke endpoint, parse response sebagai JSON.
 */
export async function postJSON<T>(
	url: string,
	body: Record<string, string>,
	ref?: string,
	timeout = 15_000,
	cf = false,
): Promise<T> {
	const base: Record<string, string> = {
		"User-Agent": DEFAULT_USER_AGENT,
		"Content-Type": "application/x-www-form-urlencoded",
	};
	const entry = await cfEntry(url, cf);

	const params = new URLSearchParams(body).toString();
	const send = (current: CfCookie | null) =>
		fetchOnce(
			url,
			{
				method: "POST",
				headers: withCfHeaders(base, current, ref),
				body: params,
			},
			timeout,
		);

	let res = await send(entry);
	res = (await retryWithFreshCookie(url, cf, entry, res, send)).res;

	if (!res.ok) {
		throw new BadGatewayError(await describeFailure(res, url));
	}

	return (await res.json()) as T;
}

/**
 * POST form-urlencoded dan kembalikan teks mentah. Dipakai untuk endpoint
 * `admin-ajax.php` yang membalas potongan HTML, bukan JSON.
 */
export async function postText(
	url: string,
	body: Record<string, string>,
	ref?: string,
	timeout = 15_000,
	cf = false,
): Promise<string> {
	const base: Record<string, string> = {
		"User-Agent": DEFAULT_USER_AGENT,
		"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
		"X-Requested-With": "XMLHttpRequest",
	};
	const entry = await cfEntry(url, cf);

	const send = (current: CfCookie | null) => {
		const headers = withCfHeaders(base, current, ref);
		if (ref) headers.Origin = new URL(ref).origin;
		return fetchOnce(
			url,
			{
				method: "POST",
				headers,
				body: new URLSearchParams(body).toString(),
			},
			timeout,
		);
	};

	let res = await send(entry);
	res = (await retryWithFreshCookie(url, cf, entry, res, send)).res;

	if (!res.ok) {
		throw new BadGatewayError(await describeFailure(res, url));
	}

	return await res.text();
}

/**
 * Fetch raw text dari URL.
 */
export async function fetchText(
	url: string,
	ref?: string,
	timeout = 15_000,
	userAgent = DEFAULT_USER_AGENT,
	cf = false,
): Promise<string> {
	const base: Record<string, string> = {
		"User-Agent": userAgent,
	};
	const entry = await cfEntry(url, cf);

	const send = (current: CfCookie | null) =>
		fetchOnce(url, { headers: withCfHeaders(base, current, ref) }, timeout);

	let res = await send(entry);
	res = (await retryWithFreshCookie(url, cf, entry, res, send)).res;

	if (!res.ok) {
		throw new BadGatewayError(await describeFailure(res, url));
	}
	return await res.text();
}
