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
const BUSINESS_NAME = process.env.BUSINESS_NAME || "BG GNV Macae";
const IGNORE_GROUPS = (process.env.IGNORE_GROUPS || "true").toLowerCase() === "true";

let sock;
let currentQr = null;
let currentQrDataUrl = null;
let connectionStatus = "iniciando";
let lastConnectionUpdate = new Date().toISOString();
const recentLeadAlerts = new Map();
const pendingLeads = new Map();
const customerLastServices = new Map();

const address = {
  text: "Av. Carlos Augusto T. Garcia, no 1618-B - Sol e Mar, Macae - RJ, CEP 27940-290",
  maps: "https://www.google.com/maps?q=-22.3914399,-41.7426833",
  hours: [
    "Segunda a sexta: 8:00 as 12:00 e 13:00 as 18:00",
    "Sabado: 8:00 as 12:00"
  ]
};

const services = [
  {
    id: "1",
    name: "Reteste cilindro GNV",
    aliases: ["reteste", "reteste cilindro", "cilindro", "validade do cilindro", "vencido", "cilindro vencido", "teste do cilindro", "retestar", "reteste gnv"],
    priceLines: ["Cartao: R$ 480,00 em ate 3x sem juros", "A vista: R$ 450,00"],
    details: [
      "Documento necessario: documento do carro ou documento do GNV no nome do ultimo proprietario",
      "Prazo: se o carro chegar de manha, entrega no final da tarde; se chegar a tarde, entrega no outro dia pela manha"
    ],
    vehiclePrompt: "Para adiantar o atendimento do reteste, envie por favor: modelo e ano do veiculo, placa, validade do cilindro se souber, e se o documento esta no seu nome ou no nome do ultimo proprietario."
  },
  {
    id: "2",
    name: "Retirada de kit GNV",
    aliases: ["retirada", "retirar kit", "retirada kit", "remover kit", "remocao de kit", "remoção de kit", "tirar kit", "tirar o gas", "tirar gnv", "retirada do 3", "retirada de 3", "retirada 3", "retirada terceira", "retirada 5", "retirada quinta", "retirar 3 geracao", "retirar 5 geracao", "kit fora"],
    priceLines: [
      "Kit 5a geracao: cartao R$ 530,00 em ate 3x sem juros | a vista R$ 500,00",
      "Kit 3a geracao: cartao R$ 430,00 em ate 3x sem juros | a vista R$ 400,00"
    ],
    details: ["Documento necessario: documento do carro ou documento do GNV no nome do ultimo proprietario"],
    vehiclePrompt: "Para adiantar a retirada do kit, envie por favor: modelo e ano do veiculo, placa, se o kit e 3a ou 5a geracao, e se o documento esta no seu nome ou no nome do ultimo proprietario."
  },
  {
    id: "3",
    name: "Revisao kit GNV",
    aliases: ["revisao", "revisão", "revisar", "manutencao", "manutenção", "regulagem", "regular gnv", "kit falhando", "carro falhando", "nao pega no gas", "não pega no gás", "cheiro de gas", "vazamento", "perda de rendimento", "consumo alto", "revisao do kit", "revisao 3", "revisao 5"],
    priceLines: [
      "3a geracao: cartao R$ 280,00 em ate 3x sem juros | a vista R$ 250,00",
      "5a geracao: cartao R$ 430,00 em ate 3x sem juros | a vista R$ 400,00"
    ],
    details: [],
    vehiclePrompt: "Para adiantar a revisao, envie por favor: modelo e ano do veiculo, placa, se o kit e 3a ou 5a geracao, e qual problema esta acontecendo."
  },
  {
    id: "4",
    name: "Instalacao GNV",
    aliases: ["instalacao", "instalação", "instalar", "instalar gnv", "colocar gnv", "colocar gas", "botar gnv", "converter para gnv", "conversao gnv", "conversão gnv", "kit novo", "instalacao de kit"],
    priceLines: ["Valor negociado diretamente com atendente, porque varia por veiculo, tipo de kit e condicoes de instalacao"],
    details: [],
    vehiclePrompt: "Para adiantar a instalacao, envie por favor: modelo e ano do veiculo, motor, se deseja kit 3a ou 5a geracao, e se ja possui algum kit."
  },
  {
    id: "5",
    name: "Limpeza de bico",
    aliases: ["limpeza de bico", "limpar bico", "bico", "bicos", "bico injetor", "bicos injetores", "limpeza dos bicos", "limpeza bicos"],
    priceLines: ["Cartao: R$ 180,00 em ate 3x sem juros", "A vista: R$ 150,00"],
    details: [],
    vehiclePrompt: "Para adiantar a limpeza de bico, envie por favor: modelo e ano do veiculo, motor, placa, e o sintoma que percebeu."
  },
  {
    id: "6",
    name: "Limpeza de sistema de arrefecimento",
    aliases: ["arrefecimento", "limpeza de arrefecimento", "sistema de arrefecimento", "radiador", "limpeza radiador", "aditivo", "agua do radiador", "água do radiador", "maquina de arrefecimento", "máquina de arrefecimento"],
    priceLines: ["Com maquina e aditivo incluso", "Cartao: R$ 330,00 em ate 3x sem juros", "A vista: R$ 300,00"],
    details: [],
    vehiclePrompt: "Para adiantar a limpeza do sistema de arrefecimento, envie por favor: modelo e ano do veiculo, motor, placa, e se esta com aquecimento, ferrugem ou vazamento."
  },
  {
    id: "7",
    name: "Documentos",
    aliases: ["documento", "documentos", "doc", "docs", "documentacao", "documentação", "precisa de documento", "quais documentos", "documento necessario", "documento necessário"],
    priceLines: [],
    details: ["Documento do carro ou documento do GNV no nome do ultimo proprietario"],
    vehiclePrompt: "Para conferir a documentacao, envie por favor uma foto ou os dados do documento do carro ou do GNV no nome do ultimo proprietario."
  },
  {
    id: "8",
    name: "Endereco e horario",
    aliases: ["endereco", "endereço", "localizacao", "localização", "onde fica", "maps", "mapa", "horario", "horário", "abre que horas", "funciona", "sabado", "sábado", "como chegar"],
    priceLines: [],
    details: [address.text, `Google Maps: ${address.maps}`, ...address.hours],
    vehiclePrompt: ""
  },
  {
    id: "9",
    name: "Falar com atendente",
    aliases: ["atendente", "falar com atendente", "humano", "consultor", "vendedor", "equipe", "whatsapp", "ligar", "telefone", "duvida", "dúvida"],
    priceLines: [],
    details: ["Um atendente da BG GNV Macae vai continuar o atendimento por aqui."],
    vehiclePrompt: "Para agilizar, envie por favor seu nome, servico desejado e modelo/ano do veiculo."
  }
];

const greetingKeywords = [
  "oi",
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
  "menu",
  "inicio",
  "início",
  "comecar",
  "começar",
  "opcoes",
  "opções",
  "servicos",
  "serviços",
  "atendimento"
];

const priceKeywords = [
  "valor",
  "valores",
  "preco",
  "preço",
  "quanto",
  "quanto custa",
  "quanto e",
  "quanto é",
  "custa quanto",
  "tabela",
  "orcamento",
  "orçamento",
  "parcelamento",
  "cartao",
  "cartão",
  "a vista",
  "avista"
];

const interestKeywords = [
  "tenho interesse",
  "quero fazer",
  "quero agendar",
  "quero marcar",
  "quero atendimento",
  "quero falar",
  "preciso fazer",
  "preciso agendar",
  "pode agendar",
  "vamos fazer",
  "vou levar",
  "posso levar",
  "fechar",
  "contratar",
  "marcar horario",
  "marcar horário",
  "agendar",
  "agenda",
  "atendente",
  "falar com atendente"
];

function normalizeText(text = "") {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasAnyKeyword(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isExactMenuOption(text) {
  const normalized = normalizeText(text).trim();
  return /^[1-9]$/.test(normalized) ? normalized : null;
}

function isLeadCancelCommand(text) {
  const normalized = normalizeText(text).trim();
  return ["cancelar", "cancela", "cancel", "menu"].includes(normalized);
}

function buildMenuMessage() {
  const options = services.map((service) => `${service.id}. ${service.name}`).join("\n");

  return [
    `Ola! Aqui e da ${BUSINESS_NAME}.`,
    "",
    "Escolha uma opcao digitando o numero ou escreva o que voce precisa:",
    options,
    "",
    "Se quiser a tabela completa, digite: valores."
  ].join("\n");
}

function buildPricesMessage() {
  return [
    "Tabela de valores BG GNV Macae:",
    "",
    "1. Reteste cilindro GNV",
    "Cartao: R$ 480,00 em ate 3x sem juros",
    "A vista: R$ 450,00",
    "",
    "2. Retirada de kit GNV",
    "Kit 5a geracao: cartao R$ 530,00 em ate 3x sem juros | a vista R$ 500,00",
    "Kit 3a geracao: cartao R$ 430,00 em ate 3x sem juros | a vista R$ 400,00",
    "",
    "3. Revisao kit GNV",
    "3a geracao: cartao R$ 280,00 em ate 3x sem juros | a vista R$ 250,00",
    "5a geracao: cartao R$ 430,00 em ate 3x sem juros | a vista R$ 400,00",
    "",
    "4. Instalacao GNV",
    "Valor negociado diretamente com atendente, porque varia por veiculo, tipo de kit e condicoes de instalacao",
    "",
    "5. Limpeza de bico",
    "Cartao: R$ 180,00 em ate 3x sem juros",
    "A vista: R$ 150,00",
    "",
    "6. Limpeza de sistema de arrefecimento",
    "Com maquina e aditivo incluso",
    "Cartao: R$ 330,00 em ate 3x sem juros",
    "A vista: R$ 300,00",
    "",
    "Para continuar, responda com o numero do servico ou escreva: quero atendimento."
  ].join("\n");
}

function buildPriceReply(matchedService) {
  if (!matchedService) return buildPricesMessage();

  return [
    buildPricesMessage(),
    "",
    `Pelo que entendi, sua duvida e sobre: ${matchedService.name}.`,
    "Se quiser seguir com esse servico, responda: quero agendar."
  ].join("\n");
}

function buildServiceMessage(service) {
  if (service.id === "8") {
    return [
      "Endereco e horario da BG GNV Macae:",
      "",
      address.text,
      `Google Maps: ${address.maps}`,
      "",
      ...address.hours
    ].join("\n");
  }

  if (service.id === "9") {
    return [
      "Perfeito. Vou avisar nossa equipe para continuar o atendimento por aqui.",
      "",
      service.vehiclePrompt
    ].join("\n");
  }

  return [
    service.name,
    "",
    ...service.priceLines,
    service.priceLines.length ? "" : null,
    ...service.details,
    "",
    "Se quiser seguir com esse servico, responda: quero agendar."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLeadReply(service) {
  const serviceName = service?.name || "atendimento";
  const prompt = service?.vehiclePrompt || "Para agilizar, envie por favor seu nome, servico desejado e modelo/ano do veiculo.";

  return [
    `Perfeito. Vou separar seu atendimento sobre ${serviceName}.`,
    "Para agilizar, me envie os dados abaixo:",
    "",
    prompt,
    "",
    "Se quiser desistir desse atendimento, digite: cancelar."
  ].join("\n");
}

function buildLeadConfirmation(service) {
  const serviceName = service?.name || "atendimento";

  return [
    "Recebi os dados do veiculo. Obrigado!",
    `Ja avisei nossa equipe sobre ${serviceName}.`,
    "Em breve um atendente continua o atendimento por aqui."
  ].join("\n");
}

function findServiceByMessage(text) {
  const option = isExactMenuOption(text);
  if (option) return services.find((service) => service.id === option);

  const normalized = normalizeText(text);
  let bestMatch = null;

  for (const service of services) {
    let score = 0;

    for (const alias of service.aliases) {
      const normalizedAlias = normalizeText(alias);
      if (normalized.includes(normalizedAlias)) {
        score += normalizedAlias.length > 6 ? 4 : 2;
      }
    }

    if (service.id === "2" && /\b(retirad|retirar|remover|tirar|remocao)\b/.test(normalized)) {
      score += 10;
    }

    if (service.id === "3" && /\b(revis|manutenc|regulag|falhand|vazament)\b/.test(normalized)) {
      score += 8;
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { service, score };
    }
  }

  return bestMatch?.service || null;
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

function formatJid(numberOrJid) {
  const value = (numberOrJid || "").trim();
  if (!value) return null;
  if (value.includes("@")) return value;

  const digits = value.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function getAttendantJids() {
  return (process.env.ATTENDANT_NUMBERS || "")
    .split(",")
    .map(formatJid)
    .filter(Boolean);
}

function shouldNotifyLead(customerJid) {
  const now = Date.now();
  const lastAlert = recentLeadAlerts.get(customerJid) || 0;
  const cooldownMs = 30 * 60 * 1000;

  if (now - lastAlert < cooldownMs) return false;

  recentLeadAlerts.set(customerJid, now);
  return true;
}

function getCustomerNumber(jid) {
  return (jid || "").split("@")[0];
}

async function sendText(to, text) {
  if (!sock) return;
  await sock.sendMessage(to, { text });
}

async function notifyAttendants({ customerJid, customerName, text, matchedService }) {
  const attendants = getAttendantJids();
  if (!attendants.length || !shouldNotifyLead(customerJid)) return;

  const customerNumber = getCustomerNumber(customerJid);
  const serviceLine = matchedService ? `Servico: ${matchedService.name}` : "Servico: nao identificado";
  const alert = [
    "Novo cliente demonstrou interesse - BG GNV Macae.",
    "",
    `Cliente: ${customerName || customerNumber}`,
    `WhatsApp: ${customerNumber}`,
    serviceLine,
    `Mensagem: ${text}`
  ].join("\n");

  await Promise.all(attendants.map((jid) => sendText(jid, alert)));
}

async function handleIncomingMessage({ jid, text, pushName }) {
  const matchedService = findServiceByMessage(text);
  const rememberedService = customerLastServices.get(jid);
  const isGreeting = hasAnyKeyword(text, greetingKeywords);
  const asksPrice = hasAnyKeyword(text, priceKeywords);
  const showsInterest = hasAnyKeyword(text, interestKeywords) || matchedService?.id === "9";
  const pendingLead = pendingLeads.get(jid);

  await sheets.appendConversation({
    date: new Date(),
    name: pushName || "",
    phone: getCustomerNumber(jid),
    message: text,
    matchedService: matchedService?.name || "",
    direction: "received"
  });

  let reply;

  if (pendingLead && isLeadCancelCommand(text)) {
    pendingLeads.delete(jid);
    reply = normalizeText(text).trim() === "menu"
      ? buildMenuMessage()
      : "Tudo bem, cancelei essa solicitacao. Se precisar, digite menu para ver as opcoes.";
  } else if (pendingLead) {
    const pendingService = pendingLead.service;
    const vehicleData = text;

    await sheets.appendLead({
      date: new Date(),
      name: pushName || "",
      phone: getCustomerNumber(jid),
      message: vehicleData,
      service: pendingService?.name || ""
    });

    await notifyAttendants({
      customerJid: jid,
      customerName: pushName,
      text: vehicleData,
      matchedService: pendingService
    });

    pendingLeads.delete(jid);
    reply = buildLeadConfirmation(pendingService);
  } else if (showsInterest) {
    const serviceForLead = matchedService || rememberedService || services.find((service) => service.id === "9");

    pendingLeads.set(jid, {
      service: serviceForLead,
      requestedAt: new Date().toISOString(),
      interestMessage: text,
      customerName: pushName || ""
    });

    reply = buildLeadReply(serviceForLead);
  } else if (asksPrice) {
    reply = buildPriceReply(matchedService);
  } else if (matchedService) {
    reply = buildServiceMessage(matchedService);
  } else if (isGreeting) {
    reply = buildMenuMessage();
  } else {
    reply = [
      "Entendi. Para te direcionar melhor, escolha uma das opcoes abaixo:",
      "",
      buildMenuMessage()
    ].join("\n");
  }

  if (matchedService && matchedService.id !== "8") {
    customerLastServices.set(jid, matchedService);
  }

  await sendText(jid, reply);
  await sheets.appendConversation({
    date: new Date(),
    name: BUSINESS_NAME,
    phone: getCustomerNumber(jid),
    message: reply,
    matchedService: matchedService?.name || "",
    direction: "sent"
  });
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: process.env.LOG_LEVEL || "silent" }),
    browser: [BUSINESS_NAME, "Chrome", "1.0.0"]
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
      console.log("Conexao encerrada.", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        startWhatsApp().catch((error) => console.error("Erro ao reconectar:", error));
      } else {
        console.log("Sessao encerrada. Apague a pasta de sessao e leia um novo QR Code.");
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

        if (!jid || fromMe) continue;
        if (IGNORE_GROUPS && jid.endsWith("@g.us")) continue;
        if (!text) continue;

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
    : "Quando a conexao pedir um novo QR Code, ele aparecera aqui automaticamente.";

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
      <h1>Conexao do WhatsApp</h1>
      <div class="status">${connectionStatus}</div>
      ${qrImage}
      <p>${qrHelp}</p>
      <p class="meta">Ultima atualizacao: ${lastConnectionUpdate}</p>
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
  <title>Politica de Privacidade</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; }
    main { max-width: 820px; margin: 0 auto; padding: 40px 20px; }
  </style>
</head>
<body>
  <main>
    <h1>Politica de Privacidade</h1>
    <p>Coletamos apenas as informacoes enviadas voluntariamente pelo usuario durante o atendimento pelo WhatsApp, como nome, telefone, mensagem e interesse no servico.</p>
    <p>Essas informacoes sao usadas para responder solicitacoes, registrar atendimentos e encaminhar oportunidades para a equipe responsavel.</p>
    <p>Os dados podem ser armazenados em planilhas internas de controle e nao sao vendidos a terceiros.</p>
    <p>Para solicitar remocao ou correcao de dados, entre em contato pelos canais oficiais da empresa.</p>
  </main>
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
