import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Clapperboard, Download, Film, Heart, Loader2, Lock, Radio, Search, Settings, Share, SquarePlus, Tv } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Channel, type ChannelsResponse, type ClientProfile, type PlayerSettings, type Programme } from "@/lib/api";
import { useInstall } from "@/lib/pwa";
import { cn, formatDate } from "@/lib/utils";
import { Button, Card, Dialog, Field, Input, Select } from "@/components/ui";
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
  { key: "series", label: "Series", icon: Clapperboard },
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
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-pink-600/20 blur-3xl" />
      <Card className="relative w-full max-w-md p-8">
        <div className="mb-6 flex justify-center">
          <Logo subtitle="TV ao vivo, filmes e series" />
        </div>
        <p className="mb-6 text-center text-sm text-muted-foreground">Entre com o usuario e a senha que voce recebeu</p>
        <form onSubmit={submit} className="space-y-4">
            <Field label="Usuario">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
            </Field>
            <Field label="Senha">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Button variant="gradient" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Entrar
            </Button>
          </form>
        <div className="mt-6 flex justify-center">
          <InstallButton />
        </div>
      </Card>
    </div>
  );
}

function InstallButton({ compact }: { compact?: boolean }) {
  const { canPrompt, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
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
              Escolha <SquarePlus className="inline h-4 w-4" /> <b>Adicionar a Tela de Inicio</b>.
            </>,
            <>
              Toque em <b>Adicionar</b>. O app aparece na tela inicial.
            </>,
          ].map((step, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}

function Watch({ profile, onLogout }: { profile: ClientProfile; onLogout: () => void }) {
  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [settings, setSettings] = useState<PlayerSettings>({ custom_pin: false, locked_groups: [] });
  const [section, setSection] = useState<Section>("live");
  const [playlistId, setPlaylistId] = useState("");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [series, setSeries] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => load("rtec:favorites", []));
  const [unlocked, setUnlocked] = useState(false);
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [epg, setEpg] = useState<Record<string, Programme[]>>({});

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

  useEffect(() => {
    api
      .get<ChannelsResponse>("/api/player/channels")
      .then((res) => {
        setData(res);
        const last = load<string>("rtec:last", "");
        const found = res.channels.find((c) => c.id === last);
        if (found && found.kind === "live") setCurrent(found);
        if (!res.channels.some((c) => c.kind === "live")) {
          const first = sections.find((s) => res.channels.some((c) => c.kind === s.key));
          if (first) setSection(first.key);
        }
      })
      .catch((err) => {
        if (!handleAuthError(err)) toast.error("Nao foi possivel carregar os canais");
        setData({ playlists: [], channels: [] });
      });
    api.get<PlayerSettings>("/api/player/settings").then(setSettings).catch(() => {});
  }, [handleAuthError]);

  const channels = data?.channels ?? [];
  const isLocked = useCallback((g: string) => !unlocked && (ADULT.test(g) || settings.locked_groups.includes(g)), [unlocked, settings]);

  const inScope = useMemo(
    () => channels.filter((c) => c.kind === section && (!playlistId || c.playlist_id === playlistId)),
    [channels, section, playlistId],
  );
  const groups = useMemo(() => [...new Set(inScope.map((c) => c.group))], [inScope]);
  const allGroups = useMemo(() => [...new Set(channels.map((c) => c.group))], [channels]);
  const counts = useMemo(() => {
    const out: Record<Section, number> = { live: 0, movie: 0, series: 0 };
    for (const c of channels) if (!playlistId || c.playlist_id === playlistId) out[c.kind]++;
    return out;
  }, [channels, playlistId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inScope.filter((c) => {
      if (group === FAVORITES ? !favorites.includes(c.id) : group ? c.group !== group : isLocked(c.group)) return false;
      return !q || c.name.toLowerCase().includes(q);
    });
  }, [inScope, group, query, favorites, isLocked]);

  // Series: agrupa episodios pelo nome da serie.
  const seriesList = useMemo(() => {
    if (section !== "series") return [];
    const map = new Map<string, { name: string; logo: string; episodes: (Channel & { season: number; episode: number })[] }>();
    for (const c of visible) {
      const info = episodeInfo(c.name);
      if (!map.has(info.series)) map.set(info.series, { name: info.series, logo: c.logo, episodes: [] });
      map.get(info.series)!.episodes.push({ ...c, season: info.season, episode: info.episode });
    }
    for (const s of map.values()) s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return [...map.values()];
  }, [section, visible]);

  useEffect(() => {
    setLimit(PAGE);
    setSeries(null);
  }, [group, query, section, playlistId]);
  useEffect(() => setGroup(""), [section, playlistId]);

  // EPG dos canais ao vivo visiveis + o atual.
  const epgIds = useMemo(() => {
    if (section !== "live") return [];
    const ids = new Set(visible.slice(0, limit).map((c) => c.epg_id).filter(Boolean));
    if (current?.epg_id) ids.add(current.epg_id);
    return [...ids].filter((id) => !(id in epg)).slice(0, 300);
  }, [section, visible, limit, current, epg]);

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
      save("rtec:last", c.id);
      if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
    }, c.group);

  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    save("rtec:favorites", next);
  };

  const logout = async () => {
    await api.post("/api/player/logout").catch(() => {});
    onLogout();
  };

  const nowPlaying = current?.epg_id ? epg[current.epg_id]?.[0] : undefined;
  const upNext = current?.epg_id ? epg[current.epg_id]?.slice(1, 3) : undefined;
  const openSeries = seriesList.find((s) => s.name === series);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Logo subtitle={profile.name || profile.username} />
        <div className="ml-auto flex items-center gap-1">
          <InstallButton compact />
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Configuracoes">
            <Settings />
          </Button>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b px-4 lg:px-6 [&::-webkit-scrollbar]:hidden">
        {sections
          .filter((s) => counts[s.key] > 0 || s.key === "live")
          .map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                section === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
              <span className="text-xs text-muted-foreground">{counts[key]}</span>
            </button>
          ))}
        {(data?.playlists.length ?? 0) > 1 && (
          <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className="my-2 ml-auto h-8 w-auto shrink-0 text-xs">
            <option value="">Todas as listas</option>
            {data!.playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </nav>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 lg:grid-cols-[1fr_400px] lg:gap-6 lg:p-6">
        <section className="sticky top-[65px] z-20 self-start bg-background lg:static">
          <VideoPlayer channel={current} />
          <div className="flex items-start justify-between gap-3 px-4 py-3 lg:px-0">
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold">{current?.name ?? "Nada em reproducao"}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {current?.group ?? (profile.expires_at ? `Acesso valido ate ${formatDate(profile.expires_at)}` : `${channels.length} itens disponiveis`)}
              </p>
              {nowPlaying && <EpgNow programme={nowPlaying} next={upNext} />}
            </div>
            {current && (
              <Button variant="ghost" size="icon" onClick={() => toggleFavorite(current.id)} title="Favorito">
                <Heart className={cn(favorites.includes(current.id) && "fill-pink-500 text-pink-500")} />
              </Button>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3 px-4 pb-6 lg:max-h-[calc(100dvh-170px)] lg:px-0 lg:pb-0">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={section === "live" ? "Buscar canal" : section === "movie" ? "Buscar filme" : "Buscar serie"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
            <Chip active={!group} onClick={() => setGroup("")}>
              Todos
            </Chip>
            <Chip active={group === FAVORITES} onClick={() => setGroup(FAVORITES)}>
              <Heart className="h-3 w-3" /> Favoritos
            </Chip>
            {groups.map((g) => (
              <Chip key={g} active={group === g} onClick={() => withPin(() => setGroup(g), g)}>
                {isLocked(g) && <Lock className="h-3 w-3" />} {g}
              </Chip>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card/50">
            {data === null ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {group === FAVORITES ? "Toque no coracao para adicionar aos favoritos." : "Nada encontrado aqui."}
              </div>
            ) : section === "live" ? (
              <ul className="divide-y">
                {visible.slice(0, limit).map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    active={current?.id === c.id}
                    favorite={favorites.includes(c.id)}
                    now={c.epg_id ? epg[c.epg_id]?.[0]?.title : undefined}
                    onPlay={() => play(c)}
                    onFavorite={() => toggleFavorite(c.id)}
                  />
                ))}
              </ul>
            ) : section === "movie" ? (
              <PosterGrid items={visible.slice(0, limit)} activeId={current?.id} onSelect={play} />
            ) : openSeries ? (
              <div>
                <button onClick={() => setSeries(null)} className="flex w-full items-center gap-2 border-b px-3 py-3 text-sm font-medium hover:bg-muted/40">
                  <ArrowLeft className="h-4 w-4" /> {openSeries.name}
                </button>
                <ul className="divide-y">
                  {openSeries.episodes.map((e) => (
                    <ChannelRow
                      key={e.id}
                      channel={e}
                      label={e.episode ? `T${e.season} · Episodio ${e.episode}` : e.name}
                      active={current?.id === e.id}
                      favorite={favorites.includes(e.id)}
                      onPlay={() => play(e)}
                      onFavorite={() => toggleFavorite(e.id)}
                    />
                  ))}
                </ul>
              </div>
            ) : (
              <PosterGrid
                items={seriesList.slice(0, limit).map((s) => ({ id: s.name, name: s.name, logo: s.logo, sub: `${s.episodes.length} episodio(s)` }))}
                onSelect={(s) => setSeries(s.id)}
              />
            )}
            {!openSeries && (section === "series" ? seriesList.length : visible.length) > limit && (
              <div className="p-3">
                <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  Mostrar mais
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
        groups={allGroups}
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
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Agora</span>
        <span className="truncate font-medium">{programme.title}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {time(programme.start)} - {time(programme.stop)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="gradient-brand h-full" style={{ width: `${pct}%` }} />
      </div>
      {programme.desc && <p className="line-clamp-2 text-xs text-muted-foreground">{programme.desc}</p>}
      {next?.map((p) => (
        <div key={p.start} className="flex gap-2 text-xs text-muted-foreground">
          <span className="w-10 shrink-0">{time(p.start)}</span>
          <span className="truncate">{p.title}</span>
        </div>
      ))}
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
    <li className={cn("flex items-center", active && "bg-primary/10")}>
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
        <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {c.logo ? (
            <img src={c.logo} alt="" loading="lazy" className="h-full w-full object-contain p-1" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <Tv className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-medium", active && "text-primary")}>{label ?? c.name}</div>
          <div className="truncate text-xs text-muted-foreground">{now ? `Agora: ${now}` : c.group}</div>
        </div>
      </button>
      <button onClick={onFavorite} className="p-3 text-muted-foreground hover:text-pink-500" aria-label="Favorito">
        <Heart className={cn("h-4 w-4", favorite && "fill-pink-500 text-pink-500")} />
      </button>
    </li>
  );
}

type PosterItem = { id: string; name: string; logo: string; sub?: string };

function PosterGrid<T extends PosterItem>({ items, activeId, onSelect }: { items: T[]; activeId?: string; onSelect: (item: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-3">
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item)} className="group text-left">
          <div
            className={cn(
              "flex aspect-[2/3] items-center justify-center overflow-hidden rounded-md bg-muted ring-primary transition group-hover:ring-2",
              activeId === item.id && "ring-2",
            )}
          >
            {item.logo ? (
              <img src={item.logo} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
            ) : (
              <Film className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="mt-1.5 line-clamp-2 text-xs font-medium">{item.name}</div>
          {item.sub && <div className="text-[11px] text-muted-foreground">{item.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-transparent gradient-brand text-white" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
