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

async function salvarLead({ nome, numero, servico, dadosCarro }) {
  const sheets = await getSheetsClient();

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leads!A:F',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        agora,
        nome || '',
        numero || '',
        servico || '',
        dadosCarro || '',
        'Novo',
      ]],
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

function converterDataBrasilParaDate(dataTexto) {
  if (!dataTexto) return null;

  const partes = String(dataTexto).split(',');
  const dataParte = partes[0]?.trim();

  if (!dataParte) return null;

  const [dia, mes, ano] = dataParte.split('/').map(Number);

  if (!dia || !mes || !ano) return null;

  return new Date(ano, mes - 1, dia);
}

async function gerarRelatorioLeads() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leads!A:F',
  });

  const rows = response.data.values || [];
  const leads = rows.slice(1);

  const hojeBrasil = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );

  const hojeInicio = new Date(
    hojeBrasil.getFullYear(),
    hojeBrasil.getMonth(),
    hojeBrasil.getDate()
  );

  const seteDiasAtras = new Date(hojeInicio);
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 6);

  let total = leads.length;
  let hoje = 0;
  let ultimos7Dias = 0;

  const porServico = {};
  const porStatus = {};

  for (const linha of leads) {
    const dataHora = linha[0] || '';
    const servico = linha[3] || 'Não informado';
    const status = linha[5] || 'Novo';

    const dataLead = converterDataBrasilParaDate(dataHora);

    if (dataLead) {
      if (dataLead.getTime() === hojeInicio.getTime()) {
        hoje++;
      }

      if (dataLead >= seteDiasAtras && dataLead <= hojeInicio) {
        ultimos7Dias++;
      }
    }

    porServico[servico] = (porServico[servico] || 0) + 1;
    porStatus[status] = (porStatus[status] || 0) + 1;
  }

  return {
    total,
    hoje,
    ultimos7Dias,
    porServico,
    porStatus,
  };
}

module.exports = {
  getValores,
  salvarConversa,
  salvarLead,
  buscarUltimasConversas,
  gerarRelatorioLeads,
};