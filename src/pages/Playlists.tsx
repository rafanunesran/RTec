import { useEffect, useState, type FormEvent } from "react";
import { Eye, Globe, ListVideo, Loader2, Pencil, Plus, Server, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Playlist, type PlaylistKind, type Preview } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Switch, Textarea } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

type Form = Omit<Playlist, "id" | "client_count" | "channel_count">;

const emptyForm: Form = {
  name: "",
  kind: "m3u_url",
  url: "",
  xtream_server: "",
  xtream_username: "",
  xtream_password: "",
  content: "#EXTM3U\n",
  epg_url: "",
  playback: "direct",
  active: true,
};

const kinds: { value: PlaylistKind; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "m3u_url", label: "URL M3U", desc: "Link de uma lista existente", icon: Globe },
  { value: "xtream", label: "Xtream Codes", desc: "Xtream, XUI.One ou OneStream", icon: Server },
  { value: "manual", label: "Manual", desc: "Cole ou escreva o M3U", icon: FileText },
];

const kindLabel = (k: PlaylistKind) => kinds.find((x) => x.value === k)?.label;

export default function Playlists() {
  const [items, setItems] = useState<Playlist[]>([]);
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ p: Playlist; data: Preview | null } | null>(null);

  const load = () => api.get<Playlist[]>("/api/playlists").then(setItems);
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (p: Playlist) => {
    setEditing(p);
    setForm({ ...p, content: p.content || "#EXTM3U\n" });
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) await api.put(`/api/playlists/${editing.id}`, form);
      else await api.post("/api/playlists", form);
      toast.success("Lista salva");
      setOpen(false);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Playlist) => {
    if (!confirm(`Excluir a lista "${p.name}"? Ela sera removida de ${p.client_count} cliente(s).`)) return;
    await api.del(`/api/playlists/${p.id}`);
    toast.success("Lista excluida");
    load();
  };

  const openPreview = async (p: Playlist) => {
    setPreview({ p, data: null });
    const data = await api.get<Preview>(`/api/playlists/${p.id}/preview`);
    setPreview({ p, data });
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setForm((f) => ({ ...f, content: "", name: f.name || file.name.replace(/\.m3u8?$/i, "") }));
    const text = await file.text();
    setForm((f) => ({ ...f, content: text }));
  };

  return (
    <>
      <PageHeader
        title="Listas M3U"
        description="Cadastre as fontes de canais que serao entregues aos clientes"
        action={
          <Button variant="gradient" onClick={openNew}>
            <Plus /> Nova lista
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<ListVideo className="h-6 w-6" />}
          title="Nenhuma lista cadastrada"
          text="Adicione uma URL M3U, um servidor Xtream Codes ou cole o conteudo de uma lista."
          action={
            <Button variant="gradient" onClick={openNew}>
              <Plus /> Adicionar lista
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const Icon = kinds.find((k) => k.value === p.kind)!.icon;
            return (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  {p.active ? <Badge variant="success">Ativa</Badge> : <Badge variant="muted">Inativa</Badge>}
                </div>
                <h3 className="mt-4 font-semibold">{p.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {kindLabel(p.kind)} · {p.kind === "m3u_url" ? p.url : p.kind === "xtream" ? p.xtream_server : `${p.channel_count} canais`}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {p.client_count} cliente(s) usando · {p.playback === "proxy" ? "via servidor" : "direto da fonte"}
                </p>
                <div className="mt-4 flex gap-2 border-t pt-4">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openPreview(p)}>
                    <Eye /> Testar
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title="Editar">
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" className="hover:text-destructive" onClick={() => remove(p)} title="Excluir">
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar lista" : "Nova lista"} wide>
        <form onSubmit={save} className="space-y-5">
          <Field label="Nome da lista">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Canais abertos" required />
          </Field>

          <div className="grid gap-2 sm:grid-cols-3">
            {kinds.map(({ value, label, desc, icon: Icon }) => (
              <button
                type="button"
                key={value}
                onClick={() => setForm({ ...form, kind: value })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  form.kind === value ? "border-primary bg-primary/10" : "hover:bg-muted/40",
                )}
              >
                <Icon className={cn("mb-2 h-4 w-4", form.kind === value && "text-primary")} />
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </button>
            ))}
          </div>

          {form.kind === "m3u_url" && (
            <Field label="URL da lista M3U">
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://exemplo.com/lista.m3u" />
            </Field>
          )}
          {form.kind === "xtream" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Servidor">
                <Input value={form.xtream_server} onChange={(e) => setForm({ ...form, xtream_server: e.target.value })} placeholder="http://servidor:8080" />
              </Field>
              <Field label="Usuario">
                <Input value={form.xtream_username} onChange={(e) => setForm({ ...form, xtream_username: e.target.value })} />
              </Field>
              <Field label="Senha">
                <Input value={form.xtream_password} onChange={(e) => setForm({ ...form, xtream_password: e.target.value })} />
              </Field>
            </div>
          )}
          {form.kind === "manual" && (
            <Field label="Conteudo M3U" hint="Formato: #EXTINF:-1 tvg-logo=&quot;...&quot; group-title=&quot;Grupo&quot;,Nome do canal — e na linha seguinte a URL do stream">
              <Textarea rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              <Input type="file" accept=".m3u,.m3u8,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
            </Field>
          )}

          <Field label="URL do EPG (opcional)" hint="Guia de programacao XMLTV, enviado no cabecalho da lista">
            <Input value={form.epg_url} onChange={(e) => setForm({ ...form, epg_url: e.target.value })} placeholder="https://exemplo.com/epg.xml" />
          </Field>

          <Field label="Reproducao no navegador">
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["direct", "Direto da fonte", "Nao gasta banda do servidor (recomendado no plano gratis). Exige link https com CORS liberado."],
                  ["proxy", "Pelo servidor (proxy)", "Toca links http e sem CORS, mas o video passa pelo servidor e consome banda."],
                ] as const
              ).map(([value, label, desc]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setForm({ ...form, playback: value })}
                  className={cn("rounded-lg border p-3 text-left transition-colors", form.playback === value ? "border-primary bg-primary/10" : "hover:bg-muted/40")}
                >
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm font-medium">Lista ativa</span>
            <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient" disabled={busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!preview} onClose={() => setPreview(null)} title={`Teste: ${preview?.p.name ?? ""}`} wide>
        {!preview?.data ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando lista...
          </div>
        ) : !preview.data.ok ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            Falha ao carregar: {preview.data.error}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{preview.data.channel_count} canais</Badge>
              <Badge>{preview.data.groups?.length} grupos</Badge>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <ul className="divide-y text-sm">
                {preview.data.entries?.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    {e.logo ? (
                      <img src={e.logo} alt="" className="h-7 w-7 rounded object-contain" loading="lazy" />
                    ) : (
                      <div className="h-7 w-7 rounded bg-muted" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{e.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{e.group || "Sem grupo"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {(preview.data.channel_count ?? 0) > (preview.data.entries?.length ?? 0) && (
              <p className="text-xs text-muted-foreground">Mostrando os primeiros {preview.data.entries?.length} canais.</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
