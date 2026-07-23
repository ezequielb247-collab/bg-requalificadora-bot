require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const sheets = require("./services/sheets");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || "./auth_info_baileys";
const IGNORE_GROUPS = (process.env.IGNORE_GROUPS || "true").toLowerCase() === "true";

const NOME_OFICINA = process.env.BUSINESS_NAME || process.env.NOME_OFICINA || "BG GNV Macaé";
const ENDERECO_OFICINA =
  process.env.ENDERECO_OFICINA ||
  "Av. Carlos Augusto T. Garcia, nº 1618-B — Sol e Mar, Macaé - RJ, CEP 27940-290";
const LINK_MAPS = process.env.LINK_MAPS || "https://maps.app.goo.gl/7ksH2EFcRNhEZxoPA";
const HORARIO_OFICINA = (
  process.env.HORARIO_OFICINA ||
  "Segunda a sexta: 8:00 às 12:00 e 13:00 às 18:00\nSábado: 8:00 às 12:00"
).replace(/\\n/g, "\n");

const ATENDENTE_NUMERO =
  process.env.ATENDENTE_NUMERO || process.env.ATTENDANT_NUMBERS || "";

let sock;
let currentQr = null;
let currentQrDataUrl = null;
let connectionStatus = "iniciando";
let lastConnectionUpdate = new Date().toISOString();

const ultimasMensagens = new Map();
const avisosRecentes = new Map();
const clientesQueJaReceberamMenu = new Set();
const avisosMensagemNaoEntendidaPorDia = new Map();
const respostasPalavrasChavePorDia = new Map();
const telefonesReaisPorJid = new Map();

function estaDentroDoHorario() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const diaSemana = dataBrasil.getDay();
  const hora = dataBrasil.getHours();
  const minuto = dataBrasil.getMinutes();
  const horarioAtual = hora * 60 + minuto;

  if (diaSemana === 0) return false;

  if (diaSemana >= 1 && diaSemana <= 5) {
    return (
      (horarioAtual >= 8 * 60 && horarioAtual < 12 * 60) ||
      (horarioAtual >= 13 * 60 && horarioAtual < 18 * 60)
    );
  }

  if (diaSemana === 6) {
    return horarioAtual >= 8 * 60 && horarioAtual < 12 * 60;
  }

  return false;
}

function mensagemForaDoHorario() {
  return `Olá! Recebemos sua mensagem.

No momento estamos fora do horário de atendimento.

🕒 Horário de funcionamento:
${HORARIO_OFICINA}

Mesmo assim, você pode ver as opções abaixo e nossa equipe responderá assim que possível.`;
}

function normalizarTexto(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function ehComandoMenu(texto) {
  const t = normalizarTexto(texto);
  return ["menu", "inicio", "voltar"].includes(t);
}


function dataAtualBrasil() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function deveEnviarAvisoMensagemNaoEntendida(numeroCliente) {
  const hoje = dataAtualBrasil();
  const ultimaData = avisosMensagemNaoEntendidaPorDia.get(numeroCliente);

  if (ultimaData === hoje) return false;

  avisosMensagemNaoEntendidaPorDia.set(numeroCliente, hoje);
  return true;
}

function deveResponderPalavraChaveHoje(numeroCliente, opcao) {
  const hoje = dataAtualBrasil();
  const chave = `${numeroCliente}:${opcao}`;
  const ultimaData = respostasPalavrasChavePorDia.get(chave);

  if (ultimaData === hoje) return false;

  respostasPalavrasChavePorDia.set(chave, hoje);
  return true;
}

function ehMensagemDuplicada(numero, texto) {
  const agora = Date.now();
  const textoNormalizado = normalizarTexto(texto);

  if (!textoNormalizado) return false;

  const ultima = ultimasMensagens.get(numero);
  if (ultima && ultima.texto === textoNormalizado && agora - ultima.horario < 15000) {
    return true;
  }

  ultimasMensagens.set(numero, {
    texto: textoNormalizado,
    horario: agora
  });

  return false;
}

function normalizarNumeroWhatsApp(numero) {
  return String(numero || "").replace(/\D/g, "");
}

function formatarJid(numeroOuJid) {
  const valor = String(numeroOuJid || "").trim();
  if (!valor) return null;
  if (valor.includes("@")) return valor;

  const digits = normalizarNumeroWhatsApp(valor);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function numeroClientePorJid(jid) {
  const jidTexto = String(jid || "").trim();
  const telefoneMapeado = telefonesReaisPorJid.get(jidTexto);

  if (telefoneMapeado) return telefoneMapeado;

  return jidTexto.split("@")[0];
}

function extrairTelefoneRealDaMensagem(message) {
  const candidatos = [
    message?.key?.remoteJidAlt,
    message?.key?.participantAlt,
    message?.senderPn,
    message?.key?.senderPn,
    message?.key?.remoteJid,
    message?.key?.participant
  ];

  for (const candidato of candidatos) {
    const jidCandidato = String(candidato || "").trim();

    if (jidCandidato.endsWith("@s.whatsapp.net")) {
      const telefone = normalizarNumeroWhatsApp(jidCandidato.split("@")[0]);
      if (telefone) return telefone;
    }
  }

  return "";
}

function registrarTelefoneRealDaMensagem(message) {
  const jidPrincipal = String(message?.key?.remoteJid || "").trim();
  const telefoneReal = extrairTelefoneRealDaMensagem(message);

  if (!jidPrincipal || !telefoneReal) return telefoneReal;

  telefonesReaisPorJid.set(jidPrincipal, telefoneReal);

  const jidAlternativo = String(message?.key?.remoteJidAlt || "").trim();
  if (jidAlternativo) telefonesReaisPorJid.set(jidAlternativo, telefoneReal);

  return telefoneReal;
}

function telefoneLimpoPorJid(jid) {
  return normalizarNumeroWhatsApp(numeroClientePorJid(jid));
}

function formatarContatoCliente(clienteNumero) {
  const telefone = normalizarNumeroWhatsApp(clienteNumero);

  return `📱 Cliente:
${telefone}

🔗 Abrir conversa:
https://wa.me/${telefone}`;
}

function getAtendentes() {
  return ATENDENTE_NUMERO.split(",")
    .map((numero) => numero.trim())
    .filter(Boolean);
}

function ehAtendente(numeroOuJid) {
  const numero = normalizarNumeroWhatsApp(numeroClientePorJid(numeroOuJid));
  return getAtendentes().some((atendente) => normalizarNumeroWhatsApp(atendente) === numero);
}

function ehPedidoRelatorio(texto) {
  const t = normalizarTexto(texto);

  return (
    t === "relatorio" ||
    t === "relatorio leads" ||
    t === "leads" ||
    t === "resumo leads" ||
    t === "relatorio de leads"
  );
}

function ehPedidoValoresGerais(texto) {
  const t = normalizarTexto(texto);

  return (
    t === "valores" ||
    t === "precos" ||
    t === "precos" ||
    t === "tabela" ||
    t === "tabela de precos" ||
    t === "valor dos servicos" ||
    t === "preco dos servicos" ||
    t === "quanto custa os servicos" ||
    t === "me passa os valores" ||
    t === "manda os valores" ||
    t === "quais os valores" ||
    t === "quais sao os valores" ||
    t.includes("tabela de preco") ||
    t.includes("tabela de valor") ||
    t.includes("lista de preco") ||
    t.includes("lista de valor") ||
    t.includes("me passa a tabela") ||
    t.includes("manda a tabela") ||
    t.includes("quanto custa todos") ||
    t.includes("quanto custa os servicos") ||
    t.includes("preco dos servicos") ||
    t.includes("valor dos servicos") ||
    t.includes("valores dos servicos")
  );
}

function formatarObjetoContagem(objeto) {
  const entradas = Object.entries(objeto || {});

  if (entradas.length === 0) {
    return "Nenhum registro.";
  }

  return entradas.map(([nome, quantidade]) => `- ${nome}: ${quantidade}`).join("\n");
}

async function enviarRelatorioLeads(jid) {
  if (typeof sheets.gerarRelatorioLeads !== "function") {
    await sendTextMessage(
      jid,
      "Ainda não encontrei a função de relatório no services/sheets.js atual. As conversas e leads continuam sendo salvos normalmente."
    );
    return;
  }

  try {
    const relatorio = await sheets.gerarRelatorioLeads();

    await sendTextMessage(
      jid,
      `RELATÓRIO DE LEADS

Total de leads:
${relatorio.total}

Leads hoje:
${relatorio.hoje}

Leads nos últimos 7 dias:
${relatorio.ultimos7Dias}

Por serviço:
${formatarObjetoContagem(relatorio.porServico)}

Por status:
${formatarObjetoContagem(relatorio.porStatus)}

Para atualizar o status, altere manualmente na aba Leads da planilha.`
    );
  } catch (error) {
    console.error("Erro ao gerar relatório de leads:", error.message);
    await sendTextMessage(
      jid,
      "Não consegui gerar o relatório agora. Confira se a aba Leads existe e se a planilha está compartilhada com a conta de serviço."
    );
  }
}

function formatarMoeda(valor) {
  const numero = Number(valor || 0);

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function normalizarNumero(valor, padrao) {
  if (valor === undefined || valor === null || valor === "") {
    return padrao;
  }

  const limpo = String(valor)
    .replace("R$", "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : padrao;
}

async function carregarValores() {
  if (typeof sheets.getValores === "function") {
    try {
      const valores = await sheets.getValores();
      return {
        reteste_cartao: normalizarNumero(valores.reteste_cartao, 480),
        reteste_vista: normalizarNumero(valores.reteste_vista, 450),
        retirada_kit_5_cartao: normalizarNumero(valores.retirada_kit_5_cartao, 530),
        retirada_kit_5_vista: normalizarNumero(valores.retirada_kit_5_vista, 500),
        retirada_kit_3_cartao: normalizarNumero(valores.retirada_kit_3_cartao, 430),
        retirada_kit_3_vista: normalizarNumero(valores.retirada_kit_3_vista, 400),
        revisao_kit_3_cartao: normalizarNumero(valores.revisao_kit_3_cartao, 280),
        revisao_kit_3_vista: normalizarNumero(valores.revisao_kit_3_vista, 250),
        revisao_kit_5_cartao: normalizarNumero(valores.revisao_kit_5_cartao, 430),
        revisao_kit_5_vista: normalizarNumero(valores.revisao_kit_5_vista, 400),
        limpeza_bico_cartao: normalizarNumero(valores.limpeza_bico_cartao, 180),
        limpeza_bico_vista: normalizarNumero(valores.limpeza_bico_vista, 150),
        limpeza_arrefecimento_cartao: normalizarNumero(valores.limpeza_arrefecimento_cartao, 330),
        limpeza_arrefecimento_vista: normalizarNumero(valores.limpeza_arrefecimento_vista, 300)
      };
    } catch (error) {
      console.error("Erro ao carregar valores da planilha:", error.message);
    }
  }

  return {
    reteste_cartao: 480,
    reteste_vista: 450,
    retirada_kit_5_cartao: 530,
    retirada_kit_5_vista: 500,
    retirada_kit_3_cartao: 430,
    retirada_kit_3_vista: 400,
    revisao_kit_3_cartao: 280,
    revisao_kit_3_vista: 250,
    revisao_kit_5_cartao: 430,
    revisao_kit_5_vista: 400,
    limpeza_bico_cartao: 180,
    limpeza_bico_vista: 150,
    limpeza_arrefecimento_cartao: 330,
    limpeza_arrefecimento_vista: 300
  };
}

async function montarResposta(opcao) {
  const valores = await carregarValores();

  if (opcao === "valores") {
    return `💰 TABELA DE VALORES

✅ Reteste de cilindro GNV
💳 Cartão: ${formatarMoeda(valores.reteste_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.reteste_vista)}

✅ Retirada de kit GNV

5ª geração:
💳 Cartão: ${formatarMoeda(valores.retirada_kit_5_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.retirada_kit_5_vista)}

3ª geração:
💳 Cartão: ${formatarMoeda(valores.retirada_kit_3_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.retirada_kit_3_vista)}

✅ Revisão de kit GNV

3ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_3_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.revisao_kit_3_vista)}

5ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_5_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.revisao_kit_5_vista)}

✅ Limpeza de bico
💳 Cartão: a partir de ${formatarMoeda(valores.limpeza_bico_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.limpeza_bico_vista)}

✅ Limpeza do sistema de arrefecimento
Serviço com máquina e aditivo incluso.
💳 Cartão: ${formatarMoeda(valores.limpeza_arrefecimento_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.limpeza_arrefecimento_vista)}

✅ Instalação de kit GNV
O valor é negociado diretamente com o atendente, pois varia conforme o veículo, tipo de kit e condições de instalação.

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para ver o menu, envie: menu`;
  }

  if (opcao === "1") {
    return `✅ RETESTE DE CILINDRO DE GNV

Valor referente a 1 cilindro:

💳 Cartão: ${formatarMoeda(valores.reteste_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.reteste_vista)}

📄 Documento necessário:
• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

⏱️ Prazo de entrega:
• Trazendo o carro de manhã, entregamos no final da tarde.
• Trazendo o carro à tarde, entregamos no outro dia pela manhã.

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === "2") {
    return `✅ RETIRADA DE KIT GNV

Valores:

5ª geração:
💳 Cartão: ${formatarMoeda(valores.retirada_kit_5_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.retirada_kit_5_vista)}

3ª geração:
💳 Cartão: ${formatarMoeda(valores.retirada_kit_3_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.retirada_kit_3_vista)}

📄 Documento necessário:
• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === "3") {
    return `✅ REVISÃO DE KIT GNV

Valores:

3ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_3_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.revisao_kit_3_vista)}

5ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_5_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.revisao_kit_5_vista)}

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === "4") {
    return `✅ INSTALAÇÃO DE KIT GNV

O valor da instalação é negociado diretamente com o atendente, pois pode variar conforme o veículo, o tipo de kit e as condições de instalação.

Nossa equipe pode te orientar melhor sobre valores, documentos e prazo.

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}`;
  }

  if (opcao === "5") {
    return `✅ LIMPEZA DE BICO

Valores:

💳 Cartão: a partir de ${formatarMoeda(valores.limpeza_bico_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.limpeza_bico_vista)}

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === "6") {
    return `✅ LIMPEZA DO SISTEMA DE ARREFECIMENTO

Serviço feito com máquina e com aditivo já incluso.

Valores:

💳 Cartão: ${formatarMoeda(valores.limpeza_arrefecimento_cartao)} em até 3x sem juros
💵 À vista no dinheiro ou Pix: ${formatarMoeda(valores.limpeza_arrefecimento_vista)}

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === "7") {
    return `📄 DOCUMENTOS NECESSÁRIOS

Para reteste de cilindro de GNV ou retirada de kit GNV, é necessário trazer:

• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

Para instalação de kit GNV, fale com o atendente para receber a orientação correta.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === "8") {
    return `📍 ENDEREÇO E HORÁRIO

${NOME_OFICINA}

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

🕒 Horário de funcionamento:
${HORARIO_OFICINA}

Para realizar o serviço, basta trazer o carro até a oficina.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === "9") {
    return `👨‍🔧 Você será atendido por um de nossos especialistas.

Aguarde um instante enquanto avisamos nossa equipe.`;
  }

  return null;
}

function montarMenu(mensagemInicial = null) {
  const textoBody =
    mensagemInicial ||
    `Olá! Seja bem-vindo(a) à ${NOME_OFICINA}

Somos especializados em serviços automotivos e GNV em Macaé-RJ.

Escolha uma opção digitando o número:`;

  return `${textoBody}

1. Reteste cilindro GNV
2. Retirada kit GNV
3. Revisão kit GNV
4. Instalação GNV
5. Limpeza de bico
6. Limpeza arrefecimento
7. Documentos
8. Endereço e horário
9. Falar com atendente`;
}

function textoTemAlgumaPalavra(texto, palavras) {
  const textoNormalizado = normalizarTexto(texto);
  return palavras.some((palavra) => textoNormalizado.includes(normalizarTexto(palavra)));
}

function identificarOpcaoPorTexto(texto) {
  const textoMinusculo = normalizarTexto(texto);

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "reteste",
      "retestar",
      "cilindro",
      "cilindro gnv",
      "requalificacao",
      "validade do cilindro",
      "vencido",
      "cilindro vencido",
      "quanto e o reteste",
      "quanto custa o reteste",
      "valor do reteste",
      "selo vencido",
      "cilindro venceu",
      "meu cilindro venceu",
      "validade vencida",
      "validade do gnv",
      "validade do cilindro gnv",
      "requalificar",
      "requalificar cilindro",
      "requalificacao do cilindro",
      "teste do cilindro",
      "testar cilindro",
      "cilindro fora da validade",
      "cilindro perto de vencer",
      "cilindro esta vencido",
      "gnv vencido",
      "selo do gnv",
      "selo do cilindro"
    ])
  ) {
    return "1";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "retirada",
      "retirar",
      "tirar kit",
      "remover kit",
      "remocao",
      "desinstalar",
      "desinstalacao",
      "quero tirar o kit",
      "tirar gnv",
      "retirar gnv",
      "remover gnv",
      "tirar o gas",
      "retirar o gas",
      "remover o gas",
      "tirar gas do carro",
      "retirar gas do carro",
      "remover gas do carro",
      "tirar cilindro",
      "remover cilindro",
      "retirar cilindro",
      "desmontar kit",
      "desmontagem do kit",
      "tirar instalacao do gnv",
      "retirada do 3",
      "retirada de 3",
      "retirada 3",
      "retirada do kit 3",
      "retirada kit 3",
      "retirada quinta",
      "retirada do 5",
      "retirada kit 5"
    ])
  ) {
    return "2";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "revisao",
      "revisar",
      "manutencao",
      "regular",
      "regulagem",
      "falhando",
      "falha",
      "vazamento",
      "cheiro de gas",
      "nao pega no gnv",
      "nao funciona no gnv",
      "carro falhando",
      "revisar kit",
      "manutencao do gas",
      "manutencao do gnv",
      "revisar gnv",
      "revisao do gnv",
      "regular gnv",
      "regular gas",
      "gnv falhando",
      "gas falhando",
      "carro ruim no gnv",
      "carro ruim no gas",
      "carro morrendo no gnv",
      "carro morrendo no gas",
      "nao passa para o gnv",
      "nao troca para o gnv",
      "gas vazando",
      "vazando gas",
      "vazamento de gnv"
    ])
  ) {
    return "3";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "instalacao",
      "instalar",
      "instalar kit",
      "colocar gnv",
      "botar gnv",
      "converter para gnv",
      "conversao",
      "kit novo",
      "instalar gnv",
      "quero colocar gnv",
      "quero instalar gnv",
      "instalar gas",
      "colocar gas",
      "botar gas",
      "por gnv",
      "colocar cilindro",
      "instalar cilindro",
      "quanto custa colocar gnv",
      "quanto custa instalar gnv",
      "valor para instalar gnv",
      "valor para colocar gnv",
      "fazer instalacao de gnv",
      "transformar para gnv",
      "converter carro para gnv",
      "colocar gas no carro",
      "instalar gas no carro",
      "gnv no carro"
    ])
  ) {
    return "4";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "limpeza de bico",
      "limpeza dos bicos",
      "limpar bico",
      "limpar bicos",
      "bico injetor",
      "bicos injetores",
      "limpeza de bico injetor",
      "limpeza bico",
      "limpeza bicos",
      "bico sujo",
      "bicos sujos",
      "quanto e limpeza de bico",
      "quanto custa limpeza de bico",
      "valor limpeza de bico",
      "limpeza dos injetores",
      "limpar injetores"
    ])
  ) {
    return "5";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "limpeza de arrefecimento",
      "limpeza do arrefecimento",
      "sistema de arrefecimento",
      "limpeza do sistema de arrefecimento",
      "arrefecimento",
      "radiador",
      "limpeza do radiador",
      "limpar radiador",
      "limpeza radiador",
      "aditivo",
      "troca de aditivo",
      "trocar aditivo",
      "agua do radiador",
      "carro aquecendo",
      "motor aquecendo",
      "baixando agua",
      "limpeza com maquina",
      "maquina de arrefecimento"
    ])
  ) {
    return "6";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "documento",
      "documentos",
      "precisa levar",
      "o que levar",
      "quais documentos",
      "documentacao",
      "crlv",
      "dut",
      "nota fiscal",
      "preciso levar o que",
      "levar quais documentos",
      "o que precisa levar",
      "precisa de documento",
      "documento do carro",
      "documento do gnv",
      "documento necessario",
      "documentos necessarios",
      "quais papeis",
      "papel do carro",
      "papel do gnv"
    ])
  ) {
    return "7";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "endereco",
      "onde fica",
      "localizacao",
      "como chegar",
      "horario",
      "abre que horas",
      "fecha que horas",
      "funcionamento",
      "local",
      "maps",
      "endereco da loja",
      "rota",
      "localizacao da loja",
      "qual endereco",
      "manda localizacao",
      "manda o endereco",
      "me manda a localizacao",
      "me manda o endereco",
      "google maps",
      "mapa",
      "fica onde",
      "voces ficam onde",
      "qual horario",
      "horario de atendimento",
      "abre sabado",
      "funciona sabado"
    ])
  ) {
    return "8";
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "atendente",
      "humano",
      "pessoa",
      "falar com alguem",
      "falar com atendente",
      "quero atendimento",
      "me liga",
      "ligacao",
      "telefone",
      "chamar atendente",
      "vendedor",
      "quero falar com alguem",
      "quero falar com uma pessoa",
      "quero falar com humano",
      "atendimento humano",
      "falar com vendedor",
      "falar com responsavel",
      "me chama",
      "pode me chamar",
      "me chama no whatsapp",
      "quero tirar duvida",
      "tenho uma duvida",
      "preciso de ajuda",
      "preciso falar com alguem"
    ])
  ) {
    return "9";
  }

  return null;
}

function isExactMenuOption(text) {
  const normalized = normalizarTexto(text).trim();
  return /^[1-9]$/.test(normalized) ? normalized : null;
}

function extrairOpcao(texto) {
  const textoLimpo = String(texto || "").trim();
  const opcaoExata = isExactMenuOption(textoLimpo);
  if (opcaoExata) return opcaoExata;

  if (ehPedidoValoresGerais(textoLimpo)) return "valores";

  const opcaoPorTexto = identificarOpcaoPorTexto(textoLimpo);
  if (opcaoPorTexto) return opcaoPorTexto;

  const textoMinusculo = normalizarTexto(textoLimpo);
  if (
    textoMinusculo === "oi" ||
    textoMinusculo === "ola" ||
    textoMinusculo === "menu" ||
    textoMinusculo === "inicio" ||
    textoMinusculo === "bom dia" ||
    textoMinusculo === "boa tarde" ||
    textoMinusculo === "boa noite" ||
    textoMinusculo === "gnv" ||
    textoMinusculo.includes("informacao") ||
    textoMinusculo.includes("informacoes")
  ) {
    return "";
  }

  return "invalido";
}

async function sendTextMessage(to, text) {
  if (!sock) return;
  await sock.sendMessage(to, { text });
}

async function enviarParaAtendentes(texto) {
  const atendentes = getAtendentes();
  for (const atendente of atendentes) {
    const jid = formatarJid(atendente);
    if (jid) await sendTextMessage(jid, texto);
  }
}

async function responderComandoAtendente(jid, texto, fromMe) {
  if (fromMe) {
    await enviarParaAtendentes(texto);
    return;
  }

  await sendTextMessage(jid, texto);
}

function deveEnviarAviso(chave) {
  const agora = Date.now();
  const ultimo = avisosRecentes.get(chave) || 0;
  if (agora - ultimo < 10000) return false;

  avisosRecentes.set(chave, agora);
  return true;
}

async function avisarAtendente(clienteNumero, nomeCliente, mensagemCliente) {
  if (!ATENDENTE_NUMERO) {
    console.log("ATENDENTE_NUMERO ou ATTENDANT_NUMBERS não configurado.");
    return;
  }

  if (!deveEnviarAviso(`${clienteNumero}:atendente:${mensagemCliente}`)) return;

  const texto = `🚨 Cliente precisa de atendimento

👤 Nome: ${nomeCliente || "Não informado"}
${formatarContatoCliente(clienteNumero)}

📌 Situação:
${mensagemCliente || "Cliente solicitou atendimento"}

Entre em contato com o cliente pelo WhatsApp.`;

  await enviarParaAtendentes(texto);
}

async function avisarPedidoAtendimentoHumano(clienteNumero, nomeCliente, mensagemCliente) {
  if (!ATENDENTE_NUMERO) {
    console.log("ATENDENTE_NUMERO ou ATTENDANT_NUMBERS não configurado.");
    return;
  }

  if (!deveEnviarAviso(`${clienteNumero}:pedido-humano:${mensagemCliente}`)) return;

  const telefone = normalizarNumeroWhatsApp(clienteNumero);
  const texto = `🚨 NOVO PEDIDO DE ATENDIMENTO HUMANO

👤 Cliente:
${nomeCliente || "Não informado"}

📱 Telefone:
${telefone}

🔗 Abrir conversa:
https://wa.me/${telefone}

💬 Última mensagem:
${mensagemCliente || "Cliente solicitou atendimento humano."}`;

  await enviarParaAtendentes(texto);
}

async function salvarConversa({ jid, nome, mensagem, opcao }) {
  await sheets.appendConversation({
    date: new Date(),
    name: nome || "",
    phone: numeroClientePorJid(jid),
    message: mensagem || "",
    matchedService: opcao || "",
    direction: "received"
  });
}

async function salvarResposta({ jid, mensagem, opcao }) {
  await sheets.appendConversation({
    date: new Date(),
    name: NOME_OFICINA,
    phone: numeroClientePorJid(jid),
    message: mensagem || "",
    matchedService: opcao || "",
    direction: "sent"
  });
}

async function responderERegistrar(jid, texto, opcao = "") {
  await sendTextMessage(jid, texto);
  await salvarResposta({ jid, mensagem: texto, opcao });
}

function getMessageText(message) {
  if (!message) return "";

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  );
}

function ehComandoAtendimentoHumano(texto) {
  return ["#assumir", "#liberar", "#status", "#renovar"].includes(normalizarTexto(texto));
}

function formatarDataAtendimentoHumano(value) {
  if (!value) return "Não informado";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatarTempoRestante(expiraEm) {
  const expireDate = new Date(expiraEm);
  if (Number.isNaN(expireDate.getTime())) return "Não informado";

  const diff = expireDate.getTime() - Date.now();
  if (diff <= 0) return "Expirado";

  const totalMinutes = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} minuto(s)`;
  return `${hours} hora(s) e ${minutes} minuto(s)`;
}

function montarStatusAtendimentoHumano(telefone, atendimento) {
  if (!atendimento) {
    return `🤖 Atendimento Humano

Cliente:
Telefone: ${telefone}

Status:
Sem atendimento humano ativo.

Atendente:
-

Início:
-

Expira:
-

Tempo restante:
-`;
  }

  return `🤖 Atendimento Humano

Cliente:
Telefone: ${telefone}

Status:
${atendimento.status || "Não informado"}

Atendente:
${atendimento.atendente || "Não informado"}

Início:
${formatarDataAtendimentoHumano(atendimento.inicio)}

Expira:
${formatarDataAtendimentoHumano(atendimento.expiraEm)}

Tempo restante:
${formatarTempoRestante(atendimento.expiraEm)}`;
}

async function processarComandoAtendimentoHumano({ jid, text, pushName, fromMe }) {
  const comando = normalizarTexto(text);
  if (!ehComandoAtendimentoHumano(comando)) return false;

  const autorizado = (fromMe && getAtendentes().length > 0) || ehAtendente(jid);
  if (!autorizado) return true;

  const telefoneCliente = telefoneLimpoPorJid(jid);
  const atendente = pushName || (fromMe ? "Atendente" : telefoneCliente);

  if (comando === "#assumir") {
    await sheets.ativarAtendimentoHumano({
      telefone: telefoneCliente,
      atendente,
      observacao: ""
    });

    await responderComandoAtendente(
      jid,
      `🤖 Atendimento humano assumido.

O bot ficará pausado por 2 horas.`,
      fromMe
    );

    return true;
  }

  if (comando === "#liberar") {
    await sheets.desativarAtendimentoHumano(telefoneCliente);

    await responderComandoAtendente(jid, "🤖 Atendimento automático reativado.", fromMe);
    return true;
  }

  if (comando === "#status") {
    const atendimento = await sheets.statusAtendimentoHumano(telefoneCliente);
    await responderComandoAtendente(
      jid,
      montarStatusAtendimentoHumano(telefoneCliente, atendimento),
      fromMe
    );
    return true;
  }

  if (comando === "#renovar") {
    const renovado = await sheets.renovarAtendimentoHumano(telefoneCliente);

    if (!renovado) {
      await responderComandoAtendente(
        jid,
        "🤖 Não encontrei atendimento humano ativo para renovar nesta conversa.",
        fromMe
      );
      return true;
    }

    await responderComandoAtendente(
      jid,
      "🤖 Atendimento humano renovado por mais 2 horas.",
      fromMe
    );
    return true;
  }

  return false;
}

async function atendimentoHumanoPausado(jid) {
  const telefone = telefoneLimpoPorJid(jid);
  const atendimento = await sheets.atendimentoHumanoEstaAtivo(telefone);
  return Boolean(atendimento);
}

async function handleIncomingMessage({ jid, text, pushName }) {
  const from = numeroClientePorJid(jid);
  const nomeCliente = pushName || "";

  if (ehMensagemDuplicada(from, text)) {
    console.log("Mensagem duplicada ignorada:", from);
    return;
  }

  if (ehAtendente(from) && ehPedidoRelatorio(text)) {
    await enviarRelatorioLeads(jid);
    return;
  }

  if (await atendimentoHumanoPausado(jid)) {
    return;
  }

  await salvarConversa({
    jid,
    nome: nomeCliente,
    mensagem: text || "menu",
    opcao: "recebida"
  });

  const foraDoHorario = !estaDentroDoHorario();
  const opcao = extrairOpcao(text);

  const pediuMenuExplicitamente = ehComandoMenu(text);
  const jaRecebeuMenu = clientesQueJaReceberamMenu.has(from);

  if (!opcao) {
    if (pediuMenuExplicitamente || !jaRecebeuMenu) {
      const menu = foraDoHorario ? montarMenu(mensagemForaDoHorario()) : montarMenu();
      await responderERegistrar(jid, menu, "menu");
      clientesQueJaReceberamMenu.add(from);
      return;
    }

    if (deveEnviarAvisoMensagemNaoEntendida(from)) {
      await responderERegistrar(
        jid,
        "Não entendi sua mensagem. Para ver as opções novamente, envie *menu*.",
        "invalido"
      );
    }
    return;
  }

  const opcaoNumericaDigitada = isExactMenuOption(text);
  const foiAcionadoPorPalavraChave = !opcaoNumericaDigitada && opcao !== "invalido";

  if (foiAcionadoPorPalavraChave && !deveResponderPalavraChaveHoje(from, opcao)) {
    return;
  }

  const resposta = await montarResposta(opcao);

  if (!resposta) {
    if (!clientesQueJaReceberamMenu.has(from)) {
      const menu = foraDoHorario ? montarMenu(mensagemForaDoHorario()) : montarMenu();
      await responderERegistrar(jid, menu, "menu");
      clientesQueJaReceberamMenu.add(from);
      return;
    }

    if (deveEnviarAvisoMensagemNaoEntendida(from)) {
      await responderERegistrar(
        jid,
        "Não entendi sua mensagem. Para ver as opções novamente, envie *menu*.",
        "invalido"
      );
    }
    return;
  }

  if (foraDoHorario) {
    await responderERegistrar(
      jid,
      `Estamos fora do horário de atendimento no momento, mas sua solicitação foi recebida.

Nossa equipe responderá assim que possível.

🕒 Horário:
${HORARIO_OFICINA}`,
      opcao
    );
  }

  await responderERegistrar(jid, resposta, opcao);

  if (opcao === "9") {
    await sheets.criarAtendimentoHumanoAguardando({
      telefone: from,
      observacao: "Solicitou atendimento humano"
    });
    await avisarPedidoAtendimentoHumano(from, nomeCliente, text);
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: process.env.LOG_LEVEL || "silent" }),
    browser: [NOME_OFICINA, "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    lastConnectionUpdate = new Date().toISOString();

    if (qr) {
      currentQr = qr;
      currentQrDataUrl = await QRCode.toDataURL(qr);
      connectionStatus = "aguardando leitura do QR Code";
      console.log("QR Code atualizado. Abra /qr no navegador.");
    }

    if (connection === "open") {
      currentQr = null;
      currentQrDataUrl = null;
      connectionStatus = "conectado";
      console.log("WhatsApp conectado.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      connectionStatus = shouldReconnect ? "reconectando" : "desconectado";
      console.log("Conexão encerrada.", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        startWhatsApp().catch((error) => console.error("Erro ao reconectar:", error));
      } else {
        console.log("Sessão encerrada. Apague a pasta de sessão e leia um novo QR Code.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      try {
        const jid = message.key.remoteJid;
        const fromMe = message.key.fromMe;
        const text = getMessageText(message.message);

        if (!jid) continue;

        const telefoneReal = registrarTelefoneRealDaMensagem(message);
        if (jid.endsWith("@lid") && !telefoneReal) {
          console.warn("Não foi possível resolver o telefone real do JID LID:", jid);
        }
        if (IGNORE_GROUPS && jid.endsWith("@g.us")) continue;
        if (!text) continue;

        const comandoProcessado = await processarComandoAtendimentoHumano({
          jid,
          text,
          pushName: message.pushName || "",
          fromMe
        });

        if (comandoProcessado) continue;
        if (fromMe) continue;

        await handleIncomingMessage({
          jid,
          text,
          pushName: message.pushName || ""
        });
      } catch (error) {
        console.error("Erro ao processar mensagem:", error);
      }
    }
  });
}

app.get("/", (req, res) => {
  res.redirect("/qr");
});

app.get("/qr", (req, res) => {
  const qrImage = currentQrDataUrl
    ? `<img src="${currentQrDataUrl}" alt="QR Code do WhatsApp" />`
    : "";

  const qrHelp = currentQrDataUrl
    ? "Abra o WhatsApp no celular principal, acesse aparelhos conectados e escaneie este QR Code."
    : "Quando a conexão pedir um novo QR Code, ele aparecerá aqui automaticamente.";

  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QR Code WhatsApp</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f7f9; color: #1f2937; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    section { width: min(520px, 100%); background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { line-height: 1.5; }
    img { display: block; width: min(340px, 100%); height: auto; margin: 24px auto; }
    .status { display: inline-block; margin-top: 8px; padding: 6px 10px; border-radius: 999px; background: #e8f5ee; color: #166534; font-size: 14px; }
    .meta { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Conexão do WhatsApp</h1>
      <div class="status">${connectionStatus}</div>
      ${qrImage}
      <p>${qrHelp}</p>
      <p class="meta">Última atualização: ${lastConnectionUpdate}</p>
    </section>
  </main>
</body>
</html>`);
});

app.get("/politica-de-privacidade", (req, res) => {
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Política de Privacidade - BG GNV Macaé</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #222; }
    h1, h2 { color: #0b1f3a; }
    p { margin-bottom: 14px; }
  </style>
</head>
<body>
  <h1>Política de Privacidade</h1>
  <p><strong>BG GNV Macaé</strong></p>
  <p>A BG GNV Macaé respeita a privacidade dos seus clientes e se compromete a proteger as informações recebidas durante o atendimento.</p>
  <h2>1. Informações coletadas</h2>
  <p>Coletamos informações fornecidas voluntariamente pelo cliente durante o contato pelo WhatsApp, como nome, número de telefone, mensagens enviadas, serviço de interesse e dados do veículo.</p>
  <h2>2. Uso das informações</h2>
  <p>As informações coletadas são utilizadas apenas para atendimento ao cliente, envio de respostas automáticas, encaminhamento para atendentes, registro de solicitações e organização interna dos atendimentos.</p>
  <h2>3. Armazenamento dos dados</h2>
  <p>Os dados podem ser armazenados em ferramentas internas, como planilhas e sistemas de atendimento, com o objetivo de melhorar o acompanhamento dos clientes.</p>
  <h2>4. Compartilhamento de dados</h2>
  <p>A BG GNV Macaé não vende, aluga ou compartilha dados pessoais dos clientes com terceiros para fins comerciais.</p>
  <h2>5. Solicitação de remoção ou atualização</h2>
  <p>O cliente pode solicitar a remoção ou atualização de seus dados entrando em contato pelo WhatsApp oficial da empresa.</p>
  <h2>6. Atualizações desta política</h2>
  <p>Esta política pode ser atualizada a qualquer momento para atender melhorias no atendimento ou exigências legais.</p>
  <h2>7. Contato</h2>
  <p><strong>BG GNV Macaé</strong><br />Endereço: ${ENDERECO_OFICINA}<br />WhatsApp: +55 22 99101-6400</p>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    whatsapp: connectionStatus,
    hasQr: Boolean(currentQr),
    updatedAt: lastConnectionUpdate
  });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}. Abra /qr para conectar o WhatsApp.`);
  startWhatsApp().catch((error) => console.error("Erro ao iniciar WhatsApp:", error));
});
