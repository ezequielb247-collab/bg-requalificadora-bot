require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { getValores, getValor } = require('./services/sheets');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ATENDENTE_NUMERO = process.env.ATENDENTE_NUMERO || '5522991016400';

const NOME_OFICINA = process.env.NOME_OFICINA || 'BG requalificadora';
const ENDERECO_OFICINA = process.env.ENDERECO_OFICINA || 'Av. Carlos Augusto T. Garcia - Sol e Mar, Macaé - RJ, 27940-290';
const HORARIO_OFICINA = process.env.HORARIO_OFICINA || 'Segunda a sexta: 8:00 às 18:00\nSábado: 8:00 às 12:00';

const apiUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

async function sendMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.');
    return;
  }

  try {
    await axios.post(
      apiUrl,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error.response?.data || error.message);
  }
}

async function avisarAtendente(clienteNumero, mensagemCliente) {
  const texto = `🚨 Cliente pediu atendimento humano\n\nCliente: +${clienteNumero}\nMensagem: ${mensagemCliente || 'Não informado'}\n\nEntre em contato com ele pelo WhatsApp.`;
  await sendMessage(ATENDENTE_NUMERO, texto);
}

function menuPrincipal() {
  return `Olá! Seja bem-vindo(a) à ${NOME_OFICINA} 🚗⛽\n\nEscolha uma opção:\n\n1️⃣ Reteste de GNV\n2️⃣ Retirada de kit GNV\n3️⃣ Revisão de kit GNV\n4️⃣ Ver valores dos serviços\n5️⃣ Documentos necessários\n6️⃣ Prazo de entrega\n7️⃣ Endereço e horário\n8️⃣ Falar com atendente`;
}

async function montarResposta(opcao) {
  let valores = {};

  try {
    valores = await getValores();
  } catch (error) {
    console.error('Erro ao buscar valores da planilha:', error.message);
  }

  const retesteCartao = getValor(valores, 'reteste_cartao', 'R$ 480,00');
  const retesteVista = getValor(valores, 'reteste_vista', 'R$ 450,00');
  const retiradaKit5 = getValor(valores, 'retirada_kit_5', 'R$ 500,00');
  const retiradaKit3 = getValor(valores, 'retirada_kit_3', 'R$ 400,00');
  const revisaoKit3Cartao = getValor(valores, 'revisao_kit_3_cartao', 'R$ 280,00');
  const revisaoKit3Vista = getValor(valores, 'revisao_kit_3_vista', 'R$ 250,00');
  const revisaoKit5Cartao = getValor(valores, 'revisao_kit_5_cartao', 'R$ 430,00');
  const revisaoKit5Vista = getValor(valores, 'revisao_kit_5_vista', 'R$ 400,00');

  const documentos = `📄 Documentos necessários\n\nPara reteste de GNV ou retirada de kit GNV, é necessário trazer:\n\n• Documento do carro ou documento do GNV\n• Precisa estar no nome do último proprietário do veículo`;

  const prazo = `⏱️ Prazo de entrega\n\n• Trazendo o carro de manhã, entregamos no início da tarde.\n• Trazendo o carro à tarde, entregamos no final do dia.`;

  const enderecoHorario = `📍 Endereço e horário\n\n${ENDERECO_OFICINA}\n\n🕒 Horário de funcionamento:\n${HORARIO_OFICINA}`;

  switch (opcao) {
    case '1':
      return `✅ RETESTE DE GNV\n\nValor referente a 1 cilindro:\n\n💳 Cartão: ${retesteCartao} em até 3x sem juros\n💵 À vista: ${retesteVista}\n\n📄 Documento necessário:\n• Documento do carro ou documento do GNV\n• Precisa estar no nome do último proprietário do veículo\n\n⏱️ Prazo de entrega:\n• Trazendo o carro de manhã, entregamos no início da tarde.\n• Trazendo o carro à tarde, entregamos no final do dia.\n\n📍 Endereço:\n${ENDERECO_OFICINA}\n\nPara realizar o serviço, basta trazer o carro até a oficina.`;

    case '2':
      return `✅ RETIRADA DE KIT GNV\n\nValores:\n\n• Retirada de kit GNV 5ª geração: ${retiradaKit5}\n• Retirada de kit GNV 3ª geração: ${retiradaKit3}\n\n📄 Documento necessário:\n• Documento do carro ou documento do GNV\n• Precisa estar no nome do último proprietário do veículo\n\n📍 Endereço:\n${ENDERECO_OFICINA}\n\nPara realizar o serviço, basta trazer o carro até a oficina.`;

    case '3':
      return `✅ REVISÃO DE KIT GNV\n\nValores:\n\n3ª geração:\n💳 Cartão: ${revisaoKit3Cartao} em até 3x sem juros\n💵 À vista: ${revisaoKit3Vista}\n\n5ª geração:\n💳 Cartão: ${revisaoKit5Cartao} em até 3x sem juros\n💵 À vista: ${revisaoKit5Vista}\n\n📍 Endereço:\n${ENDERECO_OFICINA}\n\nPara realizar o serviço, basta trazer o carro até a oficina.`;

    case '4':
      return `💰 Valores dos serviços\n\n• Reteste GNV no cartão: ${retesteCartao} em até 3x sem juros\n• Reteste GNV à vista: ${retesteVista}\n• Retirada de kit GNV 5ª geração: ${retiradaKit5}\n• Retirada de kit GNV 3ª geração: ${retiradaKit3}\n• Revisão kit GNV 3ª geração no cartão: ${revisaoKit3Cartao} em até 3x sem juros\n• Revisão kit GNV 3ª geração à vista: ${revisaoKit3Vista}\n• Revisão kit GNV 5ª geração no cartão: ${revisaoKit5Cartao} em até 3x sem juros\n• Revisão kit GNV 5ª geração à vista: ${revisaoKit5Vista}\n\nPara realizar o serviço, basta trazer o carro até a oficina.\n\n📍 Endereço:\n${ENDERECO_OFICINA}`;

    case '5':
      return documentos;

    case '6':
      return prazo;

    case '7':
      return enderecoHorario;

    case '8':
      return `👨‍🔧 Atendimento humano\n\nCerto! Vou encaminhar sua mensagem para um atendente.\n\nAguarde um momento, por favor.`;

    default:
      return menuPrincipal();
  }
}

app.get('/', (req, res) => {
  res.send('Bot BG Requalificadora online ✅');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.trim() || '';
    const opcao = text.replace(/[^0-9]/g, '');

    const resposta = await montarResposta(opcao);
    await sendMessage(from, resposta);

    if (opcao === '8') {
      await avisarAtendente(from, text);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
