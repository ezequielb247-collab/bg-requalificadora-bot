const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID || "";
const CONVERSATIONS_SHEET = process.env.SHEET_CONVERSAS || "Conversas";
const LEADS_SHEET = process.env.SHEET_LEADS || "Leads";

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

module.exports = {
  appendConversation,
  appendLead
};
