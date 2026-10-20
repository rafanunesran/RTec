import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, Lock, LogOut, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { api, type ClientProfile, type PlayerSettings } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button, Dialog, Field, Input } from "@/components/ui";

export default function SettingsDialog({
  open,
  onClose,
  profile,
  settings,
  groups,
  onSettings,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  profile: ClientProfile;
  settings: PlayerSettings;
  groups: string[];
  onSettings: (s: PlayerSettings) => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [lockPin, setLockPin] = useState("");
  const [locked, setLocked] = useState<string[]>(settings.locked_groups);

  useEffect(() => {
    if (open) setLocked(settings.locked_groups);
  }, [open, settings.locked_groups]);

  const changePin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/api/player/pin", { current, pin: next });
      toast.success("PIN alterado");
      setCurrent("");
      setNext("");
      onSettings({ ...settings, custom_pin: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const saveLocked = async () => {
    try {
      const res = await api.post<{ locked_groups: string[] }>("/api/player/locked-groups", { pin: lockPin, groups: locked });
      onSettings({ ...settings, locked_groups: res.locked_groups });
      toast.success("Bloqueios salvos");
      setLockPin("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Configurações" description="Sua conta e controle parental." wide>
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2">
          <Info icon={<User />} label="Conta" value={profile.name || profile.username} sub={profile.username} />
          <Info icon={<CalendarClock />} label="Validade" value={profile.expires_at ? formatDate(profile.expires_at) : "Sem expiração"} />
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" /> PIN de controle parental
          </h3>
          {!settings.custom_pin && <p className="mb-3 text-sm text-warning">Você ainda usa o PIN padrão 0000. Troque por um seu.</p>}
          <form onSubmit={changePin} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="PIN atual">
              <Input type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ""))} maxLength={8} />
            </Field>
            <Field label="Novo PIN (4 a 8 números)">
              <Input type="password" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))} maxLength={8} />
            </Field>
            <Button variant="outline">Trocar PIN</Button>
          </form>
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4 text-warning" /> Grupos bloqueados
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">Grupos adultos já são bloqueados automaticamente. Marque outros que devem pedir PIN.</p>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
            {groups.map((g) => (
              <label key={g} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={locked.includes(g)}
                  onChange={() => setLocked((l) => (l.includes(g) ? l.filter((x) => x !== g) : [...l, g]))}
                />
                <span className="truncate">{g}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              className="max-w-[140px]"
              value={lockPin}
              onChange={(e) => setLockPin(e.target.value.replace(/\D/g, ""))}
            />
            <Button variant="outline" onClick={saveLocked} disabled={lockPin.length < 4}>
              Salvar bloqueios
            </Button>
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <Button variant="destructive" onClick={onLogout}>
            <LogOut /> Sair da conta
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Info({ icon, label, value, sub, mono }: { icon: ReactNode; label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border bg-muted/40 p-3">
      <div className="mb-2 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "truncate font-mono text-xs font-semibold" : "truncate text-sm font-semibold"}>{value}</div>
      {sub && <div className="truncate font-mono text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
