import { useEffect, useRef, useState } from "react";
import { CalendarX2, Loader2, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, isListExpired, type ClientProfile } from "@/lib/api";
import { tvNavigationOn } from "@/lib/tvnav";
import { Button } from "@/components/ui";
import Logo from "@/components/Logo";

/** A lista do cliente venceu ou foi bloqueada no fornecedor. Libera sozinha quando o adm renovar. */
export default function ListExpired({ onRenewed, onLogout }: { onRenewed: (p: ClientProfile) => void; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  const retryRef = useRef<HTMLButtonElement>(null);

  // Na TV o foco ja fica em "Tentar novamente" (o controle so precisa apertar OK).
  useEffect(() => {
    if (tvNavigationOn()) retryRef.current?.focus();
  }, []);

  const retry = async () => {
    setBusy(true);
    try {
      onRenewed(await api.get<ClientProfile>("/api/player/me?recheck=1"));
    } catch (err) {
      if (isListExpired(err)) toast.error("A lista continua expirada");
      else {
        toast.error((err as Error).message);
        if ((err as { status?: number }).status === 401) onLogout();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-tv-scope="10" className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative w-full max-w-md animate-rise-in text-center">
        <div className="mb-8 flex justify-center">
          <Logo className="scale-125" />
        </div>
        <div className="rounded-3xl border bg-card/80 p-6 shadow-card backdrop-blur-xl sm:p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
            <CalendarX2 className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold">Lista expirada</h1>
          <p className="mt-2 text-sm text-muted-foreground">Entre em contato com o adm para renovar. Assim que for renovada, o acesso volta sozinho.</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button ref={retryRef} variant="gradient" size="lg" className="w-full" disabled={busy} onClick={retry}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Tentar novamente
            </Button>
            <Button variant="ghost" className="w-full" onClick={onLogout}>
              <LogOut /> Sair
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
