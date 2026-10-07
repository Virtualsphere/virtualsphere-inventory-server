import express from "express";
import cors from "cors";
import { join } from "node:path";
import { config } from "./config";
import { notFound } from "./lib/errors";
import { errorHandler } from "./middleware/errorHandler";
import { requireAuth } from "./middleware/auth";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/user.routes";
import { productRoutes } from "./modules/products/product.routes";
import { unitRoutes } from "./modules/units/unit.routes";
import { dispatchRoutes } from "./modules/dispatches/dispatch.routes";
import { warrantyRoutes } from "./modules/warranty/warranty.routes";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { statsRoutes } from "./modules/stats/stats.routes";

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use(express.json({ limit: "2mb" }));
  app.use(
    cors({
      origin:
        config.corsOrigin === "*"
          ? true
          : config.corsOrigin.split(",").map((s) => s.trim()),
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "stockroom", time: new Date().toISOString() });
  });

  // Public: /api/health above, and /api/auth/login (auth routes guard the rest
  // of themselves). Everything after this line requires a valid JWT.
  app.use("/api/auth", authRoutes);
  app.use("/api", requireAuth);

  app.use("/api/users", userRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/units", unitRoutes);
  app.use("/api/dispatches", dispatchRoutes);
  app.use("/api/warranty", warrantyRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/stats", statsRoutes);

  // Unmatched API routes -> structured 404 (before the SPA fallback).
  app.use("/api", (_req, _res, next) => next(notFound("Route")));

  // Static reference frontend + SPA fallback.
  const publicDir = join(__dirname, "..", "public");
  // `no-cache` = always revalidate (cheap 304 via ETag). Without it browsers
  // heuristically cache app.js/index.html and keep serving a stale UI after
  // a deploy.
  const noCache = (res: express.Response) => res.setHeader("Cache-Control", "no-cache");
  app.use(express.static(publicDir, { setHeaders: noCache }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    noCache(res);
    res.sendFile(join(publicDir, "index.html"));
  });

  app.use(errorHandler);
  return app;
}
