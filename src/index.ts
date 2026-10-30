import app from "./app.js";
import { appConfig } from "./config/index.js";
import { isSupabaseReady } from "./lib/supabase.js";

const PORT = appConfig.port;

/**
 * Isi cache cookie di proses yang sama dengan API.
 *
 * Kalau dijalankan sebagai proses terpisah, single-flight tidak berlaku:
 * prewarm dan request pengguna bisa memicu dua solve sekaligus (dua browser)
 * dan RAM VPS langsung habis. Karena itu warm-up berjalan di proses ini.
 */
async function warmCookies(): Promise<void> {
	const hosts = (process.env.PREWARM_HOSTS ?? "https://v20.kuramanime.ing,https://s13.nontonanimeid.boats")
		.split(",")
		.map((host) => host.trim())
		.filter(Boolean);
	const { cfCookies } = await import("./lib/cf-cookie.js");

	for (const host of hosts) {
		const started = Date.now();
		try {
			const entry = await cfCookies.getCookie(host);
			const seconds = Math.round((Date.now() - started) / 1000);
			console.log(`[warmup] ${host} ${entry ? "ok" : "gagal"} ${seconds}s`);
		} catch (err) {
			console.warn(`[warmup] ${host} error ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

if (process.env.NODE_ENV !== "vercel") {
	app.listen(PORT, appConfig.host, () => {
		console.log(`🚀 superanime API running at http://${appConfig.host}:${PORT}`);
		console.log(`   Sources:`);
		console.log(`   ➜  http://localhost:${PORT}/otakudesu`);
		console.log(`   ➜  http://localhost:${PORT}/kuramanime`);
		console.log(`   ➜  http://localhost:${PORT}/oploverz`);
		console.log(`   ➜  http://localhost:${PORT}/nimegami`);
		console.log(`   ➜  http://localhost:${PORT}/ylnime`);
		console.log(`   ➜  http://localhost:${PORT}/nontonanimeid`);
		if (isSupabaseReady()) {
			console.log(`   📦 Database: Supabase connected`);
			console.log(`   🔄 Sync:    POST /sync/:source/:type`);
			console.log(`   📋 Query:   GET  /db/anime`);
		} else {
			console.log(`   📦 Database: not configured (set SUPABASE_URL + SUPABASE_ANON_KEY)`);
		}

		if (process.env.WARMUP === "1") void warmCookies();
	});
}

export default app;
