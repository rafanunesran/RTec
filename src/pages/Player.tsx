import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Heart, Loader2, LogOut, Search, Share, SquarePlus, Tv } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Channel, type ClientProfile } from "@/lib/api";
import { useInstall } from "@/lib/pwa";
import { cn, formatDate } from "@/lib/utils";
import { Button, Card, Dialog, Field, Input } from "@/components/ui";
import Logo from "@/components/Logo";
import VideoPlayer from "@/components/VideoPlayer";

const FAVORITES = "__favoritos__";
const PAGE = 200;

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

  if (checking)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  return profile ? <Watch profile={profile} onLogout={() => setProfile(null)} /> : <PlayerLogin onLogin={setProfile} />;
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
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo subtitle="TV ao vivo" />
          <p className="text-sm text-muted-foreground">Entre com o usuario e a senha que voce recebeu</p>
        </div>
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
        <Download /> Instalar app
      </Button>
      <Dialog open={help} onClose={() => setHelp(false)} title="Instalar no iPhone / iPad">
        <ol className="space-y-4 text-sm">
          <li className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">1</span>
            <span>
              Abra este site no <b>Safari</b> e toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b>.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">2</span>
            <span>
              Escolha <SquarePlus className="inline h-4 w-4" /> <b>Adicionar a Tela de Inicio</b>.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">3</span>
            <span>
              Toque em <b>Adicionar</b>. O app aparece na tela inicial.
            </span>
          </li>
        </ol>
      </Dialog>
    </>
  );
}

function Watch({ profile, onLogout }: { profile: ClientProfile; onLogout: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [group, setGroup] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [favorites, setFavorites] = useState<string[]>(() => load("rtec:favorites", []));

  useEffect(() => {
    api
      .get<Channel[]>("/api/player/channels")
      .then((list) => {
        setChannels(list);
        const last = load<string>("rtec:last", "");
        const found = list.find((c) => c.id === last);
        if (found) setCurrent(found);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          toast.error(err.message);
          onLogout();
        } else toast.error("Nao foi possivel carregar os canais");
        setChannels([]);
      });
  }, [onLogout]);

  const groups = useMemo(() => [...new Set((channels ?? []).map((c) => c.group))], [channels]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (channels ?? []).filter(
      (c) =>
        (!group || (group === FAVORITES ? favorites.includes(c.id) : c.group === group)) &&
        (!q || c.name.toLowerCase().includes(q)),
    );
  }, [channels, group, query, favorites]);

  useEffect(() => setLimit(PAGE), [group, query]);

  const play = (c: Channel) => {
    setCurrent(c);
    save("rtec:last", c.id);
    if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    save("rtec:favorites", next);
  };

  const logout = async () => {
    await api.post("/api/player/logout").catch(() => {});
    onLogout();
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Logo subtitle={profile.name || profile.username} />
        <div className="ml-auto flex items-center gap-2">
          <InstallButton compact />
          <Button variant="ghost" size="icon" onClick={logout} title="Sair">
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 lg:grid-cols-[1fr_380px] lg:gap-6 lg:p-6">
        <section className="sticky top-[65px] z-20 self-start bg-background lg:static">
          <VideoPlayer channel={current} />
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-0">
            <div className="min-w-0">
              <h1 className="truncate font-semibold">{current?.name ?? "Nenhum canal selecionado"}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {current?.group ?? (profile.expires_at ? `Acesso valido ate ${formatDate(profile.expires_at)}` : `${channels?.length ?? 0} canais disponiveis`)}
              </p>
            </div>
            {current && (
              <Button variant="ghost" size="icon" onClick={() => toggleFavorite(current.id)} title="Favorito">
                <Heart className={cn(favorites.includes(current.id) && "fill-pink-500 text-pink-500")} />
              </Button>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3 px-4 pb-6 lg:max-h-[calc(100dvh-113px)] lg:px-0 lg:pb-0">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar canal" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
            <Chip active={!group} onClick={() => setGroup("")}>
              Todos
            </Chip>
            <Chip active={group === FAVORITES} onClick={() => setGroup(FAVORITES)}>
              <Heart className="h-3 w-3" /> Favoritos
            </Chip>
            {groups.map((g) => (
              <Chip key={g} active={group === g} onClick={() => setGroup(g)}>
                {g}
              </Chip>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card/50">
            {channels === null ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando canais...
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {group === FAVORITES ? "Toque no coracao de um canal para adicionar aos favoritos." : "Nenhum canal encontrado."}
              </div>
            ) : (
              <ul className="divide-y">
                {visible.slice(0, limit).map((c) => (
                  <li key={c.id} className={cn("flex items-center", current?.id === c.id && "bg-primary/10")}>
                    <button onClick={() => play(c)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
                      <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {c.logo ? (
                          <img src={c.logo} alt="" loading="lazy" className="h-full w-full object-contain p-1" onError={(e) => (e.currentTarget.style.display = "none")} />
                        ) : (
                          <Tv className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className={cn("truncate text-sm font-medium", current?.id === c.id && "text-primary")}>{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.group}</div>
                      </div>
                    </button>
                    <button onClick={() => toggleFavorite(c.id)} className="p-3 text-muted-foreground hover:text-pink-500" aria-label="Favorito">
                      <Heart className={cn("h-4 w-4", favorites.includes(c.id) && "fill-pink-500 text-pink-500")} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {visible.length > limit && (
              <div className="p-3">
                <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  Mostrar mais ({visible.length - limit})
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
