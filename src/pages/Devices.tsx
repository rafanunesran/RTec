import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { BellRing, Check, Info, MonitorSmartphone, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Device, type PendingDevice } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button, Card, Dialog, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

type Form = { client_id: string; mac: string; device_key: string; label: string };
const emptyForm: Form = { client_id: "", mac: "", device_key: "", label: "" };

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [editing, setEditing] = useState<Device | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [params, setParams] = useSearchParams();
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api
      .get<Device[]>("/api/devices")
      .then(setDevices)
      .finally(() => setLoaded(true));
    api.get<PendingDevice[]>("/api/devices/pending").then(setPending);
  };
  useEffect(() => {
    load();
    api.get<Client[]>("/api/clients").then(setClients);
  }, []);

  // Link do QR code do reprodutor: /admin/dispositivos?id=...&key=...
  useEffect(() => {
    const id = params.get("id");
    if (!id || !clients.length) return;
    setEditing(null);
    setForm({ client_id: String(clients[0].id), mac: id, device_key: params.get("key") || "", label: "" });
    setOpen(true);
    setParams({}, { replace: true });
  }, [params, clients, setParams]);

  const activate = (p: PendingDevice) => {
    setEditing(null);
    setForm({ client_id: clients[0] ? String(clients[0].id) : "", mac: p.device_id, device_key: p.device_key, label: "" });
    setOpen(true);
  };

  const dismiss = async (p: PendingDevice) => {
    await api.del(`/api/devices/pending/${encodeURIComponent(p.device_id)}`);
    load();
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, client_id: clients[0] ? String(clients[0].id) : "" });
    setOpen(true);
  };

  const openEdit = (d: Device) => {
    setEditing(d);
    setForm({ client_id: String(d.client_id), mac: d.mac, device_key: d.device_key, label: d.label });
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/api/devices/${editing.id}`, form);
      else await api.post("/api/devices", form);
      toast.success("Dispositivo salvo");
      setOpen(false);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (d: Device) => {
    if (!confirm(`Remover o dispositivo ${d.mac}?`)) return;
    await api.del(`/api/devices/${d.id}`);
    load();
  };

  const actions = (d: Device) => (
    <div className="flex justify-end gap-1">
      <Button size="icon-sm" variant="ghost" onClick={() => openEdit(d)} title="Editar" aria-label="Editar">
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => remove(d)} title="Remover" aria-label="Remover">
        <Trash2 />
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Dispositivos"
        description="Ative aparelhos pelo Device ID e Device Key"
        action={
          <Button variant="gradient" onClick={openNew} disabled={!clients.length}>
            <Plus /> Ativar dispositivo
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-warning">
            <BellRing className="h-4 w-4" /> Aguardando ativação
            <span className="rounded-full bg-warning/20 px-2 text-xs tabular-nums">{pending.length}</span>
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aparelho aguardando. Eles aparecem aqui quando o cliente abre "Código do aparelho".</p>
          ) : (
            <ul className="space-y-2">
              {pending.map((p) => (
                <li key={p.device_id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-semibold">{p.device_id}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      Chave <span className="font-mono text-foreground">{p.device_key}</span> · {formatDate(p.created_at)}
                    </div>
                    {p.user_agent && <div className="hidden truncate text-[11px] text-muted-foreground/70 md:block">{p.user_agent}</div>}
                  </div>
                  <Button size="sm" variant="gradient" onClick={() => activate(p)} disabled={!clients.length}>
                    <Check /> Ativar
                  </Button>
                  <Button size="icon-sm" variant="ghost" title="Descartar" aria-label="Descartar" onClick={() => dismiss(p)}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Info className="h-4 w-4 text-brand2" /> Como ativar
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              No reprodutor, o cliente escolhe <b className="text-foreground">Código do aparelho</b> e vê o Device ID, a Device Key e um QR code.
            </li>
            <li>Escaneie o QR (abre esta tela já preenchida) ou clique em <b className="text-foreground">Ativar</b> no aparelho aguardando.</li>
            <li>O aparelho entra sozinho em alguns segundos.</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Apps externos podem consultar <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">/api/device/playlists?mac=ID&amp;key=CHAVE</code>.
          </p>
        </Card>
      </div>

      {!loaded ? (
        <Card className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone className="h-6 w-6" />}
          title="Nenhum dispositivo ativado"
          text={clients.length ? "Vincule a TV ou TV Box do cliente pelo Device ID exibido no app." : "Crie um cliente antes de ativar dispositivos."}
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Device ID</th>
                  <th className="px-4 py-3 font-semibold">Chave</th>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Descrição</th>
                  <th className="hidden px-4 py-3 font-semibold lg:table-cell">Visto por último</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {devices.map((d) => (
                  <tr key={d.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono text-xs">{d.mac}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.device_key}</td>
                    <td className="px-4 py-3 font-semibold">{d.client_name || d.client_username}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.label || "—"}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(d.last_seen_at)}</td>
                    <td className="px-4 py-3">{actions(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="space-y-3 md:hidden">
            {devices.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{d.client_name || d.client_username}</div>
                    <div className="truncate text-xs text-muted-foreground">{d.label || "Sem descrição"}</div>
                  </div>
                  {actions(d)}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Device ID</div>
                    <div className="truncate font-mono">{d.mac}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Chave</div>
                    <div className="truncate font-mono">{d.device_key}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar dispositivo" : "Ativar dispositivo"}
        description="Vincule o aparelho a um cliente."
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Cliente">
            <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ? `${c.name} (@${c.username})` : c.username}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device ID (MAC)">
              <Input value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })} placeholder="00:1A:2B:3C:4D:5E" className="font-mono text-xs" required />
            </Field>
            <Field label="Device Key" hint="Vazio = gerar automaticamente">
              <Input value={form.device_key} onChange={(e) => setForm({ ...form, device_key: e.target.value })} className="font-mono" />
            </Field>
          </div>
          <Field label="Descrição">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="TV da sala" />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient">Salvar</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
