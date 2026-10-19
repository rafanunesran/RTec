import { useEffect, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Dialog, Input } from "@/components/ui";

/** Pede o PIN parental e confere no servidor. */
export default function PinDialog({
  open,
  title = "Conteudo protegido",
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
    <Dialog open={open} onClose={onClose} title={title} description="Digite o PIN de controle parental (padrao: 0000)">
      <form onSubmit={submit} className="space-y-4">
        <div className="relative">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={8}
            className="pl-9 text-center font-mono text-lg tracking-[0.5em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="gradient" className="w-full" disabled={busy || pin.length < 4}>
          Desbloquear
        </Button>
      </form>
    </Dialog>
  );
}
