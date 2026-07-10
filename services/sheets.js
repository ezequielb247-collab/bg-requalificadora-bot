const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID || "";
const CONVERSATIONS_SHEET = process.env.SHEET_CONVERSAS || "Conversas";
const LEADS_SHEET = process.env.SHEET_LEADS || "Leads";
const VALUES_SHEET = process.env.SHEET_VALORES || "Valores";

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

    sheetsClientPromise = auth.getClient().then((authClient) =>
      google.sheets({
        version: "v4",
        auth: authClient
      })
    );
  }

  return sheetsClientPromise;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
}

async function appendRow(sheetName, values) {
  const client = await getSheetsClient();
  if (!client) {
    console.warn("Google Sheets nao configurado. Defina GOOGLE_SHEETS_ID e as credenciais.");
    return;
  }

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values]
      }
    });
  } catch (error) {
    console.error(`Erro ao salvar na aba ${sheetName}:`, error.message);
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
    console.error(`Erro ao ler a aba ${sheetName}:`, error.message);
    return [];
  }
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

module.exports = {
  appendConversation,
  appendLead,
  getValores,
  gerarRelatorioLeads
};
