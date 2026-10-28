import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Bell, BellRing, ArrowUpDown, SlidersHorizontal, Check, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Download, Film, Heart, History, Home, KeyRound, LayoutGrid, Loader2, Lock, Play, Radio, RotateCw, Search, Settings, Share, SquarePlus, Trophy, Tv, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, isListExpired, type Catalog, type Channel, type ChannelsResponse, type ClientProfile, type PlayerSettings, type Programme } from "@/lib/api";
import { APK_URL, useApkAvailable, useInstall } from "@/lib/pwa";
import { cn, formatDate } from "@/lib/utils";
import { Button, Dialog, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import Logo from "@/components/Logo";
import PlayerOverlay from "@/components/player/PlayerOverlay";
import { MovieDetails, Recommendations, TitleHeader, useTitleInfo } from "@/components/player/TitleDetails";
import { WATCHED_AT, adoptProgress, fraction, getProgress, resumeAt, saveProgress, useProgressVersion } from "@/lib/progress";
import { applyRelink, relinkM3u, relinkXtream } from "@/lib/relink";
import { episodeInfo, lastEpisodePerSeries, seriesKeyOf } from "@/lib/titlekey";
import { listChanged, onRemoteList, startSync } from "@/lib/sync";
import { refreshChannels } from "@/lib/links";
import PinDialog from "@/components/player/PinDialog";
import SettingsDialog from "@/components/player/SettingsDialog";
import { Avatar, ProfilePicker } from "@/components/player/Profiles";
import ListExpired from "@/components/player/ListExpired";
import GamesPage, { GameAlerts } from "@/components/player/Games";
import { alertOn, epLabel, favoriteAdded, favoriteRemoved, loadEpAlerts, markSeen, markShown, resetEpAlerts, setEpAlert, shouldShow, useEpAlerts, type EpAlert } from "@/lib/epalerts";
import Screensaver, { saverItem, type SaverItem } from "@/components/player/Screensaver";
import { tvScreenOn } from "@/lib/tvnav";
import { castControl, castPlay, castTarget, knownDevices, onCastPlay, setCastNow, setCastTarget, startCast, useCast, type CastPlay } from "@/lib/cast";
import { CastBar, CastButton, CastDialog, CastRemote, WhereDialog } from "@/components/player/Cast";
import { MAIN_PROFILE, fetchProfiles, lastProfile, rememberProfile, scoped, setStorageProfile, type ProfilesResponse, type Viewer } from "@/lib/profiles";

const FAVORITES = "__favoritos__";
const HISTORY = "__historico__";
const PAGE = 200;
const HISTORY_MAX = 60;
const ADULT = /(adult|xxx|\+18|18\+|adulto|er[oó]tic|hot\b|sexy|porn)/i;

type Section = Channel["kind"];
/** TV ao vivo e radios: lista de canais (sem ponto onde parou, sem filtros de filme). */
const liveLike = (k: string) => k === "live" || k === "radio";
type Page = "home" | "all" | "section" | "games";

/** Minusculas e sem acentos (busca). */
const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const ALL_LIMIT = 24;

/** Ordenacoes do catalogo ("" = ordem do fornecedor). Filmes e series tem ano e nota; canais, so o nome. */
const SORT_OPTIONS: { key: string; label: string; vod?: boolean }[] = [
  { key: "", label: "Padrão" },
  { key: "az", label: "Nome (A → Z)" },
  { key: "za", label: "Nome (Z → A)" },
  { key: "recent", label: "Adicionados recentemente", vod: true },
  { key: "oldest", label: "Adicionados há mais tempo", vod: true },
  { key: "year_desc", label: "Lançamento (mais novos)", vod: true },
  { key: "year_asc", label: "Lançamento (mais antigos)", vod: true },
  { key: "rating", label: "Melhor avaliados", vod: true },
];
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const SORT_FN: Record<string, (a: Channel, b: Channel) => number> = {
  az: (a, b) => collator.compare(a.name, b.name),
  za: (a, b) => collator.compare(b.name, a.name),
  recent: (a, b) => (b.added || 0) - (a.added || 0),
  oldest: (a, b) => (a.added || Infinity) - (b.added || Infinity),
  year_desc: (a, b) => (b.year || 0) - (a.year || 0) || collator.compare(a.name, b.name),
  year_asc: (a, b) => (a.year || Infinity) - (b.year || Infinity) || collator.compare(a.name, b.name),
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || collator.compare(a.name, b.name),
};
const sortList = (list: Channel[], sort: string) => (SORT_FN[sort] ? [...list].sort(SORT_FN[sort]) : list);
/** "2023 · ★ 8.4" embaixo do poster. */
/** Filtros extras (alem da categoria): generos, de/ate o ano e nota minima. */
type Filters = { g: string[]; y1: number; y2: number; r: number };
const NO_FILTERS: Filters = { g: [], y1: 0, y2: 0, r: 0 };
const filterCount = (f: Filters) => (f.g.length ? 1 : 0) + (f.y1 || f.y2 ? 1 : 0) + (f.r ? 1 : 0);
const filterQuery = (f: Filters) => {
  const q = new URLSearchParams();
  if (f.g.length) q.set("g", f.g.join(","));
  if (f.y1) q.set("y1", String(f.y1));
  if (f.y2) q.set("y2", String(f.y2));
  if (f.r) q.set("r", String(f.r));
  return q.toString();
};
const yearOf = (c: Channel) => c.year || Number(/\((19|20)\d{2}\)/.exec(c.name)?.[0].slice(1, 5)) || 0;
/** Generos do item; sem eles, o fim do nome da categoria ("Filmes | Acao" -> "Acao"), como no servidor. */
const genresOf = (c: Channel) => (c.genres?.length ? c.genres : (/[|:\-–]\s*([^|:\-–]+?)\s*$/.exec(c.group || "")?.slice(1, 2) ?? []));
function applyFilters(list: Channel[], f: Filters) {
  if (!filterCount(f)) return list;
  const g = new Set(f.g.map(fold));
  return list.filter((c) => {
    const y = yearOf(c);
    return (!g.size || genresOf(c).some((x) => g.has(fold(x)))) && (!f.y1 || y >= f.y1) && (!f.y2 || (y > 0 && y <= f.y2)) && (!f.r || (c.rating || 0) >= f.r);
  });
}
type Facets = { genres: { name: string; count: number }[]; years: { min: number; max: number }; rated: number };
function localFacets(list: Channel[]): Facets {
  const genres = new Map<string, { name: string; count: number }>();
  let min = 0;
  let max = 0;
  let rated = 0;
  for (const c of list) {
    for (const g of genresOf(c)) {
      const cur = genres.get(fold(g)) ?? { name: g, count: 0 };
      cur.count++;
      genres.set(fold(g), cur);
    }
    const y = yearOf(c);
    if (y) {
      min = min ? Math.min(min, y) : y;
      max = Math.max(max, y);
    }
    if (c.rating) rated++;
  }
  return { genres: [...genres.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name)).slice(0, 60), years: { min, max }, rated };
}

const metaLine = (c: Channel) => [c.year || "", c.rating ? `★ ${c.rating.toFixed(1)}` : ""].filter(Boolean).join(" · ") || undefined;

const sections: { key: Section; label: string; icon: typeof Tv }[] = [
  { key: "live", label: "TV ao vivo", icon: Tv },
  { key: "movie", label: "Filmes", icon: Film },
  { key: "series", label: "Séries", icon: Clapperboard },
  { key: "radio", label: "Rádios", icon: Radio },
];

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Salva favoritos/historico no aparelho e agenda o envio para a conta (outros aparelhos). */
function saveList(key: "favorites" | "history", items: Channel[]) {
  save(scoped(key === "favorites" ? "rtec:favs" : "rtec:history"), items);
  listChanged(key);
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponivel (aba anonima etc.) */
  }
}

// Titulo mandado de outro aparelho: vai para a tela do perfil aberto (ou fica guardado ate o perfil abrir).
let castInbox: ((p: CastPlay) => void) | null = null;
let castPending: CastPlay | null = null;

export default function Player() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [checking, setChecking] = useState(true);
  // A cada abertura o servidor confere a lista no fornecedor; vencida, mostra a tela de lista expirada.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api
      .get<ClientProfile>("/api/player/me")
      .then(setProfile)
      .catch((err) => {
        setProfile(null);
        setExpired(isListExpired(err));
      })
      .finally(() => setChecking(false));
  }, []);

  // Perfis da conta: sempre pergunta "Quem esta assistindo?" ao abrir (como na Netflix).
  const [viewers, setViewers] = useState<ProfilesResponse | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [manage, setManage] = useState(false);

  const choose = useCallback(
    (v: Viewer) => {
      if (!profile) return;
      setStorageProfile(v.id);
      rememberProfile(profile.username, v.id);
      setViewer(v);
    },
    [profile],
  );

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    fetchProfiles(profile.username)
      .then((res) => {
        if (!alive) return;
        setViewers(res);
      })
      .catch(() => {
        // Sem rede e sem perfis guardados: entra no principal.
        if (alive) choose({ id: MAIN_PROFILE, name: profile.name || profile.username, avatar: 0, kids: false });
      });
    return () => {
      alive = false;
    };
  }, [profile, choose]);

  // Aparelho logado aparece para os outros da conta e obedece "tocar aqui", ate na tela de perfis.
  const username = profile?.username;
  useEffect(() => (username ? startCast(username) : undefined), [username]);
  const castRef = useRef({ viewer, viewers, choose });
  castRef.current = { viewer, viewers, choose };
  useEffect(
    () =>
      onCastPlay((p) => {
        const { viewer: v, viewers: vs, choose: pick } = castRef.current;
        toast(`${p.name} mandou tocar aqui`, { description: p.item.name });
        if (v?.id === p.profile && castInbox) return castInbox(p);
        // Toca no perfil de quem mandou (favoritos, historico e progresso dele).
        castPending = p;
        const next = vs?.profiles.find((x) => x.id === p.profile) ?? v ?? vs?.profiles[0];
        if (next && next.id !== v?.id) {
          setManage(false);
          pick(next);
        } else if (castInbox) {
          castPending = null;
          castInbox(p);
        }
      }),
    [],
  );

  const logout = useCallback(() => {
    setProfile(null);
    setViewer(null);
    setViewers(null);
    setExpired(false);
  }, []);

  const listExpired = useCallback(() => {
    logout();
    setExpired(true);
  }, [logout]);

  if (checking || (profile && !viewer && !viewers))
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  if (expired)
    return (
      <ListExpired
        onRenewed={(p) => {
          setExpired(false);
          setProfile(p);
        }}
        onLogout={async () => {
          await api.post("/api/player/logout").catch(() => {});
          logout();
        }}
      />
    );
  if (!profile) return <PlayerLogin onLogin={setProfile} onExpired={listExpired} />;
  if (!viewer && viewers)
    return (
      <ProfilePicker
        account={profile}
        profiles={viewers.profiles}
        max={viewers.max}
        manage={manage}
        focusId={lastProfile(profile.username)}
        onPick={(v) => {
          setManage(false);
          choose(v);
        }}
        onChange={(list) => setViewers({ ...viewers, profiles: list })}
        onLogout={async () => {
          await api.post("/api/player/logout").catch(() => {});
          logout();
        }}
      />
    );
  return (
    <Watch
      key={viewer!.id}
      profile={profile}
      viewer={viewer!}
      onSwitchProfile={(manageProfiles) => {
        setManage(manageProfiles);
        setViewers((v) => v ?? { profiles: [viewer!], max: 5 });
        setViewer(null);
      }}
      onLogout={logout}
      onExpired={listExpired}
    />
  );
}

function PlayerLogin({ onLogin, onExpired }: { onLogin: (p: ClientProfile) => void; onExpired: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(await api.post<ClientProfile>("/api/player/login", { username, password }));
    } catch (err) {
      if (isListExpired(err)) return onExpired();
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
      <>
        {/* O download comeca e, junto, abre o passo a passo dos avisos do Android (fontes desconhecidas e Play Protect). */}
        <a href={APK_URL} download onClick={() => setHelp(true)}>
          <Button variant="outline" size={compact ? "sm" : "default"} type="button">
            <Download /> {compact ? "App" : "Baixar app Android"}
          </Button>
        </a>
        <Dialog open={help} onClose={() => setHelp(false)} title="Baixando o app..." description="O celular vai mostrar alguns avisos. É normal, siga estes passos:">
          <ol className="space-y-4 text-sm">
            {[
              <>
                Quando terminar o download, toque em <b>Abrir</b>.
              </>,
              <>
                Se pedir, toque em <b>Configurações</b>, ligue <b>Permitir desta fonte</b> e volte.
              </>,
              <>
                Toque em <b>Instalar</b>. Se aparecer o aviso do <b>Play Protect</b>, toque em <b>Mais detalhes</b> e em <b>Instalar mesmo assim</b>.
              </>,
            ].map((step, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <a href="/instalar" className="mt-5 block">
            <Button variant="outline" className="w-full" type="button">
              Ver passo a passo com imagens
            </Button>
          </a>
        </Dialog>
      </>
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
type OpenSeries = { key: string; name: string; logo: string; episodes: Episode[] | null };

function Watch({
  profile,
  viewer,
  onSwitchProfile,
  onLogout,
  onExpired,
}: {
  profile: ClientProfile;
  viewer: Viewer;
  onSwitchProfile: (manage: boolean) => void;
  onLogout: () => void;
  onExpired: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [data, setData] = useState<ChannelsResponse | null>(null); // listas M3U comuns
  const [xtItems, setXtItems] = useState<Record<string, Channel[] | "loading" | { error: string }>>({}); // Xtream: por secao/categoria
  const [settings, setSettings] = useState<PlayerSettings>({ custom_pin: false, locked_groups: [] });
  const [page, setPage] = useState<Page>("home");
  const tv = tvScreenOn();
  const [peek, setPeek] = useState<Channel | null>(null); // TV: canal selecionado na lista ao vivo (painel da direita)
  const [sorts, setSorts] = useState<Record<string, string>>(() => load("rtec:sort", {}));
  const [filtersBy, setFiltersBy] = useState<Record<string, Filters>>(() => load("rtec:filters", {}));
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [movie, setMovie] = useState<Channel | null>(null); // tela de detalhes do filme
  const [favorites, setFavorites] = useState<Channel[]>(() => load(scoped("rtec:favs"), []));
  const [history, setHistory] = useState<Channel[]>(() => load(scoped("rtec:history"), []));
  // Historico guardado antes desta regra pode ter varios EPs da mesma serie: mostra so o mais recente.
  const shownHistory = useMemo(() => lastEpisodePerSeries(history), [history]);
  // Favoritos, historico e progresso acompanham o perfil na conta: o que fizer aqui aparece nos outros aparelhos.
  useEffect(() => {
    const off = onRemoteList((key, items) => {
      const set = key === "favorites" ? setFavorites : setHistory;
      set(items);
      // Vindo de outro aparelho pode trazer links do servidor de video ja vencidos: renova.
      refreshChannels(items)
        .then((fresh) => fresh !== items && set(fresh))
        .catch(() => {});
    });
    const stop = startSync(profile.username);
    return () => {
      off();
      stop();
    };
  }, [profile.username]);
  const [xtPage, setXtPage] = useState<XtPage | null>(null); // Xtream: "Todos" de filmes/series, em paginas
  const [searchTerm, setSearchTerm] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [epg, setEpg] = useState<Record<string, Programme[]>>({});

  const xt = catalog?.mode === "xtream";
  const handleAuthError = useCallback(
    (err: unknown) => {
      if (isListExpired(err)) {
        onExpired();
        return true;
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        toast.error(err.message);
        onLogout();
        return true;
      }
      return false;
    },
    [onLogout, onExpired],
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

  // Ao entrar: renova os links guardados no historico e nos favoritos (logos e videos).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, f] = await Promise.all([refreshChannels(load<Channel[]>(scoped("rtec:history"), [])), refreshChannels(load<Channel[]>(scoped("rtec:favs"), []))]);
        if (!alive) return;
        setHistory(h);
        save(scoped("rtec:history"), h);
        setFavorites(f);
        save(scoped("rtec:favs"), f);
      } catch {
        /* sem conexao: tenta de novo na proxima vez */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Lista trocada ou atualizada: historico e favoritos voltam a apontar para os mesmos titulos na lista nova.
  // M3U: confere a cada abertura (o catalogo inteiro ja esta aqui). Xtream: quando a lista muda (sig).
  const relinkSaved = useCallback((map: Map<string, Channel>) => {
    adoptProgress([...load<Channel[]>(scoped("rtec:history"), []), ...load<Channel[]>(scoped("rtec:favs"), [])]);
    if (!map.size) return;
    for (const [key, set] of [["history", setHistory], ["favorites", setFavorites]] as const) {
      set((old) => {
        const next = applyRelink(old, map);
        if (next !== old) saveList(key, next);
        return next;
      });
    }
  }, []);
  useEffect(() => {
    if (!data?.channels.length || catalog?.mode !== "m3u") return;
    adoptProgress(data.channels);
    relinkSaved(relinkM3u([...load<Channel[]>(scoped("rtec:history"), []), ...load<Channel[]>(scoped("rtec:favs"), [])], data.channels));
  }, [data, catalog, relinkSaved]);
  useEffect(() => {
    const sig = catalog?.mode === "xtream" && !catalog.errors?.length ? catalog.sig : "";
    if (!sig || load(scoped("rtec:linksig"), "") === sig) return;
    let alive = true;
    const saved = [...load<Channel[]>(scoped("rtec:history"), []), ...load<Channel[]>(scoped("rtec:favs"), [])];
    (saved.length ? relinkXtream(saved) : Promise.resolve(new Map<string, Channel>()))
      .then((map) => {
        if (!alive) return;
        relinkSaved(map);
        save(scoped("rtec:linksig"), sig);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [catalog, relinkSaved]);

  useEffect(() => {
    loadAll();
    api.get<PlayerSettings>("/api/player/settings").then(setSettings).catch(() => {});
  }, [loadAll]);

  // Perfil infantil: categorias adultas e bloqueadas nunca abrem (nem com PIN) e somem do menu.
  const isLocked = useCallback(
    (g: string) => (viewer.kids || !unlocked) && (ADULT.test(g) || settings.locked_groups.includes(g)),
    [viewer.kids, unlocked, settings],
  );

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
    const out: Record<Section, number> = { live: 0, radio: 0, movie: 0, series: 0 };
    if (xt) for (const s of sections) out[s.key] = catalog?.sections?.[s.key]?.length ?? 0;
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
  const pagedAll = xt && !liveLike(section) && !group;
  const sort = sorts[section] ?? "";
  const setSort = (v: string) =>
    setSorts((old) => {
      const next = { ...old, [section]: v };
      save("rtec:sort", next);
      return next;
    });
  const filters = liveLike(section) ? NO_FILTERS : { ...NO_FILTERS, ...filtersBy[section] };
  const setFilters = (f: Filters) =>
    setFiltersBy((old) => {
      const next = { ...old, [section]: f };
      save("rtec:filters", next);
      return next;
    });
  const fq = encodeURIComponent(filterQuery(filters));
  const xtKey = xt && !special && !pagedAll ? `${section}:${liveLike(section) ? "" : group}:${sort}:${fq}` : "";
  const skipIds = useMemo(() => groups.filter((g) => isLocked(g.name)).map((g) => g.key).join(","), [groups, isLocked]);
  const pageKey = pagedAll ? `${section}|${searchTerm}|${skipIds}|${sort}|${fq}` : "";

  const loadPage = useCallback(
    (key: string, offset: number) => {
      const [sec, q, skip, srt, f] = key.split("|");
      setXtPage((p) => (offset && p?.key === key ? { ...p, loading: true } : { key, items: [], total: 0, loading: true, error: "" }));
      const params = new URLSearchParams({ section: sec, limit: String(PAGE), offset: String(offset), q, skip, sort: srt });
      const extra = decodeURIComponent(f || "");
      api
        .get<{ total: number; items: Channel[] }>(`/api/player/xtream/items?${params}${extra ? `&${extra}` : ""}`)
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
    const [sec, cat, srt, f] = xtKey.split(":");
    const extra = decodeURIComponent(f || "");
    api
      .get<Channel[]>(`/api/player/xtream/items?section=${sec}&category=${encodeURIComponent(cat)}&sort=${srt}${extra ? `&${extra}` : ""}`)
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

  // Lista antes dos filtros extras (para montar as opcoes do popup sem o servidor).
  const unfiltered = useMemo(() => {
    let list: Channel[];
    if (group === FAVORITES) list = favorites.filter((c) => c.kind === section);
    else if (group === HISTORY) list = shownHistory.filter((c) => c.kind === section);
    else if (pagedAll) return pageState?.items ?? [];
    else if (xt) {
      list = Array.isArray(xtState) ? xtState : [];
      if (liveLike(section)) list = list.filter((c) => (group ? c.group === groups.find((g) => g.key === group)?.name : !isLocked(c.group)));
    } else {
      list = channels.filter(
        (c) => c.kind === section && (!playlistId || c.playlist_id === playlistId) && (group ? c.group === group : !isLocked(c.group)),
      );
    }
    return list;
  }, [group, favorites, shownHistory, section, pagedAll, pageState, xt, xtState, groups, isLocked, channels, playlistId]);

  const visible = useMemo(() => {
    if (pagedAll) return unfiltered;
    const q = query.trim().toLowerCase();
    // Xtream por categoria ja vem filtrado e ordenado do servidor; o resto e feito aqui.
    let list = !xt || special ? sortList(applyFilters(unfiltered, filters), sort) : unfiltered;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unfiltered, pagedAll, query, xt, special, sort, fq]);

  // Series: no Xtream cada item e uma serie (episodios vem da API); nas listas M3U, agrupa pelo nome.
  const seriesList = useMemo(() => {
    if (section !== "series") return [];
    if (xt) return visible.map((c) => ({ key: c.series_id || c.id, name: c.name, logo: c.logo, sub: metaLine(c) ?? "", episodes: null as Episode[] | null }));
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

  const pushNav = () => window.history.pushState({ rtecNav: true }, "");

  // Titulos abertos pelas recomendacoes: o "voltar" retorna ao anterior em vez de fechar a tela.
  const prevTitles = useRef<{ movie: Channel[]; series: OpenSeries[] }>({ movie: [], series: [] });

  const openSeries = (s: (typeof seriesList)[number], fromRec = false) => {
    if (!fromRec) prevTitles.current.series = [];
    else if (series) prevTitles.current.series.push(series);
    pushNav();
    if (s.episodes) return setSeries({ key: s.key, name: s.name, logo: s.logo, episodes: s.episodes });
    setSeries({ key: s.key, name: s.name, logo: s.logo, episodes: null });
    api
      .get<Episode[]>(`/api/player/xtream/series/${encodeURIComponent(s.key)}?name=${encodeURIComponent(s.name)}`)
      .then((eps) => setSeries((cur) => (cur?.name === s.name ? { ...cur, episodes: eps } : cur)))
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

  const withPin = (fn: () => void | Promise<void>, groupName: string) => {
    if (!isLocked(groupName)) fn();
    else if (viewer.kids) toast.error("Indisponível no perfil infantil");
    else setPinFor(() => fn);
  };

  const addHistory = (c: Channel) =>
    setHistory((old) => {
      // Episodio: sai do historico o EP anterior da mesma serie, fica so o ultimo tocado.
      const sk = seriesKeyOf(c);
      const next = [c, ...old.filter((h) => h.id !== c.id && (!sk || seriesKeyOf(h) !== sk))].slice(0, HISTORY_MAX);
      saveList("history", next);
      return next;
    });
  const startPlay = async (c0: Channel, list?: Channel[] | null) => {
    // Itens guardados (historico, favoritos) podem ter o link do servidor de video vencido: renova antes.
    const c = await refreshChannels([c0])
      .then((r) => r[0])
      .catch(() => c0);
    setCurrent(c);
    if (list !== undefined) setQueue(list);
    addHistory(c);
  };
  // Conectado a outro aparelho (TV): o titulo toca la, continuando de onde parou aqui.
  const sendTo = async (c: Channel, at = resumeAt(c), dur = getProgress(c)?.d ?? 0) => {
    const name = castTarget()?.name;
    try {
      await castPlay(c, viewer.id, at, dur);
      addHistory(c);
      toast.success(`Tocando em ${name}`, { description: c.name });
      if (!remoteOpen) {
        pushNav();
        setRemoteOpen(true);
      }
    } catch {
      toast.error(`Não foi possível mandar para ${name}`);
    }
  };
  // Com outro aparelho da conta aberto (e sem estar conectado a ele), pergunta onde tocar. `ask` falso: troca de
  // episodio/canal dentro do player, que continua onde esta.
  const [where, setWhere] = useState<{ c: Channel; list?: Channel[] | null } | null>(null);
  const play = (c0: Channel, list?: Channel[] | null, ask = true) =>
    withPin(() => {
      if (castTarget()) return sendTo(c0);
      if (ask && !tv && knownDevices().length) return setWhere({ c: c0, list });
      return startPlay(c0, list);
    }, c0.group);

  // Recebendo de outro aparelho da conta: toca aqui (o PIN ja foi pedido la).
  const fromCast = useRef<(p: CastPlay) => void>();
  fromCast.current = (p) => {
    if (p.at > 0 && p.dur > 0) saveProgress(p.item, p.at + 5, p.dur);
    setMovie(null);
    void startPlay(p.item, p.item.kind === "series" ? undefined : null);
  };
  useEffect(() => {
    castInbox = (p) => fromCast.current?.(p);
    if (castPending) {
      const p = castPending;
      castPending = null;
      castInbox(p);
    }
    return () => {
      castInbox = null;
    };
  }, []);
  // O outro aparelho acompanha o que toca aqui e pode mandar parar (fecha o player como o botao voltar).
  useEffect(() => {
    setCastNow(current, () => (window.history.state?.rtecPlayer ? window.history.back() : setCurrent(null)));
    return () => setCastNow(null, null);
  }, [current]);
  const cast = useCast();
  const [castOpen, setCastOpen] = useState(false);
  const [castFromPlayer, setCastFromPlayer] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false); // controle completo do que toca no outro aparelho
  // O que toca no outro aparelho conta como "tocando" para anterior/proximo e a lista de EPs/canais do controle.
  const playing = current ?? (cast.target && cast.state ? cast.state.item : null);
  const closeRemote = useCallback(() => {
    if (window.history.state?.rtecNav) window.history.back();
    else setRemoteOpen(false);
  }, []);

  // Episodio aberto pelo historico ou pela busca: carrega a serie para saber qual e o proximo.
  useEffect(() => {
    if (!playing || playing.kind !== "series" || queue?.some((q) => q.id === playing.id)) return;
    if (!xt) {
      // Lista M3U: os episodios da mesma serie estao no proprio catalogo.
      const name = episodeInfo(playing.name).series;
      const eps = channels
        .filter((x) => x.kind === "series" && episodeInfo(x.name).series === name)
        .map((x) => ({ ...x, ...episodeInfo(x.name) }))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
      if (eps.length) setQueue(eps);
      return;
    }
    if (!playing.parent_series) return;
    let alive = true;
    api
      .get<Episode[]>(`/api/player/xtream/series/${encodeURIComponent(playing.parent_series)}?name=${encodeURIComponent(playing.group)}`)
      .then((eps) => alive && setQueue(eps))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, queue, xt]);

  // Lista em que o titulo tocando esta: episodios da serie ou canais da mesma lista/categoria (anterior/proximo e "EPs").
  const playlist = useMemo(() => {
    if (!playing) return null;
    if (playing.kind === "series") return queue?.some((q) => q.id === playing.id) ? queue.map((q) => ({ ...q, group: playing.group })) : null;
    if (!liveLike(playing.kind)) return null;
    const list = visible.some((x) => x.id === playing.id) ? visible : channels.filter((x) => x.kind === playing.kind && x.group === playing.group);
    return list.length > 1 && list.some((x) => x.id === playing.id) ? list : null;
  }, [playing, queue, visible, channels]);
  const neighbor = (step: number) => {
    if (!playing || !playlist) return null;
    const i = playlist.findIndex((q) => q.id === playing.id);
    if (liveLike(playing.kind)) return playlist[(i + step + playlist.length) % playlist.length];
    return playlist[i + step] ?? null;
  };
  const nextEpisode = neighbor(1);
  const prevEpisode = neighbor(-1);

  // Pagina "Tudo": busca em canais, filmes e series ao mesmo tempo.
  useEffect(() => {
    const t = setTimeout(() => setAllTerm(allQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [allQuery]);

  const allKey = page === "all" && catalog ? `${xt ? "xt" : "m3u"}|${allTerm}` : "";
  useEffect(() => {
    if (!allKey) return;
    const kinds: Section[] = ["live", "movie", "series", "radio"];
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
    setAllRes((r) => (r ? { ...r, key: allKey, loading: true } : { key: allKey, loading: true, data: { live: { total: 0, items: [] }, movie: { total: 0, items: [] }, series: { total: 0, items: [] }, radio: { total: 0, items: [] } } }));
    Promise.all(
      kinds.map((k) => {
        if (!catalog?.sections?.[k]?.length) return Promise.resolve({ total: 0, items: [] });
        const skip = (catalog?.sections?.[k] ?? []).filter((g) => isLocked(g.name)).map((g) => g.id).join(",");
        const params = new URLSearchParams({ section: k, limit: String(ALL_LIMIT), offset: "0", q: allTerm, skip });
        return api.get<{ total: number; items: Channel[] }>(`/api/player/xtream/items?${params}`).catch(() => ({ total: 0, items: [] }));
      }),
    ).then(([live, movie, series, radio]) => setAllRes((r) => (r?.key === allKey ? { key: allKey, loading: false, data: { live, movie, series, radio } } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKey]);

  const goSection = (k: Section) => {
    pushNav();
    setPage("section");
    setSection(k);
  };

  // Botao voltar (celular, TV Box e navegador): fecha o player -> sai da serie -> volta ao Inicio -> sai do app.
  const navRef = useRef({ page, series, current, movie, remoteOpen });
  navRef.current = { page, series, current, movie, remoteOpen };
  const goBackInApp = () => {
    const n = navRef.current;
    if (n.remoteOpen) setRemoteOpen(false);
    else if (n.current) setCurrent(null);
    else if (n.movie) setMovie(prevTitles.current.movie.pop() ?? null);
    else if (n.series) setSeries(prevTitles.current.series.pop() ?? null);
    else if (n.page !== "home") setPage("home");
    else return false;
    return true;
  };
  useEffect(() => {
    // Navegador: cada tela aberta deixa um passo no historico (pushNav); o "voltar" desfaz um passo.
    const onPop = () => {
      if (navRef.current.current) return; // o player trata o proprio voltar
      goBackInApp();
    };
    window.addEventListener("popstate", onPop);
    // App Android: o botao/gesto voltar passa por aqui; so sai do app quando ja esta no Inicio.
    let removeBack: (() => void) | undefined;
    let alive = true;
    import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", () => {
          if (!goBackInApp()) App.exitApp();
        }).then((h) => {
          if (alive) removeBack = () => void h.remove();
          else void h.remove();
        }),
      )
      .catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener("popstate", onPop);
      removeBack?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TV: "voltar" no Inicio leva para a escolha de perfil (de la, outro "voltar" sai do app).
  const switchProfileRef = useRef(onSwitchProfile);
  switchProfileRef.current = onSwitchProfile;
  useEffect(() => {
    if (!tv) return;
    const onHome = (e: Event) => {
      e.preventDefault();
      switchProfileRef.current(false);
    };
    window.addEventListener("rtec:back-home", onHome);
    return () => window.removeEventListener("rtec:back-home", onHome);
  }, [tv]);

  // CH+/CH- do controle: proximo/anterior canal da lista ou episodio da serie.
  const zapRef = useRef({ neighbor, play });
  zapRef.current = { neighbor, play };
  useEffect(() => {
    const onChannel = (e: Event) => {
      const n = zapRef.current.neighbor((e as CustomEvent<number>).detail);
      if (n) zapRef.current.play(n);
    };
    window.addEventListener("rtec:channel", onChannel);
    return () => window.removeEventListener("rtec:channel", onChannel);
  }, []);

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

  // Categorias bloqueadas (PIN) de uma secao: nao aparecem nas recomendacoes.
  const lockedIds = (k: "movie" | "series") => (catalog?.sections?.[k] ?? []).filter((g) => isLocked(g.name)).map((g) => g.id).join(",");

  const openMovie = (c: Channel, fromRec = false) =>
    withPin(() => {
      if (!fromRec) prevTitles.current.movie = [];
      else if (movie) prevTitles.current.movie.push(movie);
      pushNav();
      setMovie(c);
    }, c.group);
  // A aba Jogos do dia fica logo depois de Series (ou Filmes / TV ao vivo, se a lista nao tiver series).
  const gamesAfter: Section = counts.series > 0 ? "series" : counts.movie > 0 ? "movie" : "live";
  const goGames = () => {
    if (page === "games") return;
    pushNav();
    setPage("games");
  };
  const openItem = (c: Channel) =>
    c.kind === "series" && (c.series_id || c.id.startsWith("serie:")) ? openSeriesFrom(c) : c.kind === "movie" ? openMovie(c) : play(c, null);

  // Favoritar um episodio = favoritar a serie dele (abre a serie com as temporadas).
  const seriesCard = (key: string, name: string, logo: string): Channel => ({
    id: xt ? `s${key}` : `serie:${name}`,
    series_id: xt ? key : undefined,
    name,
    group: name,
    logo,
    src: "",
    type: "file",
    alt: "",
    alt_type: "",
    kind: "series",
    epg_id: "",
    playlist_id: "own",
  });
  const favItem = (c: Channel): Channel => {
    const isEpisode = c.kind === "series" && !c.series_id && !c.id.startsWith("serie:");
    if (!isEpisode) return c;
    if (xt && !c.parent_series) return c; // historico antigo, sem a serie de origem
    const name = xt ? c.group : episodeInfo(c.name).series;
    const logo = series && series.name === name ? series.logo : c.logo;
    return seriesCard(xt ? c.parent_series! : name, name, logo);
  };
  const isFavorite = (id: string) => favorites.some((f) => f.id === id);
  const isFav = (c: Channel) => isFavorite(favItem(c).id);
  const toggleFavorite = (c: Channel) => {
    const item = favItem(c);
    const was = isFavorite(item.id);
    const next = was ? favorites.filter((f) => f.id !== item.id) : [...favorites, item];
    setFavorites(next);
    saveList("favorites", next);
    // Serie favorita ganha alerta de novos episodios.
    if (item.kind === "series" && (item.series_id || item.id.startsWith("serie:"))) {
      if (was) favoriteRemoved(item.id);
      else favoriteAdded(item, series?.name === item.name ? series.episodes : null);
    }
    if (item !== c) toast.success(isFavorite(item.id) ? "Série removida dos favoritos" : "Série adicionada aos favoritos");
  };

  // Alertas de novos episodios: o servidor confere as series (Xtream); nas listas M3U compara com os EPs do aparelho.
  const epAlerts = useEpAlerts();
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const listReady = xt || channels.length > 0;
  useEffect(() => resetEpAlerts(), []);
  useEffect(() => {
    if (!catalog || !listReady) return;
    const episodesOf = (a: EpAlert) => {
      if (!a.id.startsWith("serie:")) return null;
      return channelsRef.current.filter((x) => x.kind === "series" && episodeInfo(x.name).series === a.name).map((x) => episodeInfo(x.name));
    };
    void loadEpAlerts(episodesOf, true);
    const onVisible = () => document.visibilityState === "visible" && void loadEpAlerts(episodesOf);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => void loadEpAlerts(episodesOf), 30 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [catalog, listReady]);
  const openSeriesCard = series ? seriesCard(xt ? series.key : series.name, series.name, series.logo) : null;
  const seriesAlert = !!openSeriesCard && epAlerts.some((a) => a.id === openSeriesCard.id);
  // Abriu a serie com alerta: os episodios de agora passam a ser os "ja vistos".
  useEffect(() => {
    if (openSeriesCard && series?.episodes?.length && alertOn(openSeriesCard.id)) void markSeen(openSeriesCard, series.episodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series?.episodes, seriesAlert]);
  const newEpisodes = epAlerts.filter((a) => a.new > 0);
  const openAlert = (a: EpAlert) => openSeriesFrom(seriesCard(a.series_id || a.name, a.name, a.logo));

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
    saveList("history", next);
  };

  // Protecao de tela: nunca mostra adulto nem categoria bloqueada, mesmo com o PIN ja digitado.
  const saverHidden = useCallback((g: string) => ADULT.test(g) || settings.locked_groups.includes(g), [settings]);
  const saverResume = useMemo(
    () =>
      shownHistory
        .filter((c) => !liveLike(c.kind) && fraction(c) > 0 && fraction(c) < WATCHED_AT && !saverHidden(c.group) && !ADULT.test(c.name))
        .slice(0, 12)
        .map((c) => saverItem(c, "resume")),
    [shownHistory, saverHidden, current], // current: ao fechar o video, o progresso mudou
  );
  const loadSaverRecs = useCallback(async (): Promise<SaverItem[]> => {
    const ok = (c: Channel) => !saverHidden(c.group) && !ADULT.test(c.name);
    let found: Channel[] = [];
    if (xt) {
      const skipOf = (k: "movie" | "series") => (catalog?.sections?.[k] ?? []).filter((g) => saverHidden(g.name)).map((g) => g.id).join(",");
      // Semelhantes ao que a pessoa esta assistindo; completa com os mais bem avaliados do catalogo.
      const seeds = saverResume.filter((s) => s.id).slice(0, 3);
      const recs = await Promise.all(
        seeds.map((s) => {
          const q = new URLSearchParams({ kind: s.kind, id: s.id!, name: s.name, skip: skipOf(s.kind), ...(s.year ? { year: String(s.year) } : {}) });
          return api.get<Channel[]>(`/api/player/recommend?${q}`).catch(() => [] as Channel[]);
        }),
      );
      found = recs.flatMap((r) => r.slice(0, 8));
      if (found.length < 12) {
        const top = await Promise.all(
          (["movie", "series"] as const).map((k) =>
            api
              .get<{ items: Channel[] }>(`/api/player/xtream/items?${new URLSearchParams({ section: k, limit: "40", offset: "0", sort: "rating", skip: skipOf(k), r: "7" })}`)
              .then((r) => r.items)
              .catch(() => [] as Channel[]),
          ),
        );
        found = found.concat(top.flat());
      }
    } else {
      found = channels.filter((c) => c.kind === "movie" || c.kind === "series");
    }
    const seen = new Set(saverResume.map((s) => fold(s.name)));
    const items: SaverItem[] = [];
    for (const c of found.filter(ok).sort(() => Math.random() - 0.5)) {
      const it = saverItem(c, "rec");
      if (seen.has(fold(it.name))) continue;
      seen.add(fold(it.name));
      items.push(it);
      if (items.length >= 30) break;
    }
    return items;
  }, [xt, catalog, channels, saverHidden, saverResume]);

  const groupLabel =
    group === FAVORITES ? "Favoritos" : group === HISTORY ? "Histórico" : group ? (groups.find((g) => g.key === group)?.name ?? group) : "Todos";
  const menuOptions: MenuOption[] = [
    { key: "", name: "Todos", icon: <LayoutGrid /> },
    { key: FAVORITES, name: "Favoritos", icon: <Heart />, count: favorites.filter((c) => c.kind === section).length },
    { key: HISTORY, name: "Histórico", icon: <History />, count: shownHistory.filter((c) => c.kind === section).length },
    ...groups.filter((g) => !viewer.kids || !isLocked(g.name)).map((g) => ({ key: g.key, name: g.name, locked: isLocked(g.name) })),
  ];

  const castDialog = (
    <CastDialog
      open={castOpen}
      onClose={() => {
        setCastOpen(false);
        setCastFromPlayer(false);
      }}
      onPick={
        castFromPlayer && current
          ? () => {
              // Passa o que esta tocando aqui para o outro aparelho, do mesmo ponto, e fecha o player daqui.
              const v = document.querySelector("video");
              const live = liveLike(current.kind);
              void sendTo(current, live || !v ? 0 : v.currentTime, live || !v || !Number.isFinite(v.duration) ? 0 : v.duration);
              if (window.history.state?.rtecPlayer) window.history.back();
              else setCurrent(null);
            }
          : undefined
      }
    />
  );
  return (
    <div className={cn("flex min-h-[100dvh] flex-col", tv && "pl-24")}>
      {tv ? (
        <TvSidebar
          items={[
            { key: "home", label: "Início", icon: Home, active: page === "home", onClick: () => page !== "home" && (pushNav(), setPage("home")) },
            { key: "all", label: "Buscar", icon: Search, active: page === "all", onClick: () => page !== "all" && (pushNav(), setPage("all")) },
            ...sections
              .filter((s) => counts[s.key] > 0 || s.key === "live")
              .flatMap((s) => [
                { key: s.key, label: s.label, icon: s.icon, active: page === "section" && section === s.key, onClick: () => goSection(s.key) },
                ...(s.key === gamesAfter ? [{ key: "games", label: "Jogos do dia", icon: Trophy, active: page === "games", onClick: goGames }] : []),
              ]),
          ]}
          viewer={viewer}
          onProfile={() => onSwitchProfile(false)}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <Logo />
          <div className="ml-auto flex items-center gap-2">
            <InstallButton compact />
            <button
              onClick={() => onSwitchProfile(false)}
              title="Trocar perfil"
              aria-label={`Perfil ${viewer.name}. Trocar perfil`}
              className="flex items-center gap-2 rounded-lg p-1 pr-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:pr-2"
            >
              <Avatar avatar={viewer.avatar} className="w-8 rounded-md" />
              <span className="hidden max-w-[140px] truncate font-semibold text-foreground sm:block">{viewer.name}</span>
            </button>
            <CastButton onClick={() => setCastOpen(true)} />
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
                onClick={() => {
                  if (key !== page) pushNav();
                  setPage(key);
                }}
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
              ))
              // Jogos do dia: logo depois de Filmes e Series
              .flatMap((el) =>
                el.key === gamesAfter
                  ? [
                      el,
                      <button
                        key="games"
                        onClick={goGames}
                        aria-pressed={page === "games"}
                        className={cn(
                          "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                          page === "games" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Trophy className="h-4 w-4" /> Jogos do dia
                      </button>,
                    ]
                  : [el],
              )}
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
      )}

      <main className={cn("mx-auto w-full flex-1", tv ? "px-10 pb-10 pt-8" : "max-w-[1600px] px-4 pb-8 pt-4 lg:px-6", cast.target && !tv && "pb-24")}>
            {page === "home" ? (
              <HomePage
                newEpisodes={newEpisodes}
                onOpenAlert={openAlert}
                history={shownHistory}
                loading={catalog === null}
                onOpen={openItem}
                onExplore={() => {
                  pushNav();
                  setPage("all");
                }}
                onClear={() => {
                  setHistory([]);
                  saveList("history", []);
                }}
                currentId={current?.id}
                isFavorite={(id) => isFav(history.find((h) => h.id === id) ?? ({ id } as Channel))}
                onFavorite={toggleFavorite}
                epg={epg}
              />
            ) : page === "games" ? (
              <GamesPage onPlay={(c, list) => play(c, list)} isLocked={isLocked} currentId={current?.id} tv={tv} />
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
            ) : tv && liveLike(section) ? (
              <TvLive
                radio={section === "radio"}
                options={menuOptions}
                group={group}
                onGroup={(o) => (o.locked ? withPin(() => setGroup(o.key), o.name) : setGroup(o.key))}
                query={query}
                onQuery={setQuery}
                loading={loading}
                channels={visible.slice(0, cap)}
                more={!loading && total > (pagedAll ? visible.length : limit) ? total - (pagedAll ? visible.length : limit) : 0}
                onMore={() => (pagedAll ? loadPage(pageKey, visible.length) : setLimit((l) => l + PAGE))}
                peek={peek}
                onPeek={setPeek}
                epg={epg}
                currentId={current?.id}
                isFavorite={isFavorite}
                onFavorite={toggleFavorite}
                onPlay={(c) => play(c, null)}
              />
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
          {/* Dentro de uma serie a busca e as categorias saem da frente (o "Voltar" leva de volta a lista). */}
          {!series && (
          <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Buscar"
              placeholder={group ? `Buscar em ${groupLabel}...` : section === "live" ? "Buscar canal..." : section === "radio" ? "Buscar rádio..." : section === "movie" ? "Buscar filme..." : "Buscar série..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2 landscape:flex-row landscape:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
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
            {!series && (
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <SortSelect value={sort} onChange={setSort} vod={!liveLike(section)} />
                </div>
                {!liveLike(section) && (
                  <Button variant={filterCount(filters) ? "secondary" : "outline"} className="h-10 shrink-0" onClick={() => setFiltersOpen(true)} aria-label="Filtros">
                    <SlidersHorizontal /> Filtros
                    {!!filterCount(filters) && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{filterCount(filters)}</span>}
                  </Button>
                )}
              </div>
            )}
          </div>
          </>
          )}

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
                <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="mb-2">
                  <ArrowLeft /> Voltar
                </Button>
                <SeriesHeader
                  series={series}
                  xt={xt}
                  actions={(() => {
                    const card = seriesCard(xt ? series.key : series.name, series.name, series.logo);
                    const fav = isFavorite(card.id);
                    return (
                      <>
                        <Button variant={fav ? "secondary" : "outline"} size="sm" onClick={() => toggleFavorite(card)} aria-pressed={fav}>
                          <Heart className={cn(fav && "fill-destructive text-destructive")} /> {fav ? "Favorita" : "Favoritar série"}
                        </Button>
                        <Button
                          variant={seriesAlert ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={seriesAlert}
                          onClick={() => {
                            const on = !seriesAlert;
                            setEpAlert(card, on, series.episodes).catch(() => toast.error("Não foi possível salvar o alerta"));
                            toast.success(on ? "Você será avisado quando sair episódio novo" : "Alerta de novos episódios desligado");
                          }}
                        >
                          {seriesAlert ? <BellRing className="text-primary" /> : <Bell />} {seriesAlert ? "Alerta ligado" : "Avisar novos episódios"}
                        </Button>
                      </>
                    );
                  })()}
                />
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
                    onPlay={(e) => play({ ...e, group: series.name }, series.episodes!.map((x) => ({ ...x, group: series.name })))}
                  />
                )}
                {xt && (
                  <div className="mt-6">
                    <Recommendations
                      kind="series"
                      id={series.key}
                      name={series.name}
                      skip={lockedIds("series")}
                      onOpen={(c) => {
                        openSeries({ key: c.series_id || c.id, name: c.name, logo: c.logo, sub: "", episodes: null }, true);
                        window.scrollTo({ top: 0 });
                      }}
                    />
                  </div>
                )}
              </div>
            ) : visible.length === 0 ? (
              group === FAVORITES ? (
                <EmptyState icon={<Heart className="h-6 w-6" />} title="Sem favoritos ainda" text="Toque no coração de um canal para salvá-lo aqui." />
              ) : group === HISTORY ? (
                <EmptyState icon={<History className="h-6 w-6" />} title="Histórico vazio" text="O que você assistir aparece aqui, do mais recente para o mais antigo." />
              ) : (
                <div className="space-y-3 text-center">
                  <EmptyState
                    icon={<Search className="h-6 w-6" />}
                    title="Nada encontrado"
                    text={filterCount(filters) ? "Nenhum título combina com os filtros escolhidos." : "Tente outro termo ou outra categoria."}
                  />
                  {!!filterCount(filters) && (
                    <Button variant="outline" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                      <X /> Limpar filtros
                    </Button>
                  )}
                </div>
              )
            ) : liveLike(section) ? (
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
              <PosterGrid items={visible.slice(0, cap).map((c) => ({ ...c, progress: fraction(c), sub: metaLine(c) }))} activeId={current?.id} onSelect={(c) => openItem(c)} />
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

      {movie && (
        <MovieDetails
          key={movie.id}
          movie={movie}
          skip={lockedIds("movie")}
          onOpen={(c) => openMovie(c, true)}
          favorite={isFav(movie)}
          onFavorite={() => toggleFavorite(movie)}
          onPlay={() => play(movie, null)}
          onClose={() => window.history.back()}
        />
      )}

      <Screensaver enabled={!current} resume={saverResume} loadRecs={loadSaverRecs} />

      {current && (
        <PlayerOverlay
          channel={current}
          next={nextEpisode}
          prev={prevEpisode}
          playlist={playlist}
          onPick={(c) => play(c, undefined, false)}
          favorite={isFav(current)}
          onFavorite={() => toggleFavorite(current)}
          onNext={(n) => play(n, undefined, false)}
          onClose={() => setCurrent(null)}
          onCast={
            tv
              ? undefined
              : () => {
                  setCastFromPlayer(true);
                  setCastOpen(true);
                }
          }
          info={nowPlaying ? <EpgNow programme={nowPlaying} next={upNext} /> : undefined}
        >
          {castFromPlayer && castDialog}
        </PlayerOverlay>
      )}

      {filtersOpen && (
        <FiltersDialog
          section={section}
          value={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(f) => {
            setFilters(f);
            setFiltersOpen(false);
          }}
          load={
            xt && !special
              ? () => api.get<Facets>(`/api/player/xtream/facets?${new URLSearchParams({ section, category: group, skip: group ? "" : skipIds })}`)
              : () => Promise.resolve(localFacets(unfiltered))
          }
        />
      )}

      {!tv && !remoteOpen && (
        <CastBar
          onOpen={() => {
            if (!cast.state) return setCastOpen(true);
            pushNav();
            setRemoteOpen(true);
          }}
        />
      )}
      {remoteOpen && cast.state && (
        <CastRemote
          playlist={playlist}
          prev={prevEpisode}
          next={nextEpisode}
          onPick={(c) => play(c)}
          favorite={isFav(cast.state.item)}
          onFavorite={() => toggleFavorite(cast.state!.item)}
          onHere={(item, pos, dur) => {
            // Traz para este aparelho do mesmo ponto: para la e desconecta.
            void castControl("stop").catch(() => {});
            setCastTarget(null);
            if (pos > 0 && dur > 0) saveProgress(item, pos + 5, dur);
            setRemoteOpen(false);
            void startPlay(item, item.kind === "series" ? undefined : null);
          }}
          onClose={closeRemote}
        />
      )}
      {where && (
        <WhereDialog
          title={where.c.name}
          onClose={() => setWhere(null)}
          onHere={() => {
            const w = where;
            setWhere(null);
            void startPlay(w.c, w.list);
          }}
          onDevice={(d) => {
            const w = where;
            setWhere(null);
            setCastTarget(d);
            void sendTo(w.c);
          }}
        />
      )}
      {!castFromPlayer && castDialog}
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
        onManageProfiles={() => onSwitchProfile(true)}
      />
      {/* Alertas dos Jogos do dia: avisa quando o jogo comeca, mesmo fora da aba (e por cima do video). */}
      <GameAlerts onPlay={(c, list) => play(c, list)} isLocked={isLocked} />
      {/* Novos episodios das series com alerta: avisa uma vez por episodio novo. */}
      <EpisodeAlerts items={newEpisodes} onOpen={openAlert} />
    </div>
  );
}

function EpisodeAlerts({ items, onOpen }: { items: EpAlert[]; onOpen: (a: EpAlert) => void }) {
  const [shown, setShown] = useState<EpAlert[] | null>(null);
  useEffect(() => {
    if (shown || !shouldShow(items)) return;
    markShown(items);
    setShown(items);
    const title = items.length === 1 ? `Episódio novo: ${items[0].name}` : `${items.length} séries com episódios novos`;
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      try {
        new Notification(title, { body: items.map((a) => a.name).join(", "), icon: "/icons/icon-192.png" });
      } catch {
        /* celular sem suporte a notificacao fora do service worker */
      }
    }
  }, [items, shown]);
  if (!shown) return null;
  return (
    <Dialog open onClose={() => setShown(null)} title="Novos episódios" description="Saíram episódios novos das séries que você acompanha." icon={<BellRing className="h-6 w-6 text-primary" />}>
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
        {shown.map((a) => (
          <li key={a.id}>
            <button
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted"
              onClick={() => {
                setShown(null);
                onOpen(a);
              }}
            >
              <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                {a.logo ? <img src={a.logo} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Clapperboard className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{a.name}</div>
                <div className="text-xs text-primary">{epLabel(a)}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={() => setShown(null)}>
          Ver depois
        </Button>
      </div>
    </Dialog>
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
  onFocus,
}: {
  channel: Channel;
  label?: string;
  now?: string;
  active: boolean;
  favorite?: boolean;
  onPlay: () => void;
  onFavorite?: () => void;
  progress?: number;
  badge?: ReactNode;
  sub?: string;
  onFocus?: () => void;
}) {
  return (
    <li className={cn("flex items-center rounded-xl transition-colors", active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-accent")}>
      <button onClick={onPlay} onFocus={onFocus} className="channel-row flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left">
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
      {onFavorite && (
        <button onClick={onFavorite} className="rounded-lg p-3 text-muted-foreground transition-colors hover:text-destructive" aria-label="Favorito">
          <Heart className={cn("h-4 w-4", favorite && "fill-destructive text-destructive")} />
        </button>
      )}
    </li>
  );
}

type PosterItem = { id: string; name: string; logo: string; sub?: string; progress?: number };

function PosterGrid<T extends PosterItem>({ items, activeId, onSelect }: { items: T[]; activeId?: string; onSelect: (item: T) => void }) {
  return (
    <div className="poster-grid grid grid-cols-3 gap-3 pb-1 pt-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item)} className="poster-card group text-left">
          <div
            className={cn(
              "poster-frame relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-secondary to-card ring-1 ring-border transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow group-hover:ring-primary/50",
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
            <span className="poster-play absolute inset-0 grid place-items-center bg-background/30 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-background">
                <Play className="h-4 w-4 fill-current" />
              </span>
            </span>
          </div>
          <div className="poster-title mt-2 line-clamp-2 text-xs font-semibold">{item.name}</div>
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
        c.kind === "radio" ? <Radio className="h-4 w-4 text-muted-foreground" /> : <Tv className="h-4 w-4 text-muted-foreground" />
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
          <div data-tv-scope="45" data-tv-close="escape" className="fixed inset-x-0 bottom-0 z-50 animate-rise-in overflow-hidden rounded-t-3xl border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl sm:absolute sm:bottom-auto sm:top-full sm:z-40 sm:mt-2 sm:animate-pop-in sm:rounded-2xl sm:pb-0">
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

/** Episodios por temporada: marca o que ja foi assistido, o que esta tocando e quanto de cada um (barra). */
function SeriesHeader({ series, xt, actions }: { series: OpenSeries; xt: boolean; actions: ReactNode }) {
  const info = useTitleInfo("series", xt ? series.key : undefined, series.name);
  return (
    <div className="mb-4">
      <TitleHeader kind="series" info={info} name={series.name} logo={series.logo} actions={actions} />
    </div>
  );
}

function EpisodeList({
  episodes,
  currentId,
  xt,
  onPlay,
}: {
  episodes: Episode[];
  seriesName: string;
  currentId?: string;
  xt: boolean;
  onPlay: (e: Episode) => void;
}) {
  // Ultimo episodio mexido = onde o cliente parou ("Continuar").
  const lastId = episodes.reduce<{ id: string; t: number } | null>((best, e) => {
    const pr = getProgress(e);
    return pr && (!best || pr.t > best.t) ? { id: e.id, t: pr.t } : best;
  }, null)?.id;
  const resume = episodes.find((e) => e.id === lastId);
  const nextUp = resume && fraction(resume) >= WATCHED_AT ? episodes[episodes.indexOf(resume) + 1] : resume;

  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b), [episodes]);
  const playingSeason = episodes.find((e) => e.id === currentId)?.season;
  const [season, setSeason] = useState<number>(() => playingSeason ?? nextUp?.season ?? seasons[0] ?? 1);
  useEffect(() => {
    if (!seasons.includes(season)) setSeason(seasons[0] ?? 1);
  }, [seasons, season]);
  const list = episodes.filter((e) => e.season === season);

  return (
    <div className="space-y-4">
      {nextUp && (
        <Button
          variant="gradient"
          onClick={() => {
            setSeason(nextUp.season);
            onPlay(nextUp);
          }}
          className="w-full sm:w-auto"
        >
          <Play className="fill-current" /> {fraction(nextUp) > 0 ? "Continuar" : "Assistir"} T{nextUp.season} · E{nextUp.episode}
        </Button>
      )}
      {seasons.length > 1 && (
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Temporadas">
          {seasons.map((n) => {
            const eps = episodes.filter((e) => e.season === n);
            const done = eps.filter((e) => fraction(e) >= WATCHED_AT).length;
            return (
              <button
                key={n}
                role="tab"
                aria-selected={season === n}
                onClick={() => setSeason(n)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                  season === n ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                Temporada {n}
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", season === n ? "bg-background/15" : "bg-muted")}>
                  {done ? `${done}/${eps.length}` : eps.length}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="text-sm font-semibold text-muted-foreground">
        Temporada {season} · {list.length} episódio(s)
      </div>
      <ul className="grid gap-1 md:grid-cols-2">
        {list.map((e) => {
          const f = fraction(e);
          const watched = f >= WATCHED_AT;
          const playing = currentId === e.id;
          return (
            <ChannelRow
              key={e.id}
              channel={e}
              label={e.episode ? `Episódio ${e.episode}${xt && e.name ? ` · ${e.name}` : ""}` : e.name}
              active={playing}
              onPlay={() => onPlay(e)}
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

const KIND_LABEL: Record<Section, string> = { live: "TV ao vivo", radio: "Rádio", movie: "Filme", series: "Série" };

/** Pagina inicial: historico do que o cliente assistiu por ultimo. */
function HomePage({
  newEpisodes,
  onOpenAlert,
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
  newEpisodes: EpAlert[];
  onOpenAlert: (a: EpAlert) => void;
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
  const resume = history.filter((c) => !liveLike(c.kind) && fraction(c) > 0 && fraction(c) < WATCHED_AT);
  if (!loading && !history.length && !newEpisodes.length) {
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
      {!!newEpisodes.length && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold tracking-tight">
            <BellRing className="h-5 w-5 text-primary" /> Novos episódios
          </h2>
          <PosterGrid items={newEpisodes.map((a) => ({ ...a, sub: epLabel(a) }))} onSelect={onOpenAlert} />
        </section>
      )}
      {!!resume.length && (
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Continuar assistindo</h2>
          <PosterGrid items={resume.slice(0, 16).map((c) => ({ ...c, progress: fraction(c), sub: c.kind === "series" ? c.group : undefined }))} activeId={currentId} onSelect={onOpen} />
        </section>
      )}
      {!!history.length && (
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
              progress={liveLike(c.kind) ? 0 : fraction(c)}
              now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
              badge={<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">{KIND_LABEL[c.kind]}</span>}
            />
          ))}
        </ul>
      </section>
      )}
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
    { key: "radio", label: "Rádios" },
  ];
  const nothing = result && !result.loading && kinds.every((k) => !result.data[k.key].total);
  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-12 pl-10 text-base" aria-label="Buscar em tudo" placeholder="Buscar canais, filmes e séries..." value={query} onChange={(e) => onQuery(e.target.value)} autoFocus={!tvScreenOn()} />
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
              {liveLike(key) ? (
                <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
                  {r.items.slice(0, 9).map((c) => (
                    <ChannelRow key={c.id} channel={c} active={currentId === c.id} favorite={isFavorite(c.id)} onPlay={() => onOpen(c)} onFavorite={() => onFavorite(c)} />
                  ))}
                </ul>
              ) : (
                <PosterGrid items={r.items.map((c) => ({ ...c, progress: fraction(c), sub: metaLine(c) }))} activeId={currentId} onSelect={onOpen} />
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

/** Seletor de ordenacao (lista nativa do sistema: funciona bem no celular e no controle da TV Box). */
const RATINGS = [0, 5, 6, 7, 8];

/** Popup de filtros: generos (varios), periodo de lancamento e nota minima. */
function FiltersDialog({ section, value, onApply, onClose, load }: { section: Section; value: Filters; onApply: (f: Filters) => void; onClose: () => void; load: () => Promise<Facets> }) {
  const [draft, setDraft] = useState<Filters>(value);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    load()
      .then(setFacets)
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleGenre = (g: string) =>
    setDraft((d) => (d.g.some((x) => fold(x) === fold(g)) ? { ...d, g: d.g.filter((x) => fold(x) !== fold(g)) } : { ...d, g: [...d.g, g] }));
  const thisYear = new Date().getFullYear();
  const minYear = facets?.years.min || 1950;
  const maxYear = Math.max(facets?.years.max || thisYear, thisYear);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))].slice(0, 6);
  const chip = (on: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
      on ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );
  const yearSelect = (label: string, v: number, set: (n: number) => void) => (
    <label className="flex flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
      <select value={v || ""} onChange={(e) => set(Number(e.target.value) || 0)} className="h-10 rounded-lg border bg-card px-2 text-sm font-semibold normal-case tracking-normal text-foreground">
        <option value="">Qualquer</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog open onClose={onClose} title={`Filtrar ${section === "series" ? "séries" : "filmes"}`} description="Combine com a categoria escolhida." icon={<SlidersHorizontal className="h-5 w-5" />}>
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Gênero</h3>
          {!facets && !failed ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-full" />
              ))}
            </div>
          ) : !facets?.genres.length ? (
            <p className="text-sm text-muted-foreground">Esta lista não informa os gêneros.</p>
          ) : (
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {facets.genres.map((g) => (
                <button key={g.name} type="button" className={chip(draft.g.some((x) => fold(x) === fold(g.name)))} onClick={() => toggleGenre(g.name)}>
                  {g.name} <span className="text-xs opacity-60">{g.count}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Ano de lançamento</h3>
          <div className="flex flex-wrap gap-2">
            {decades.map((d) => (
              <button key={d} type="button" className={chip(draft.y1 === d && draft.y2 === d + 9)} onClick={() => setDraft((x) => (x.y1 === d && x.y2 === d + 9 ? { ...x, y1: 0, y2: 0 } : { ...x, y1: d, y2: d + 9 }))}>
                Anos {String(d).slice(2)}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            {yearSelect("De", draft.y1, (n) => setDraft((x) => ({ ...x, y1: n })))}
            {yearSelect("Até", draft.y2, (n) => setDraft((x) => ({ ...x, y2: n })))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Nota mínima</h3>
          {facets && !facets.rated ? (
            <p className="text-sm text-muted-foreground">Esta lista não informa as notas.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {RATINGS.map((r) => (
                <button key={r} type="button" className={chip(draft.r === r)} onClick={() => setDraft((x) => ({ ...x, r }))}>
                  {r ? `★ ${r}+` : "Qualquer"}
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setDraft(NO_FILTERS)} disabled={!filterCount(draft)}>
            Limpar
          </Button>
          <Button variant="gradient" className="flex-1" onClick={() => onApply(draft)}>
            Aplicar{filterCount(draft) ? ` (${filterCount(draft)})` : ""}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SortSelect({ value, onChange, vod }: { value: string; onChange: (v: string) => void; vod: boolean }) {
  const options = SORT_OPTIONS.filter((o) => vod || !o.vod);
  return (
    <label className="relative flex h-10 shrink-0 items-center gap-2 rounded-lg border bg-card/60 px-3 text-sm landscape:w-64">
      <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ordenar</span>
      <select
        aria-label="Ordenar"
        value={options.some((o) => o.key === value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-6 font-semibold outline-none"
      >
        {options.map((o) => (
          <option key={o.key || "padrao"} value={o.key} className="bg-card text-foreground">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
    </label>
  );
}

type TvMenuItem = { key: string; label: string; icon: typeof Tv; active: boolean; onClick: () => void };

/** TV: menu lateral fino que abre ao receber o foco do controle (padrao Netflix/Duplecast). */
function TvSidebar({ items, viewer, onProfile, onSettings }: { items: TvMenuItem[]; viewer: Viewer; onProfile: () => void; onSettings: () => void }) {
  const itemClass = (active: boolean) =>
    cn(
      "tv-plain-focus flex h-12 w-full items-center gap-4 rounded-xl px-3 text-left font-semibold transition-colors focus:bg-foreground focus:text-background",
      active ? "text-foreground" : "text-muted-foreground",
    );
  const label = "whitespace-nowrap opacity-0 transition-opacity group-focus-within/side:opacity-100";
  return (
    <aside data-tv-group className="group/side fixed inset-y-0 left-0 z-30 flex w-24 flex-col gap-1 overflow-hidden bg-gradient-to-r from-background via-background to-background/0 px-4 py-8 transition-[width] duration-200 focus-within:w-80 focus-within:to-background/90">
      <div className="mb-6 flex h-12 items-center px-1.5">
        <Logo className="[&>div:last-child]:opacity-0 [&>div:last-child]:transition-opacity group-focus-within/side:[&>div:last-child]:opacity-100" />
      </div>
      {items.map(({ key, label: text, icon: Icon, active, onClick }) => (
        <button key={key} onClick={onClick} aria-current={active ? "page" : undefined} className={itemClass(active)}>
          <span className="relative shrink-0">
            <Icon className="h-6 w-6" />
            {active && <span className="absolute -bottom-2 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-brand" />}
          </span>
          <span className={label}>{text}</span>
        </button>
      ))}
      <div className="mt-auto space-y-1">
        <button onClick={onProfile} className={itemClass(false)} aria-label={`Perfil ${viewer.name}. Trocar perfil`}>
          <Avatar avatar={viewer.avatar} className="w-7 shrink-0 rounded-md" />
          <span className={label}>{viewer.name}</span>
        </button>
        {/* Pega a versao nova do site sem fechar o app da TV (tambem no botao vermelho do controle). */}
        <button onClick={() => location.reload()} className={itemClass(false)} aria-label="Atualizar">
          <RotateCw className="h-6 w-6 shrink-0" />
          <span className={label}>Atualizar</span>
        </button>
        <button onClick={onSettings} className={itemClass(false)} aria-label="Configurações">
          <Settings className="h-6 w-6 shrink-0" />
          <span className={label}>Configurações</span>
        </button>
      </div>
    </aside>
  );
}

/** TV ao vivo na TV: categorias | canais | o que esta passando no canal selecionado (padrao Duplecast). */
function TvLive({
  radio = false,
  options,
  group,
  onGroup,
  query,
  onQuery,
  loading,
  channels,
  more,
  onMore,
  peek,
  onPeek,
  epg,
  currentId,
  isFavorite,
  onFavorite,
  onPlay,
}: {
  radio?: boolean;
  options: MenuOption[];
  group: string;
  onGroup: (o: MenuOption) => void;
  query: string;
  onQuery: (q: string) => void;
  loading: boolean;
  channels: Channel[];
  more: number;
  onMore: () => void;
  peek: Channel | null;
  onPeek: (c: Channel) => void;
  epg: Record<string, Programme[]>;
  currentId?: string;
  isFavorite: (id: string) => boolean;
  onFavorite: (c: Channel) => void;
  onPlay: (c: Channel) => void;
}) {
  const shown = peek && channels.some((c) => c.id === peek.id) ? peek : channels[0];
  const progs = shown?.epg_id ? (epg[shown.epg_id] ?? []) : [];
  const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const now = progs[0];
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - +new Date(now.start)) / (+new Date(now.stop) - +new Date(now.start))) * 100)) : 0;
  return (
    <div className="grid grid-cols-[15rem_minmax(0,1fr)_22rem] gap-6">
      <nav aria-label="Categorias" className="sticky top-8 max-h-[calc(100dvh-4rem)] space-y-1 overflow-y-auto pr-1">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onGroup(o)}
            aria-pressed={group === o.key}
            className={cn(
              "tv-plain-focus flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors focus:bg-foreground focus:text-background",
              group === o.key ? "bg-primary/15 text-foreground ring-1 ring-primary/50" : "text-muted-foreground",
            )}
          >
            {o.icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{o.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.locked ? <Lock className="h-3.5 w-3.5 shrink-0" /> : !!o.count && <span className="text-xs tabular-nums opacity-70">{o.count}</span>}
          </button>
        ))}
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" aria-label={radio ? "Buscar rádio" : "Buscar canal"} placeholder={radio ? "Buscar rádio..." : "Buscar canal..."} value={query} onChange={(e) => onQuery(e.target.value)} />
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : !channels.length ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title="Nenhum canal aqui" text="Escolha outra categoria ou mude a busca." />
        ) : (
          <ul className="space-y-1">
            {channels.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                active={currentId === c.id}
                favorite={isFavorite(c.id)}
                now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
                onPlay={() => onPlay(c)}
                onFocus={() => onPeek(c)}
                onFavorite={() => onFavorite(c)}
              />
            ))}
          </ul>
        )}
        {more > 0 && (
          <Button variant="outline" className="w-full" onClick={onMore}>
            Mostrar mais ({more})
          </Button>
        )}
      </div>

      <aside className="sticky top-8 h-fit space-y-4 rounded-2xl border bg-card/80 p-5">
        {shown ? (
          <>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-glow ring-1 ring-border">
              {shown.logo ? <img src={shown.logo} alt="" className="max-h-[70%] max-w-[70%] object-contain" onError={(e) => (e.currentTarget.style.display = "none")} /> : radio ? <Radio className="h-10 w-10 text-muted-foreground" /> : <Tv className="h-10 w-10 text-muted-foreground" />}
            </div>
            <div>
              <div className="text-lg font-bold leading-tight">{shown.name}</div>
              <div className="text-sm text-muted-foreground">{shown.group}</div>
            </div>
            {now ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-primary">Agora</div>
                  <div className="font-semibold">{now.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {time(now.start)} - {time(now.stop)}
                  </div>
                  <ProgressBar value={pct / 100} className="mt-2" />
                  {now.desc && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{now.desc}</p>}
                </div>
                {progs.slice(1, 3).map((p) => (
                  <div key={p.start} className="flex gap-3 text-sm">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{time(p.start)}</span>
                    <span className="truncate">{p.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{radio ? "Rádio ao vivo." : "Sem guia de programação para este canal."}</p>
            )}
            <p className="text-xs text-muted-foreground">{radio ? "OK para ouvir" : "OK para assistir"} · Voltar para sair</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Escolha um canal.</p>
        )}
      </aside>
    </div>
  );
}
