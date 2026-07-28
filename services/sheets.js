const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID || "";
const CONVERSATIONS_SHEET = process.env.SHEET_CONVERSAS || "Conversas";
const LEADS_SHEET = process.env.SHEET_LEADS || "Leads";
const VALUES_SHEET = process.env.SHEET_VALORES || "Valores";
const HUMAN_SERVICE_SHEET = process.env.SHEET_ATENDIMENTO_HUMANO || "AtendimentoHumano";
const HUMAN_SERVICE_HEADERS = ["Telefone", "Status", "Inicio", "ExpiraEm", "Atendente", "Observacao"];

let sheetsClientPromise;

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  }

  return undefined;
}

async function getSheetsClient() {
  if (!SPREADSHEET_ID) return null;

  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: getCredentials(),
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    sheetsClientPromise = auth.getClient()
      .then((authClient) =>
        google.sheets({
          version: "v4",
          auth: authClient
        })
      )
      .catch((error) => {
        sheetsClientPromise = null;
        throw error;
      });
  }

  return sheetsClientPromise;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
}

async function getSpreadsheetMetadata(client) {
  const response = await client.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  return response.data;
}

async function ensureSheet(sheetName, headers = null) {
  const client = await getSheetsClient();
  if (!client) return null;

  const spreadsheet = await getSpreadsheetMetadata(client);
  const existingSheet = spreadsheet.sheets?.find((sheet) => sheet.properties?.title === sheetName);

  if (!existingSheet) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  if (headers) {
    const rows = await getRows(sheetName);
    if (!rows.length) {
      await client.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:${String.fromCharCode(64 + headers.length)}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [headers]
        }
      });
    }
  }

  return client;
}

async function appendRow(sheetName, values) {
  try {
    const client = await ensureSheet(sheetName);
    if (!client) {
      console.warn("Google Sheets nao configurado. Defina GOOGLE_SHEETS_ID e as credenciais.");
      return false;
    }

    await client.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values]
      }
    });

    return true;
  } catch (error) {
    console.error(`Erro ao salvar na aba ${sheetName}:`, error.message);
    return false;
  }
}

async function getRows(sheetName) {
  const client = await getSheetsClient();
  if (!client) {
    console.warn("Google Sheets nao configurado. Defina GOOGLE_SHEETS_ID e as credenciais.");
    return [];
  }

  try {
    const response = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`
    });

    return response.data.values || [];
  } catch (error) {
    if (error.code !== 400) {
      console.error(`Erro ao ler a aba ${sheetName}:`, error.message);
    }
    return [];
  }
}

async function updateRow(sheetName, rowNumber, values) {
  const client = await ensureSheet(sheetName);
  if (!client) return;

  await client.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values]
    }
  });
}

async function deleteRow(sheetName, rowNumber) {
  const client = await ensureSheet(sheetName);
  if (!client) return;

  const spreadsheet = await getSpreadsheetMetadata(client);
  const sheet = spreadsheet.sheets?.find((item) => item.properties?.title === sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined) return;

  await client.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function parseHumanServiceRow(row, rowNumber) {
  return {
    rowNumber,
    telefone: normalizePhone(row[0]),
    status: row[1] || "",
    inicio: row[2] || "",
    expiraEm: row[3] || "",
    atendente: row[4] || "",
    observacao: row[5] || ""
  };
}

async function appendConversation({ date, name, phone, message, matchedService, direction }) {
  await appendRow(CONVERSATIONS_SHEET, [
    formatDate(date),
    direction || "",
    name || "",
    phone || "",
    matchedService || "",
    message || ""
  ]);
}

async function appendLead({ date, name, phone, message, service }) {
  await appendRow(LEADS_SHEET, [
    formatDate(date),
    name || "",
    phone || "",
    service || "",
    message || "",
    "Novo"
  ]);
}

async function getValores() {
  const rows = await getRows(VALUES_SHEET);
  const valores = {};

  for (const row of rows) {
    const key = row[0];
    const value = row[1];
    if (key) valores[String(key).trim()] = value;
  }

  return valores;
}

function sameBrazilDate(dateA, dateB) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(dateA) === formatter.format(dateB);
}

function increment(target, key) {
  const name = key || "Nao informado";
  target[name] = (target[name] || 0) + 1;
}

async function gerarRelatorioLeads() {
  const rows = await getRows(LEADS_SHEET);
  const dataRows = rows.slice(1);
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const relatorio = {
    total: 0,
    hoje: 0,
    ultimos7Dias: 0,
    porServico: {},
    porStatus: {}
  };

  for (const row of dataRows) {
    if (!row || row.length === 0) continue;

    const date = new Date(row[0]);
    const service = row[3] || "";
    const status = row[5] || "Novo";

    relatorio.total += 1;
    increment(relatorio.porServico, service);
    increment(relatorio.porStatus, status);

    if (!Number.isNaN(date.getTime())) {
      if (sameBrazilDate(date, now)) relatorio.hoje += 1;
      if (date >= sevenDaysAgo) relatorio.ultimos7Dias += 1;
    }
  }

  return relatorio;
}

async function listarAtendimentosHumanos() {
  await ensureSheet(HUMAN_SERVICE_SHEET, HUMAN_SERVICE_HEADERS);
  const rows = await getRows(HUMAN_SERVICE_SHEET);

  return rows.slice(1).map((row, index) => parseHumanServiceRow(row, index + 2));
}

async function buscarAtendimentoHumano(telefone) {
  const phone = normalizePhone(telefone);
  const atendimentos = await listarAtendimentosHumanos();

  return atendimentos.find((item) => item.telefone === phone) || null;
}

async function finalizarAtendimentoHumano(atendimento, observacao = "Expirado automaticamente") {
  if (!atendimento?.rowNumber) return;

  await updateRow(HUMAN_SERVICE_SHEET, atendimento.rowNumber, [
    atendimento.telefone,
    "FINALIZADO",
    atendimento.inicio,
    atendimento.expiraEm,
    atendimento.atendente,
    observacao
  ]);
}

async function salvarAtendimentoHumano({
  telefone,
  status,
  inicio,
  expiraEm,
  atendente = "",
  observacao = ""
}) {
  await ensureSheet(HUMAN_SERVICE_SHEET, HUMAN_SERVICE_HEADERS);
  const phone = normalizePhone(telefone);
  const existente = await buscarAtendimentoHumano(phone);
  const values = [
    phone,
    status,
    formatDate(inicio),
    formatDate(expiraEm),
    atendente || "",
    observacao || ""
  ];

  if (existente) {
    await updateRow(HUMAN_SERVICE_SHEET, existente.rowNumber, values);
  } else {
    await appendRow(HUMAN_SERVICE_SHEET, values);
  }

  return parseHumanServiceRow(values, existente?.rowNumber || null);
}

async function criarAtendimentoHumanoAguardando({ telefone, observacao = "Solicitou atendimento humano" }) {
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 15 * 60 * 1000);

  return salvarAtendimentoHumano({
    telefone,
    status: "AGUARDANDO",
    inicio: agora,
    expiraEm,
    atendente: "",
    observacao
  });
}

async function ativarAtendimentoHumano({ telefone, atendente, observacao = "" }) {
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 2 * 60 * 60 * 1000);

  return salvarAtendimentoHumano({
    telefone,
    status: "ATIVO",
    inicio: agora,
    expiraEm,
    atendente,
    observacao
  });
}


async function assumirOuRenovarAtendimentoHumano({
  telefone,
  atendente = "Atendente",
  observacao = "Atendente respondeu manualmente"
}) {
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
  const existente = await buscarAtendimentoHumano(telefone);

  return salvarAtendimentoHumano({
    telefone,
    status: "ATIVO",
    inicio: existente?.inicio || agora,
    expiraEm,
    atendente: atendente || existente?.atendente || "Atendente",
    observacao: observacao || existente?.observacao || ""
  });
}

async function desativarAtendimentoHumano(telefone) {
  const atendimento = await buscarAtendimentoHumano(telefone);
  if (!atendimento) return false;

  await deleteRow(HUMAN_SERVICE_SHEET, atendimento.rowNumber);
  return true;
}

async function renovarAtendimentoHumano(telefone) {
  const atendimento = await buscarAtendimentoHumano(telefone);
  if (!atendimento) return null;

  const base = new Date(atendimento.expiraEm);
  const agora = new Date();
  const inicioRenovacao = !Number.isNaN(base.getTime()) && base > agora ? base : agora;
  const expiraEm = new Date(inicioRenovacao.getTime() + 2 * 60 * 60 * 1000);

  await updateRow(HUMAN_SERVICE_SHEET, atendimento.rowNumber, [
    atendimento.telefone,
    "ATIVO",
    atendimento.inicio || formatDate(agora),
    formatDate(expiraEm),
    atendimento.atendente,
    atendimento.observacao
  ]);

  return {
    ...atendimento,
    status: "ATIVO",
    expiraEm: formatDate(expiraEm)
  };
}

async function statusAtendimentoHumano(telefone) {
  const atendimento = await buscarAtendimentoHumano(telefone);
  if (!atendimento) return null;

  return atendimento;
}

async function atendimentoHumanoEstaAtivo(telefone) {
  const atendimento = await buscarAtendimentoHumano(telefone);
  if (!atendimento) return null;

  const expiraEm = new Date(atendimento.expiraEm);
  if (
    ["ATIVO", "AGUARDANDO"].includes(atendimento.status) &&
    !Number.isNaN(expiraEm.getTime()) &&
    expiraEm > new Date()
  ) {
    return atendimento;
  }

  if (["ATIVO", "AGUARDANDO"].includes(atendimento.status)) {
    await finalizarAtendimentoHumano(atendimento);
  }

  return null;
}

module.exports = {
  appendConversation,
  appendLead,
  getValores,
  gerarRelatorioLeads,
  criarAtendimentoHumanoAguardando,
  ativarAtendimentoHumano,
  assumirOuRenovarAtendimentoHumano,
  desativarAtendimentoHumano,
  buscarAtendimentoHumano,
  renovarAtendimentoHumano,
  statusAtendimentoHumano,
  atendimentoHumanoEstaAtivo
};
