import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ListVideo, MonitorSmartphone, UserCheck, UserX, Users } from "lucide-react";
import { api, type Stats } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/stats").then(setStats).catch(() => {});
  }, []);

  const cards = [
    { label: "Clientes", value: stats?.clients, icon: Users, to: "/clientes" },
    { label: "Ativos", value: stats?.active_clients, icon: UserCheck, to: "/clientes" },
    { label: "Expirados", value: stats?.expired_clients, icon: UserX, to: "/clientes" },
    { label: "Listas M3U", value: stats?.playlists, icon: ListVideo, to: "/listas" },
    { label: "Dispositivos", value: stats?.devices, icon: MonitorSmartphone, to: "/dispositivos" },
  ];

  return (
    <>
      <PageHeader title="Painel" description="Visao geral do seu servico IPTV" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to}>
            <Card className="p-5 transition-colors hover:border-primary/50">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm">{label}</span>
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-3 text-3xl font-bold">{value ?? "—"}</div>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-8 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Acessos recentes</h2>
        </div>
        {stats?.recent.length ? (
          <ul className="divide-y">
            {stats.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <span className="font-medium">{r.name || r.username}</span>
                  <span className="ml-2 text-muted-foreground">@{r.username}</span>
                </span>
                <span className="text-muted-foreground">{formatDate(r.last_access_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum acesso ainda. Crie um cliente e envie o link M3U para ele.</p>
        )}
      </Card>

      <Card className="mt-8 p-6">
        <h2 className="mb-3 font-semibold">Como funciona</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Cadastre suas fontes em <Link to="/listas" className="text-primary">Listas M3U</Link> (URL M3U, servidor Xtream ou conteudo colado).
          </li>
          <li>
            Crie um <Link to="/clientes" className="text-primary">cliente</Link> com login e senha, validade e as listas que ele pode acessar.
          </li>
          <li>Envie ao cliente o link M3U, ou o servidor + usuario + senha, para usar em qualquer app IPTV.</li>
          <li>
            Opcional: ative o aparelho do cliente pelo MAC e chave em <Link to="/dispositivos" className="text-primary">Dispositivos</Link>.
          </li>
        </ol>
      </Card>
    </>
  );
}
