import { Router } from "express";
import * as ctrl from "../controllers/sync.js";
import { requireSyncSecret } from "../middlewares/requireSyncSecret.js";

const router = Router();

// Manual sync trigger — memicu scraping massal, jadi wajib pakai secret.
router.post("/:source/:type", requireSyncSecret, ctrl.syncSource);

// Sync status history
router.get("/status", ctrl.getSyncStatus);

// Query anime from database
router.get("/anime", ctrl.getAnimeFromDB);

export default router;
