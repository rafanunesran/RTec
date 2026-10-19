import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, Dices, Link2, Loader2, Zap, Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Source } from "@/lib/api";
import { copy, formatDate } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Switch, Textarea } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import CopyRow from "@/components/CopyRow";
import SourceEditor, { emptySource, sourceLabel } from "@/components/SourceEditor";

type Form = {
  name: string;
  username: string;
  password: string;
  active: boolean;
  expires_at: string;
  notes: string;
  source: Source;
};

const emptyForm = (): Form => ({
  name: "",
  username: "",
  password: randomPass(),
  active: true,
  expires_at: addDays(30),
  notes: "",
  source: emptySource(),
});

function randomPass() {
  return Math.random().toString(36).slice(2, 10);
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalInput(d.toISOString());
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function status(c: Client) {
  if (!c.active) return <Badge variant="muted">Bloqueado</Badge>;
  if (!c.valid) return <Badge variant="danger">Expirado</Badge>;
  return <Badge variant="success">Ativo</Badge>;
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [linksFor, setLinksFor] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ link: "", name: "" });

  const load = () => api.get<Client[]>("/api/clients").then(setClients);

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return clients.filter((c) => c.username.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [clients, query]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({
      name: c.name,
      username: c.username,
      password: c.password,
      active: c.active,
      expires_at: toLocalInput(c.expires_at),
      notes: c.notes,
      source: c.source ? { ...emptySource(), ...c.source } : emptySource(),
    });
    setFormOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const src = form.source;
      const blank =
        (src.kind === "m3u_url" && !src.url.trim()) ||
        (src.kind === "xtream" && !src.xtream_server.trim() && !src.xtream_username.trim()) ||
        (src.kind === "manual" && !/#EXTINF/i.test(src.content));
      const body = { ...form, source: blank ? null : src, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null };
      const saved = editing
        ? await api.put<Client>(`/api/clients/${editing.id}`, body)
        : await api.post<Client>("/api/clients", body);
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      setFormOpen(false);
      await load();
      if (!editing) setLinksFor(saved);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createQuick = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<Client>("/api/clients/quick", { link: quick.link, name: quick.name });
      toast.success(`Cliente ${created.username} criado`);
      setQuickOpen(false);
      setQuick({ link: "", name: "" });
      await load();
      setLinksFor(created);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Client) => {
    if (!confirm(`Excluir o cliente "${c.username}"?`)) return;
    await api.del(`/api/clients/${c.id}`);
    toast.success("Cliente excluido");
    load();
  };

  const regenerate = async (c: Client) => {
    if (!confirm("Gerar um novo link curto? O link anterior deixara de funcionar.")) return;
    const updated = await api.post<Client>(`/api/clients/${c.id}/regenerate-token`);
    setLinksFor(updated);
    load();
  };

  const resetPin = async (c: Client) => {
    const updated = await api.put<Client>(`/api/clients/${c.id}`, { reset_pin: true });
    setEditing(updated);
    toast.success("PIN voltou para 0000");
    load();
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Crie o login de cada cliente e cole a lista dele"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openNew}>
              <Plus /> Novo cliente
            </Button>
            <Button variant="gradient" onClick={() => setQuickOpen(true)}>
              <Zap /> Cliente rapido
            </Button>
          </div>
        }
      />

      {clients.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou usuario" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Nenhum cliente ainda"
          text="Crie o primeiro cliente: login, senha e a lista M3U dele."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={openNew}>
                <Plus /> Criar cliente
              </Button>
              <Button variant="gradient" onClick={() => setQuickOpen(true)}>
                <Zap /> Cliente rapido
              </Button>
            </div>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Senha</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Validade</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Lista</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Ultimo acesso</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.username}</div>
                    {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.password}</td>
                  <td className="px-4 py-3">{status(c)}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{c.expires_at ? formatDate(c.expires_at) : "Sem validade"}</td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {c.source ? <Badge>{sourceLabel(c.source)}</Badge> : <Badge variant="muted">Sem lista</Badge>}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(c.last_access_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Links de acesso" onClick={() => setLinksFor(c)}>
                        <Link2 />
                      </Button>
                      <Button size="icon" variant="ghost" title="Editar" onClick={() => openEdit(c)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" title="Excluir" className="hover:text-destructive" onClick={() => remove(c)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Cliente rapido"
        description="Cole o link da lista do fornecedor. O cliente e criado com o mesmo usuario, senha e validade da lista."
      >
        <form onSubmit={createQuick} className="space-y-4">
          <Field label="Link da lista">
            <Textarea
              autoFocus
              rows={3}
              className="text-xs"
              value={quick.link}
              onChange={(e) => setQuick({ ...quick, link: e.target.value })}
              placeholder="http://servidor/get.php?username=USUARIO&password=SENHA&type=m3u_plus"
              required
            />
          </Field>
          <Field label="Nome do cliente (opcional)">
            <Input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder="Se vazio, usa o usuario da lista" />
          </Field>
          <Button variant="gradient" className="w-full" disabled={busy || !quick.link.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Zap />} Criar cliente
          </Button>
        </form>
      </Dialog>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Editar cliente" : "Novo cliente"} wide>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome (opcional)">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Joao da Silva" />
            </Field>
            <Field label="Usuario" hint="Letras, numeros, ponto, _ ou -">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </Field>
            <Field label="Senha">
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
                <Button type="button" variant="outline" size="icon" title="Gerar senha" onClick={() => setForm({ ...form, password: randomPass() })}>
                  <Dices />
                </Button>
              </div>
            </Field>
            <Field label="Validade" hint="Deixe vazio para nao expirar">
              <Input type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {[1, 7, 30, 90, 365].map((d) => (
                  <Button key={d} type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, expires_at: addDays(d) })}>
                    +{d}d
                  </Button>
                ))}
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Acesso liberado</div>
                <div className="text-xs text-muted-foreground">Desative para bloquear o cliente</div>
              </div>
              <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Lista do cliente</div>
            <p className="text-xs text-muted-foreground">Cole o link ou o login do fornecedor deste cliente. E so isso que ele vai ver no reprodutor.</p>
            <SourceEditor value={form.source} onChange={(source) => setForm({ ...form, source })} />
          </div>

          {editing?.custom_pin && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">PIN parental personalizado</div>
                <div className="text-xs text-muted-foreground">Se o cliente esqueceu, volte para o padrao 0000</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => resetPin(editing)}>
                Resetar PIN
              </Button>
            </div>
          )}

          <Field label="Observacoes">
            <Textarea className="font-sans" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient" disabled={busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!linksFor} onClose={() => setLinksFor(null)} title="Dados de acesso" description="O cliente assiste pelo site com usuario e senha. Os links M3U servem para apps IPTV externos." wide>
        {linksFor && (
          <div className="space-y-4">
            <CopyRow label="Site do reprodutor" value={linksFor.links.server} />
            <CopyRow label="Link M3U (usuario e senha)" value={linksFor.links.m3u} />
            <CopyRow label="Link M3U curto" value={linksFor.links.m3u_token} />
            <div className="grid gap-4 sm:grid-cols-3">
              <CopyRow label="Servidor" value={linksFor.links.server} />
              <CopyRow label="Usuario" value={linksFor.username} />
              <CopyRow label="Senha" value={linksFor.password} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => regenerate(linksFor)}>
                <RefreshCw /> Gerar novo link curto
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  copy(
                    `Seu acesso IPTV\nAssista em: ${linksFor.links.server}\nUsuario: ${linksFor.username}\nSenha: ${linksFor.password}\n\nAndroid, TV Box e Fire TV: baixe o app em ${linksFor.links.server}/download/rtec-tv.apk\niPhone: abra o link no Safari e use "Adicionar a Tela de Inicio".`,
                    "Mensagem copiada",
                  )
                }
              >
                <Copy /> Copiar mensagem para o cliente
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
