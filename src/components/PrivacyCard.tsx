import { useEffect, useState, type FormEvent } from "react";
import { Check, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type PrivacyInfo, type PrivacyRequest } from "@/lib/api";
import { Button, Card, Field, IconTile, Input, Switch } from "@/components/ui";
import { formatDate } from "@/lib/utils";

type AdminPrivacy = PrivacyInfo & { requests: PrivacyRequest[]; cleanup: { at: string; devices: number; locks: number; links: number } | null };

const KIND: Record<PrivacyRequest["kind"], string> = { delete: "Excluir conta", correct: "Corrigir dados", other: "Outro pedido" };

/** LGPD: dados do controlador (aparecem na Politica de Privacidade) e pedidos dos clientes. */
export default function PrivacyCard() {
  const [st, setSt] = useState<AdminPrivacy | null>(null);
  const [form, setForm] = useState<PrivacyInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<AdminPrivacy>("/api/admin/privacy").then((d) => {
      setSt(d);
      setForm(d);
    }, (err) => toast.error((err as Error).message));
  useEffect(() => void load(), []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api.put<PrivacyInfo>("/api/admin/privacy", form);
      setForm(saved);
      toast.success("Dados da privacidade salvos");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = async (r: PrivacyRequest) => {
    try {
      await api.post(`/api/admin/privacy/requests/${r.id}/done`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const set = (k: keyof PrivacyInfo) => (e: React.ChangeEvent<HTMLInputElement>) => form && setForm({ ...form, [k]: e.target.value });
  const open = st?.requests.filter((r) => !r.done_at) || [];
  const old = st?.requests.filter((r) => r.done_at).slice(0, 5) || [];

  return (
    <Card className="max-w-lg p-6">
      <div className="mb-4 flex items-start gap-3">
        <IconTile icon={<FileText />} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Privacidade (LGPD)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Estes dados aparecem na{" "}
            <a href="/privacidade" target="_blank" className="font-medium text-primary underline">
              Política de Privacidade <ExternalLink className="inline h-3 w-3" />
            </a>{" "}
            e nos{" "}
            <a href="/termos" target="_blank" className="font-medium text-primary underline">
              Termos de Uso
            </a>
            . O que ficar vazio aparece como "a preencher".
          </p>
        </div>
      </div>

      {open.length > 0 && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 text-sm font-semibold text-warning">Pedidos dos clientes ({open.length})</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Responda em até 15 dias. Para excluir, apague o cliente em Clientes (apaga também perfis, histórico e aparelhos) e marque como atendido.
          </p>
          <ul className="space-y-2">
            {open.map((r) => (
              <li key={r.id} className="rounded-lg border bg-card p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <strong>{KIND[r.kind]}</strong> · {r.name || r.username} <span className="font-mono text-xs text-muted-foreground">{r.username}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                </div>
                {r.message && <p className="mt-1 text-xs text-muted-foreground">"{r.message}"</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => (window.location.href = `/api/clients/${r.client_id}/export`)}>
                    <Download /> Dados
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void done(r)}>
                    <Check /> Atendido
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {form ? (
        <form onSubmit={save} className="space-y-3">
          <Field label="Nome ou razão social (controlador)">
            <Input value={form.controller} onChange={set("controller")} maxLength={300} />
          </Field>
          <Field label="CPF ou CNPJ">
            <Input value={form.document} onChange={set("document")} maxLength={300} />
          </Field>
          <Field label="Endereço para correspondência">
            <Input value={form.address} onChange={set("address")} maxLength={300} />
          </Field>
          <Field label="Encarregado de dados (DPO)" hint="Pessoa que responde pelos pedidos de privacidade. Pode ser você.">
            <Input value={form.dpo} onChange={set("dpo")} maxLength={300} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-mail de contato">
              <Input type="email" value={form.email} onChange={set("email")} maxLength={300} />
            </Field>
            <Field label="WhatsApp de contato">
              <Input value={form.whatsapp} onChange={set("whatsapp")} maxLength={300} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div className="text-sm">
              <p className="font-medium">Texto revisado por advogado</p>
              <p className="text-xs text-muted-foreground">Desligado, as páginas mostram o aviso "Versão preliminar".</p>
            </div>
            <Switch checked={form.reviewed} onChange={(v) => setForm({ ...form, reviewed: v })} label="Texto revisado" />
          </div>
          <Button variant="gradient" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </form>
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      )}

      {st?.cleanup && (
        <p className="mt-4 text-xs text-muted-foreground">
          Limpeza automática (aparelhos parados há 60 dias, tentativas de login e links vencidos): última em {formatDate(st.cleanup.at)}.
        </p>
      )}
      {old.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Atendidos recentes: {old.map((r) => `${KIND[r.kind]} de ${r.username} (${formatDate(r.done_at!)})`).join("; ")}.
        </p>
      )}
    </Card>
  );
}
