import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Download, Film, Heart, History, Home, KeyRound, LayoutGrid, Loader2, Lock, Play, Radio, Search, Settings, Share, SquarePlus, Tv, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Catalog, type Channel, type ChannelsResponse, type ClientProfile, type PlayerSettings, type Programme } from "@/lib/api";
import { APK_URL, useApkAvailable, useInstall } from "@/lib/pwa";
import { cn, formatDate } from "@/lib/utils";
import { Button, Dialog, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import Logo from "@/components/Logo";
import PlayerOverlay from "@/components/player/PlayerOverlay";
import { WATCHED_AT, fraction, getProgress, useProgressVersion } from "@/lib/progress";
import PinDialog from "@/components/player/PinDialog";
import SettingsDialog from "@/components/player/SettingsDialog";

const FAVORITES = "__favoritos__";
const HISTORY = "__historico__";
const PAGE = 200;
const HISTORY_MAX = 60;
const ADULT = /(adult|xxx|\+18|18\+|adulto|er[oó]tic|hot\b|sexy|porn)/i;

type Section = Channel["kind"];
type Page = "home" | "all" | "section";

/** Minusculas e sem acentos (busca). */
const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const ALL_LIMIT = 24;

const sections: { key: Section; label: string; icon: typeof Tv }[] = [
  { key: "live", label: "TV ao vivo", icon: Radio },
  { key: "movie", label: "Filmes", icon: Film },
  { key: "series", label: "Séries", icon: Clapperboard },
];

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponivel (aba anonima etc.) */
  }
}

/** "Nome da Serie S01 E02" -> { series: "Nome da Serie", season: 1, episode: 2 } */
function episodeInfo(name: string) {
  const m = /^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})\b/i.exec(name);
  if (!m) return { series: name.trim(), season: 1, episode: 0 };
  return { series: m[1].trim() || name, season: Number(m[2]), episode: Number(m[3]) };
}

export default function Player() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .get<ClientProfile>("/api/player/me")
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = useCallback(() => setProfile(null), []);

  if (checking)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  return profile ? <Watch profile={profile} onLogout={logout} /> : <PlayerLogin onLogin={setProfile} />;
}

function PlayerLogin({ onLogin }: { onLogin: (p: ClientProfile) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(await api.post<ClientProfile>("/api/player/login", { username, password }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative w-full max-w-md animate-rise-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="scale-125" />
          <p className="mt-5 text-sm text-muted-foreground">TV ao vivo, filmes e séries em qualquer tela.</p>
        </div>
        <div className="rounded-3xl border bg-card/80 p-6 shadow-card backdrop-blur-xl sm:p-8">
          <p className="mb-6 text-sm text-muted-foreground">Entre com o usuário e a senha que você recebeu.</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Usuário">
              <Input className="h-11" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
            </Field>
            <Field label="Senha">
              <Input className="h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Button variant="gradient" size="lg" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Entrar
            </Button>
          </form>
        </div>
        <div className="mt-6 flex justify-center">
          <InstallButton />
        </div>
      </div>
    </div>
  );
}

function InstallButton({ compact }: { compact?: boolean }) {
  const { canPrompt, ios, install } = useInstall();
  const apk = useApkAvailable();
  const [help, setHelp] = useState(false);
  const android = /android/i.test(navigator.userAgent);
  // No Android, o app (APK) toca o video direto do fornecedor: melhor que instalar o site.
  if (apk && (android || !ios)) {
    return (
      <a href={APK_URL} download>
        <Button variant="outline" size={compact ? "sm" : "default"} type="button">
          <Download /> {compact ? "App" : "Baixar app Android"}
        </Button>
      </a>
    );
  }
  if (!canPrompt && !ios) return null;
  return (
    <>
      <Button variant="outline" size={compact ? "sm" : "default"} onClick={() => (canPrompt ? install() : setHelp(true))}>
        <Download /> {compact ? "Instalar" : "Instalar app"}
      </Button>
      <Dialog open={help} onClose={() => setHelp(false)} title="Instalar no iPhone / iPad">
        <ol className="space-y-4 text-sm">
          {[
            <>
              Abra este site no <b>Safari</b> e toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b>.
            </>,
            <>
              Escolha <SquarePlus className="inline h-4 w-4" /> <b>Adicionar à Tela de Início</b>.
            </>,
            <>
              Toque em <b>Adicionar</b>. O app aparece na tela inicial.
            </>,
          ].map((step, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}

type Group = { key: string; name: string };
type XtPage = { key: string; items: Channel[]; total: number; loading: boolean; error: string };
type Episode = Channel & { season: number; episode: number };
type OpenSeries = { name: string; episodes: Episode[] | null };

function Watch({ profile, onLogout }: { profile: ClientProfile; onLogout: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [data, setData] = useState<ChannelsResponse | null>(null); // listas M3U comuns
  const [xtItems, setXtItems] = useState<Record<string, Channel[] | "loading" | { error: string }>>({}); // Xtream: por secao/categoria
  const [settings, setSettings] = useState<PlayerSettings>({ custom_pin: false, locked_groups: [] });
  const [page, setPage] = useState<Page>("home");
  const [section, setSection] = useState<Section>("live");
  const [queue, setQueue] = useState<Channel[] | null>(null); // episodios da serie em reproducao (para "proximo")
  const [allQuery, setAllQuery] = useState("");
  const [allTerm, setAllTerm] = useState("");
  const [allRes, setAllRes] = useState<{ key: string; loading: boolean; data: Record<Section, { total: number; items: Channel[] }> } | null>(null);
  const pendingSeries = useRef<{ key: string; name: string; logo: string; sub: string; episodes: Episode[] | null } | null>(null);
  useProgressVersion();
  const [playlistId, setPlaylistId] = useState("");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [series, setSeries] = useState<OpenSeries | null>(null);
  const [favorites, setFavorites] = useState<Channel[]>(() => load("rtec:favs", []));
  const [history, setHistory] = useState<Channel[]>(() => load("rtec:history", []));
  const [xtPage, setXtPage] = useState<XtPage | null>(null); // Xtream: "Todos" de filmes/series, em paginas
  const [searchTerm, setSearchTerm] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [epg, setEpg] = useState<Record<string, Programme[]>>({});

  const xt = catalog?.mode === "xtream";
  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        toast.error(err.message);
        onLogout();
        return true;
      }
      return false;
    },
    [onLogout],
  );

  const loadAll = useCallback(() => {
    setCatalog(null);
    setData(null);
    setXtItems({});
    api
      .get<Catalog>("/api/player/catalog")
      .then((cat) => {
        setCatalog(cat);
        if (cat.mode === "xtream") return;
        return api.get<ChannelsResponse>("/api/player/channels").then((res) => {
          setData(res);
          if (!res.channels.some((c) => c.kind === "live")) {
            const first = sections.find((s) => res.channels.some((c) => c.kind === s.key));
            if (first) setSection(first.key);
          }
        });
      })
      .catch((err) => {
        if (handleAuthError(err)) return;
        setCatalog({ mode: "m3u" });
        setData({ playlists: [], channels: [], errors: ["Sem conexao com o servidor"] });
      });
  }, [handleAuthError]);

  useEffect(() => {
    loadAll();
    api.get<PlayerSettings>("/api/player/settings").then(setSettings).catch(() => {});
  }, [loadAll]);

  const isLocked = useCallback((g: string) => !unlocked && (ADULT.test(g) || settings.locked_groups.includes(g)), [unlocked, settings]);

  // Grupos (chips): no Xtream sao as categorias do fornecedor; nas listas M3U, os group-title.
  const channels = data?.channels ?? [];
  const groups: Group[] = useMemo(() => {
    if (xt) return (catalog?.sections?.[section] ?? []).map((c) => ({ key: c.id, name: c.name }));
    const names = new Set(channels.filter((c) => c.kind === section && (!playlistId || c.playlist_id === playlistId)).map((c) => c.group));
    return [...names].map((n) => ({ key: n, name: n }));
  }, [xt, catalog, section, channels, playlistId]);

  const allGroupNames = useMemo(() => {
    if (xt) return [...new Set(sections.flatMap((s) => (catalog?.sections?.[s.key] ?? []).map((c) => c.name)))];
    return [...new Set(channels.map((c) => c.group))];
  }, [xt, catalog, channels]);

  const counts = useMemo(() => {
    const out: Record<Section, number> = { live: 0, movie: 0, series: 0 };
    if (xt) for (const s of sections) out[s.key] = catalog?.sections?.[s.key].length ?? 0;
    else for (const c of channels) if (!playlistId || c.playlist_id === playlistId) out[c.kind]++;
    return out;
  }, [xt, catalog, channels, playlistId]);

  // Ao trocar de secao ou de lista, volta para "Todos".
  useEffect(() => {
    setSeries(null);
    setGroup("");
    const pending = pendingSeries.current;
    if (pending) {
      pendingSeries.current = null;
      openSeries(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, playlistId, xt]);

  // Busca com atraso, usada no "Todos" do Xtream (a busca roda no servidor).
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const special = group === FAVORITES || group === HISTORY;
  // Xtream: "Todos" de filmes e series vem do servidor em paginas; o resto, por categoria
  // (ao vivo: todos os canais de uma vez, filtrados aqui).
  const pagedAll = xt && section !== "live" && !group;
  const xtKey = xt && !special && !pagedAll ? `${section}:${section === "live" ? "" : group}` : "";
  const skipIds = useMemo(() => groups.filter((g) => isLocked(g.name)).map((g) => g.key).join(","), [groups, isLocked]);
  const pageKey = pagedAll ? `${section}|${searchTerm}|${skipIds}` : "";

  const loadPage = useCallback(
    (key: string, offset: number) => {
      const [sec, q, skip] = key.split("|");
      setXtPage((p) => (offset && p?.key === key ? { ...p, loading: true } : { key, items: [], total: 0, loading: true, error: "" }));
      const params = new URLSearchParams({ section: sec, limit: String(PAGE), offset: String(offset), q, skip });
      api
        .get<{ total: number; items: Channel[] }>(`/api/player/xtream/items?${params}`)
        .then((res) =>
          setXtPage((p) => (p?.key === key ? { key, items: offset ? [...p.items, ...res.items] : res.items, total: res.total, loading: false, error: "" } : p)),
        )
        .catch((err) => {
          if (!handleAuthError(err)) setXtPage((p) => (p?.key === key ? { ...p, loading: false, error: (err as Error).message } : p));
        });
    },
    [handleAuthError],
  );

  useEffect(() => {
    if (pageKey) loadPage(pageKey, 0);
  }, [pageKey, loadPage]);

  useEffect(() => {
    if (!xtKey || xtItems[xtKey]) return;
    setXtItems((m) => ({ ...m, [xtKey]: "loading" }));
    const [sec, cat] = xtKey.split(":");
    api
      .get<Channel[]>(`/api/player/xtream/items?section=${sec}&category=${encodeURIComponent(cat)}`)
      .then((list) => setXtItems((m) => ({ ...m, [xtKey]: list })))
      .catch((err) => {
        if (!handleAuthError(err)) setXtItems((m) => ({ ...m, [xtKey]: { error: (err as Error).message } }));
      });
  }, [xtKey, xtItems, handleAuthError]);

  const xtState = xtKey ? xtItems[xtKey] : undefined;
  const pageState = pagedAll && xtPage?.key === pageKey ? xtPage : null;
  const loading =
    catalog === null || (!xt && data === null) || xtState === "loading" || (pagedAll && (!pageState || (pageState.loading && !pageState.items.length)));
  const loadError = xtState && typeof xtState === "object" && "error" in xtState ? xtState.error : (pageState?.error ?? "");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: Channel[];
    if (group === FAVORITES) list = favorites.filter((c) => c.kind === section);
    else if (group === HISTORY) list = history.filter((c) => c.kind === section);
    else if (pagedAll) return pageState?.items ?? [];
    else if (xt) {
      list = Array.isArray(xtState) ? xtState : [];
      if (section === "live") list = list.filter((c) => (group ? c.group === groups.find((g) => g.key === group)?.name : !isLocked(c.group)));
    } else {
      list = channels.filter(
        (c) => c.kind === section && (!playlistId || c.playlist_id === playlistId) && (group ? c.group === group : !isLocked(c.group)),
      );
    }
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [group, favorites, history, section, pagedAll, pageState, xt, xtState, groups, isLocked, channels, playlistId, query]);

  // Series: no Xtream cada item e uma serie (episodios vem da API); nas listas M3U, agrupa pelo nome.
  const seriesList = useMemo(() => {
    if (section !== "series") return [];
    if (xt) return visible.map((c) => ({ key: c.series_id || c.id, name: c.name, logo: c.logo, sub: "", episodes: null as Episode[] | null }));
    const map = new Map<string, { key: string; name: string; logo: string; sub: string; episodes: Episode[] | null }>();
    for (const c of visible) {
      const info = episodeInfo(c.name);
      if (!map.has(info.series)) map.set(info.series, { key: info.series, name: info.series, logo: c.logo, sub: "", episodes: [] });
      map.get(info.series)!.episodes!.push({ ...c, season: info.season, episode: info.episode });
    }
    for (const s of map.values()) {
      s.episodes!.sort((a, b) => a.season - b.season || a.episode - b.episode);
      s.sub = `${s.episodes!.length} episódio(s)`;
    }
    return [...map.values()];
  }, [section, xt, visible]);

  useEffect(() => setLimit(PAGE), [group, query, section, playlistId]);

  const openSeries = (s: (typeof seriesList)[number]) => {
    if (s.episodes) return setSeries({ name: s.name, episodes: s.episodes });
    setSeries({ name: s.name, episodes: null });
    api
      .get<Episode[]>(`/api/player/xtream/series/${encodeURIComponent(s.key)}?name=${encodeURIComponent(s.name)}`)
      .then((eps) => setSeries((cur) => (cur?.name === s.name ? { name: s.name, episodes: eps } : cur)))
      .catch((err) => {
        if (!handleAuthError(err)) toast.error("Não foi possível carregar os episódios");
        setSeries(null);
      });
  };

  // EPG dos canais ao vivo visiveis + o atual.
  const epgIds = useMemo(() => {
    if (section !== "live") return [];
    const ids = new Set(visible.slice(0, xt ? 20 : limit).map((c) => c.epg_id).filter(Boolean));
    if (current?.epg_id) ids.add(current.epg_id);
    return [...ids].filter((id) => !(id in epg)).slice(0, 300);
  }, [section, visible, limit, current, epg, xt]);

  useEffect(() => {
    if (!epgIds.length) return;
    const t = setTimeout(() => {
      api
        .get<Record<string, Programme[]>>(`/api/player/epg?ids=${encodeURIComponent(epgIds.join(","))}`)
        .then((res) => setEpg((old) => ({ ...old, ...Object.fromEntries(epgIds.map((id) => [id, res[id] ?? []])) })))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [epgIds]);

  const withPin = (fn: () => void, groupName: string) => {
    if (isLocked(groupName)) setPinFor(() => fn);
    else fn();
  };

  const play = (c: Channel, list?: Channel[] | null) =>
    withPin(() => {
      setCurrent(c);
      if (list !== undefined) setQueue(list);
      setHistory((old) => {
        const next = [c, ...old.filter((h) => h.id !== c.id)].slice(0, HISTORY_MAX);
        save("rtec:history", next);
        return next;
      });
    }, c.group);

  // Episodio aberto pelo historico ou pela busca: carrega a serie para saber qual e o proximo.
  useEffect(() => {
    if (!current || current.kind !== "series" || queue?.some((q) => q.id === current.id)) return;
    if (!xt) {
      // Lista M3U: os episodios da mesma serie estao no proprio catalogo.
      const name = episodeInfo(current.name).series;
      const eps = channels
        .filter((x) => x.kind === "series" && episodeInfo(x.name).series === name)
        .map((x) => ({ ...x, ...episodeInfo(x.name) }))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
      if (eps.length) setQueue(eps);
      return;
    }
    if (!current.parent_series) return;
    let alive = true;
    api
      .get<Episode[]>(`/api/player/xtream/series/${encodeURIComponent(current.parent_series)}?name=${encodeURIComponent(current.group)}`)
      .then((eps) => alive && setQueue(eps))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, queue, xt]);

  const nextEpisode = useMemo(() => {
    if (!current || current.kind !== "series" || !queue) return null;
    const i = queue.findIndex((q) => q.id === current.id);
    return i >= 0 && i + 1 < queue.length ? { ...queue[i + 1], group: current.group } : null;
  }, [current, queue]);

  // Pagina "Tudo": busca em canais, filmes e series ao mesmo tempo.
  useEffect(() => {
    const t = setTimeout(() => setAllTerm(allQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [allQuery]);

  const allKey = page === "all" && catalog ? `${xt ? "xt" : "m3u"}|${allTerm}` : "";
  useEffect(() => {
    if (!allKey) return;
    const kinds: Section[] = ["live", "movie", "series"];
    if (!xt) {
      const q = fold(allTerm);
      const data = {} as Record<Section, { total: number; items: Channel[] }>;
      for (const k of kinds) {
        let found = channels.filter((c) => c.kind === k && !isLocked(c.group) && (!q || fold(c.name).includes(q)));
        if (k === "series") {
          const seen = new Map<string, Channel>();
          for (const c of found) {
            const name = episodeInfo(c.name).series;
            if (!seen.has(name)) seen.set(name, { ...c, name, id: `serie:${name}` });
          }
          found = [...seen.values()];
        }
        data[k] = { total: found.length, items: found.slice(0, ALL_LIMIT) };
      }
      setAllRes({ key: allKey, loading: false, data });
      return;
    }
    setAllRes((r) => (r ? { ...r, key: allKey, loading: true } : { key: allKey, loading: true, data: { live: { total: 0, items: [] }, movie: { total: 0, items: [] }, series: { total: 0, items: [] } } }));
    Promise.all(
      kinds.map((k) => {
        const skip = (catalog?.sections?.[k] ?? []).filter((g) => isLocked(g.name)).map((g) => g.id).join(",");
        const params = new URLSearchParams({ section: k, limit: String(ALL_LIMIT), offset: "0", q: allTerm, skip });
        return api.get<{ total: number; items: Channel[] }>(`/api/player/xtream/items?${params}`).catch(() => ({ total: 0, items: [] }));
      }),
    ).then(([live, movie, series]) => setAllRes((r) => (r?.key === allKey ? { key: allKey, loading: false, data: { live, movie, series } } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKey]);

  const goSection = (k: Section) => {
    setPage("section");
    setSection(k);
  };

  // Abre uma serie a partir das paginas Inicio/Tudo.
  const openSeriesFrom = (c: Channel) => {
    const item = xt
      ? { key: c.series_id || c.id, name: c.name, logo: c.logo, sub: "", episodes: null as Episode[] | null }
      : { key: c.name, name: c.name, logo: c.logo, sub: "", episodes: null as Episode[] | null };
    if (!xt) {
      const eps = channels
        .filter((x) => x.kind === "series" && episodeInfo(x.name).series === c.name)
        .map((x) => ({ ...x, ...episodeInfo(x.name) }))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
      item.episodes = eps;
    }
    if (page === "section" && section === "series") return openSeries(item);
    pendingSeries.current = item;
    setPage("section");
    if (section === "series") {
      pendingSeries.current = null;
      openSeries(item);
    } else setSection("series");
  };

  const openItem = (c: Channel) => (c.kind === "series" && (c.series_id || c.id.startsWith("serie:")) ? openSeriesFrom(c) : play(c, null));

  const isFavorite = (id: string) => favorites.some((f) => f.id === id);
  const toggleFavorite = (c: Channel) => {
    const next = isFavorite(c.id) ? favorites.filter((f) => f.id !== c.id) : [...favorites, c];
    setFavorites(next);
    save("rtec:favs", next);
  };

  const logout = async () => {
    await api.post("/api/player/logout").catch(() => {});
    onLogout();
  };

  const nowPlaying = current?.epg_id ? epg[current.epg_id]?.[0] : undefined;
  const upNext = current?.epg_id ? epg[current.epg_id]?.slice(1, 3) : undefined;
  const sourceErrors = xt ? catalog?.errors : data?.errors;
  const empty = xt ? sections.every((s) => !counts[s.key]) : channels.length === 0;
  const total = pagedAll ? (pageState?.total ?? 0) : section === "series" && !series ? seriesList.length : visible.length;
  const cap = pagedAll ? Infinity : limit;
  const clearHistory = () => {
    const next = history.filter((h) => h.kind !== section);
    setHistory(next);
    save("rtec:history", next);
  };

  const groupLabel =
    group === FAVORITES ? "Favoritos" : group === HISTORY ? "Histórico" : group ? (groups.find((g) => g.key === group)?.name ?? group) : "Todos";
  const menuOptions: MenuOption[] = [
    { key: "", name: "Todos", icon: <LayoutGrid /> },
    { key: FAVORITES, name: "Favoritos", icon: <Heart />, count: favorites.filter((c) => c.kind === section).length },
    { key: HISTORY, name: "Histórico", icon: <History />, count: history.filter((c) => c.kind === section).length },
    ...groups.map((g) => ({ key: g.key, name: g.name, locked: isLocked(g.name) })),
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <Logo />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground sm:block">
              Olá, <span className="font-semibold text-foreground">{profile.name || profile.username}</span>
            </span>
            <InstallButton compact />
            <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Configurações" aria-label="Configurações">
              <Settings className="!size-5" />
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 pb-3 lg:px-6">
          <nav className="scrollbar-none flex flex-1 gap-1 overflow-x-auto">
            {(
              [
                ["home", "Início", Home],
                ["all", "Tudo", LayoutGrid],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                aria-pressed={page === key}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                  page === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
            {sections
              .filter((s) => counts[s.key] > 0 || s.key === "live")
              .map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => goSection(key)}
                  aria-pressed={page === "section" && section === key}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                    page === "section" && section === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                  {!xt && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", page === "section" && section === key ? "bg-background/15" : "bg-muted")}>{counts[key]}</span>}
                </button>
              ))}
          </nav>
          {!xt && (data?.playlists.length ?? 0) > 1 && (
            <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} aria-label="Lista" className="h-9 w-[150px] shrink-0 text-xs sm:w-[190px]">
              <option value="">Todas as listas</option>
              {data!.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-8 pt-4 lg:px-6">
            {page === "home" ? (
              <HomePage
                history={history}
                loading={catalog === null}
                onOpen={openItem}
                onExplore={() => setPage("all")}
                onClear={() => {
                  setHistory([]);
                  save("rtec:history", []);
                }}
                currentId={current?.id}
                isFavorite={isFavorite}
                onFavorite={toggleFavorite}
                epg={epg}
              />
            ) : page === "all" ? (
              <AllPage
                query={allQuery}
                onQuery={setAllQuery}
                result={allRes?.key === allKey ? allRes : null}
                onOpen={openItem}
                onSeeAll={(k) => {
                  goSection(k);
                  setQuery(allTerm);
                }}
                currentId={current?.id}
                isFavorite={isFavorite}
                onFavorite={toggleFavorite}
              />
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Buscar"
              placeholder={group ? `Buscar em ${groupLabel}...` : section === "live" ? "Buscar canal..." : section === "movie" ? "Buscar filme..." : "Buscar série..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <CategoryMenu
              label={groupLabel}
              value={group}
              options={menuOptions}
              onSelect={(o) => (o.locked ? withPin(() => setGroup(o.key), o.name) : setGroup(o.key))}
            />
            {group === HISTORY && history.some((h) => h.kind === section) && (
              <Button variant="ghost" size="sm" onClick={clearHistory}>
                Limpar
              </Button>
            )}
          </div>

          <div>
            {loading ? (
              <ul className="space-y-1">
                {Array.from({ length: 7 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 p-2">
                    <Skeleton className="h-11 w-14 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (empty && !loadError) || loadError ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center text-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/15 text-warning ring-1 ring-warning/30">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                {!xt && data?.no_source ? (
                  <p className="text-muted-foreground">Sua conta ainda não tem uma lista configurada. Fale com seu revendedor.</p>
                ) : (
                  <>
                    <p className="font-semibold">Não foi possível carregar sua lista</p>
                    {[...(loadError ? [loadError] : []), ...(sourceErrors ?? [])].map((e) => (
                      <p key={e} className="text-muted-foreground">
                        {e}
                      </p>
                    ))}
                    <Button variant="outline" size="sm" onClick={loadAll}>
                      Tentar novamente
                    </Button>
                  </>
                )}
              </div>
            ) : series ? (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setSeries(null)} className="mb-2">
                  <ArrowLeft /> Voltar
                </Button>
                <h2 className="mb-3 px-1 text-lg font-bold tracking-tight">{series.name}</h2>
                {series.episodes === null ? (
                  <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" /> Carregando episódios...
                  </div>
                ) : (
                  <EpisodeList
                    episodes={series.episodes}
                    seriesName={series.name}
                    currentId={current?.id}
                    xt={xt}
                    isFavorite={isFavorite}
                    onPlay={(e) => play({ ...e, group: series.name }, series.episodes!.map((x) => ({ ...x, group: series.name })))}
                    onFavorite={(e) => toggleFavorite({ ...e, group: series.name })}
                  />
                )}
              </div>
            ) : visible.length === 0 ? (
              group === FAVORITES ? (
                <EmptyState icon={<Heart className="h-6 w-6" />} title="Sem favoritos ainda" text="Toque no coração de um canal para salvá-lo aqui." />
              ) : group === HISTORY ? (
                <EmptyState icon={<History className="h-6 w-6" />} title="Histórico vazio" text="O que você assistir aparece aqui, do mais recente para o mais antigo." />
              ) : (
                <EmptyState icon={<Search className="h-6 w-6" />} title="Nada encontrado" text="Tente outro termo ou outra categoria." />
              )
            ) : section === "live" ? (
              <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
                {visible.slice(0, cap).map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    active={current?.id === c.id}
                    favorite={isFavorite(c.id)}
                    now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
                    onPlay={() => play(c, null)}
                    onFavorite={() => toggleFavorite(c)}
                  />
                ))}
              </ul>
            ) : section === "movie" || special ? (
              <PosterGrid items={visible.slice(0, cap).map((c) => ({ ...c, progress: fraction(c.id) }))} activeId={current?.id} onSelect={(c) => openItem(c)} />
            ) : (
              <PosterGrid items={seriesList.slice(0, cap).map((s) => ({ ...s, id: s.key }))} onSelect={openSeries} />
            )}
            {!loading && !series && total > (pagedAll ? visible.length : limit) && (
              <div className="py-3">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!!pageState?.loading}
                  onClick={() => (pagedAll ? loadPage(pageKey, visible.length) : setLimit((l) => l + PAGE))}
                >
                  {pageState?.loading && <Loader2 className="animate-spin" />}
                  Mostrar mais ({total - (pagedAll ? visible.length : limit)})
                </Button>
              </div>
            )}
          </div>
              </div>
            )}
      </main>

      {current && (
        <PlayerOverlay
          channel={current}
          next={nextEpisode}
          favorite={isFavorite(current.id)}
          onFavorite={() => toggleFavorite(current)}
          onNext={(n) => play(n)}
          onClose={() => setCurrent(null)}
          info={nowPlaying ? <EpgNow programme={nowPlaying} next={upNext} /> : undefined}
        />
      )}

      <PinDialog
        open={!!pinFor}
        onClose={() => setPinFor(null)}
        onSuccess={() => {
          setUnlocked(true);
          pinFor?.();
          setPinFor(null);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        settings={settings}
        groups={allGroupNames}
        onSettings={setSettings}
        onLogout={logout}
      />
    </div>
  );
}

function EpgNow({ programme, next }: { programme: Programme; next?: Programme[] }) {
  const start = new Date(programme.start).getTime();
  const stop = new Date(programme.stop).getTime();
  const pct = Math.min(100, Math.max(0, ((Date.now() - start) / (stop - start)) * 100));
  const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
          <span className="text-brand">Agora</span>
          <span className="tabular-nums text-muted-foreground">
            {time(programme.start)} – {time(programme.stop)}
          </span>
        </div>
        <div className="mt-1 truncate font-semibold">{programme.title}</div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        {programme.desc && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{programme.desc}</p>}
      </div>
      {!!next?.length && (
        <div className="hidden rounded-xl border bg-card/50 p-4 sm:block">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">A seguir</div>
          {next.map((p) => (
            <div key={p.start} className="mt-1.5 flex gap-2 text-sm">
              <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{time(p.start)}</span>
              <span className="truncate font-semibold">{p.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  channel: c,
  label,
  now,
  active,
  favorite,
  onPlay,
  onFavorite,
  progress = 0,
  badge,
  sub,
}: {
  channel: Channel;
  label?: string;
  now?: string;
  active: boolean;
  favorite: boolean;
  onPlay: () => void;
  onFavorite: () => void;
  progress?: number;
  badge?: ReactNode;
  sub?: string;
}) {
  return (
    <li className={cn("flex items-center rounded-xl transition-colors", active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-accent")}>
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left">
        <ChannelLogo channel={c} />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-semibold", active && "text-primary")}>{label ?? c.name}</div>
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            {badge}
            <span className="truncate">{now ? `Agora: ${now}` : (sub ?? c.group)}</span>
          </div>
          {progress > 0 && <ProgressBar value={progress} className="mt-1.5" />}
        </div>
        {active && <Play className="ml-auto h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}
      </button>
      <button onClick={onFavorite} className="rounded-lg p-3 text-muted-foreground transition-colors hover:text-destructive" aria-label="Favorito">
        <Heart className={cn("h-4 w-4", favorite && "fill-destructive text-destructive")} />
      </button>
    </li>
  );
}

type PosterItem = { id: string; name: string; logo: string; sub?: string; progress?: number };

function PosterGrid<T extends PosterItem>({ items, activeId, onSelect }: { items: T[]; activeId?: string; onSelect: (item: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3 pb-1 pt-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item)} className="group text-left">
          <div
            className={cn(
              "relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-secondary to-card ring-1 ring-border transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow group-hover:ring-primary/50",
              activeId === item.id && "ring-2 ring-primary",
            )}
          >
            {item.logo ? (
              <img src={item.logo} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
            ) : (
              <Film className="h-6 w-6 text-muted-foreground" />
            )}
            {!!item.progress && item.progress > 0 && (
              <div className="absolute inset-x-1.5 bottom-1.5">
                <ProgressBar value={item.progress} />
              </div>
            )}
            {!!item.progress && item.progress >= WATCHED_AT && (
              <CheckCircle2 className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-background/80 text-success" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-background/30 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-background">
                <Play className="h-4 w-4 fill-current" />
              </span>
            </span>
          </div>
          <div className="mt-2 line-clamp-2 text-xs font-semibold">{item.name}</div>
          {item.sub && <div className="text-[11px] text-muted-foreground">{item.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function ChannelLogo({ channel: c }: { channel: Channel }) {
  return (
    <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted ring-1 ring-border">
      {c.logo ? (
        <img src={c.logo} alt="" loading="lazy" className="h-full w-full object-contain p-1" onError={(e) => (e.currentTarget.style.display = "none")} />
      ) : (
        <Tv className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

type MenuOption = { key: string; name: string; icon?: ReactNode; count?: number; locked?: boolean };

/** Botao que abre o menu flutuante de categorias (Todos, Favoritos, Historico e as categorias da lista). */
function CategoryMenu({ label, value, options, onSelect }: { label: string; value: string; options: MenuOption[]; onSelect: (o: MenuOption) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  const fixed = options.filter((o) => o.icon);
  const cats = options.filter((o) => !o.icon && o.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const pick = (o: MenuOption) => {
    setOpen(false);
    onSelect(o);
  };

  const item = (o: MenuOption) => (
    <li key={o.key || "__todos__"}>
      <button
        type="button"
        role="option"
        aria-selected={value === o.key}
        onClick={() => pick(o)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
          value === o.key ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {o.icon && <span className={cn("[&_svg]:h-4 [&_svg]:w-4", value === o.key && "text-primary")}>{o.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{o.name}</span>
        {o.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-warning" />}
        {!!o.count && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{o.count}</span>}
        {value === o.key && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    </li>
  );

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border bg-card/60 px-3 text-left text-sm transition-colors hover:border-muted-foreground/30",
          open && "border-primary/60 ring-2 ring-ring/40",
        )}
      >
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categoria</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          {/* No celular o menu abre como painel de baixo para cima; no computador, logo abaixo do botao. */}
          <div className="fixed inset-0 z-40 animate-fade-in bg-background/70 backdrop-blur-sm sm:hidden" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 animate-rise-in overflow-hidden rounded-t-3xl border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl sm:absolute sm:bottom-auto sm:top-full sm:z-40 sm:mt-2 sm:animate-pop-in sm:rounded-2xl sm:pb-0">
            <div className="flex items-center justify-between border-b px-4 py-3 sm:hidden">
              <span className="font-semibold">Categorias</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul role="listbox" aria-label="Categorias" className="max-h-[70dvh] overflow-y-auto p-1.5 sm:max-h-[min(60vh,420px)]">
              {fixed.map(item)}
              {options.length > fixed.length && (
                <>
                  <li className="my-1.5 border-t" aria-hidden />
                  {options.length - fixed.length > 8 && (
                    <li className="relative px-1 pb-1.5">
                      <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-[calc(50%+3px)] text-muted-foreground" />
                      <Input className="h-9 pl-9 pr-8" placeholder="Filtrar categorias" aria-label="Filtrar categorias" value={filter} onChange={(e) => setFilter(e.target.value)} />
                      {filter && (
                        <button type="button" onClick={() => setFilter("")} className="absolute right-3 top-1/2 -translate-y-[calc(50%+3px)] text-muted-foreground hover:text-foreground" aria-label="Limpar filtro">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  )}
                  {cats.length ? cats.map(item) : <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma categoria encontrada</li>}
                </>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-muted/80", className)} aria-label={`${Math.round(value * 100)}% assistido`}>
      <div className={cn("h-full rounded-full", value >= WATCHED_AT ? "bg-success" : "bg-brand")} style={{ width: `${Math.max(3, Math.round(value * 100))}%` }} />
    </div>
  );
}

/** Lista de episodios: marca o que ja foi assistido, o que esta tocando e quanto de cada um (barra). */
function EpisodeList({
  episodes,
  currentId,
  xt,
  isFavorite,
  onPlay,
  onFavorite,
}: {
  episodes: Episode[];
  seriesName: string;
  currentId?: string;
  xt: boolean;
  isFavorite: (id: string) => boolean;
  onPlay: (e: Episode) => void;
  onFavorite: (e: Episode) => void;
}) {
  // Ultimo episodio mexido = onde o cliente parou ("Continuar").
  const lastId = episodes.reduce<{ id: string; t: number } | null>((best, e) => {
    const pr = getProgress(e.id);
    return pr && (!best || pr.t > best.t) ? { id: e.id, t: pr.t } : best;
  }, null)?.id;
  const resume = episodes.find((e) => e.id === lastId);
  const nextUp = resume && fraction(resume.id) >= WATCHED_AT ? episodes[episodes.indexOf(resume) + 1] : resume;

  return (
    <div className="space-y-3">
      {nextUp && (
        <Button variant="gradient" onClick={() => onPlay(nextUp)} className="w-full sm:w-auto">
          <Play className="fill-current" /> {fraction(nextUp.id) > 0 ? "Continuar" : "Assistir"} T{nextUp.season} · E{nextUp.episode}
        </Button>
      )}
      <ul className="grid gap-1 md:grid-cols-2">
        {episodes.map((e) => {
          const f = fraction(e.id);
          const watched = f >= WATCHED_AT;
          const playing = currentId === e.id;
          return (
            <ChannelRow
              key={e.id}
              channel={e}
              label={e.episode ? `T${e.season} · Episódio ${e.episode}${xt && e.name ? ` · ${e.name}` : ""}` : e.name}
              active={playing}
              favorite={isFavorite(e.id)}
              onPlay={() => onPlay(e)}
              onFavorite={() => onFavorite(e)}
              progress={f}
              sub={watched ? "Assistido" : f > 0 ? `${Math.round(f * 100)}% assistido` : "Não assistido"}
              badge={
                playing ? (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">Tocando</span>
                ) : e.id === lastId && !watched ? (
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand">Parou aqui</span>
                ) : watched ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

const KIND_LABEL: Record<Section, string> = { live: "TV ao vivo", movie: "Filme", series: "Série" };

/** Pagina inicial: historico do que o cliente assistiu por ultimo. */
function HomePage({
  history,
  loading,
  onOpen,
  onExplore,
  onClear,
  currentId,
  isFavorite,
  onFavorite,
  epg,
}: {
  history: Channel[];
  loading: boolean;
  onOpen: (c: Channel) => void;
  onExplore: () => void;
  onClear: () => void;
  currentId?: string;
  isFavorite: (id: string) => boolean;
  onFavorite: (c: Channel) => void;
  epg: Record<string, Programme[]>;
}) {
  const resume = history.filter((c) => c.kind !== "live" && fraction(c.id) > 0 && fraction(c.id) < WATCHED_AT);
  if (!loading && !history.length) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" />}
        title="Nada assistido ainda"
        text="O que você assistir aparece aqui, para continuar de onde parou."
        action={
          <Button variant="gradient" onClick={onExplore}>
            <LayoutGrid /> Explorar tudo
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-8">
      {!!resume.length && (
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Continuar assistindo</h2>
          <PosterGrid items={resume.slice(0, 16).map((c) => ({ ...c, progress: fraction(c.id), sub: c.kind === "series" ? c.group : undefined }))} activeId={currentId} onSelect={onOpen} />
        </section>
      )}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight">Histórico</h2>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Limpar
          </Button>
        </div>
        <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
          {history.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              active={currentId === c.id}
              favorite={isFavorite(c.id)}
              onPlay={() => onOpen(c)}
              onFavorite={() => onFavorite(c)}
              progress={c.kind === "live" ? 0 : fraction(c.id)}
              now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
              badge={<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">{KIND_LABEL[c.kind]}</span>}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Pagina "Tudo": canais, filmes e series juntos, com busca em tudo. */
function AllPage({
  query,
  onQuery,
  result,
  onOpen,
  onSeeAll,
  currentId,
  isFavorite,
  onFavorite,
}: {
  query: string;
  onQuery: (q: string) => void;
  result: { loading: boolean; data: Record<Section, { total: number; items: Channel[] }> } | null;
  onOpen: (c: Channel) => void;
  onSeeAll: (k: Section) => void;
  currentId?: string;
  isFavorite: (id: string) => boolean;
  onFavorite: (c: Channel) => void;
}) {
  const kinds: { key: Section; label: string }[] = [
    { key: "live", label: "TV ao vivo" },
    { key: "movie", label: "Filmes" },
    { key: "series", label: "Séries" },
  ];
  const nothing = result && !result.loading && kinds.every((k) => !result.data[k.key].total);
  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-12 pl-10 text-base" aria-label="Buscar em tudo" placeholder="Buscar canais, filmes e séries..." value={query} onChange={(e) => onQuery(e.target.value)} autoFocus />
        {result?.loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />}
      </div>
      {!result ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
          ))}
        </div>
      ) : nothing ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Nada encontrado" text="Tente outro nome." />
      ) : (
        kinds.map(({ key, label }) => {
          const r = result.data[key];
          if (!r.total) return null;
          return (
            <section key={key}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight">
                  {label} <span className="text-sm font-normal text-muted-foreground">({r.total.toLocaleString("pt-BR")})</span>
                </h2>
                <Button variant="ghost" size="sm" onClick={() => onSeeAll(key)}>
                  Ver tudo <ChevronRight />
                </Button>
              </div>
              {key === "live" ? (
                <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
                  {r.items.slice(0, 9).map((c) => (
                    <ChannelRow key={c.id} channel={c} active={currentId === c.id} favorite={isFavorite(c.id)} onPlay={() => onOpen(c)} onFavorite={() => onFavorite(c)} />
                  ))}
                </ul>
              ) : (
                <PosterGrid items={r.items.map((c) => ({ ...c, progress: fraction(c.id) }))} activeId={currentId} onSelect={onOpen} />
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
