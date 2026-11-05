import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, IconTile, Switch } from "@/components/ui";

type Security = { hide_links: boolean; active: boolean; video_server: boolean; sealed: boolean };

/** Links blindados: nenhum aparelho recebe o link do fornecedor (com usuario e senha da lista). */
export default function SecurityCard() {
  const [st, setSt] = useState<Security | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<Security>("/api/admin/security").then(setSt, (err) => toast.error((err as Error).message));
  }, []);

  const toggle = async (hide_links: boolean) => {
    setBusy(true);
    try {
      setSt(await api.put<Security>("/api/admin/security", { hide_links }));
      toast.success(hide_links ? "Links blindados ligados" : "Links blindados desligados");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const on = !!st?.hide_links;
  const waiting = on && !!st && !st.active;
  return (
    <Card className="max-w-lg p-6">
      <div className="flex items-start gap-3">
        <IconTile icon={on && !waiting ? <ShieldCheck /> : <ShieldAlert />} tone={on && !waiting ? "success" : waiting ? "warning" : "destructive"} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Links blindados</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ligado, nenhum aparelho (celular, app, TV ou navegador) recebe o link da lista com usuário e senha do fornecedor: o vídeo passa pelo
            servidor de vídeo (Oracle) com um link cifrado, que vale só para o cliente e vence sozinho. O vídeo nunca passa pela Vercel, então o
            limite gratuito dela não é gasto.
          </p>
          {st && !on && (
            <p className="mt-2 text-xs font-medium text-destructive">Desligado: o app Android e as TVs recebem o link direto do fornecedor, e quem souber olhar consegue copiar a lista.</p>
          )}
          {waiting && (
            <p className="mt-2 text-xs font-medium text-warning">
              Em espera: o servidor de vídeo (Oracle) não está configurado. Sem ele o vídeo teria de passar pela Vercel e estouraria o limite, então os
              aparelhos tocam como antes. A blindagem liga sozinha quando o servidor de vídeo estiver configurado.
            </p>
          )}
          {st && on && st.video_server && (
            <p className="mt-2 text-xs text-muted-foreground">Se alguma TV antiga parar de tocar, desligue para ela voltar a tocar direto do fornecedor.</p>
          )}
        </div>
        {st ? <Switch checked={on} onChange={(v) => !busy && void toggle(v)} label="Links blindados" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </div>
    </Card>
  );
}
