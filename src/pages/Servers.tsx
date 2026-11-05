import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRightLeft, CheckCircle2, Clock, Link2, Loader2, Plus, RefreshCw, Server, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, Input, Skeleton, StatCard } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

type State = "online" | "slow" | "problem" | "offline" | "unknown";

type ServerRow = {
  server: string;
  host: string;
  clients: { id: string; name: string; username: string }[];
  state: State;
  ms: number | null;
  http: number;
  reason: string;
  checked_at: string | null;
  since: string | null;
  last_ok_at: string | null;
  last_down_at: string | null;
  history: { t: number; ms: number; c: number }[];
  uptime: number | null;
  avg_ms: number | null;
  checks: number;
  /** Servidores irmaos (mesmo painel, outro endereco). */
  siblings: string[];
  /** Fora do ar: os clientes estao usando este irmao. */
  failover_to: string | null;
};

type Monitor = { checked_at: string | null; monitor_at: string | null; every_seconds: number; slow_ms: number; servers: ServerRow[] };

const LABEL: Record<State, string> = { online: "No ar", slow: "Lento", problem: "Com problema", offline: "Fora do ar", unknown: "Aguardando teste" };
const VARIANT: Record<State, "success" | "warning" | "danger" | "muted"> = { online: "success", slow: "warning", problem: "warning", offline: "danger", unknown: "muted" };
const DOT: Record<State, string> = { online: "bg-success", slow: "bg-warning", problem: "bg-warning", offline: "bg-destructive", unknown: "bg-muted-foreground/40" };

/** "há 3 min", "há 2 h", "há 1 dia". */
function ago(iso: string | null, now: number) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

const hostOf = (origin: string) => origin.replace(/^https?:\/\//, "");

const secs = (ms: number | null) => (ms == null || ms < 0 ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Ultimas 24 h em 48 blocos de 30 min: vermelho se caiu, amarelo se ficou lento/com problema. */
function Timeline({ history, now }: { history: ServerRow["history"]; now: number }) {
  const bars = useMemo(() => {
    const out: (number | null)[] = Array(48).fill(null);
    const start = now - 24 * 3600_000;
    for (const x of history) {
      const i = Math.floor((x.t * 1000 - start) / (30 * 60_000));
      if (i < 0 || i > 47) continue;
      // pior estado do bloco: fora (0) > problema/lento (2,3) > no ar (1)
      const rank = (c: number | null) => (c == null ? -1 : c === 0 ? 3 : c === 1 ? 1 : 2);
      if (rank(x.c) > rank(out[i])) out[i] = x.c;
    }
    return out;
  }, [history, now]);
  return (
    <div>
      <div className="flex h-7 items-end gap-[2px]" aria-label="Últimas 24 horas">
        {bars.map((c, i) => (
          <div
            key={i}
            className={cn("h-full flex-1 rounded-[2px]", c == null ? "bg-muted" : c === 0 ? "bg-destructive" : c === 1 ? "bg-success" : "bg-warning")}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>24 h atrás</span>
        <span>agora</span>
      </div>
    </div>
  );
}

function ServerCard({ s, now, onSiblings }: { s: ServerRow; now: number; onSiblings: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="relative mt-1.5 flex h-3 w-3 shrink-0">
          {s.state === "offline" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />}
          <span className={cn("relative inline-flex h-3 w-3 rounded-full", DOT[s.state])} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{s.host}</h3>
            <Badge variant={VARIANT[s.state]}>{LABEL[s.state]}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {s.state === "unknown" ? "Ainda não testado" : `${LABEL[s.state]} desde ${ago(s.since, now)}`} · testado {ago(s.checked_at, now)}
          </p>
          {s.reason && <p className={cn("mt-1 text-xs", s.state === "offline" ? "text-destructive" : "text-warning")}>{s.reason}</p>}
        </div>
      </div>

      {s.failover_to && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
          Clientes passaram sozinhos para o irmão {hostOf(s.failover_to)}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-muted/50 p-2">
          <div className="text-[11px] text-muted-foreground">Resposta</div>
          <div className="text-sm font-semibold tabular-nums">{s.state === "offline" ? "—" : secs(s.ms)}</div>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <div className="text-[11px] text-muted-foreground">No ar (24 h)</div>
          <div className="text-sm font-semibold tabular-nums">{s.uptime == null ? "—" : `${s.uptime}%`}</div>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <div className="text-[11px] text-muted-foreground">Média</div>
          <div className="text-sm font-semibold tabular-nums">{secs(s.avg_ms)}</div>
        </div>
      </div>

      <div className="mt-4">
        <Timeline history={s.history} now={now} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <button type="button" className="flex items-center gap-1.5 hover:text-foreground" onClick={() => setOpen((v) => !v)}>
          <Users className="h-3.5 w-3.5" />
          {s.clients.length ? `${s.clients.length} ${s.clients.length === 1 ? "cliente" : "clientes"} ${open ? "▴" : "▾"}` : "Só irmão (sem cliente)"}
        </button>
        <button type="button" className="flex items-center gap-1.5 hover:text-foreground" onClick={onSiblings}>
          <Link2 className="h-3.5 w-3.5" />
          {s.siblings.length ? `Irmãos: ${s.siblings.map(hostOf).join(", ")}` : "Ligar irmão"}
        </button>
        {s.last_down_at && s.state !== "offline" && <span>Última queda {ago(s.last_down_at, now)}</span>}
        {s.state === "offline" && s.last_ok_at && <span>Último teste bom {ago(s.last_ok_at, now)}</span>}
      </div>
      {open && s.clients.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {s.clients.map((c) => (
            <li key={c.id} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Escolhe os irmaos de um servidor: outros servidores da lista ou um endereco novo colado. */
function SiblingsDialog({ server, all, onClose, onSave }: { server: ServerRow | null; all: ServerRow[]; onClose: () => void; onSave: (server: string, siblings: string[]) => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPicked(server?.siblings || []);
    setLink("");
  }, [server]);
  if (!server) return null;
  const others = [...new Set([...all.map((x) => x.server).filter((x) => x !== server.server), ...picked])];
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const add = () => {
    let raw = link.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
    try {
      const o = new URL(raw).origin.toLowerCase();
      if (o === server.server) return toast.error("Esse é o próprio servidor");
      setPicked((p) => (p.includes(o) ? p : [...p, o]));
      setLink("");
    } catch {
      toast.error("Endereço inválido. Ex.: http://servidor2.com:8080");
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(server.server, picked);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Irmãos de ${server.host}`}
      description="Servidores irmãos são o mesmo painel do fornecedor em outro endereço: os usuários funcionam em todos. Se este cair, os clientes passam sozinhos para um irmão que esteja no ar, e o vídeo que falhar já tenta o irmão na hora."
      icon={<Link2 className="h-6 w-6 text-primary" />}
    >
      <div className="space-y-2">
        {others.length === 0 && <p className="text-sm text-muted-foreground">Nenhum outro servidor ainda. Cole o endereço do irmão abaixo.</p>}
        {others.map((o) => {
          const row = all.find((x) => x.server === o);
          return (
            <label key={o} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm hover:bg-muted/40">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.includes(o)} onChange={() => toggle(o)} />
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[row?.state || "unknown"])} />
              <span className="min-w-0 flex-1 truncate font-medium">{hostOf(o)}</span>
              {row && <span className="text-xs text-muted-foreground">{row.clients.length} cliente(s)</span>}
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <Input placeholder="Endereço do irmão (http://servidor2.com:8080)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button variant="outline" onClick={add} aria-label="Adicionar endereço">
          <Plus />
        </Button>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Salvar
        </Button>
      </div>
    </Dialog>
  );
}

export default function Servers() {
  const [data, setData] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<ServerRow | null>(null);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      setData(force ? await api.post<Monitor>("/api/servers/check") : await api.get<Monitor>("/api/servers/status"));
      setNow(Date.now());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Com a tela aberta, atualiza sozinha a cada minuto (o servidor so testa de novo a cada 5 min).
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  // Grupo novo = este servidor + os irmaos marcados; quem entrou sai do grupo antigo.
  const saveSiblings = async (server: string, siblings: string[]) => {
    const list = data?.servers || [];
    const groups: string[][] = [];
    const seen = new Set<string>();
    for (const r of list) {
      if (seen.has(r.server) || !r.siblings.length) continue;
      const g = [r.server, ...r.siblings];
      g.forEach((x) => seen.add(x));
      groups.push(g);
    }
    const mine = [server, ...siblings];
    const old = list.find((r) => r.server === server)?.siblings || [];
    const next = groups.map((g) => g.filter((x) => !mine.includes(x) && !(old.includes(x) && g.includes(server)))).filter((g) => g.length >= 2);
    if (siblings.length) next.push(mine);
    try {
      setData(await api.put<Monitor>("/api/servers/groups", { groups: next }));
      setNow(Date.now());
      toast.success(siblings.length ? "Irmãos salvos e testados" : "Irmãos removidos");
    } catch (err) {
      toast.error((err as Error).message);
      throw err;
    }
  };

  const list = data?.servers || [];
  const count = (st: State[]) => list.filter((s) => st.includes(s.state)).length;
  const auto = !!data?.monitor_at && now - Date.parse(data.monitor_at) < 20 * 60_000;

  return (
    <>
      <PageHeader
        title="Servidores"
        description="Teste dos servidores das listas dos clientes: se estão no ar, o tempo de resposta e as quedas das últimas 24 horas."
        action={
          <Button onClick={() => load(true)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Testar agora
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Servidores" value={data ? list.length : undefined} icon={<Server />} tone="primary" />
        <StatCard label="No ar" value={data ? count(["online"]) : undefined} icon={<CheckCircle2 />} tone="success" />
        <StatCard label="Lentos ou com problema" value={data ? count(["slow", "problem"]) : undefined} icon={<Activity />} tone="warning" />
        <StatCard label="Fora do ar" value={data ? count(["offline"]) : undefined} icon={<XCircle />} tone="destructive" />
      </div>

      {data && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Último teste {ago(data.checked_at, now)}.{" "}
          {auto
            ? `Teste automático a cada ${Math.round(data.every_seconds / 60)} min, mesmo com esta tela fechada.`
            : `Com esta tela aberta testa a cada ${Math.round(data.every_seconds / 60)} min (o teste automático pelo servidor de vídeo ainda não chegou).`}{" "}
          Acima de {data.slow_ms / 1000} s conta como lento.
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!data ? (
          [0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-7 w-full" />
            </Card>
          ))
        ) : list.length ? (
          list.map((s) => <ServerCard key={s.server} s={s} now={now} onSiblings={() => setEditing(s)} />)
        ) : (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              icon={<Server className="h-6 w-6" />}
              title="Nenhum servidor para testar"
              text="Os servidores aparecem aqui quando algum cliente tem lista por link M3U ou login Xtream."
            />
          </div>
        )}
      </div>
      <SiblingsDialog server={editing} all={list} onClose={() => setEditing(null)} onSave={saveSiblings} />
    </>
  );
}
