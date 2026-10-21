import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link2, Loader2, MessageSquareText, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Source } from "@/lib/api";
import { copy, formatDate } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Skeleton, Switch, Textarea } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import CopyRow from "@/components/CopyRow";
import SourceEditor, { emptySource, sourceLabel } from "@/components/SourceEditor";

type Form = {
  name: string;
  username: string;
  password: string;
  active: boolean;
  notes: string;
  source: Source;
};

const emptyForm = (): Form => ({
  name: "",
  username: "",
  password: randomPass(),
  active: true,
  notes: "",
  source: emptySource(),
});

function randomPass() {
  return Math.random().toString(36).slice(2, 10);
}

// A validade e conferida sozinha na lista do fornecedor, a cada login ou abertura do app do cliente.
function status(c: Client) {
  const s = c.list_status;
  const title = [s?.reason, s?.last_error && `Ultima tentativa: ${s.last_error}`, s?.checked_at && `Conferida em ${formatDate(s.checked_at)}`].filter(Boolean).join(" · ");
  if (!c.active) return <Badge variant="warning">Bloqueado</Badge>;
  if (s?.state === "expired") return <span title={title}><Badge variant="danger">Lista expirada</Badge></span>;
  if (s?.state === "active") return <span title={title}><Badge variant="success">Ativo</Badge></span>;
  if (s?.state === "none") return <Badge variant="success">Ativo</Badge>;
  return <span title={title || "Confere no próximo acesso do cliente"}><Badge variant="muted">Não conferida</Badge></span>;
}

/** Vencimento que o fornecedor informa (listas Xtream). */
const expiry = (c: Client) => (c.expires_at ? formatDate(c.expires_at) : c.list_status?.state === "active" ? "Lista ativa" : "—");

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

  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api
      .get<Client[]>("/api/clients")
      .then(setClients)
      .finally(() => setLoaded(true));

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
      const body = { ...form, source: blank ? null : src };
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
    toast.success("Cliente excluído");
    load();
  };

  const regenerate = async (c: Client) => {
    if (!confirm("Gerar um novo link curto? O link anterior deixará de funcionar.")) return;
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

  const [checkingId, setCheckingId] = useState("");
  const checkList = async (c: Client) => {
    setCheckingId(c.id);
    try {
      const updated = await api.post<Client>(`/api/clients/${c.id}/check`);
      setClients((list) => list.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
      const s = updated.list_status?.state;
      if (s === "expired") toast.error(`Lista expirada: ${updated.list_status?.reason}`);
      else if (s === "active") toast.success("Lista ativa no fornecedor");
      else if (updated.list_status?.last_error) toast.warning(`Não deu para conferir agora: ${updated.list_status.last_error}`);
      else toast.info("Este cliente não tem lista própria para conferir");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCheckingId("");
    }
  };

  const actions = (c: Client) => (
    <div className="flex justify-end gap-1">
      <Button size="icon-sm" variant="ghost" title="Conferir lista no fornecedor" aria-label="Conferir lista no fornecedor" disabled={checkingId === c.id} onClick={() => checkList(c)}>
        {checkingId === c.id ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
      </Button>
      <Button size="icon-sm" variant="ghost" title="Dados de acesso" aria-label="Dados de acesso" onClick={() => setLinksFor(c)}>
        <Link2 />
      </Button>
      <Button size="icon-sm" variant="ghost" title="Editar" aria-label="Editar" onClick={() => openEdit(c)}>
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" title="Excluir" aria-label="Excluir" className="hover:text-destructive" onClick={() => remove(c)}>
        <Trash2 />
      </Button>
    </div>
  );

  const sourceBadge = (c: Client) => (c.source ? <Badge variant="info">{sourceLabel(c.source)}</Badge> : <Badge variant="muted">Sem lista</Badge>);

  return (
    <>
      <PageHeader
        title="Clientes"
        description={clients.length ? `${clients.length} cliente(s) cadastrado(s)` : "Crie o login de cada cliente e cole a lista dele"}
        action={
          <>
            <Button variant="outline" onClick={openNew}>
              <Plus /> Novo cliente
            </Button>
            <Button variant="gradient" onClick={() => setQuickOpen(true)}>
              <Zap /> Cliente rápido
            </Button>
          </>
        }
      />

      {clients.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou usuário" aria-label="Buscar cliente" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {!loaded ? (
        <Card className="space-y-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : clients.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Nenhum cliente ainda"
          text="Crie o primeiro cliente: login, senha e a lista M3U dele."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={openNew}>
                <Plus /> Criar cliente
              </Button>
              <Button variant="gradient" onClick={() => setQuickOpen(true)}>
                <Zap /> Cliente rápido
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Nenhum cliente encontrado" text="Ajuste a busca ou cadastre um novo cliente." />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Senha</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Vencimento</th>
                  <th className="px-4 py-3 font-semibold">Lista</th>
                  <th className="hidden px-4 py-3 font-semibold lg:table-cell">Último acesso</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.username}</div>
                      {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.password}</td>
                    <td className="px-4 py-3">{status(c)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{expiry(c)}</td>
                    <td className="px-4 py-3">{sourceBadge(c)}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(c.last_access_at)}</td>
                    <td className="px-4 py-3">{actions(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="space-y-3 md:hidden">
            {filtered.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.username}</div>
                    {c.name && <div className="truncate text-xs text-muted-foreground">{c.name}</div>}
                  </div>
                  {status(c)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Senha</div>
                    <div className="truncate font-mono">{c.password}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Vencimento</div>
                    <div className="truncate">{expiry(c)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-0.5 text-muted-foreground">Lista</div>
                    {sourceBadge(c)}
                  </div>
                </div>
                <div className="mt-3 border-t pt-2">{actions(c)}</div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Cliente rápido"
        description="Cole o link da lista do fornecedor. O cliente é criado com o mesmo usuário e senha da lista, e a validade é conferida sozinha no fornecedor."
      >
        <form onSubmit={createQuick} className="space-y-4">
          <Field label="Link da lista">
            <Textarea
              autoFocus
              rows={3}
              className="font-mono text-xs"
              value={quick.link}
              onChange={(e) => setQuick({ ...quick, link: e.target.value })}
              placeholder="http://servidor/get.php?username=USUARIO&password=SENHA&type=m3u_plus"
              required
            />
          </Field>
          <Field label="Nome do cliente (opcional)">
            <Input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder="Se vazio, usa o usuário da lista" />
          </Field>
          <Button variant="gradient" size="lg" className="w-full" disabled={busy || !quick.link.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Zap />} Criar cliente
          </Button>
        </form>
      </Dialog>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Editar cliente" : "Novo cliente"} description="Defina credenciais e a lista do cliente. A validade é conferida sozinha na lista, a cada acesso." wide>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome (opcional)">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="João da Silva" />
            </Field>
            <Field label="Usuário" hint="Letras, números, ponto, _ ou -">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required />
            </Field>
            <Field label="Senha">
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
                <Button type="button" variant="outline" size="icon" title="Gerar senha" aria-label="Gerar senha" onClick={() => setForm({ ...form, password: randomPass() })}>
                  <Wand2 />
                </Button>
              </div>
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 sm:self-start">
              <div>
                <div className="text-sm font-medium">Acesso liberado</div>
                <div className="text-xs text-muted-foreground">Desative para bloquear o cliente</div>
              </div>
              <Switch label="Acesso liberado" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Lista do cliente</div>
            <p className="text-xs text-muted-foreground">Cole o link ou o login do fornecedor deste cliente. É só isso que ele vai ver no reprodutor.</p>
            <SourceEditor value={form.source} onChange={(source) => setForm({ ...form, source })} />
          </div>

          {editing?.custom_pin && (
            <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
              <div>
                <div className="text-sm font-medium">PIN parental personalizado</div>
                <div className="text-xs text-muted-foreground">Se o cliente esqueceu, volte para o padrão 0000</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => resetPin(editing)}>
                Resetar PIN
              </Button>
            </div>
          )}

          <Field label="Observações">
            <Textarea className="font-sans" rows={3} placeholder="Anotações internas..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Salvar cliente
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!linksFor} onClose={() => setLinksFor(null)} title="Dados de acesso" description="Toque para copiar. O cliente assiste pelo site com usuário e senha; os links M3U servem para apps IPTV externos." wide>
        {linksFor && (
          <div className="space-y-4">
            <div className="space-y-2">
              <CopyRow label="Site do reprodutor" value={linksFor.links.server} />
              <CopyRow label="Link M3U (usuário e senha)" value={linksFor.links.m3u} />
              <CopyRow label="Link M3U curto" value={linksFor.links.m3u_token} />
              <div className="grid gap-2 sm:grid-cols-3">
                <CopyRow label="Servidor" value={linksFor.links.server} />
                <CopyRow label="Usuário" value={linksFor.username} />
                <CopyRow label="Senha" value={linksFor.password} />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={() => regenerate(linksFor)}>
                <RefreshCw /> Gerar novo link curto
              </Button>
              <Button
                variant="gradient"
                className="flex-1"
                onClick={() =>
                  copy(
                    `Seu acesso IPTV\nAssista em: ${linksFor.links.server}\nUsuario: ${linksFor.username}\nSenha: ${linksFor.password}\n\nAndroid, TV Box e Fire TV: baixe o app em ${linksFor.links.server}/download/rtec-tv.apk\niPhone: abra o link no Safari e use "Adicionar a Tela de Inicio".`,
                    "Mensagem copiada",
                  )
                }
              >
                <MessageSquareText /> Copiar mensagem para o cliente
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
