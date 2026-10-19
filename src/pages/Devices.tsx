import { useEffect, useState, type FormEvent } from "react";
import { MonitorSmartphone, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Client, type Device } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button, Card, Dialog, EmptyState, Field, Input, Select } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

type Form = { client_id: string; mac: string; device_key: string; label: string };
const emptyForm: Form = { client_id: "", mac: "", device_key: "", label: "" };

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [editing, setEditing] = useState<Device | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const load = () => api.get<Device[]>("/api/devices").then(setDevices);
  useEffect(() => {
    load();
    api.get<Client[]>("/api/clients").then(setClients);
  }, []);

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

  return (
    <>
      <PageHeader
        title="Dispositivos"
        description="Ative aparelhos pelo endereco MAC e chave do dispositivo (modelo Duplecast)"
        action={
          <Button variant="gradient" onClick={openNew} disabled={!clients.length}>
            <Plus /> Ativar dispositivo
          </Button>
        }
      />

      <Card className="mb-6 p-4 text-sm text-muted-foreground">
        O app consulta <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">/api/device/playlists?mac=MAC&amp;key=CHAVE</code> e recebe a lista M3U do cliente vinculado.
      </Card>

      {devices.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone className="h-6 w-6" />}
          title="Nenhum dispositivo ativado"
          text={clients.length ? "Vincule a TV ou TV Box do cliente pelo MAC exibido no app." : "Crie um cliente antes de ativar dispositivos."}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">MAC</th>
                <th className="px-4 py-3 font-medium">Chave</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Descricao</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Visto por ultimo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{d.mac}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.device_key}</td>
                  <td className="px-4 py-3">{d.client_name || d.client_username}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{d.label || "—"}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatDate(d.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(d)} title="Editar">
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" className="hover:text-destructive" onClick={() => remove(d)} title="Remover">
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

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar dispositivo" : "Ativar dispositivo"}>
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
          <Field label="Endereco MAC">
            <Input value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })} placeholder="00:1A:2B:3C:4D:5E" className="font-mono" required />
          </Field>
          <Field label="Chave do dispositivo" hint="Deixe vazio para gerar automaticamente">
            <Input value={form.device_key} onChange={(e) => setForm({ ...form, device_key: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Descricao">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="TV da sala" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="gradient">Salvar</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
