import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Lock, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Input } from "@/components/ui";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-pink-600/20 blur-3xl" />
      <Card className="relative w-full max-w-md p-8">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold">Acesso do administrador</h1>
            <p className="text-sm text-muted-foreground">Gerencie clientes, logins e listas M3U</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Usuario">
            <div className="relative">
              <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
          </Field>
          <Field label="Senha">
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </Field>
          <Button variant="gradient" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          E cliente?{" "}
          <a href="/" className="font-medium text-primary hover:underline">
            Abrir o reprodutor
          </a>
        </p>
      </Card>
    </div>
  );
}
