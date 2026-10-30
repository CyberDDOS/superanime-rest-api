import { describe, expect, test } from "bun:test";
import { extractInertiaProps, isFiledonEmbed, resolveFiledon } from "../src/lib/filedon.js";

const EMBED_HTML = `<!DOCTYPE html>
<html>
<head><title>Filedon</title></head>
<body>
<div id="app" data-page="{&quot;component&quot;:&quot;public/embed&quot;,&quot;props&quot;:{&quot;errors&quot;:{},&quot;files&quot;:{&quot;id&quot;:256876,&quot;name&quot;:&quot;Otakudesu.io_TMTM--04_360p.mp4&quot;,&quot;mime_type&quot;:&quot;video/mp4&quot;,&quot;size&quot;:45922272},&quot;url&quot;:&quot;https://4ee42e7b34bf3c2aec4681b9c17de08f.r2.cloudflarestorage.com/filedon/users/467/direct/otakudesuio-tmtm-04-360p.mp4?X-Amz-Signature=abc&quot;,&quot;media&quot;:{&quot;hls_url&quot;:null}}}" />
</body>
</html>`;

function mockFetch(html: string, status = 200): typeof fetch {
	return (async () => new Response(html, { status })) as unknown as typeof fetch;
}

describe("filedon resolver", () => {
	test("isFiledonEmbed mengenali host filedon saja", () => {
		expect(isFiledonEmbed("https://filedon.co/embed/IEBkk4xIUA")).toBe(true);
		expect(isFiledonEmbed("https://filedon.co.evil.com/embed/x")).toBe(false);
		expect(isFiledonEmbed("bukan url")).toBe(false);
	});

	test("extractInertiaProps membaca url, nama, dan ukuran file", () => {
		const props = extractInertiaProps(EMBED_HTML);
		expect(props.url).toContain("r2.cloudflarestorage.com");
		expect(props.files?.name).toBe("Otakudesu.io_TMTM--04_360p.mp4");
		expect(props.files?.size).toBe(45922272);
	});

	test("resolveFiledon mengembalikan sumber direct", async () => {
		const source = await resolveFiledon(
			"https://filedon.co/embed/IEBkk4xIUA",
			mockFetch(EMBED_HTML),
		);
		expect(source.url).toContain("r2.cloudflarestorage.com");
		expect(source.name).toBe("Otakudesu.io_TMTM--04_360p.mp4");
		expect(source.mimeType).toBe("video/mp4");
		expect(source.size).toBe(45922272);
		expect(source.hlsUrl).toBeNull();
	});

	test("resolveFiledon menolak host selain filedon", async () => {
		await expect(
			resolveFiledon("https://evil.com/embed/x", mockFetch(EMBED_HTML)),
		).rejects.toThrow(/bukan embed filedon/);
	});

	test("resolveFiledon menolak url file dari host asing", async () => {
		const html = EMBED_HTML.replace(
			/4ee42e7b34bf3c2aec4681b9c17de08f\.r2\.cloudflarestorage\.com/,
			"evil-storage.example.com",
		);
		await expect(
			resolveFiledon("https://filedon.co/embed/x", mockFetch(html)),
		).rejects.toThrow(/tidak dikenali/);
	});

	test("resolveFiledon menolak tanpa url file", async () => {
		await expect(
			resolveFiledon("https://filedon.co/embed/x", mockFetch("<html>kosong</html>")),
		).rejects.toThrow(/data-page/);
	});

	test("resolveFiledon meneruskan status error embed", async () => {
		await expect(
			resolveFiledon("https://filedon.co/embed/x", mockFetch("not found", 404)),
		).rejects.toThrow(/404/);
	});
});
