import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui";
import Logo from "@/components/Logo";

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from || "/admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative w-full max-w-sm animate-rise-in">
        <Logo className="mb-8 justify-center" />
        <form onSubmit={submit} className="space-y-4 rounded-3xl border bg-card/80 p-7 shadow-card backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-bold">Painel do revendedor</h1>
            <p className="text-sm text-muted-foreground">Entre para gerenciar clientes, logins e listas M3U.</p>
          </div>
          <Field label="Usuário">
            <Input className="h-11" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label="Senha">
            <Input className="h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Button variant="gradient" size="lg" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
            Entrar
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          É cliente?{" "}
          <a href="/" className="font-semibold text-foreground hover:text-primary">
            Abrir o reprodutor
          </a>
        </p>
      </div>
    </div>
  );
}
