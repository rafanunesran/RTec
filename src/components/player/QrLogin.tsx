import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, QrCode, RotateCw, Smartphone, Tv, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, isListExpired, type ClientProfile } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";
import Logo from "@/components/Logo";

type QrStart = { code: string; token: string; url: string; expires_at: string; svg: string };
type PollResult = { state: "waiting" } | { state: "ok"; profile: ClientProfile };

const POLL_MS = 3000;
/** "ABCDEFGH" -> "ABCD-EFGH" (mais facil de ler e digitar). */
export const prettyCode = (code: string) => code.replace(/^(.{4})(.{4})$/, "$1-$2");

/**
 * QR code da tela de entrar (TV/PC): o celular le, aprova e este aparelho entra sozinho.
 * Para de perguntar quando o codigo vence (10 min) para nao gastar o banco com uma TV parada na tela.
 */
export function QrLoginPanel({ onLogin, onExpired, className }: { onLogin: (p: ClientProfile) => void; onExpired: () => void; className?: string }) {
  const [qr, setQr] = useState<QrStart | null>(null);
  const [state, setState] = useState<"loading" | "waiting" | "expired" | "denied" | "error">("loading");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);
  const run = useRef(0);
  const done = useRef({ onLogin, onExpired });
  done.current = { onLogin, onExpired };

  const start = async () => {
    const id = ++run.current;
    setState("loading");
    try {
      const data = await api.post<QrStart>("/api/player/qr");
      if (id !== run.current) return;
      setQr(data);
      setState("waiting");
    } catch (err) {
      if (id !== run.current) return;
      setError((err as Error).message);
      setState("error");
    }
  };

  useEffect(() => {
    start();
    return () => {
      run.current++;
    };
  }, []);

  // Pergunta ao servidor se o celular ja aprovou (so com a tela visivel).
  useEffect(() => {
    if (state !== "waiting" || !qr) return;
    const id = run.current;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (id !== run.current) return;
      if (Date.parse(qr.expires_at) <= Date.now()) return setState("expired");
      if (document.visibilityState === "visible") {
        try {
          const r = await api.post<PollResult>("/api/player/qr/poll", { code: qr.code, token: qr.token });
          if (id !== run.current) return;
          if (r.state === "ok") {
            run.current++;
            return done.current.onLogin(r.profile);
          }
        } catch (err) {
          if (id !== run.current) return;
          if (isListExpired(err)) return done.current.onExpired();
          if (err instanceof ApiError && err.code === "qr_denied") return setState("denied");
          if (err instanceof ApiError && (err.code === "qr_expired" || err.status === 404 || err.status === 410)) return setState("expired");
          if (err instanceof ApiError && err.code === "blocked") {
            setError(err.message);
            return setState("error");
          }
          // Falha de rede: tenta de novo no proximo ciclo.
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => clearTimeout(timer);
  }, [state, qr]);

  useEffect(() => {
    if (state !== "waiting" || !qr) return;
    const upd = () => setLeft(Math.max(0, Math.round((Date.parse(qr.expires_at) - Date.now()) / 1000)));
    upd();
    const t = setInterval(upd, 1000);
    return () => clearInterval(t);
  }, [state, qr]);

  const host = qr ? new URL(qr.url).host : location.host;
  const stale = state === "expired" || state === "denied" || state === "error";

  return (
    <div className={className}>
      <div className="mb-4 flex items-center gap-2 text-base font-semibold">
        <QrCode className="h-5 w-5 text-primary" /> Entrar com o celular
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-[15rem] overflow-hidden rounded-2xl bg-white p-2 shadow-card">
        {qr && <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} alt="QR code para entrar" className={stale ? "h-full w-full opacity-10" : "h-full w-full"} />}
        {state === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
          </div>
        )}
        {stale && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm font-medium text-neutral-800">
            {state === "denied" ? "O acesso foi recusado no celular." : state === "error" ? error || "Não foi possível gerar o QR code." : "O QR code venceu."}
            <Button type="button" variant="gradient" size="sm" onClick={start}>
              <RotateCw /> Gerar novo QR code
            </Button>
          </div>
        )}
      </div>
      {qr && !stale && (
        <>
          <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <b className="text-foreground">1.</b> Aponte a câmera do celular para o código.
            </li>
            <li>
              <b className="text-foreground">2.</b> Confirme no celular. Pronto: esta tela entra sozinha.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Sem câmera? Abra <b className="text-foreground">{host}/q</b> e digite <b className="font-mono text-sm tracking-wider text-foreground">{prettyCode(qr.code)}</b>
            {left > 0 && <span> · vence em {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
          </p>
        </>
      )}
    </div>
  );
}

type QrInfo = { name: string; kind: string; expires_at: string };

/** Pagina /q/<codigo>: o celular aprova o aparelho que mostrou o QR code. */
export function QrApprovePage() {
  const fromUrl = location.pathname.match(/^\/q\/([A-Za-z0-9-]{4,20})\/?$/)?.[1] || "";
  const [code, setCode] = useState(fromUrl.toUpperCase());
  const [typed, setTyped] = useState("");
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [me, setMe] = useState<ClientProfile | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api
      .get<ClientProfile>("/api/player/me")
      .then((p) => setMe(p.device?.guest ? null : p))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!code) return;
    setError("");
    setInfo(null);
    api
      .post<QrInfo>("/api/player/qr/check", { code })
      .then(setInfo)
      .catch((err) => setError((err as Error).message));
  }, [code]);

  const approve = async (deny = false) => {
    setBusy(true);
    try {
      if (me) await api.post("/api/player/qr/approve", { code, deny });
      else await api.post("/api/player/qr/approve-login", { code, username, password });
      setDone(deny ? "denied" : "approved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = (e: FormEvent) => {
    e.preventDefault();
    approve();
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const c = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== 8) return toast.error("O código tem 8 letras e números, como ABCD-EF23.");
    setCode(c);
  };

  let body;
  if (done === "approved")
    body = (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
        <h1 className="mt-3 text-xl font-bold">Pronto!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {info?.name || "O aparelho"} vai entrar na sua conta em alguns segundos. Você pode fechar esta página.
        </p>
        <a href="/" className="mt-6 block">
          <Button variant="outline" className="w-full" type="button">
            Ir para o RTec
          </Button>
        </a>
      </div>
    );
  else if (done === "denied")
    body = (
      <div className="text-center">
        <X className="mx-auto h-14 w-14 text-destructive" />
        <h1 className="mt-3 text-xl font-bold">Acesso recusado</h1>
        <p className="mt-2 text-sm text-muted-foreground">O aparelho não entrou na sua conta.</p>
      </div>
    );
  else if (!code || error)
    body = (
      <form onSubmit={submitCode} className="space-y-4">
        <h1 className="text-lg font-bold">Entrar em uma TV</h1>
        {error && <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-warning">{error}</p>}
        <p className="text-sm text-muted-foreground">Digite o código que aparece na tela de entrar da TV ou do computador.</p>
        <Field label="Código">
          <Input
            className="h-12 text-center font-mono text-lg uppercase tracking-[0.3em]"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="ABCD-EF23"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
            required
          />
        </Field>
        <Button variant="gradient" size="lg" className="w-full">
          Continuar
        </Button>
      </form>
    );
  else if (!info || me === undefined)
    body = (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  else {
    const Icon = info.kind === "phone" ? Smartphone : Tv;
    body = (
      <div>
        <div className="flex items-center gap-3 rounded-2xl border bg-secondary/40 p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand text-white">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Pedindo para entrar</p>
            <p className="truncate font-semibold">{info.name}</p>
            <p className="text-xs text-muted-foreground">Código {prettyCode(code)}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Só confirme se este aparelho estiver na sua frente. Ele vai entrar na sua conta e aparecer em Dispositivos.</p>
        {me ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm">
              Conta: <b>{me.name || me.username}</b>
            </p>
            <Button variant="gradient" size="lg" className="w-full" disabled={busy} onClick={() => approve()}>
              {busy ? <Loader2 className="animate-spin" /> : <Tv />} Entrar no aparelho
            </Button>
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => approve(true)}>
              Não fui eu
            </Button>
          </div>
        ) : (
          <form onSubmit={submitLogin} className="mt-5 space-y-4">
            <p className="text-sm">Entre com o usuário e a senha que você recebeu. Este celular não fica logado.</p>
            <Field label="Usuário">
              <Input className="h-11" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
            </Field>
            <Field label="Senha">
              <Input className="h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Button variant="gradient" size="lg" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Tv />} Entrar no aparelho
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative w-full max-w-md animate-rise-in">
        <div className="mb-8 flex justify-center">
          <Logo className="scale-125" />
        </div>
        <div className="rounded-3xl border bg-card/80 p-6 shadow-card backdrop-blur-xl sm:p-8">{body}</div>
      </div>
    </div>
  );
}
