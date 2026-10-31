/**
 * Resolver embed OK.ru (odnoklassniki).
 *
 * Halaman embed `ok.ru/videoembed/<videoId>` menanam konfigurasi player di
 * atribut `data-options` (JSON dengan entitas HTML). Di dalamnya,
 * `flashvars.metadata.videos[]` berisi URL `.mp4` progressive download untuk
 * setiap kualitas — mobile, lowest, low, sd, hd, full — tanpa enkripsi.
 *
 * Karakteristik URL hasil resolve:
 * - Terikat IP (`srcIp`): harus diputar dari IP yang sama dengan yang resolve.
 * - Referer wajib dikirim (nilai apa pun diterima); tanpa Referer → 400.
 * - Masa berlaku ~24 jam (parameter `expires`).
 * - HEAD tidak didukung; gunakan GET + Range untuk health check.
 */

const OKRU_HOSTS = new Set(["ok.ru", "www.ok.ru", "odnoklassniki.ru"]);

export interface OkruSource {
	/** Kualitas → URL mp4 (mobile, lowest, low, sd, hd, full). */
	qualities: Record<string, string>;
	/** URL mp4 kualitas tertinggi (full/hd/sd — apa pun yang tersedia). */
	bestUrl: string;
	/** Label kualitas tertinggi yang tersedia. */
	bestQuality: string;
	/** Judul video dari metadata (biasanya berisi resolusi). */
	title: string;
	/** Durasi dalam detik. */
	duration: number;
}

/** Deteksi URL embed ok.ru. */
export function isOkruEmbed(url: string): boolean {
	try {
		return OKRU_HOSTS.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

/** Ekstrak JSON data-options dari HTML halaman embed. */
export function extractOkruOptions(html: string): Record<string, unknown> {
	const match = html.match(/data-options="([^"]+)"/);
	if (!match) throw new Error("halaman embed tidak memuat data-options");
	const encoded = match[1]
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
	try {
		return JSON.parse(encoded);
	} catch {
		throw new Error("data-options bukan JSON yang valid");
	}
}

/** Urutan kualitas dari yang tertinggi. */
const QUALITY_ORDER = ["full", "hd", "sd", "low", "lowest", "mobile"];

/**
 * Resolve embed ok.ru menjadi URL mp4 per kualitas.
 * @param embedUrl mis. `https://ok.ru/videoembed/16333763119794`
 */
export async function resolveOkru(
	embedUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<OkruSource> {
	if (!isOkruEmbed(embedUrl)) {
		throw new Error(`bukan embed ok.ru: ${embedUrl}`);
	}

	const res = await fetchImpl(embedUrl, {
		// UA harus Chrome: srcAg di URL hasil resolve menyesuaikan UA ini
		// dan CDN memvalidasi kecocokannya saat streaming.
		headers: { accept: "text/html,*/*", "user-agent": OKRU_STREAM_UA },
		redirect: "follow",
	});
	if (!res.ok) {
		throw new Error(`embed ok.ru balas ${res.status}`);
	}

	const options = extractOkruOptions(await res.text());
	const flashvars = (options.flashvars ?? {}) as Record<string, unknown>;
	const metadataRaw = flashvars.metadata;
	if (!metadataRaw) {
		throw new Error("data-options tidak memuat flashvars.metadata");
	}
	const metadata =
		typeof metadataRaw === "string" ? JSON.parse(metadataRaw) : metadataRaw;

	const videos = (metadata as { videos?: { name: string; url: string }[] })
		.videos;
	if (!videos?.length) {
		throw new Error("metadata tidak memuat daftar video");
	}

	const qualities: Record<string, string> = {};
	for (const video of videos) {
		if (video.name && video.url) qualities[video.name] = video.url;
	}

	const bestQuality =
		QUALITY_ORDER.find((q) => qualities[q]) ?? Object.keys(qualities)[0];
	if (!bestQuality) {
		throw new Error("tidak ada kualitas yang bisa dipakai");
	}

	return {
		qualities,
		bestUrl: qualities[bestQuality],
		bestQuality,
		title: (metadata as { movie?: { title?: string } }).movie?.title ?? "",
		duration: (metadata as { movie?: { duration?: number } }).movie
			?.duration ?? 0,
	};
}

/**
 * UA yang harus dipakai klien saat streaming URL hasil resolve.
 *
 * CDN okcdn memvalidasi User-Agent terhadap `srcAg` yang tertanam di URL
 * (dipilih berdasarkan UA saat halaman embed diambil). ResolveOkru selalu
 * memakai UA Chrome, jadi klien harus memakai UA yang sama saat streaming;
 * UA lain akan dibalas 400. Jangan ubah satu tanpa yang lain.
 */
export const OKRU_STREAM_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
