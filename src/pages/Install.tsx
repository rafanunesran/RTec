import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, FileDown, Share, ShieldAlert, SquarePlus } from "lucide-react";
import { APK_URL } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/ui";
import Logo from "@/components/Logo";

// Passo a passo para o cliente instalar o app Android (APK) fora da Play Store.
// As "telas" sao desenhos simplificados dos avisos do Android, com o botao certo destacado.

/** Desenho de um celular com uma tela de aviso dentro. */
function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-[200px] shrink-0 rounded-[28px] border-4 border-zinc-700 bg-zinc-900 p-2 shadow-xl">
      <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-zinc-700" />
      <div className="flex min-h-[220px] flex-col justify-end overflow-hidden rounded-2xl bg-zinc-800 p-2 text-left">{children}</div>
    </div>
  );
}

/** Caixa de aviso do Android dentro do desenho do celular. */
function Sheet({ icon, title, text, buttons }: { icon?: ReactNode; title: string; text?: string; buttons: { label: string; tap?: boolean }[] }) {
  return (
    <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-900">
      {icon && <div className="mb-1.5 text-zinc-600">{icon}</div>}
      <div className="text-[12px] font-semibold leading-snug">{title}</div>
      {text && <div className="mt-1 text-[10px] leading-snug text-zinc-600">{text}</div>}
      <div className="mt-3 flex flex-wrap justify-end gap-1.5">
        {buttons.map((b) => (
          <span
            key={b.label}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold",
              b.tap ? "animate-pulse bg-blue-600 text-white ring-4 ring-amber-400" : "text-blue-700",
            )}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Toggle() {
  return (
    <div className="mb-2 rounded-2xl bg-zinc-100 p-3 text-zinc-900">
      <div className="text-[12px] font-semibold">Instalar apps desconhecidos</div>
      <div className="mt-1 text-[10px] text-zinc-600">Chrome</div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white p-2 ring-4 ring-amber-400">
        <span className="text-[11px] font-medium">Permitir desta fonte</span>
        <span className="relative h-4 w-7 animate-pulse rounded-full bg-blue-600">
          <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white" />
        </span>
      </div>
      <div className="mt-2 text-[10px] text-zinc-600">Depois toque em voltar ( ◁ ou deslize ).</div>
    </div>
  );
}

const steps: { title: string; text: ReactNode; screen: ReactNode }[] = [
  {
    title: "Baixe o app",
    text: (
      <>
        Toque no botão <b>Baixar app</b> acima. Se o Chrome perguntar se quer mesmo baixar, toque em <b>Baixar mesmo assim</b>. O arquivo é
        o nosso app, pode confiar.
      </>
    ),
    screen: (
      <Sheet
        icon={<FileDown className="h-4 w-4" />}
        title="Baixar rtec-tv.apk mesmo assim?"
        text="Esse tipo de arquivo pode danificar seu dispositivo."
        buttons={[{ label: "Cancelar" }, { label: "Baixar mesmo assim", tap: true }]}
      />
    ),
  },
  {
    title: "Abra o arquivo",
    text: (
      <>
        Quando terminar, toque em <b>Abrir</b>. Se a mensagem sumiu, abra o app <b>Arquivos</b> (ou <b>Meus arquivos</b>), entre em{" "}
        <b>Downloads</b> e toque em <b>rtec-tv.apk</b>.
      </>
    ),
    screen: <Sheet icon={<Download className="h-4 w-4" />} title="Download concluído" text="rtec-tv.apk · 10 MB" buttons={[{ label: "Abrir", tap: true }]} />,
  },
  {
    title: "Libere a instalação (só na primeira vez)",
    text: (
      <>
        O celular avisa que não instala apps “desta fonte”. Toque em <b>Configurações</b>, ligue <b>Permitir desta fonte</b> e volte. Em alguns
        celulares o nome é <b>Instalar apps desconhecidos</b>.
      </>
    ),
    screen: (
      <>
        <Toggle />
        <Sheet
          title="Por segurança, seu celular não pode instalar apps desta fonte."
          buttons={[{ label: "Cancelar" }, { label: "Configurações", tap: true }]}
        />
      </>
    ),
  },
  {
    title: "Toque em Instalar",
    text: <>Aparece o ícone do RTec TV perguntando se deseja instalar. Toque em <b>Instalar</b>.</>,
    screen: <Sheet title="RTec TV" text="Deseja instalar este app?" buttons={[{ label: "Cancelar" }, { label: "Instalar", tap: true }]} />,
  },
  {
    title: "Se aparecer o aviso do Play Protect",
    text: (
      <>
        O Google avisa sobre qualquer app que não veio da Play Store, não quer dizer que tenha vírus. Toque em <b>Mais detalhes</b> e depois em{" "}
        <b>Instalar mesmo assim</b>. Se perguntar se quer enviar o app para verificação, pode escolher qualquer opção.
      </>
    ),
    screen: (
      <Sheet
        icon={<ShieldAlert className="h-4 w-4" />}
        title="Bloqueado pelo Play Protect"
        text="O Play Protect não reconhece o desenvolvedor deste app. ▾ Mais detalhes"
        buttons={[{ label: "OK" }, { label: "Instalar mesmo assim", tap: true }]}
      />
    ),
  },
  {
    title: "Pronto!",
    text: (
      <>
        Toque em <b>Abrir</b>. O RTec TV fica na tela inicial junto com os outros apps. Nas próximas atualizações é só repetir os passos 1, 2 e 4.
      </>
    ),
    screen: <Sheet title="App instalado." buttons={[{ label: "Concluído" }, { label: "Abrir", tap: true }]} />,
  },
];

export default function Install() {
  const apk = typeof window !== "undefined" ? new URL(APK_URL, window.location.origin).href : APK_URL;
  return (
    <div className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <Link to="/" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Logo />
      </header>

      <h1 className="text-2xl font-extrabold tracking-tight">Como instalar o app no Android</h1>
      <p className="mt-2 text-muted-foreground">
        Leva 1 minuto. Como o app não vem da Play Store, o celular mostra alguns avisos. É normal: siga os passos e toque no botão destacado
        em amarelo.
      </p>
      <a href={APK_URL} download className="mt-5 block">
        <Button variant="gradient" className="w-full sm:w-auto" type="button">
          <Download /> Baixar app
        </Button>
      </a>

      <ol className="mt-8 space-y-5">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">{i + 1}</span>
                  <h2 className="font-bold">{s.title}</h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{s.text}</p>
              </div>
              <Phone>{s.screen}</Phone>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-8 p-5">
        <h2 className="font-bold">Não deu certo?</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <b>Samsung</b>: se aparecer “bloqueado pelo Bloqueador automático”, vá em <b>Configurações › Segurança e privacidade › Bloqueador
            automático</b>, desligue, instale o app e depois pode ligar de novo.
          </li>
          <li>
            <b>Xiaomi / Redmi / Poco</b>: pode aparecer uma “verificação de segurança” com contagem. Espere terminar e toque em{" "}
            <b>Continuar</b> / <b>Instalar</b>.
          </li>
          <li>
            <b>“App não instalado”</b> ao atualizar: desinstale a versão antiga e instale de novo.
          </li>
          <li>
            <b>TV Box e Fire TV</b>: no app <b>Downloader</b> (ou no navegador da TV Box) digite <b className="break-all">{apk}</b>. Os avisos
            são os mesmos: libere o Downloader em “fontes desconhecidas” e confirme a instalação.
          </li>
        </ul>
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-bold">iPhone / iPad</h2>
        <p className="mt-3 text-sm leading-relaxed">
          Não precisa baixar nada: abra o site no <b>Safari</b>, toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b>, depois em{" "}
          <SquarePlus className="inline h-4 w-4" /> <b>Adicionar à Tela de Início</b> e em <b>Adicionar</b>.
        </p>
      </Card>
    </div>
  );
}
