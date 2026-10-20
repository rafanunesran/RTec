import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link2, Loader2, MessageSquareText, Pencil, Plus, RefreshCw, Search, Trash2, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Playlist } from "@/lib/api";
import { copy, formatDate } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Skeleton, Switch, Textarea } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import CopyRow from "@/components/CopyRow";

type Form = {
  name: string;
  username: string;
  password: string;
  active: boolean;
  max_devices: number;
  expires_at: string;
  notes: string;
  playlist_ids: string[];
};

const emptyForm = (): Form => ({
  name: "",
  username: "",
  password: randomPass(),
  active: true,
  max_devices: 1,
  expires_at: addDays(30),
  notes: "",
  playlist_ids: [],
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
  if (!c.active) return <Badge variant="warning">Bloqueado</Badge>;
  if (!c.valid) return <Badge variant="danger">Expirado</Badge>;
  return <Badge variant="success">Ativo</Badge>;
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [linksFor, setLinksFor] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api
      .get<Client[]>("/api/clients")
      .then(setClients)
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
    api.get<Playlist[]>("/api/playlists").then(setPlaylists);
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
      max_devices: c.max_devices,
      expires_at: toLocalInput(c.expires_at),
      notes: c.notes,
      playlist_ids: c.playlist_ids,
    });
    setFormOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null };
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

  const remove = async (c: Client) => {
    if (!confirm(`Excluir o cliente "${c.username}"? Os dispositivos dele também serão removidos.`)) return;
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

  const togglePlaylist = (id: string) =>
    setForm((f) => ({
      ...f,
      playlist_ids: f.playlist_ids.includes(id) ? f.playlist_ids.filter((x) => x !== id) : [...f.playlist_ids, id],
    }));

  const actions = (c: Client) => (
    <div className="flex justify-end gap-1">
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

  return (
    <>
      <PageHeader
        title="Clientes"
        description={clients.length ? `${clients.length} cliente(s) cadastrado(s)` : "Crie logins e senhas e defina quais listas cada cliente recebe"}
        action={
          <Button variant="gradient" onClick={openNew}>
            <Plus /> Novo cliente
          </Button>
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
          text="Crie o primeiro login e senha para disponibilizar suas listas M3U."
          action={
            <Button variant="gradient" onClick={openNew}>
              <Plus /> Criar cliente
            </Button>
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
                  <th className="px-4 py-3 font-semibold">Validade</th>
                  <th className="px-4 py-3 font-semibold">Listas</th>
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
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.expires_at ? formatDate(c.expires_at) : "Sem validade"}</td>
                    <td className="px-4 py-3 tabular-nums">{c.playlist_ids.length}</td>
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
                    <div className="text-muted-foreground">Validade</div>
                    <div className="truncate">{c.expires_at ? formatDate(c.expires_at) : "Sem validade"}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Listas</div>
                    <div>{c.playlist_ids.length}</div>
                  </div>
                </div>
                <div className="mt-3 border-t pt-2">{actions(c)}</div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar cliente" : "Novo cliente"}
        description="Defina credenciais, validade e listas liberadas."
        wide
      >
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
            <Field label="Limite de dispositivos">
              <Input type="number" min={1} value={form.max_devices} onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })} />
            </Field>
          </div>

          <Field label="Validade" hint="Deixe vazio para não expirar">
            <Input type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[1, 7, 30, 90, 365].map((d) => (
                <Button key={d} type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, expires_at: addDays(d) })}>
                  +{d}d
                </Button>
              ))}
            </div>
          </Field>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Acesso liberado</div>
              <div className="text-xs text-muted-foreground">Desative para bloquear o cliente</div>
            </div>
            <Switch label="Acesso liberado" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
          </label>

          <Field label="Listas liberadas">
            {playlists.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Cadastre listas em "Listas M3U" para liberar ao cliente.</p>
            ) : (
              <div className="grid gap-1 rounded-xl border p-2 sm:grid-cols-2">
                {playlists.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                    <input type="checkbox" className="h-4 w-4" checked={form.playlist_ids.includes(p.id)} onChange={() => togglePlaylist(p.id)} />
                    <span className="truncate">{p.name}</span>
                    {!p.active && <Badge variant="muted">inativa</Badge>}
                  </label>
                ))}
              </div>
            )}
          </Field>

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

      <Dialog
        open={!!linksFor}
        onClose={() => setLinksFor(null)}
        title="Dados de acesso"
        description="Toque para copiar. O cliente assiste pelo site com usuário e senha; os links M3U servem para apps IPTV externos."
        wide
      >
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
                    `Seu acesso IPTV\nAssista em: ${linksFor.links.server}\nUsuario: ${linksFor.username}\nSenha: ${linksFor.password}\n\nNo celular, abra o link e toque em "Instalar app" para colocar na tela inicial.`,
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
