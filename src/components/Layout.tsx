import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, Settings, Users, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import Logo from "./Logo";

const nav = [
  { to: "/admin", label: "Painel", icon: LayoutDashboard },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/configuracoes", label: "Configuracoes", icon: Settings },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-5">
      <Logo />
      <nav className="flex flex-1 flex-col gap-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/admin"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
        <a
          href="/"
          target="_blank"
          className="mt-2 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir reprodutor
        </a>
      </nav>
      <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
        <div className="text-sm">
          <div className="font-medium">{admin?.username}</div>
          <div className="text-xs text-muted-foreground">Administrador</div>
        </div>
        <button onClick={logout} className="text-muted-foreground hover:text-destructive" title="Sair">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-card/50 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r bg-card" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
