import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Server, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, IconTile } from "@/components/ui";
import { cn } from "@/lib/utils";

type Status = {
  configured: boolean;
  host?: string;
  ok?: boolean;
  error?: string;
  version?: string;
  started_at?: string;
  node?: string;
  ffmpeg?: { installed: boolean; version: string; fingerprint: boolean };
  streaming?: number;
  aac?: number;
  marks?: { queue: number; busy: boolean; done: number; found: number; errors: number; last_error: string; last_at: string };
  update_log?: string[];
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

function Row({ label, good, children }: { label: string; good?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-medium">
        {good === true && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
        {good === false && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
        {children}
      </span>
    </div>
  );
}

/** Situacao do servidor de video (Oracle): ffmpeg, analises do Pular intro e ultimas atualizacoes automaticas. */
export default function VideoServerCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setSt(await api.get<Status>("/api/admin/video-server"));
    } catch (err) {
      setSt({ configured: true, ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ff = st?.ffmpeg;
  const m = st?.marks;
  return (
    <Card className="max-w-lg p-6">
      <div className="mb-4 flex items-center gap-3">
        <IconTile icon={<Server />} tone={st?.ok ? "success" : st && st.configured ? "destructive" : "primary"} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Servidor de vídeo</h2>
          <p className="truncate text-xs text-muted-foreground">{st?.host || "Oracle (STREAM_PROXY_URL)"}</p>
        </div>
        <Button variant="outline" size="icon-sm" onClick={load} disabled={busy} aria-label="Atualizar">
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {!st ? (
        <p className="text-sm text-muted-foreground">Consultando…</p>
      ) : !st.configured ? (
        <p className="text-sm text-muted-foreground">Nenhum servidor de vídeo configurado (STREAM_PROXY_URL na Vercel).</p>
      ) : !st.ok ? (
        <p className="text-sm text-destructive">{st.error || "Sem resposta do servidor."}</p>
      ) : (
        <div>
          <Row label="Funcionando" good>
            desde {when(st.started_at)}
          </Row>
          <Row label="Versão do servidor">{st.version || "—"}</Row>
          <Row label="ffmpeg" good={!!ff?.installed}>
            {ff?.installed ? ff.version || "instalado" : "não instalado"}
          </Row>
          <Row label="Pular intro (análise do áudio)" good={!!ff?.fingerprint}>
            {ff?.fingerprint ? "pronto" : "indisponível"}
          </Row>
          <Row label="Vídeos passando agora">{st.streaming ?? 0}</Row>
          {m && (
            <>
              <Row label="Análises de episódios">
                {m.done} feitas · {m.found} com intro/créditos{m.errors ? ` · ${m.errors} com erro` : ""}
              </Row>
              <Row label="Na fila">{m.busy ? m.queue + 1 : m.queue}</Row>
              {m.last_error && <Row label="Último erro">{m.last_error}</Row>}
            </>
          )}
          {!!st.update_log?.length && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atualizações automáticas</div>
              <pre className={cn("max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground")}>{st.update_log.join("\n")}</pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
