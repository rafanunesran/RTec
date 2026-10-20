import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, ListVideo, UserCheck, UserX, Users } from "lucide-react";
import { api, type Stats } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Card, Skeleton, StatCard } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

const steps: [string, ReactNode][] = [
  [
    "Crie o cliente",
    <>
      Em <Link to="/admin/clientes" className="font-medium text-primary hover:underline">Clientes</Link>, defina login, senha e validade e cole a lista M3U
      dele (link, login Xtream ou o conteúdo do arquivo). Use "Testar lista" antes de salvar.
    </>,
  ],
  ["Envie o acesso", "Mande o endereço do site com o login e a senha: o cliente assiste no navegador e pode instalar o app no celular."],
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/stats").then(setStats).catch(() => {});
  }, []);

  const cards = [
    { label: "Clientes", value: stats?.clients, icon: <Users />, to: "/admin/clientes", tone: "primary" },
    { label: "Ativos", value: stats?.active_clients, icon: <UserCheck />, to: "/admin/clientes", tone: "success" },
    { label: "Expirados", value: stats?.expired_clients, icon: <UserX />, to: "/admin/clientes", tone: "destructive" },
    { label: "Com lista", value: stats?.playlists, icon: <ListVideo />, to: "/admin/clientes", tone: "info" },
  ] as const;

  return (
    <>
      <PageHeader title="Painel" description="Visão geral do seu serviço IPTV" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon, to, tone }) => (
          <Link key={label} to={to}>
            <StatCard label={label} value={value} icon={icon} tone={tone} />
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Activity className="h-4 w-4 text-primary" /> Acessos recentes
          </h2>
          {!stats ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : stats.recent.length ? (
            <ul className="divide-y">
              {stats.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold uppercase">
                    {(r.name || r.username).slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.name || r.username}</div>
                    <div className="truncate text-xs text-muted-foreground">@{r.username}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.last_access_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum acesso ainda. Crie um cliente e envie o endereço do site com o login e a senha dele.</p>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-5 font-semibold">Como funciona</h2>
          <ol className="space-y-5">
            {steps.map(([title, text], i) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-sm text-muted-foreground">{text}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
