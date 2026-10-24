import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "./store/memory.js";
import { needsSeal, openUrl, sealCollection, sealUrl } from "./seal.js";

test("link do proxy: cifrado, sempre o mesmo e so abre com o segredo certo", () => {
  const url = "http://fornecedor.tv:8080/live/USUARIO/SENHA/1.ts";
  const t = sealUrl("s1", url);
  assert.doesNotMatch(t, /USUARIO|SENHA|fornecedor/);
  assert.equal(sealUrl("s1", url), t);
  assert.equal(openUrl("s1", t), url);
  assert.equal(openUrl("outro", t), "");
  assert.equal(openUrl("s1", t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA")), "");
});

test("banco: com DATA_KEY os dados do fornecedor ficam cifrados e o servidor le normal", async () => {
  const raw = createMemoryStore();
  const clients = sealCollection("clients", raw.clients);
  const source = { kind: "xtream", xtream_server: "http://srv.tv", xtream_username: "joao", xtream_password: "p@ss", url: "", playback: "auto" };

  // Sem chave: grava como sempre
  delete process.env.DATA_KEY;
  const a = await clients.create({ username: "a", source });
  assert.equal((await raw.clients.get(a.id)).source.xtream_password, "p@ss");
  assert.ok(needsSeal("clients", await raw.clients.get(a.id)));

  process.env.DATA_KEY = "chave-de-teste";
  const b = await clients.create({ username: "b", password: "senha-do-cliente", source, extra_sources: [{ ...source, xtream_username: "maria" }] });
  const stored = await raw.clients.get(b.id);
  assert.match(stored.source.xtream_password, /^enc1:/);
  assert.match(stored.extra_sources[0].xtream_username, /^enc1:/);
  assert.equal(stored.source.kind, "xtream");
  assert.equal(stored.username, "b");
  assert.match(stored.password, /^enc1:/);
  assert.equal((await clients.findOne("username", "b")).password, "senha-do-cliente");
  assert.ok(!needsSeal("clients", stored));
  assert.equal((await clients.get(b.id)).source.xtream_password, "p@ss");
  assert.equal((await clients.findOne("username", "b")).extra_sources[0].xtream_username, "maria");
  assert.equal((await clients.list()).find((c) => c.id === b.id).source.xtream_server, "http://srv.tv");
  await clients.update(b.id, { list_status: { state: "active" } });
  assert.equal((await clients.get(b.id)).source.xtream_password, "p@ss");

  // Chave errada ou ausente: avisa em vez de entregar lixo
  process.env.DATA_KEY = "outra";
  await assert.rejects(clients.get(b.id), /DATA_KEY/);
  delete process.env.DATA_KEY;
  await assert.rejects(clients.get(b.id), /DATA_KEY/);
});
