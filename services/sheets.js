const { google } = require('googleapis');

const SHEET_NAME = 'Valores';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function formatMoney(value) {
  const number = Number(String(value).replace(',', '.'));

  if (Number.isNaN(number)) {
    return `R$ ${value}`;
  }

  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

async function getValores() {
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID não configurado no .env');
  }

  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`
  });

  const rows = response.data.values || [];
  const dataRows = rows.slice(1);
  const valores = {};

  for (const row of dataRows) {
    const [codigo, servico, valor] = row;

    if (!codigo || valor === undefined) continue;

    valores[codigo.trim()] = {
      servico: servico || codigo,
      valor: formatMoney(valor)
    };
  }

  return valores;
}

function getValor(valores, codigo, fallback) {
  return valores[codigo]?.valor || fallback;
}

module.exports = {
  getValores,
  getValor
};
