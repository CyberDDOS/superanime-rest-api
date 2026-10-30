/**
 * Resolver embed Filedon (filedon.co).
 *
 * Halaman embed Otakudesu (filedon.co/embed/<slug>) adalah aplikasi Inertia
 * (Laravel) yang menanam JSON props di atribut `data-page`. Salah satu props
 * (`url`) berisi URL file R2 Cloudflare yang sudah ditandatangani
 * (X-Amz-Signature, kedaluwarsa 1 jam) dan bisa diputar langsung tanpa
 * referer atau User-Agent khusus.
 *
 * Catatan penting:
 * - HEAD pada URL R2 ditolak 403; gunakan GET + Range untuk health check.
 * - Signature berbeda tiap kali halaman embed dibuka, jadi URL harus
 * di-resolve ulang setiap kali akan diputar dan tidak boleh di-cache lama.
 */

const FILEDON_HOST = "filedon.co";

interface FiledonPageProps {
	files?: {
		id?: number;
		name?: string;
		mime_type?: string;
		size?: number;
	};
	url?: string;
	embed_url?: string;
	view_url?: string;
	media?: {
		preview_url?: string | null;
		hls_url?: string | null;
	};
}

export interface FiledonSource {
	/** URL file R2 signed — langsung diputar. */
	url: string;
	/** Nama file asli, mis. `Otakudesu.io_TMTM--04_360p.mp4`. */
	name: string;
	mimeType: string;
	size: number;
	/** URL HLS bila tersedia (biasanya null saat transcode pending). */
	hlsUrl: string | null;
}

/** Ekstrak props Inertia dari HTML halaman embed. */
export function extractInertiaProps(html: string): FiledonPageProps {
	const match = html.match(/data-page="([^"]+)"/);
	if (!match) throw new Error("halaman embed tidak memuat data-page");

	const encoded = match[1]
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");

	let page: { props?: FiledonPageProps };
	try {
		page = JSON.parse(encoded);
	} catch {
		throw new Error("data-page bukan JSON yang valid");
	}

	return page.props ?? {};
}

/** Pastikan hanya URL R2 milik filedon yang dikembalikan. */
function isAllowedFileUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return false;
		return parsed.hostname.endsWith(".r2.cloudflarestorage.com");
	} catch {
		return false;
	}
}

/**
 * Resolve URL embed filedon menjadi URL file video direct.
 *
 * Menerima dua jenis halaman:
 * - `filedon.co/embed/<slug>` — halaman player (serverList), props.url tersedia
 * - `filedon.co/view/<slug>` — halaman unduhan (downloadList), props.url kosong
 *   tapi props.embed_url menunjuk ke halaman player
 *
 * @param embedUrl mis. `https://filedon.co/embed/IEBkk4xIUA`
 */
export async function resolveFiledon(
	embedUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<FiledonSource> {
	let host: string;
	try {
		host = new URL(embedUrl).hostname;
	} catch {
		throw new Error("URL embed tidak valid");
	}
	if (host !== FILEDON_HOST) {
		throw new Error(`bukan embed filedon: ${host}`);
	}

	const res = await fetchImpl(embedUrl, {
		headers: { accept: "text/html,*/*" },
		redirect: "follow",
	});
	if (!res.ok) {
		throw new Error(`embed filedon balas ${res.status}`);
	}

	let props = extractInertiaProps(await res.text());

	// Halaman /view/ tidak memuat url file — ikuti embed_url ke halaman player.
	if (!props.url && props.embed_url) {
		const embedTarget = new URL(props.embed_url);
		if (embedTarget.hostname !== FILEDON_HOST) {
			throw new Error(`embed_url menunjuk host asing: ${embedTarget.hostname}`);
		}
		const res2 = await fetchImpl(props.embed_url, {
			headers: { accept: "text/html,*/*" },
			redirect: "follow",
		});
		if (!res2.ok) {
			throw new Error(`embed filedon balas ${res2.status}`);
		}
		props = extractInertiaProps(await res2.text());
	}

	const url = props.url;
	if (!url) {
		throw new Error("props embed tidak memuat url file");
	}
	if (!isAllowedFileUrl(url)) {
		throw new Error("url file tidak dikenali (bukan R2 filedon)");
	}

	return {
		url,
		name: props.files?.name ?? "",
		mimeType: props.files?.mime_type || "video/mp4",
		size: props.files?.size ?? 0,
		hlsUrl: props.media?.hls_url ?? null,
	};
}

/** Deteksi URL embed filedon. */
export function isFiledonEmbed(url: string): boolean {
	try {
		return new URL(url).hostname === FILEDON_HOST;
	} catch {
		return false;
	}
}
