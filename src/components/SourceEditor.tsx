import { useState } from "react";
import { CheckCircle2, FileText, Globe, Loader2, Server, XCircle, Zap } from "lucide-react";
import { api, type Preview, type Source, type SourceKind } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { Button, Field, Input, OptionCard, Textarea } from "@/components/ui";

export const emptySource = (): Source => ({
  kind: "m3u_url",
  url: "",
  xtream_server: "",
  xtream_username: "",
  xtream_password: "",
  content: "#EXTM3U\n",
  epg_url: "",
  playback: "auto",
});

const kinds: { value: SourceKind; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "m3u_url", label: "Link M3U", desc: "Link da lista do fornecedor", icon: Globe },
  { value: "xtream", label: "Xtream Codes", desc: "Servidor + usuário + senha", icon: Server },
  { value: "manual", label: "Colar lista", desc: "Conteúdo do arquivo .m3u", icon: FileText },
];

export const sourceLabel = (s: Source | null) => (s ? kinds.find((k) => k.value === s.kind)?.label ?? "—" : "Sem lista");

/** Formulario da lista do cliente, com botao para testar antes de salvar. */
export default function SourceEditor({ value, onChange }: { value: Source; onChange: (s: Source) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const set = (patch: Partial<Source>) => {
    setResult(null);
    onChange({ ...value, ...patch });
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post<Preview>("/api/source/preview", value));
    } catch (err) {
      setResult({ ok: false, source: null, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const onFile = async (file?: File) => {
    if (file) set({ content: await file.text() });
  };

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="grid grid-cols-3 gap-2">
        {kinds.map(({ value: k, label, desc, icon: Icon }) => (
          <OptionCard key={k} active={value.kind === k} onClick={() => set({ kind: k })}>
            <Icon className={cn("mb-2 h-5 w-5", value.kind === k ? "text-primary" : "text-muted-foreground")} />
            <div className="text-sm font-semibold">{label}</div>
            <div className="hidden text-xs text-muted-foreground sm:block">{desc}</div>
          </OptionCard>
        ))}
      </div>

      {value.kind === "m3u_url" && (
        <Field label="Link da lista M3U">
          <Input value={value.url} onChange={(e) => set({ url: e.target.value })} placeholder="http://servidor:porta/get.php?username=...&password=...&type=m3u_plus" className="font-mono text-xs" />
        </Field>
      )}
      {value.kind === "xtream" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Servidor">
            <Input value={value.xtream_server} onChange={(e) => set({ xtream_server: e.target.value })} placeholder="http://servidor:8080" className="font-mono text-xs" />
          </Field>
          <Field label="Usuário">
            <Input value={value.xtream_username} onChange={(e) => set({ xtream_username: e.target.value })} />
          </Field>
          <Field label="Senha">
            <Input value={value.xtream_password} onChange={(e) => set({ xtream_password: e.target.value })} />
          </Field>
        </div>
      )}
      {value.kind === "manual" && (
        <Field label="Conteúdo da lista" hint="Cole o texto do arquivo .m3u ou escolha o arquivo (até ~900 KB)">
          <Textarea rows={8} className="text-xs" value={value.content} onChange={(e) => set({ content: e.target.value })} />
          <Input type="file" accept=".m3u,.m3u8,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      )}

      <Field label="Guia de programação / EPG (opcional)">
        <Input value={value.epg_url} onChange={(e) => set({ epg_url: e.target.value })} placeholder="http://servidor/xmltv.php?username=...&password=..." className="font-mono text-xs" />
      </Field>

      <Field label="Reprodução no navegador">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["auto", "Automático (recomendado)", "Links https tocam direto; links http passam pelo servidor."],
              ["direct", "Direto (só https)", "Links https tocam direto da fonte. Links http sempre passam pelo servidor."],
              ["proxy", "Sempre pelo servidor", "Toca tudo, mas todo o vídeo consome a banda da Vercel."],
            ] as const
          ).map(([mode, label, desc]) => (
            <OptionCard key={mode} active={value.playback === mode} onClick={() => set({ playback: mode })}>
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </OptionCard>
          ))}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={test} disabled={testing}>
          {testing ? <Loader2 className="animate-spin" /> : <Zap />} Testar lista
        </Button>
        {result &&
          (result.ok && result.xtream ? (
            <span className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Conta {result.xtream.status || "ok"}
              {result.xtream.expires_at && ` até ${formatDate(result.xtream.expires_at)}`} · {result.xtream.categories.live} categorias de canais ·{" "}
              {result.xtream.categories.movie} de filmes · {result.xtream.categories.series} de séries
              {result.xtream.max_connections && ` · ${result.xtream.max_connections} tela(s)`}
            </span>
          ) : result.ok ? (
            <span className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              {result.kinds?.live ?? 0} canais · {result.kinds?.movie ?? 0} filmes · {result.kinds?.series ?? 0} episódios{result.kinds?.radio ? ` · ${result.kinds.radio} rádios` : ""} · {result.groups?.length ?? 0} grupos
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" /> {result.error}
            </span>
          ))}
      </div>
    </div>
  );
}
