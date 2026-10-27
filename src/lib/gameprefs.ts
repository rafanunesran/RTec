import { useEffect, useState } from "react";
import type { Game } from "./api";
import { scoped } from "./profiles";

// Jogos do dia: preferencias (esportes, campeonatos e times) e alertas de inicio, guardados no aparelho por perfil.

export type GamePrefs = { sports: string[]; leagues: string[]; teams: string[] };
export const NO_PREFS: GamePrefs = { sports: [], leagues: [], teams: [] };
/** Jogo com alerta: o basico para mostrar o aviso mesmo sem rede. */
export type GameAlert = Pick<Game, "id" | "start" | "league" | "home" | "away">;

const PREFS = "rtec:games-prefs";
const ALERTS = "rtec:game-alerts";
const CHANGED = "rtec:games-store";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(scoped(key));
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(scoped(key), JSON.stringify(value));
  } catch {
    /* armazenamento indisponivel */
  }
  window.dispatchEvent(new Event(CHANGED));
}

export const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const loadPrefs = (): GamePrefs => ({ ...NO_PREFS, ...read<Partial<GamePrefs>>(PREFS, {}) });
export const savePrefs = (p: GamePrefs) => write(PREFS, p);
export const hasPrefs = (p: GamePrefs) => !!(p.sports.length || p.leagues.length || p.teams.length);

export const isFavTeam = (p: GamePrefs, name: string) => p.teams.some((t) => fold(t) === fold(name));
/**
 * O jogo entra no pre-filtro: tem um time favorito, ou bate com os esportes e campeonatos escolhidos.
 * So times escolhidos (sem esporte/campeonato): mostra so os jogos deles.
 */
export function matchesPrefs(p: GamePrefs, g: Game) {
  if (isFavTeam(p, g.home.name) || isFavTeam(p, g.away.name)) return true;
  if (!p.sports.length && !p.leagues.length) return !p.teams.length;
  return (!p.sports.length || p.sports.includes(g.sport)) && (!p.leagues.length || p.leagues.includes(g.league_id));
}

export const loadAlerts = (): GameAlert[] => read<GameAlert[]>(ALERTS, []);
export const saveAlerts = (a: GameAlert[]) => write(ALERTS, a);
export function toggleAlert(g: Game) {
  const list = loadAlerts();
  const on = list.some((a) => a.id === g.id);
  saveAlerts(on ? list.filter((a) => a.id !== g.id) : [...list, { id: g.id, start: g.start, league: g.league, home: g.home, away: g.away }]);
  return !on;
}

/** Le de novo quando outra parte do app muda preferencias ou alertas. */
export function useGamesStore<T>(get: () => T): T {
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
