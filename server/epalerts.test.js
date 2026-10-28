import { test } from "node:test";
import assert from "node:assert/strict";
import { alertList, alertTargets, checkAlerts, markSeen, newCount, setAlert, snapshot } from "./epalerts.js";

const eps = (n, season = 1) => Array.from({ length: n }, (_, i) => ({ season, episode: i + 1 }));
const fav = { id: "s70", series_id: "70", kind: "series", name: "Serie A", logo: "" };

test("alertas: favoritas entram sozinhas e o sino vale mais que o favorito", () => {
  const doc = {};
  assert.deepEqual(alertTargets(doc, [fav, { id: "m1", kind: "movie" }]).map((t) => t.id), ["s70"]);
  setAlert(doc, { id: "s70", name: "Serie A", logo: "", series_id: "70" }, false);
  assert.deepEqual(alertTargets(doc, [fav]), [], "desligado no sino");
  setAlert(doc, { id: "serie:Outra", name: "Outra", logo: "", series_id: "" }, true);
  assert.deepEqual(alertTargets(doc, [fav]).map((t) => t.id), ["serie:Outra"]);
});

test("alertas: primeira conferida so guarda; depois avisa os episodios novos ate o cliente abrir", async () => {
  const doc = {};
  let n = 5;
  const targets = alertTargets(doc, [fav]);
  await checkAlerts(doc, targets, async () => eps(n));
  assert.equal(alertList(doc, targets)[0].new, 0);
  n = 7;
  await checkAlerts(doc, targets, async () => eps(n));
  const [item] = alertList(doc, targets);
  assert.deepEqual([item.new, item.season, item.episode], [2, 1, 7]);
  // Fornecedor falhou ou devolveu vazio: fica o que ja sabia.
  await checkAlerts(doc, targets, async () => {
    throw new Error("fora do ar");
  });
  await checkAlerts(doc, targets, async () => []);
  assert.equal(alertList(doc, targets)[0].new, 2);
  markSeen(doc, fav, snapshot(eps(7)));
  assert.equal(alertList(doc, targets)[0].new, 0);
  // Temporada nova com a mesma contagem (fornecedor tirou um antigo): ainda avisa.
  assert.equal(newCount(snapshot(eps(7)), snapshot([...eps(6), { season: 2, episode: 1 }])), 1);
});
