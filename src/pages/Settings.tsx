import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

export default function Settings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirmNext) return toast.error("As senhas nao conferem");
    try {
      await api.post("/api/auth/password", { current, next });
      toast.success("Senha alterada");
      setCurrent("");
      setNext("");
      setConfirmNext("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Configuracoes" description="Seguranca da conta do administrador" />
      <Card className="max-w-lg p-6">
        <h2 className="mb-4 font-semibold">Alterar senha</h2>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Senha atual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="Nova senha">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} required />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} required />
          </Field>
          <Button variant="gradient">Salvar nova senha</Button>
        </form>
      </Card>
    </>
  );
}
