import express from "express";
import path from "node:path";
import fs from "node:fs";
import { seedAdmin } from "./db.js";
import { createApp } from "./app.js";

seedAdmin();
const app = createApp();

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`[rtec] API rodando em http://localhost:${port}`));
