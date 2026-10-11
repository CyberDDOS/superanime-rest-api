import { Router } from "express";
import * as ctrl from "../controllers/kuramanime.js";
import { serverCache, clientCache } from "../lib/cache.js";
import { autoSync } from "../middlewares/autoSync.js";

const router = Router();

router.use(clientCache(60)); // client cache 1 menit
router.use(autoSync("kuramanime")); // auto-sync ke Supabase

// Root — daftar route
router.get("/", ctrl.getRoutes);

// Data endpoints
router.get("/home", serverCache(10), ctrl.getHome);
router.get("/anime", serverCache(10), ctrl.getAnimes);
router.get("/schedule", serverCache(10), ctrl.getSchedule);
router.get("/episodes", serverCache(10), ctrl.getEpisodes);
router.get("/properties/:propertyType", serverCache(10), ctrl.getProperties);
router.get("/properties/:propertyType/:propertyId", serverCache(10), ctrl.getAnimesByProperty);
router.get("/anime/:animeId/:animeSlug", serverCache(10), ctrl.getAnimeDetails);
router.get("/batch/:animeId/:animeSlug/:batchId", serverCache(10), ctrl.getBatchDetails);
router.get("/episode/:animeId/:animeSlug/:episodeId", serverCache(10), ctrl.getEpisodeDetails);
// `:file` hanya nama file asli, supaya URL proxy tetap berakhiran .mp4.
router.get("/stream/:file", ctrl.streamVideo);

export default router;
