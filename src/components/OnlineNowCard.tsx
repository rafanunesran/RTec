import { useEffect, useState } from "react";
import { Monitor, MonitorPlay, Smartphone, Tv, Users } from "lucide-react";
import { api, type OnlineNow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Card, IconTile, Skeleton } from "@/components/ui";

const REFRESH_MS = 30_000;
const KIND_ICON = { tv: Tv, phone: Smartphone, computer: Monitor };

/** "ha 12 min" / "ha 1 h 5 min" desde a hora dada. */
function since(iso: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Painel: quantos clientes estao com o app aberto e quantas telas estao com video agora. */
export default function OnlineNowCard() {
  const [data, setData] = useState<OnlineNow | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      api
        .get<OnlineNow>("/api/admin/online")
        .then((d) => alive && setData(d))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const ready = data?.configured && data.ok ? data : null;

  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="relative flex h-2.5 w-2.5">
            {ready && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", ready ? "bg-success" : "bg-muted-foreground/40")} />
          </span>
          Usando agora
        </h2>
        <span className="text-xs text-muted-foreground">Atualiza sozinho a cada 30 s</span>
      </div>

      {data && !data.configured ? (
        <p className="text-sm text-muted-foreground">
          A contagem precisa do servidor de vídeo (Oracle, variável STREAM_PROXY_URL na Vercel). Sem ele não dá para saber quem está assistindo.
        </p>
      ) : data && data.configured && !data.ok ? (
        <p className="text-sm text-destructive">{data.error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 rounded-xl border p-4">
              <IconTile icon={<Users />} tone="primary" />
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Usuários</div>
                {ready ? <div className="text-3xl font-bold tabular-nums">{ready.users}</div> : <Skeleton className="mt-1 h-8 w-12" />}
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border p-4">
              <IconTile icon={<MonitorPlay />} tone="success" />
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Telas assistindo</div>
                {ready ? <div className="text-3xl font-bold tabular-nums">{ready.screens}</div> : <Skeleton className="mt-1 h-8 w-12" />}
              </div>
            </div>
          </div>
          {ready && (
            <p className="mt-3 text-xs text-muted-foreground">
              {plural(ready.devices, "aparelho", "aparelhos")} com o app aberto: {ready.screens} com vídeo e {ready.devices - ready.screens} só navegando. Conta quem deu
              sinal nos últimos {Math.round(ready.window_seconds / 60)} min.
            </p>
          )}

          {ready && ready.clients.length > 0 && (
            <ul className="mt-4 divide-y border-t">
              {ready.clients.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold uppercase">{(c.name || c.username).slice(0, 2)}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{c.name || c.username}</div>
                      <div className="truncate text-xs text-muted-foreground">@{c.username}</div>
                    </div>
                    <Badge variant={c.screens ? "success" : "muted"} className="ml-auto shrink-0 sm:ml-0">
                      {c.screens ? plural(c.screens, "tela", "telas") : "Navegando"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-12 sm:max-w-[55%] sm:justify-end sm:pl-0">
                    {c.devices.map((d) => {
                      const Icon = KIND_ICON[d.kind] || Monitor;
                      return (
                        <span
                          key={d.id}
                          title={d.watching ? `Assistindo ${since(d.watching_since)}` : `App aberto ${since(d.since)}`}
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                            d.watching ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{d.name || "Aparelho"}</span>
                          <span className="shrink-0 opacity-75">· {d.watching ? `assistindo ${since(d.watching_since)}` : "navegando"}</span>
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {ready && ready.clients.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Ninguém com o app aberto agora.</p>}
        </>
      )}
    </Card>
  );
}
