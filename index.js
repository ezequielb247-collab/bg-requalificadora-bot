require('dotenv').config();

const express = require('express');
const axios = require('axios');

const {
  getValores,
  salvarConversa,
  buscarUltimasConversas,
} = require('./services/sheets');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const ATENDENTE_NUMERO = process.env.ATENDENTE_NUMERO;

const NOME_OFICINA = process.env.NOME_OFICINA || 'BG requalificadora';

const ENDERECO_OFICINA =
  process.env.ENDERECO_OFICINA ||
  'Av. Carlos Augusto T. Garcia - Sol e Mar, Macaé - RJ, 27940-290';

const HORARIO_OFICINA =
  process.env.HORARIO_OFICINA ||
  'Segunda a sexta: 8:00 às 18:00\nSábado: 8:00 às 12:00';

function normalizarNumero(valor, padrao) {
  if (valor === undefined || valor === null || valor === '') {
    return padrao;
  }

  const limpo = String(valor)
    .replace('R$', '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const numero = Number(limpo);

  return Number.isFinite(numero) ? numero : padrao;
}

function formatarMoeda(valor) {
  const numero = Number(valor || 0);

  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

async function carregarValores() {
  try {
    const valores = await getValores();

    return {
      reteste_cartao: normalizarNumero(valores.reteste_cartao, 480),
      reteste_vista: normalizarNumero(valores.reteste_vista, 450),
      retirada_kit_5: normalizarNumero(valores.retirada_kit_5, 500),
      retirada_kit_3: normalizarNumero(valores.retirada_kit_3, 400),
      revisao_kit_3_cartao: normalizarNumero(valores.revisao_kit_3_cartao, 280),
      revisao_kit_3_vista: normalizarNumero(valores.revisao_kit_3_vista, 250),
      revisao_kit_5_cartao: normalizarNumero(valores.revisao_kit_5_cartao, 430),
      revisao_kit_5_vista: normalizarNumero(valores.revisao_kit_5_vista, 400),
    };
  } catch (error) {
    console.error('❌ Erro ao carregar valores da planilha:', error.message);

    return {
      reteste_cartao: 480,
      reteste_vista: 450,
      retirada_kit_5: 500,
      retirada_kit_3: 400,
      revisao_kit_3_cartao: 280,
      revisao_kit_3_vista: 250,
      revisao_kit_5_cartao: 430,
      revisao_kit_5_vista: 400,
    };
  }
}

async function montarResposta(opcao) {
  const valores = await carregarValores();

  if (opcao === '1') {
    return `✅ RETESTE DE GNV

Valor referente a 1 cilindro:

💳 Cartão: ${formatarMoeda(valores.reteste_cartao)} em até 3x sem juros
💵 À vista: ${formatarMoeda(valores.reteste_vista)}

📄 Documento necessário:
• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

⏱️ Prazo de entrega:
• Trazendo o carro de manhã, entregamos no início da tarde.
• Trazendo o carro à tarde, entregamos no final do dia.

📍 Endereço:
${ENDERECO_OFICINA}

Para realizar o serviço, basta trazer o carro até a oficina.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '2') {
    return `✅ RETIRADA DE KIT GNV

Valores:

• Retirada de kit GNV 5ª geração: ${formatarMoeda(valores.retirada_kit_5)}
• Retirada de kit GNV 3ª geração: ${formatarMoeda(valores.retirada_kit_3)}

📄 Documento necessário:
• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

📍 Endereço:
${ENDERECO_OFICINA}

Para realizar o serviço, basta trazer o carro até a oficina.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '3') {
    return `✅ REVISÃO DE KIT GNV

Valores:

3ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_3_cartao)} em até 3x sem juros
💵 À vista: ${formatarMoeda(valores.revisao_kit_3_vista)}

5ª geração:
💳 Cartão: ${formatarMoeda(valores.revisao_kit_5_cartao)} em até 3x sem juros
💵 À vista: ${formatarMoeda(valores.revisao_kit_5_vista)}

📍 Endereço:
${ENDERECO_OFICINA}

Para realizar o serviço, basta trazer o carro até a oficina.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '4') {
    return `✅ INSTALAÇÃO DE KIT GNV

O valor da instalação é negociado diretamente com o atendente, pois pode variar conforme o veículo e o tipo de kit.

👨‍🔧 Nossa equipe foi avisada e vai te orientar melhor.

📍 Endereço:
${ENDERECO_OFICINA}

Aguarde um momento, por favor.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '5') {
    return `💰 VALORES DOS SERVIÇOS

✅ Reteste de GNV:
• Cartão: ${formatarMoeda(valores.reteste_cartao)} em até 3x sem juros
• À vista: ${formatarMoeda(valores.reteste_vista)}

✅ Retirada de kit GNV:
• 5ª geração: ${formatarMoeda(valores.retirada_kit_5)}
• 3ª geração: ${formatarMoeda(valores.retirada_kit_3)}

✅ Revisão de kit GNV:

3ª geração:
• Cartão: ${formatarMoeda(valores.revisao_kit_3_cartao)} em até 3x sem juros
• À vista: ${formatarMoeda(valores.revisao_kit_3_vista)}

5ª geração:
• Cartão: ${formatarMoeda(valores.revisao_kit_5_cartao)} em até 3x sem juros
• À vista: ${formatarMoeda(valores.revisao_kit_5_vista)}

✅ Instalação de kit GNV:
• Valor negociado diretamente com o atendente

📍 Endereço:
${ENDERECO_OFICINA}

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '6') {
    return `📄 DOCUMENTOS NECESSÁRIOS

Para reteste de GNV ou retirada de kit GNV, é necessário trazer:

• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

Para instalação de kit GNV, fale com o atendente para receber a orientação correta.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '7') {
    return `⏱️ PRAZO DE ENTREGA

• Trazendo o carro de manhã, entregamos no início da tarde.
• Trazendo o carro à tarde, entregamos no final do dia.

Para instalação de kit GNV, o prazo deve ser confirmado diretamente com o atendente.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '8') {
    return `📍 ENDEREÇO E HORÁRIO

${NOME_OFICINA}

📍 Endereço:
${ENDERECO_OFICINA}

🕒 Horário de funcionamento:
${HORARIO_OFICINA}

Para realizar o serviço, basta trazer o carro até a oficina.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '9') {
    return `👨‍🔧 ATENDIMENTO HUMANO

Certo! Já avisei nossa equipe.

Aguarde um momento, por favor.`;
  }

  return null;
}

async function sendTextMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.');
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: text,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Mensagem de texto enviada:', response.data);
  } catch (error) {
    console.error(
      '❌ Erro ao enviar mensagem de texto:',
      error.response?.data || error.message
    );
  }
}

async function sendMenuInterativo(to) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.');
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: {
            type: 'text',
            text: 'BG requalificadora',
          },
          body: {
            text: `Olá! Seja bem-vindo(a) à ${NOME_OFICINA} 🚗⛽\n\nToque no botão abaixo e escolha uma opção:`,
          },
          footer: {
            text: 'Atendimento automático',
          },
          action: {
            button: 'Ver opções',
            sections: [
              {
                title: 'Serviços e informações',
                rows: [
                  {
                    id: 'opcao_1',
                    title: 'Reteste de GNV',
                    description: 'Valores, documentos e prazo',
                  },
                  {
                    id: 'opcao_2',
                    title: 'Retirada kit GNV',
                    description: '3ª e 5ª geração',
                  },
                  {
                    id: 'opcao_3',
                    title: 'Revisão kit GNV',
                    description: '3ª e 5ª geração',
                  },
                  {
                    id: 'opcao_4',
                    title: 'Instalação GNV',
                    description: 'Valor com atendente',
                  },
                  {
                    id: 'opcao_5',
                    title: 'Valores',
                    description: 'Tabela de serviços',
                  },
                  {
                    id: 'opcao_6',
                    title: 'Documentos',
                    description: 'O que precisa trazer',
                  },
                  {
                    id: 'opcao_7',
                    title: 'Prazo de entrega',
                    description: 'Manhã ou tarde',
                  },
                  {
                    id: 'opcao_8',
                    title: 'Endereço e horário',
                    description: 'Localização da oficina',
                  },
                  {
                    id: 'opcao_9',
                    title: 'Falar atendente',
                    description: 'Atendimento humano',
                  },
                ],
              },
            ],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Menu interativo enviado:', response.data);
  } catch (error) {
    console.error(
      '❌ Erro ao enviar menu interativo:',
      error.response?.data || error.message
    );
  }
}

function extrairOpcao(message) {
  if (message?.type === 'interactive') {
    const listReplyId = message.interactive?.list_reply?.id;
    const buttonReplyId = message.interactive?.button_reply?.id;
    const id = listReplyId || buttonReplyId || '';

    if (id.startsWith('opcao_')) {
      return id.replace('opcao_', '');
    }

    return id.replace(/[^0-9]/g, '');
  }

  const text = message?.text?.body?.trim() || '';
  const textoMinusculo = text.toLowerCase();

  if (
    textoMinusculo === 'oi' ||
    textoMinusculo === 'olá' ||
    textoMinusculo === 'ola' ||
    textoMinusculo === 'menu' ||
    textoMinusculo === 'inicio' ||
    textoMinusculo === 'início'
  ) {
    return '';
  }

  return text.replace(/[^0-9]/g, '');
}

function obterTextoCliente(message) {
  return (
    message.text?.body ||
    message.interactive?.list_reply?.title ||
    message.interactive?.button_reply?.title ||
    ''
  );
}

async function avisarAtendente(clienteNumero, nomeCliente, mensagemCliente) {
  if (!ATENDENTE_NUMERO) {
    console.log('⚠️ ATENDENTE_NUMERO não configurado.');
    return;
  }

  let historicoTexto = '';

  try {
    const ultimasConversas = await buscarUltimasConversas(clienteNumero, 8);

    if (ultimasConversas.length > 0) {
      historicoTexto = ultimasConversas
        .map((item, index) => {
          return `${index + 1}. ${item.mensagem || 'Sem mensagem'} ${
            item.opcao ? `(opção: ${item.opcao})` : ''
          }`;
        })
        .join('\n');
    }
  } catch (error) {
    console.error('❌ Erro ao buscar histórico do cliente:', error.message);
  }

  const texto = `🚨 Cliente pediu atendimento humano

👤 Nome: ${nomeCliente || 'Não informado'}
📱 Número: ${clienteNumero}

💬 Mensagem atual:
${mensagemCliente || 'Cliente solicitou atendimento'}

📌 Últimas interações:
${historicoTexto || 'Nenhum histórico encontrado.'}

Entre em contato com o cliente pelo WhatsApp.`;

  const atendentes = ATENDENTE_NUMERO.split(',')
    .map((numero) => numero.trim())
    .filter(Boolean);

  for (const atendente of atendentes) {
    await sendTextMessage(atendente, texto);
  }
}

app.get('/', (req, res) => {
  res.send('Bot BG Requalificadora online ✅');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Verificação de webhook recebida');
  console.log('Mode:', mode);
  console.log('Token recebido:', token);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }

  console.log('❌ Falha na verificação do webhook.');
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  console.log('📩 Webhook POST recebido');
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log('⚠️ Nenhuma mensagem encontrada no webhook.');
      return res.sendStatus(200);
    }

    const from = message.from;
    const nomeCliente = value?.contacts?.[0]?.profile?.name || '';
    const opcao = extrairOpcao(message);
    const textoCliente = obterTextoCliente(message);

    console.log('👤 Cliente:', from);
    console.log('🏷️ Nome:', nomeCliente);
    console.log('💬 Mensagem:', textoCliente);
    console.log('🔢 Opção detectada:', opcao || 'menu');

    try {
      await salvarConversa({
        numero: from,
        nome: nomeCliente,
        mensagem: textoCliente || 'menu',
        opcao: opcao || 'menu',
      });

      console.log('✅ Conversa salva na planilha.');
    } catch (error) {
      console.error('❌ Erro ao salvar conversa na planilha:', error.message);
    }

    if (!opcao) {
      console.log('📤 Enviando menu interativo...');
      await sendMenuInterativo(from);
      return res.sendStatus(200);
    }

    const resposta = await montarResposta(opcao);

    if (!resposta) {
      console.log('📤 Opção inválida. Enviando menu interativo...');
      await sendMenuInterativo(from);
      return res.sendStatus(200);
    }

    console.log('📤 Enviando resposta...');
    await sendTextMessage(from, resposta);
    console.log('✅ Resposta processada.');

    if (opcao === '4' || opcao === '9') {
      console.log('📢 Avisando atendente...');
      await avisarAtendente(from, nomeCliente, textoCliente);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});