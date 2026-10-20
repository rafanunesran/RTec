import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, Dices, KeyRound, Pencil, Plus, Search, Trash2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Playlist } from "@/lib/api";
import { copy, formatDate } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Switch, Textarea } from "@/components/ui";
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

type QuickForm = { url: string; name: string; username: string; password: string; expires_at: string };

const emptyQuick = (): QuickForm => ({
  url: "",
  name: "",
  username: `cliente${Math.floor(1000 + Math.random() * 9000)}`,
  password: randomPass(),
  expires_at: addDays(30),
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
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [linksFor, setLinksFor] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickForm>(emptyQuick);

  const load = () => api.get<Client[]>("/api/clients").then(setClients);

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

  const openQuick = () => {
    setQuick(emptyQuick());
    setQuickOpen(true);
  };

  // Adicao rapida: cria a lista com o link M3U do cliente e ja libera para o login novo.
  const saveQuick = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let playlist: Playlist | null = null;
    try {
      playlist = await api.post<Playlist>("/api/playlists", {
        name: quick.name || quick.username,
        kind: "m3u_url",
        url: quick.url.trim(),
      });
      const saved = await api.post<Client>("/api/clients", {
        name: quick.name,
        username: quick.username,
        password: quick.password,
        active: true,
        max_devices: 1,
        expires_at: quick.expires_at ? new Date(quick.expires_at).toISOString() : null,
        notes: "",
        playlist_ids: [playlist.id],
      });
      toast.success("Cliente criado");
      setQuickOpen(false);
      await load();
      api.get<Playlist[]>("/api/playlists").then(setPlaylists);
      setLinksFor(saved);
    } catch (err) {
      if (playlist) await api.del(`/api/playlists/${playlist.id}`).catch(() => {});
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Client) => {
    if (!confirm(`Excluir o cliente "${c.username}"? Os dispositivos dele tambem serao removidos.`)) return;
    await api.del(`/api/clients/${c.id}`);
    toast.success("Cliente excluido");
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

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Crie logins e senhas e defina quais listas cada cliente recebe"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openNew}>
              <Plus /> Novo cliente
            </Button>
            <Button variant="gradient" onClick={openQuick}>
              <Zap /> Adicao rapida
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
          text="Cole o link M3U do cliente para criar o login dele."
          action={
            <Button variant="gradient" onClick={openQuick}>
              <Zap /> Adicao rapida
            </Button>
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
                <th className="hidden px-4 py-3 font-medium md:table-cell">Listas</th>
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
                  <td className="hidden px-4 py-3 md:table-cell">{c.playlist_ids.length}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(c.last_access_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Dados de acesso" onClick={() => setLinksFor(c)}>
                        <KeyRound />
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
            <Field label="Limite de dispositivos">
              <Input type="number" min={1} value={form.max_devices} onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })} />
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Acesso liberado</div>
                <div className="text-xs text-muted-foreground">Desative para bloquear o cliente</div>
              </div>
              <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>

          <Field label="Listas liberadas">
            {playlists.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre listas em "Listas M3U" para liberar ao cliente.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {playlists.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/40">
                    <input type="checkbox" className="accent-violet-500" checked={form.playlist_ids.includes(p.id)} onChange={() => togglePlaylist(p.id)} />
                    <span className="text-sm">{p.name}</span>
                    {!p.active && <Badge variant="muted">inativa</Badge>}
                  </label>
                ))}
              </div>
            )}
          </Field>

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

      <Dialog open={quickOpen} onClose={() => setQuickOpen(false)} title="Adicao rapida" description="Cole o link M3U do cliente. A lista e o login sao criados juntos." wide>
        <form onSubmit={saveQuick} className="space-y-5">
          <Field label="Link M3U do cliente">
            <Input autoFocus type="url" value={quick.url} onChange={(e) => setQuick({ ...quick, url: e.target.value })} placeholder="http://servidor/get.php?username=...&password=...&type=m3u_plus" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome (opcional)">
              <Input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder="Joao da Silva" />
            </Field>
            <Field label="Usuario" hint="Letras, numeros, ponto, _ ou -">
              <Input value={quick.username} onChange={(e) => setQuick({ ...quick, username: e.target.value })} required />
            </Field>
            <Field label="Senha">
              <div className="flex gap-2">
                <Input value={quick.password} onChange={(e) => setQuick({ ...quick, password: e.target.value })} className="font-mono" />
                <Button type="button" variant="outline" size="icon" title="Gerar senha" onClick={() => setQuick({ ...quick, password: randomPass() })}>
                  <Dices />
                </Button>
              </div>
            </Field>
            <Field label="Validade">
              <Input type="datetime-local" value={quick.expires_at} onChange={(e) => setQuick({ ...quick, expires_at: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {[1, 7, 30, 90, 365].map((d) => (
                  <Button key={d} type="button" size="sm" variant="outline" onClick={() => setQuick({ ...quick, expires_at: addDays(d) })}>
                    +{d}d
                  </Button>
                ))}
              </div>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setQuickOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient" disabled={busy}>
              Criar cliente
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!linksFor} onClose={() => setLinksFor(null)} title="Dados de acesso" description="O cliente assiste pelo site com usuario e senha." wide>
        {linksFor && (
          <div className="space-y-4">
            <CopyRow label="Site do reprodutor" value={linksFor.links.server} />
            <div className="grid gap-4 sm:grid-cols-2">
              <CopyRow label="Usuario" value={linksFor.username} />
              <CopyRow label="Senha" value={linksFor.password} />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() =>
                  copy(
                    `Seu acesso IPTV\nAssista em: ${linksFor.links.server}\nUsuario: ${linksFor.username}\nSenha: ${linksFor.password}\n\nNo celular, abra o link e toque em "Instalar app" para colocar na tela inicial.`,
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
