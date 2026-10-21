import { useEffect, useRef, useState, type FormEvent } from "react";
import { Baby, Bird, Cat, Crown, Dog, Flower2, Gamepad2, Ghost, Loader2, LogOut, Music, Pencil, Plus, Rocket, Smile, Star, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type ClientProfile } from "@/lib/api";
import { forgetProfile, type Viewer } from "@/lib/profiles";
import { tvNavigationOn } from "@/lib/tvnav";
import { cn } from "@/lib/utils";
import { Button, Dialog, Field, Input, Switch } from "@/components/ui";
import Logo from "@/components/Logo";

// Avatares: cor + desenho (o numero e guardado no perfil, 0 a 11).
const AVATARS = [
  { icon: Smile, bg: "from-sky-500 to-blue-700" },
  { icon: Cat, bg: "from-rose-500 to-red-700" },
  { icon: Dog, bg: "from-amber-400 to-orange-600" },
  { icon: Rocket, bg: "from-violet-500 to-purple-800" },
  { icon: Star, bg: "from-yellow-300 to-amber-500" },
  { icon: Ghost, bg: "from-slate-400 to-slate-700" },
  { icon: Gamepad2, bg: "from-emerald-400 to-green-700" },
  { icon: Music, bg: "from-pink-400 to-fuchsia-700" },
  { icon: Zap, bg: "from-cyan-400 to-teal-700" },
  { icon: Crown, bg: "from-orange-400 to-rose-600" },
  { icon: Flower2, bg: "from-lime-400 to-emerald-600" },
  { icon: Bird, bg: "from-indigo-400 to-blue-800" },
];

export function Avatar({ avatar, className }: { avatar: number; className?: string }) {
  const a = AVATARS[avatar] ?? AVATARS[0];
  const Icon = a.icon;
  return (
    <span className={cn("grid aspect-square place-items-center rounded-xl bg-gradient-to-br text-white", a.bg, className)}>
      <Icon className="h-1/2 w-1/2" strokeWidth={1.75} />
    </span>
  );
}

/** Tela "Quem esta assistindo?": escolher, criar, editar e excluir perfis. */
export function ProfilePicker({
  account,
  profiles: initial,
  max,
  focusId,
  manage: startManaging = false,
  onPick,
  onChange,
  onLogout,
}: {
  account: ClientProfile;
  profiles: Viewer[];
  max: number;
  focusId?: string | null;
  manage?: boolean;
  onPick: (v: Viewer) => void;
  onChange: (list: Viewer[]) => void;
  onLogout: () => void;
}) {
  const [profiles, setProfiles] = useState(initial);
  const [manage, setManage] = useState(startManaging);
  const [editing, setEditing] = useState<Viewer | "new" | null>(null);
  const focusRef = useRef<HTMLButtonElement>(null);

  // Na TV ja comeca com o ultimo perfil selecionado (o controle so precisa apertar OK).
  useEffect(() => {
    if (tvNavigationOn()) focusRef.current?.focus();
  }, []);

  const update = (list: Viewer[]) => {
    setProfiles(list);
    onChange(list);
  };
  const focusTarget = profiles.find((p) => p.id === focusId)?.id ?? profiles[0]?.id;

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative w-full max-w-5xl">
        <Logo />
      </div>
      <div className="relative flex w-full flex-1 animate-rise-in flex-col items-center justify-center py-10">
        <h1 className="text-center text-2xl font-bold tracking-tight sm:text-4xl">{manage ? "Gerenciar perfis" : "Quem está assistindo?"}</h1>
        <div className="mt-8 flex max-w-4xl flex-wrap justify-center gap-4 sm:mt-12 sm:gap-8">
          {profiles.map((p) => (
            <button
              key={p.id}
              ref={p.id === focusTarget ? focusRef : undefined}
              onClick={() => (manage ? setEditing(p) : onPick(p))}
              className="profile-tile group flex w-24 flex-col items-center gap-3 outline-none sm:w-32 lg:w-40"
            >
              <span className="relative w-full rounded-xl ring-offset-4 ring-offset-background transition-all group-hover:ring-4 group-hover:ring-foreground/80 group-focus:ring-4 group-focus:ring-foreground group-focus:scale-105">
                <Avatar avatar={p.avatar} className={cn("w-full", manage && "opacity-50")} />
                {manage && (
                  <span className="absolute inset-0 grid place-items-center">
                    <Pencil className="h-1/3 w-1/3 text-white" />
                  </span>
                )}
                {p.kids && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">INFANTIL</span>}
              </span>
              <span className="w-full truncate text-center text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground group-focus:text-foreground sm:text-base">
                {p.name}
              </span>
            </button>
          ))}
          {profiles.length < max && (
            <button onClick={() => setEditing("new")} className="profile-tile group flex w-24 flex-col items-center gap-3 outline-none sm:w-32 lg:w-40">
              <span className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-muted-foreground/40 text-muted-foreground ring-offset-4 ring-offset-background transition-all group-hover:border-foreground group-hover:text-foreground group-focus:scale-105 group-focus:border-foreground group-focus:text-foreground group-focus:ring-4 group-focus:ring-foreground">
                <Plus className="h-1/3 w-1/3" />
              </span>
              <span className="text-center text-sm font-medium text-muted-foreground group-hover:text-foreground group-focus:text-foreground sm:text-base">Adicionar perfil</span>
            </button>
          )}
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3 sm:mt-14">
          <Button variant={manage ? "gradient" : "outline"} size="lg" onClick={() => setManage(!manage)}>
            {manage ? "Concluído" : (
              <>
                <Pencil /> Gerenciar perfis
              </>
            )}
          </Button>
          <Button variant="ghost" size="lg" onClick={onLogout}>
            <LogOut /> Sair da conta
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Conta: {account.name || account.username}</p>
      </div>

      {editing && (
        <ProfileEditor
          profile={editing === "new" ? null : editing}
          canDelete={profiles.length > 1}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            const exists = profiles.some((p) => p.id === saved.id);
            update(exists ? profiles.map((p) => (p.id === saved.id ? saved : p)) : [...profiles, saved]);
            setEditing(null);
          }}
          onDeleted={(id) => {
            forgetProfile(id);
            update(profiles.filter((p) => p.id !== id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: {
  profile: Viewer | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (v: Viewer) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar ?? Math.floor(Math.random() * AVATARS.length));
  const [kids, setKids] = useState(profile?.kids ?? false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, avatar, kids };
      onSaved(profile ? await api.put<Viewer>(`/api/player/profiles/${profile.id}`, body) : await api.post<Viewer>("/api/player/profiles", body));
      toast.success(profile ? "Perfil atualizado" : "Perfil criado");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await api.del(`/api/player/profiles/${profile.id}`);
      toast.success("Perfil excluído");
      onDeleted(profile.id);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={profile ? "Editar perfil" : "Novo perfil"} description={profile ? undefined : "Cada perfil tem seus favoritos, histórico e onde parou."}>
      <form onSubmit={save} className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar avatar={avatar} className="w-20 shrink-0" />
          <div className="flex-1">
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus={!profile && !tvNavigationOn()} required />
            </Field>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Avatar</p>
          <div className="grid grid-cols-6 gap-2">
            {AVATARS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setAvatar(i)}
                aria-label={`Avatar ${i + 1}`}
                aria-pressed={avatar === i}
                className={cn("rounded-xl ring-offset-2 ring-offset-card transition-all", avatar === i ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100")}
              >
                <Avatar avatar={i} className="w-full" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div className="flex items-center gap-3">
            <Baby className="h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Perfil infantil</p>
              <p className="text-xs text-muted-foreground">Esconde as categorias adultas e as bloqueadas pelo PIN.</p>
            </div>
          </div>
          <Switch checked={kids} onChange={setKids} label="Perfil infantil" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {profile && canDelete && (
            <Button type="button" variant={confirmDelete ? "destructive" : "ghost"} onClick={remove} disabled={busy} className="sm:mr-auto">
              <Trash2 /> {confirmDelete ? "Confirmar exclusão" : "Excluir perfil"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} className="sm:ml-auto">
            Cancelar
          </Button>
          <Button variant="gradient" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
