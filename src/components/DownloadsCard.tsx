import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, Field, IconTile, Select, Switch } from "@/components/ui";

type Downloads = { enabled: boolean; max_items: number; days: number; video_server: boolean };

/** Downloads offline: o cliente baixa filmes e episodios no celular, PC ou app Android para ver sem internet. */
export default function DownloadsCard() {
  const [st, setSt] = useState<Downloads | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<Downloads>("/api/admin/downloads").then(setSt, (err) => toast.error((err as Error).message));
  }, []);

  const save = async (patch: Partial<Downloads>, msg: string) => {
    setBusy(true);
    try {
      setSt(await api.put<Downloads>("/api/admin/downloads", patch));
      toast.success(msg);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const on = !!st?.enabled;
  return (
    <Card className="max-w-lg p-6">
      <div className="flex items-start gap-3">
        <IconTile icon={<Download />} tone={on ? "success" : "primary"} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Downloads offline</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ligado, o cliente pode baixar filmes e episódios no celular, no PC ou no app Android e assistir sem internet (TVs ficam de fora). O arquivo
            vem pelo servidor de vídeo (Oracle) com link cifrado, gasta a banda dele e ocupa uma conexão da lista enquanto baixa. Cada download vale
            alguns dias e renova quando o aparelho fica online; conta bloqueada, lista vencida ou chave desligada apagam os downloads dos aparelhos.
          </p>
          <p className="mt-2 text-xs font-medium text-warning">
            Baixar conteúdo das listas pode violar direitos autorais e os termos dos fornecedores. Ligue por sua conta e risco.
          </p>
          {st && on && !st.video_server && (
            <p className="mt-2 text-xs font-medium text-warning">Em espera: o servidor de vídeo (Oracle) não está configurado, então o botão Baixar não aparece.</p>
          )}
          {st && on && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Máximo por aparelho">
                <Select value={st.max_items} disabled={busy} onChange={(e) => void save({ max_items: Number(e.target.value) }, "Limite salvo")}>
                  {[1, 2, 3, 5, 10, 15, 20, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} download{n > 1 ? "s" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vale offline por">
                <Select value={st.days} disabled={busy} onChange={(e) => void save({ days: Number(e.target.value) }, "Validade salva")}>
                  {[1, 3, 7, 15, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} dia{n > 1 ? "s" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
        {st ? (
          <Switch checked={on} onChange={(v) => !busy && void save({ enabled: v }, v ? "Downloads ligados" : "Downloads desligados")} label="Downloads offline" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
    </Card>
  );
}
