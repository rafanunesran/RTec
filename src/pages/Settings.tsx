import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button, Card, Field, IconTile, Input } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

export default function Settings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirmNext) return toast.error("As senhas não conferem");
    setBusy(true);
    try {
      await api.post("/api/auth/password", { current, next });
      toast.success("Senha alterada");
      setCurrent("");
      setNext("");
      setConfirmNext("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Configurações" description="Segurança da conta do administrador" />
      <Card className="max-w-lg p-6">
        <div className="mb-5 flex items-center gap-3">
          <IconTile icon={<KeyRound />} />
          <div>
            <h2 className="font-semibold">Alterar senha</h2>
            <p className="text-xs text-muted-foreground">Use pelo menos 10 caracteres.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Senha atual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="Nova senha">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} autoComplete="new-password" required />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Button variant="gradient" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Salvar nova senha
          </Button>
        </form>
      </Card>
    </>
  );
}
