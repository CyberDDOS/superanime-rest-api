import { Router } from "express";
import * as ctrl from "../controllers/anichin.js";
import { serverCache, clientCache } from "../lib/cache.js";

const router = Router();
router.use(clientCache(60));

router.get("/", ctrl.getRoutes);
router.get("/home", serverCache(10), ctrl.getHome);
router.get("/ongoing", serverCache(10), ctrl.getOngoing);
router.get("/completed", serverCache(10), ctrl.getCompleted);
router.get("/anime/:slug", serverCache(10), ctrl.getAnimeDetails);
router.get("/episode/:slug", serverCache(10), ctrl.getEpisodeDetails);
router.get("/server/:serverId", ctrl.getServerDetails);
router.get("/search", serverCache(10), ctrl.searchAnimes);
router.get("/genre", serverCache(10), ctrl.getGenreList);
router.get("/genres/:genreId", serverCache(10), ctrl.getAnimesByGenre);
router.get("/schedule", serverCache(10), ctrl.getSchedule);

export default router;
