const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();

  return google.sheets({
    version: 'v4',
    auth: client,
  });
}

async function getValores() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Valores!A:C',
  });

  const rows = response.data.values || [];
  const valores = {};

  // Pula a primeira linha, que é o cabeçalho
  for (let i = 1; i < rows.length; i++) {
    const codigo = rows[i][0];
    const valor = rows[i][2];

    if (codigo) {
      valores[codigo] = valor;
    }
  }

  return valores;
}

async function salvarConversa({ numero, nome, mensagem, opcao }) {
  const sheets = await getSheetsClient();

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Conversas!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[agora, numero, nome || '', mensagem || '', opcao || '']],
    },
  });
}

async function buscarUltimasConversas(numero, limite = 8) {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Conversas!A:E',
  });

  const rows = response.data.values || [];

  // Remove cabeçalho
  const dados = rows.slice(1);

  const conversasCliente = dados
    .filter((linha) => linha[1] === numero)
    .slice(-limite);

  return conversasCliente.map((linha) => {
    return {
      dataHora: linha[0] || '',
      numero: linha[1] || '',
      nome: linha[2] || '',
      mensagem: linha[3] || '',
      opcao: linha[4] || '',
    };
  });
}

module.exports = {
  getValores,
  salvarConversa,
  buscarUltimasConversas,
};