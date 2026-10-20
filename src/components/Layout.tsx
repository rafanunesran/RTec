import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ExternalLink, LayoutDashboard, ListVideo, LogOut, Menu, MonitorSmartphone, Settings, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import Logo from "./Logo";

const nav = [
  { to: "/admin", label: "Painel", icon: LayoutDashboard },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/listas", label: "Listas M3U", icon: ListVideo },
  { to: "/admin/dispositivos", label: "Dispositivos", icon: MonitorSmartphone },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const initials = (admin?.username || "A").slice(0, 2).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col p-4">
      <div className="mb-8 flex items-center justify-between px-2 pt-1">
        <Logo />
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X />
        </Button>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/admin"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-sidebar-accent text-foreground ring-1 ring-sidebar-border" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                {label}
              </>
            )}
          </NavLink>
        ))}
        <a
          href="/"
          target="_blank"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir reprodutor
        </a>
      </nav>
      <div className="flex items-center gap-3 rounded-2xl border border-sidebar-border bg-card p-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{admin?.username}</div>
          <div className="truncate text-xs text-muted-foreground">Administrador</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={logout} className="hover:text-destructive" title="Sair" aria-label="Sair">
          <LogOut />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-in-left border-r border-sidebar-border bg-sidebar">{sidebar}</aside>
        </div>
      )}
      <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 lg:hidden">
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Abrir menu">
          <Menu />
        </Button>
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-6xl animate-fade-in px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
