// Servidor Node tradicional (desenvolvimento local ou VPS). Na Vercel, quem atende e api/index.js.
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createApp } from "./app.js";

const app = createApp();

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      setHeaders: (res, file) => {
        if (/(sw\.js|manifest\.webmanifest|index\.html)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`[rtec] API rodando em http://localhost:${port}`));
