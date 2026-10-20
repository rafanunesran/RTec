import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Clapperboard, Download, Film, Heart, KeyRound, Loader2, Lock, Play, Radio, Search, Settings, Share, SquarePlus, Tv } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Catalog, type Channel, type ChannelsResponse, type ClientProfile, type PlayerSettings, type Programme } from "@/lib/api";
import { APK_URL, useApkAvailable, useInstall } from "@/lib/pwa";
import { cn, formatDate } from "@/lib/utils";
import { Button, Dialog, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import Logo from "@/components/Logo";
import VideoPlayer from "@/components/VideoPlayer";
import PinDialog from "@/components/player/PinDialog";
import SettingsDialog from "@/components/player/SettingsDialog";

const FAVORITES = "__favoritos__";
const PAGE = 200;
const ADULT = /(adult|xxx|\+18|18\+|adulto|er[oó]tic|hot\b|sexy|porn)/i;

type Section = Channel["kind"];

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
type Episode = Channel & { season: number; episode: number };
type OpenSeries = { name: string; episodes: Episode[] | null };

function Watch({ profile, onLogout }: { profile: ClientProfile; onLogout: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [data, setData] = useState<ChannelsResponse | null>(null); // listas M3U comuns
  const [xtItems, setXtItems] = useState<Record<string, Channel[] | "loading" | { error: string }>>({}); // Xtream: por secao/categoria
  const [settings, setSettings] = useState<PlayerSettings>({ custom_pin: false, locked_groups: [] });
  const [section, setSection] = useState<Section>("live");
  const [playlistId, setPlaylistId] = useState("");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [series, setSeries] = useState<OpenSeries | null>(null);
  const [favorites, setFavorites] = useState<Channel[]>(() => load("rtec:favs", []));
  const [unlocked, setUnlocked] = useState(false);
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [epg, setEpg] = useState<Record<string, Programme[]>>({});

  const xt = catalog?.mode === "xtream";
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(108);

  // No celular o player fica fixo logo abaixo do cabecalho (altura varia com o seletor de listas).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        if (cat.mode === "xtream") {
          const first = sections.find((s) => (cat.sections?.[s.key].length ?? 0) > 0);
          if (first) setSection(first.key);
          return;
        }
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
    const last = load<Channel | null>("rtec:current", null);
    if (last?.src && last.kind === "live") setCurrent(last);
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

  // No Xtream, filmes e series sempre abrem numa categoria (o catalogo inteiro e grande demais).
  const needsCategory = xt && section !== "live";
  useEffect(() => {
    setSeries(null);
    setGroup(needsCategory ? (groups.find((g) => !isLocked(g.name))?.key ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, playlistId, xt, needsCategory, groups.length]);

  // Carrega a categoria do Xtream quando necessario (ao vivo: todos os canais de uma vez).
  const xtKey = xt && group !== FAVORITES ? `${section}:${section === "live" ? "" : group}` : "";
  useEffect(() => {
    if (!xtKey || xtItems[xtKey] || (needsCategory && !group)) return;
    setXtItems((m) => ({ ...m, [xtKey]: "loading" }));
    const [sec, cat] = xtKey.split(":");
    api
      .get<Channel[]>(`/api/player/xtream/items?section=${sec}&category=${encodeURIComponent(cat)}`)
      .then((list) => setXtItems((m) => ({ ...m, [xtKey]: list })))
      .catch((err) => {
        if (!handleAuthError(err)) setXtItems((m) => ({ ...m, [xtKey]: { error: (err as Error).message } }));
      });
  }, [xtKey, xtItems, needsCategory, group, handleAuthError]);

  const xtState = xtKey ? xtItems[xtKey] : undefined;
  const loading = catalog === null || (!xt && data === null) || xtState === "loading";
  const loadError = xtState && typeof xtState === "object" && "error" in xtState ? xtState.error : "";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: Channel[];
    if (group === FAVORITES) list = favorites.filter((c) => c.kind === section);
    else if (xt) {
      list = Array.isArray(xtState) ? xtState : [];
      if (section === "live") list = list.filter((c) => (group ? c.group === groups.find((g) => g.key === group)?.name : !isLocked(c.group)));
    } else {
      list = channels.filter(
        (c) => c.kind === section && (!playlistId || c.playlist_id === playlistId) && (group ? c.group === group : !isLocked(c.group)),
      );
    }
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [group, favorites, section, xt, xtState, groups, isLocked, channels, playlistId, query]);

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

  const play = (c: Channel) =>
    withPin(() => {
      setCurrent(c);
      save("rtec:current", c);
      if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
    }, c.group);

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
  const total = section === "series" && !series ? seriesList.length : visible.length;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header ref={headerRef} className="glass sticky top-0 z-30 border-b">
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
            {sections
              .filter((s) => counts[s.key] > 0 || s.key === "live")
              .map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  aria-pressed={section === key}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                    section === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                  {!xt && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", section === key ? "bg-background/15" : "bg-muted")}>{counts[key]}</span>}
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

      <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:p-6">
        <section className="sticky z-20 self-start bg-background lg:static" style={{ top: headerHeight }}>
          <VideoPlayer channel={current} />
          <div className="space-y-3 px-4 py-3 lg:px-0 lg:pt-5">
            <div className="flex items-center gap-3">
              {current && <ChannelLogo channel={current} />}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-bold tracking-tight lg:text-xl">{current?.name ?? "Nada em reprodução"}</h1>
                <p className="truncate text-xs text-muted-foreground">
                  {current?.group || (profile.expires_at ? `Acesso válido até ${formatDate(profile.expires_at)}` : "Escolha um canal, filme ou série")}
                </p>
              </div>
              {current && (
                <Button variant="ghost" size="icon" onClick={() => toggleFavorite(current)} title="Favorito" aria-label="Favorito">
                  <Heart className={cn(isFavorite(current.id) && "fill-destructive text-destructive")} />
                </Button>
              )}
            </div>
            {nowPlaying && <EpgNow programme={nowPlaying} next={upNext} />}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3 px-4 pb-6 lg:sticky lg:top-[124px] lg:h-[calc(100dvh-148px)] lg:px-0 lg:pb-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Buscar"
              placeholder={section === "live" ? "Buscar canal..." : needsCategory ? "Buscar nesta categoria..." : section === "movie" ? "Buscar filme..." : "Buscar série..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
            {!needsCategory && (
              <Chip active={!group} onClick={() => setGroup("")}>
                Todos
              </Chip>
            )}
            <Chip active={group === FAVORITES} onClick={() => setGroup(FAVORITES)}>
              <Heart className="h-3 w-3" /> Favoritos
            </Chip>
            {groups.map((g) => (
              <Chip key={g.key} active={group === g.key} onClick={() => withPin(() => setGroup(g.key), g.name)}>
                {isLocked(g.name) && <Lock className="h-3 w-3 text-warning" />} {g.name}
              </Chip>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto lg:pr-1">
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
                  <ul className="space-y-1">
                    {series.episodes.map((e) => (
                      <ChannelRow
                        key={e.id}
                        channel={e}
                        label={e.episode ? `T${e.season} · Episódio ${e.episode}${xt && e.name ? ` · ${e.name}` : ""}` : e.name}
                        active={current?.id === e.id}
                        favorite={isFavorite(e.id)}
                        onPlay={() => play({ ...e, group: series.name })}
                        onFavorite={() => toggleFavorite({ ...e, group: series.name })}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : visible.length === 0 ? (
              group === FAVORITES ? (
                <EmptyState icon={<Heart className="h-6 w-6" />} title="Sem favoritos ainda" text="Toque no coração de um canal para salvá-lo aqui." />
              ) : (
                <EmptyState icon={<Search className="h-6 w-6" />} title="Nada encontrado" text="Tente outro termo ou outra categoria." />
              )
            ) : section === "live" ? (
              <ul className="space-y-1">
                {visible.slice(0, limit).map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    active={current?.id === c.id}
                    favorite={isFavorite(c.id)}
                    now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
                    onPlay={() => play(c)}
                    onFavorite={() => toggleFavorite(c)}
                  />
                ))}
              </ul>
            ) : section === "movie" || group === FAVORITES ? (
              <PosterGrid items={visible.slice(0, limit)} activeId={current?.id} onSelect={play} />
            ) : (
              <PosterGrid items={seriesList.slice(0, limit).map((s) => ({ ...s, id: s.key }))} onSelect={openSeries} />
            )}
            {!series && total > limit && (
              <div className="py-3">
                <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  Mostrar mais ({total - limit})
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>

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
}: {
  channel: Channel;
  label?: string;
  now?: string;
  active: boolean;
  favorite: boolean;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  return (
    <li className={cn("flex items-center rounded-xl transition-colors", active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-accent")}>
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left">
        <ChannelLogo channel={c} />
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-semibold", active && "text-primary")}>{label ?? c.name}</div>
          <div className="truncate text-xs text-muted-foreground">{now ? `Agora: ${now}` : c.group}</div>
        </div>
        {active && <Play className="ml-auto h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}
      </button>
      <button onClick={onFavorite} className="rounded-lg p-3 text-muted-foreground transition-colors hover:text-destructive" aria-label="Favorito">
        <Heart className={cn("h-4 w-4", favorite && "fill-destructive text-destructive")} />
      </button>
    </li>
  );
}

type PosterItem = { id: string; name: string; logo: string; sub?: string };

function PosterGrid<T extends PosterItem>({ items, activeId, onSelect }: { items: T[]; activeId?: string; onSelect: (item: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3 pb-1 pt-1 sm:grid-cols-4 lg:grid-cols-3">
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        active ? "border-primary/50 bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
