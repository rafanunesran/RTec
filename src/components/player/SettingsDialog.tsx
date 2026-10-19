import { useEffect, useState, type FormEvent } from "react";
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
    <Dialog open={open} onClose={onClose} title="Configuracoes" wide>
      <div className="space-y-8">
        <section className="grid gap-3 sm:grid-cols-2">
          <Info label="Conta" value={profile.name || profile.username} />
          <Info label="Validade" value={profile.expires_at ? formatDate(profile.expires_at) : "Sem expiracao"} />
        </section>

        <section>
          <h3 className="mb-3 font-semibold">PIN de controle parental</h3>
          {!settings.custom_pin && <p className="mb-3 text-sm text-amber-400">Voce ainda usa o PIN padrao 0000. Troque por um seu.</p>}
          <form onSubmit={changePin} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="PIN atual">
              <Input type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ""))} maxLength={8} />
            </Field>
            <Field label="Novo PIN (4 a 8 numeros)">
              <Input type="password" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))} maxLength={8} />
            </Field>
            <Button variant="outline">Trocar PIN</Button>
          </form>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">Grupos bloqueados</h3>
          <p className="mb-3 text-sm text-muted-foreground">Grupos adultos ja sao bloqueados automaticamente. Marque outros que devem pedir PIN.</p>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {groups.map((g) => (
              <label key={g} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="accent-violet-500"
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

        <div className="flex justify-end border-t pt-4">
          <Button variant="destructive" onClick={onLogout}>
            Sair da conta
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "mt-1 font-mono text-xs" : "mt-1 text-sm font-medium"}>{value}</div>
    </div>
  );
}
