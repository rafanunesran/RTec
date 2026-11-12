import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, type PrivacyInfo } from "@/lib/api";
import Logo from "@/components/Logo";
import { formatDate } from "@/lib/utils";

// Politica de Privacidade e Termos de Uso (LGPD). Os dados do controlador vem de Admin > Configuracoes >
// Privacidade; o que ainda nao foi preenchido aparece destacado como "a preencher".

const EMPTY: PrivacyInfo = { controller: "", document: "", email: "", whatsapp: "", dpo: "", address: "", reviewed: false, updated_at: null };

function usePrivacyInfo() {
  const [info, setInfo] = useState<PrivacyInfo>(EMPTY);
  useEffect(() => {
    api.get<PrivacyInfo>("/api/privacy").then(setInfo, () => {});
  }, []);
  return info;
}

/** Valor preenchido pelo admin ou marcador amarelo de "a preencher". */
function V({ v, what }: { v: string; what: string }) {
  if (v) return <strong className="font-semibold text-foreground">{v}</strong>;
  return <mark className="rounded bg-warning/20 px-1 text-warning">[{what}: a preencher]</mark>;
}

function Contact({ info }: { info: PrivacyInfo }) {
  if (!info.email && !info.whatsapp) return <V v="" what="e-mail ou WhatsApp de contato" />;
  return (
    <>
      {info.email && (
        <a className="font-semibold text-primary underline" href={`mailto:${info.email}`}>
          {info.email}
        </a>
      )}
      {info.email && info.whatsapp && " ou WhatsApp "}
      {!info.email && "WhatsApp "}
      {info.whatsapp && <strong className="font-semibold text-foreground">{info.whatsapp}</strong>}
    </>
  );
}

function Page({ title, info, children }: { title: string; info: PrivacyInfo; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · RTec`;
    return () => {
      document.title = "RTec";
    };
  }, [title]);
  return (
    <div className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Logo />
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        </div>
        {!info.reviewed && (
          <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Versão preliminar: este texto ainda está sendo revisado e pode mudar.
          </p>
        )}
        <article className="space-y-6 rounded-3xl border bg-card/80 p-6 text-sm leading-relaxed text-muted-foreground shadow-card sm:p-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          <header>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            {info.updated_at && <p className="mt-1 text-xs">Atualizado em {formatDate(info.updated_at)}</p>}
          </header>
          {children}
        </article>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/privacidade" className="hover:text-foreground">
            Política de Privacidade
          </Link>
          {" · "}
          <Link to="/termos" className="hover:text-foreground">
            Termos de Uso
          </Link>
        </p>
      </div>
    </div>
  );
}

export function PrivacyPolicy() {
  const info = usePrivacyInfo();
  return (
    <Page title="Política de Privacidade" info={info}>
      <p>
        Esta política explica quais dados pessoais o RTec (site, app Android e apps de TV) trata, para quê, com quem compartilha, por quanto tempo
        guarda e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).
      </p>

      <section>
        <h2>1. Quem é o responsável pelos seus dados</h2>
        <ul>
          <li>
            Controlador: <V v={info.controller} what="nome ou razão social" />, CPF/CNPJ <V v={info.document} what="CPF ou CNPJ" />.
          </li>
          <li>
            Endereço: <V v={info.address} what="endereço para correspondência" />.
          </li>
          <li>
            Encarregado (DPO): <V v={info.dpo} what="nome do encarregado" />. Contato: <Contact info={info} />.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Quais dados tratamos</h2>
        <ul>
          <li>
            <strong>Conta:</strong> nome, usuário, senha de acesso (guardada cifrada), situação da conta, validade, datas de cadastro e do último acesso.
          </li>
          <li>
            <strong>Listas contratadas:</strong> endereço do servidor, usuário e senha da lista do fornecedor (guardados cifrados e nunca mostrados nos
            aparelhos).
          </li>
          <li>
            <strong>Uso do app:</strong> perfis (nome, avatar, se é infantil), favoritos, histórico do que foi assistido, ponto onde parou, alertas de
            novos episódios, preferências de gêneros e jogos.
          </li>
          <li>
            <strong>Aparelhos:</strong> tipo e modelo do aparelho e navegador, endereço IP, data da conexão e do último uso; links de conexão criados
            para outras TVs.
          </li>
          <li>
            <strong>Controle parental:</strong> PIN (guardado só como código irreversível, o hash) e grupos bloqueados.
          </li>
          <li>
            <strong>Cobrança:</strong> data prevista do pagamento e do último pagamento recebido. Não guardamos cartão, conta bancária nem chave Pix.
          </li>
          <li>
            <strong>Anotações do atendimento:</strong> observações que o revendedor escreve sobre a conta.
          </li>
          <li>
            <strong>Segurança:</strong> tentativas de login com senha errada (o IP fica guardado só como código irreversível) e registros técnicos da
            hospedagem.
          </li>
        </ul>
        <p className="mt-2">Não coletamos documentos, localização, contatos, câmera ou microfone, e não usamos dados para publicidade.</p>
      </section>

      <section>
        <h2>3. Para que usamos e com qual base legal</h2>
        <ul>
          <li>Criar e manter sua conta, liberar as listas contratadas e tocar o conteúdo: execução do contrato (art. 7º, V).</li>
          <li>
            Sincronizar favoritos, histórico e ponto onde parou entre seus aparelhos, perfis, alertas e recomendações: execução do contrato (art. 7º, V).
          </li>
          <li>
            Proteger a conta (limite de tentativas, lista de aparelhos conectados, links cifrados) e evitar fraude: legítimo interesse (art. 7º, IX) e
            segurança (art. 46).
          </li>
          <li>Lembrar a data de pagamento combinada: execução do contrato (art. 7º, V).</li>
          <li>Guardar registros de acesso quando a lei exigir: cumprimento de obrigação legal (art. 7º, II).</li>
        </ul>
      </section>

      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>Não vendemos dados. Para o serviço funcionar, alguns dados passam por estes operadores e serviços:</p>
        <ul>
          <li>Vercel Inc. (hospedagem do site e da API, com servidores no Brasil e nos Estados Unidos).</li>
          <li>Google Firebase / Firestore (banco de dados da conta e da sincronização).</li>
          <li>Oracle Cloud (servidor de vídeo, que repassa o vídeo com links cifrados).</li>
          <li>Fornecedores das listas contratadas (recebem os pedidos de vídeo e o IP do aparelho ou do servidor de vídeo).</li>
          <li>ntfy.sh (mensagens cifradas de ponta a ponta para "tocar em outro aparelho").</li>
          <li>is.gd (encurtador do link de conexão de TV; recebe só um código aleatório).</li>
          <li>
            Serviços de informação de títulos e jogos (TMDB, TVmaze, Wikipédia, ESPN): consultados pelo nosso servidor, sem dados seus. Capas e logos
            podem ser carregados direto desses sites pelo seu aparelho, e trailers abrem no YouTube.
          </li>
        </ul>
        <p className="mt-2">
          Alguns desses serviços ficam fora do Brasil. A transferência internacional segue o art. 33 da LGPD, com contratos e garantias desses
          fornecedores.
        </p>
      </section>

      <section>
        <h2>5. Cookies e armazenamento no aparelho</h2>
        <p>
          Usamos só o necessário para o app funcionar: um cookie de sessão que mantém você conectado (vale 30 dias desde o último uso; o do painel do
          revendedor, 7 dias) e o armazenamento local do navegador para preferências, perfil escolhido, cópia dos favoritos e do histórico e um
          identificador do aparelho. Não usamos cookies de publicidade nem de análise. Ao sair da conta ou limpar os dados do navegador, isso é apagado do
          aparelho.
        </p>
      </section>

      <section>
        <h2>6. Por quanto tempo guardamos</h2>
        <ul>
          <li>
            Conta e listas: enquanto a conta existir. Depois do fim do serviço, por até <V v="" what="prazo, ex.: 6 meses" /> para cobrança e defesa em
            caso de disputa, e então são apagadas.
          </li>
          <li>Favoritos, histórico e ponto onde parou: até você apagar (em Configurações) ou a conta ser excluída, com limite de itens por perfil.</li>
          <li>Aparelhos (IP e navegador): apagados sozinhos depois de 60 dias sem uso.</li>
          <li>Tentativas de login erradas: apagadas sozinhas em 1 dia.</li>
          <li>Links de conexão de TV: apagados quando vencem sem uso (48 horas) ou quando a conexão termina.</li>
          <li>Registros técnicos da hospedagem: pelo prazo da Vercel (de horas a poucos dias).</li>
        </ul>
      </section>

      <section>
        <h2>7. Como protegemos</h2>
        <p>
          Conexão sempre com HTTPS; senhas e credenciais das listas cifradas (AES-GCM); PIN e senha do painel em hash; o banco só é acessado pelo
          servidor; limite de tentativas de login; links de vídeo cifrados que vencem sozinhos; você vê e desconecta os aparelhos da conta. Se houver um
          incidente de segurança que possa causar risco ou dano relevante, avisaremos você e a ANPD (art. 48).
        </p>
      </section>

      <section>
        <h2>8. Seus direitos</h2>
        <p>Pelo art. 18 da LGPD você pode, a qualquer momento:</p>
        <ul>
          <li>confirmar que tratamos seus dados e acessá-los;</li>
          <li>corrigir dados incompletos ou errados;</li>
          <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desacordo com a lei;</li>
          <li>receber seus dados em formato aberto (portabilidade);</li>
          <li>saber com quem compartilhamos;</li>
          <li>pedir a exclusão da conta e dos dados;</li>
          <li>reclamar à Autoridade Nacional de Proteção de Dados (ANPD, gov.br/anpd).</li>
        </ul>
        <p className="mt-2">
          No app, em <strong>Configurações &gt; Privacidade</strong>, você baixa seus dados, apaga o histórico de uso e pede a exclusão ou correção da
          conta. Também pode pedir pelo contato <Contact info={info} />. Respondemos em até 15 dias.
        </p>
      </section>

      <section>
        <h2>9. Crianças e adolescentes</h2>
        <p>
          A conta é contratada por um adulto, que pode criar perfis infantis e bloquear grupos com PIN. Dos perfis infantis guardamos só o mesmo que dos
          outros perfis (favoritos, histórico e ponto onde parou), no melhor interesse da criança (art. 14).
        </p>
      </section>

      <section>
        <h2>10. Mudanças nesta política</h2>
        <p>Quando esta política mudar, a data no topo é atualizada e as mudanças importantes são avisadas no app.</p>
      </section>
    </Page>
  );
}

export function TermsOfUse() {
  const info = usePrivacyInfo();
  return (
    <Page title="Termos de Uso" info={info}>
      <p>
        Estes termos valem para o uso do RTec (site, app Android e apps de TV), oferecido por <V v={info.controller} what="nome ou razão social" />,
        CPF/CNPJ <V v={info.document} what="CPF ou CNPJ" />. Ao entrar na conta, você concorda com eles e com a{" "}
        <Link to="/privacidade" className="font-semibold text-primary underline">
          Política de Privacidade
        </Link>
        .
      </p>
      <section>
        <h2>1. O serviço</h2>
        <p>
          O RTec é um reprodutor: organiza e toca as listas contratadas pela sua conta. A disponibilidade de canais, filmes e séries depende dos
          fornecedores dessas listas e pode mudar sem aviso.
        </p>
      </section>
      <section>
        <h2>2. Sua conta</h2>
        <ul>
          <li>O usuário e a senha são pessoais. Não compartilhe com quem não mora com você.</li>
          <li>Você pode ver e desconectar os aparelhos da conta em Configurações &gt; Dispositivos.</li>
          <li>Use o PIN parental para proteger conteúdo impróprio para crianças.</li>
        </ul>
      </section>
      <section>
        <h2>3. Pagamento, validade e cancelamento</h2>
        <p>
          A validade e o valor são combinados com o revendedor. Sem pagamento, a conta pode ser suspensa. Você pode cancelar a qualquer momento pelo contato{" "}
          <Contact info={info} />. <V v="" what="regras de reembolso e prazo de aviso" />
        </p>
      </section>
      <section>
        <h2>4. Uso proibido</h2>
        <p>
          Não é permitido revender, redistribuir ou retransmitir o acesso, tentar burlar a segurança do app ou usar a conta para atividade ilegal. Nesses
          casos a conta pode ser suspensa.
        </p>
      </section>
      <section>
        <h2>5. Limites de responsabilidade</h2>
        <p>
          Fazemos o possível para manter o serviço no ar, mas podem ocorrer interrupções por falhas de internet, dos fornecedores ou da hospedagem.
        </p>
      </section>
      <section>
        <h2>6. Contato e foro</h2>
        <p>
          Dúvidas e pedidos: <Contact info={info} />. Fica eleito o foro do domicílio do consumidor, conforme o Código de Defesa do Consumidor.{" "}
          <V v="" what="revisar com advogado" />
        </p>
      </section>
    </Page>
  );
}
