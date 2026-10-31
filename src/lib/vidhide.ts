/**
 * Resolver embed VidHide (dan mirror-nya).
 *
 * Halaman embed VidHide memuat player JW dengan sumber video yang
 * disembunyikan di balik `eval(function(p,a,c,k,e,d){…})` — Dean Edwards
 * packer. Untuk mengekstrak URL:
 *   1. ambil blok `eval(...)` dari HTML,
 *   2. ganti `eval` menjadi `return` dan jalankan dengan `new Function`
 *      (murni dekompresi string — tidak ada efek samping jaringan),
 *   3. ambil URL `.m3u8` dari hasilnya.
 *
 * Karakteristik URL hasil resolve:
 * - Token one-shot: kedaluwarsa cepat, harus resolve ulang tiap play.
 * - Referer `https://morencius.com/` (atau host embed) diperlukan saat
 *   mengambil master.m3u8; tanpa Referer → 403.
 *
 * Domain embed VidHide sering berubah (morencius.com, odvidhide.com, …),
 * jadi host tidak di-hardcode — klien mengirim URL embed yang didapat dari
 * halaman episode.
 */

export interface VidhideSource {
	/** URL master.m3u8 (HLS). */
	url: string;
	/** Resolusi dari master playlist, mis. `1920x1080`. */
	resolution: string | null;
}

/** Cari blok eval packer di HTML dan jalankan. */
function runPacker(html: string): string {
	const start = html.indexOf("eval(function(p,a,c,k,e,d)");
	if (start < 0) throw new Error("packer tidak ditemukan di halaman embed");
	const end = html.indexOf("</script>", start);
	const packed = (
		end > start ? html.slice(start, end) : html.slice(start)
	).replace(/^eval/, "return");
	return new Function(packed)() as string;
}

/** Ekstrak URL .m3u8 dari hasil unpack. */
export function extractM3u8(unpacked: string): string {
	const match = unpacked.match(/https?:\/\/[^\s"']+?\.m3u8[^\s"']*/);
	return match ? match[0] : "";
}

/**
 * Resolve embed VidHide menjadi URL m3u8.
 * @param embedUrl mis. `https://morencius.com/embed/z7oqjcwef5vk`
 */
export async function resolveVidhide(
	embedUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<VidhideSource> {
	let referer: string;
	try {
		referer = new URL(embedUrl).origin + "/";
	} catch {
		throw new Error("URL embed tidak valid");
	}

	const res = await fetchImpl(embedUrl, {
		headers: { accept: "text/html,*/*", referer: `${new URL(embedUrl).hostname}/` },
		redirect: "follow",
	});
	if (!res.ok) {
		throw new Error(`embed vidhide balas ${res.status}`);
	}

	const url = extractM3u8(runPacker(await res.text()));
	if (!url) {
		throw new Error("url m3u8 tidak ditemukan di packer");
	}

	return { url, resolution: null };
}

/**
 * Baca resolusi dari master playlist (opsional, untuk verifikasi).
 */
export async function readMasterResolution(
	masterUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const res = await fetchImpl(masterUrl, {
		headers: { referer: "https://morencius.com/" },
	});
	if (!res.ok) return null;
	const text = await res.text();
	return text.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? null;
}
