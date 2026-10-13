import { Router } from "express";
import * as ctrl from "../controllers/otakudesu.js";
import { serverCache, clientCache } from "../lib/cache.js";
import { autoSync } from "../middlewares/autoSync.js";

const router = Router();

router.use(clientCache(60)); // client cache 1 menit
router.use(autoSync("otakudesu")); // auto-sync ke Supabase

// Root — daftar route
router.get("/", ctrl.getRoutes);

// Data endpoints (cache 10 menit di server)
router.get("/home", serverCache(10), ctrl.getHome);
router.get("/schedule", serverCache(10), ctrl.getSchedule);
router.get("/anime", serverCache(10), ctrl.getAnimes);
router.get("/genre", serverCache(10), ctrl.getGenres);
router.get("/ongoing", serverCache(10), ctrl.getOngoingAnimes);
router.get("/completed", serverCache(10), ctrl.getCompletedAnimes);
router.get("/search", serverCache(10), ctrl.searchAnimes);
router.get("/genre/:genreId", serverCache(10), ctrl.getAnimesByGenre);
router.get("/batch/:batchId", serverCache(10), ctrl.getBatchDetails);
router.get("/anime/:animeId", serverCache(10), ctrl.getAnimeDetails);
router.get("/episode/:episodeId", serverCache(10), ctrl.getEpisodeDetails);

// Server — GET + POST
router.get("/server/:serverId", serverCache(5), ctrl.getServerDetails);
// Tanpa cache: URL video desustream dirotasi (lihat scraper.resolvePlayerUrl).
router.get("/play/:file", ctrl.playVideo);
router.post("/server/:serverId", serverCache(5), ctrl.getServerDetails);

export default router;
