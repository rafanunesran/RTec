import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Dialog, IconTile } from "@/components/ui";
import { useAppUpdate } from "@/lib/appupdate";

/** Aviso dentro do app Android: versao nova do app, com o botao que ja baixa e instala. */
export default function AppUpdatePrompt() {
  const update = useAppUpdate();
  const [started, setStarted] = useState(false);
  if (!update) return null;
  return (
    <Dialog
      open
      onClose={update.later}
      title={started ? "Baixando a atualização" : "Nova versão do app"}
      description={
        started
          ? undefined
          : `A versão ${update.version} do RTec está pronta, com novidades e correções. Leva menos de um minuto.`
      }
      icon={<IconTile icon={<Download className="h-5 w-5" />} />}
    >
      {started ? (
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Espere o download terminar (aparece no topo da tela).</li>
            <li>Toque na notificação do download ou em <b>Abrir</b>.</li>
            <li>
              Se o celular pedir, toque em <b>Configurações</b> e ligue <b>Permitir desta fonte</b>, depois volte.
            </li>
            <li>
              Toque em <b>Atualizar</b>. Seus dados e o login continuam.
            </li>
          </ol>
          <Button className="w-full" variant="secondary" onClick={update.later}>
            Entendi
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="w-full sm:w-auto"
            variant="gradient"
            autoFocus
            onClick={() => {
              update.start();
              if (update.mode === "old") setStarted(true);
            }}
          >
            <Download /> Atualizar agora
          </Button>
          <Button className="w-full sm:w-auto" variant="ghost" onClick={update.later}>
            Depois
          </Button>
        </div>
      )}
    </Dialog>
  );
}
