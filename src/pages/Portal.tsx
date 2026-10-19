import { useState, type FormEvent } from "react";
import { CalendarClock, ListVideo, Loader2, LogOut, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type PortalData } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import Logo from "@/components/Logo";
import CopyRow from "@/components/CopyRow";

export default function Portal() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setData(await api.post<PortalData>("/api/portal/login", { username, password }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-pink-600/25 blur-3xl" />
        <Card className="relative w-full max-w-md p-8">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <Logo subtitle="Area do cliente" />
            <p className="text-sm text-muted-foreground">Entre com o usuario e senha recebidos para ver suas listas</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Usuario">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </Field>
            <Field label="Senha">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button variant="gradient" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Acessar
            </Button>
          </form>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <Logo subtitle="Area do cliente" />
        <Button variant="ghost" size="sm" onClick={() => setData(null)}>
          <LogOut /> Sair
        </Button>
      </div>

      <h1 className="text-2xl font-bold">Ola, {data.name || data.username}!</h1>
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarClock className="h-4 w-4" />
        {data.expires_at ? `Acesso valido ate ${formatDate(data.expires_at)}` : "Acesso sem data de expiracao"}
      </div>

      <Card className="mt-6 space-y-4 p-6">
        <h2 className="font-semibold">Sua lista M3U</h2>
        <CopyRow label="Link M3U" value={data.links.m3u_token} />
        <div className="grid gap-4 sm:grid-cols-3">
          <CopyRow label="Servidor" value={data.links.server} />
          <CopyRow label="Usuario" value={data.username} />
          <CopyRow label="Senha" value={password} />
        </div>
        <p className="text-xs text-muted-foreground">
          No seu app IPTV escolha "Adicionar lista / URL M3U" e cole o link acima.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <ListVideo className="h-4 w-4 text-primary" /> Pacotes liberados
          </div>
          <div className="flex flex-wrap gap-2">
            {data.playlists.length ? data.playlists.map((p) => <Badge key={p.id}>{p.name}</Badge>) : <span className="text-sm text-muted-foreground">Nenhum</span>}
          </div>
        </Card>
        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <MonitorSmartphone className="h-4 w-4 text-primary" /> Dispositivos ({data.devices.length}/{data.max_devices})
          </div>
          {data.devices.length ? (
            <ul className="space-y-1 text-sm">
              {data.devices.map((d) => (
                <li key={d.mac} className="flex justify-between">
                  <span className="font-mono text-xs">{d.mac}</span>
                  <span className="text-muted-foreground">{d.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-muted-foreground">Nenhum dispositivo ativado</span>
          )}
        </Card>
      </div>
    </div>
  );
}
