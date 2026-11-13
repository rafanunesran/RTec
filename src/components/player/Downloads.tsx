import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download as DownloadIcon, Loader2, Pause, Play, RotateCw, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { type Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Dialog, EmptyState } from "@/components/ui";
import Logo from "@/components/Logo";
import { getProgress, saveProgress } from "@/lib/progress";
import {
  deleteDownload,
  downloadId,
  formatBytes,
  isExpired,
  openDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  useDownloads,
  useDownloadsEnabled,
  type Download,
} from "@/lib/downloads";

const pct = (d: Download) => (d.size ? Math.min(100, Math.floor((d.done / d.size) * 100)) : 0);

/** Botao "Baixar" de um filme ou episodio (some com os downloads desligados ou na TV). */
export function DownloadButton({ account, item, title, compact }: { account: string; item: Channel; title: string; compact?: boolean }) {
  const enabled = useDownloadsEnabled();
  const { items } = useDownloads(account);
  const [busy, setBusy] = useState(false);
  const d = items.find((x) => x.id === downloadId(account, item));
  if (!enabled && !d) return null;
  if (item.kind !== "movie" && item.kind !== "series") return null;

  const click = async () => {
    if (d?.status === "downloading" || d?.status === "queued") return pauseDownload(d.id);
    if (d?.status === "done") return toast.info("Já está baixado. Veja em Downloads.");
    setBusy(true);
    try {
      await startDownload(account, item, title);
      toast.success("Baixando", { description: `${title}. Acompanhe em Downloads.` });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label =
    d?.status === "done"
      ? "Baixado"
      : d?.status === "downloading"
        ? `Baixando ${pct(d)}%`
        : d?.status === "queued"
          ? "Na fila"
          : d?.status === "paused"
            ? `Continuar (${pct(d)}%)`
            : d?.status === "error"
              ? "Tentar de novo"
              : "Baixar";
  const icon = busy ? (
    <Loader2 className="animate-spin" />
  ) : d?.status === "done" ? (
    <CheckCircle2 className="text-success" />
  ) : d?.status === "downloading" || d?.status === "queued" ? (
    <Loader2 className="animate-spin" />
  ) : (
    <DownloadIcon />
  );

  if (compact)
    return (
      <button
        onClick={click}
        title={label}
        aria-label={`${label}: ${title}`}
        className="relative rounded-lg p-3 text-muted-foreground transition-colors hover:text-foreground [&_svg]:h-4 [&_svg]:w-4"
      >
        {icon}
        {d && d.status !== "done" && d.size > 0 && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold tabular-nums">{pct(d)}%</span>}
      </button>
    );
  return (
    <Button variant="outline" onClick={click} disabled={busy}>
      {icon} {label}
    </Button>
  );
}

/** Lista dos downloads da conta: progresso, pausar, continuar, apagar e assistir. */
function DownloadList({ account, onWatch }: { account?: string; onWatch: (d: Download) => void }) {
  const { loaded, items } = useDownloads(account);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ usage: e.usage || 0, quota: e.quota || 0 }))
      .catch(() => {});
  }, [items.length]);
  const used = items.reduce((n, d) => n + d.done, 0);

  if (!loaded)
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  if (!items.length)
    return <EmptyState icon={<DownloadIcon />} title="Nenhum download" text="Abra um filme ou episódio e toque em Baixar para assistir sem internet." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {formatBytes(used)} usados{usage?.quota ? ` · cerca de ${formatBytes(Math.max(0, usage.quota - usage.usage))} livres` : ""}. Os vídeos ficam guardados só
        dentro do app e precisam que o aparelho se conecte à internet de vez em quando para continuar valendo.
      </p>
      <ul className="space-y-2">
        {items.map((d) => {
          const expired = isExpired(d);
          const left = Math.ceil((Date.parse(d.valid_until) - Date.now()) / 86400_000);
          return (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border p-2">
              <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {d.item.cover || d.item.logo ? (
                  <img src={d.item.cover || d.item.logo} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : (
                  <DownloadIcon className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{d.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.status === "done"
                    ? expired
                      ? "Venceu: conecte à internet para renovar"
                      : `${formatBytes(d.size)} · vale por mais ${left} dia${left > 1 ? "s" : ""}`
                    : d.status === "error"
                      ? d.error || "Falha ao baixar"
                      : d.status === "paused"
                        ? `Pausado · ${formatBytes(d.done)}${d.size ? ` de ${formatBytes(d.size)}` : ""}`
                        : d.status === "queued"
                          ? "Na fila"
                          : `Baixando · ${formatBytes(d.done)}${d.size ? ` de ${formatBytes(d.size)}` : ""}`}
                </div>
                {d.status !== "done" && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", d.status === "error" ? "bg-destructive" : "bg-primary")} style={{ width: `${pct(d)}%` }} />
                  </div>
                )}
              </div>
              {d.status === "done" ? (
                <Button size="sm" variant="gradient" disabled={expired} onClick={() => onWatch(d)} aria-label={`Assistir ${d.title}`}>
                  <Play className="fill-current" />
                </Button>
              ) : d.status === "downloading" || d.status === "queued" ? (
                <Button size="sm" variant="outline" onClick={() => pauseDownload(d.id)} aria-label="Pausar">
                  <Pause />
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => resumeDownload(d.id)} aria-label="Continuar">
                  <RotateCw />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => deleteDownload(d.id)} aria-label={`Apagar ${d.title}`}>
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Toca um download guardado no aparelho (sem internet), continuando de onde parou. */
export function OfflineVideo({ download, onClose }: { download: Download; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    openDownload(download.id)
      .then((r) => {
        url = r.url;
        setSrc(r.url);
      })
      .catch((err) => {
        toast.error((err as Error).message);
        onClose();
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [download.id, onClose]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const pr = getProgress(download.item);
    const onMeta = () => {
      if (pr && pr.p > 5 && pr.p < v.duration - 30) v.currentTime = pr.p;
    };
    let last = 0;
    const onTime = () => {
      if (Math.abs(v.currentTime - last) < 10) return;
      last = v.currentTime;
      saveProgress(download.item, v.currentTime, v.duration);
    };
    const onError = () => toast.error("Este aparelho não conseguiu tocar o arquivo baixado (formato não suportado).");
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("error", onError);
    return () => {
      if (v.duration) saveProgress(download.item, v.currentTime, v.duration);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("error", onError);
    };
  }, [src, download.item]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center gap-2 p-2 pt-[max(8px,env(safe-area-inset-top))] text-white">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/10 hover:text-white">
          <ArrowLeft /> Voltar
        </Button>
        <span className="truncate text-sm font-semibold">{download.title}</span>
      </div>
      {src ? (
        <video ref={ref} src={src} controls autoPlay playsInline className="min-h-0 w-full flex-1 bg-black object-contain" />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
    </div>
  );
}

export function DownloadsDialog({ open, onClose, account }: { open: boolean; onClose: () => void; account: string }) {
  const [watching, setWatching] = useState<Download | null>(null);
  return (
    <>
      <Dialog open={open && !watching} onClose={onClose} title="Downloads" description="Filmes e episódios guardados neste aparelho para assistir sem internet." wide>
        <DownloadList account={account} onWatch={setWatching} />
      </Dialog>
      {watching && <OfflineVideo download={watching} onClose={() => setWatching(null)} />}
    </>
  );
}

/** Sem internet ao abrir o app: mostra so os downloads guardados. */
export function OfflinePage({ onRetry }: { onRetry: () => void }) {
  const [watching, setWatching] = useState<Download | null>(null);
  return (
    <div className="min-h-[100dvh]">
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Logo />
          <Button variant="outline" size="sm" className="ml-auto" onClick={onRetry}>
            <RotateCw /> Tentar conectar
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="flex items-start gap-3 rounded-2xl border bg-card p-4">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <h1 className="font-bold">Você está sem internet</h1>
            <p className="mt-1 text-sm text-muted-foreground">Dá para assistir os filmes e episódios que você baixou.</p>
          </div>
        </div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <DownloadIcon className="h-5 w-5" /> Downloads
        </h2>
        <DownloadList onWatch={setWatching} />
      </main>
      {watching && <OfflineVideo download={watching} onClose={() => setWatching(null)} />}
    </div>
  );
}
