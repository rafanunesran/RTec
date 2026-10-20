import { useEffect, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Dialog, Input } from "@/components/ui";

/** Pede o PIN parental e confere no servidor. */
export default function PinDialog({
  open,
  title = "Conteúdo protegido",
  onClose,
  onSuccess,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onSuccess: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin("");
      setError("");
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/player/pin/verify", { pin });
      onSuccess(pin);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Digite o PIN de controle parental (padrão: 0000)"
      icon={
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/15 text-warning ring-1 ring-warning/30">
          <Lock className="h-5 w-5" />
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          aria-label="PIN"
          placeholder="••••"
          maxLength={8}
          className="h-16 text-center font-mono text-3xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setError("");
          }}
        />
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
        <Button variant="gradient" size="lg" className="w-full" disabled={busy || pin.length < 4}>
          Desbloquear
        </Button>
      </form>
    </Dialog>
  );
}
