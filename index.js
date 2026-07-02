require('dotenv').config();

const express = require('express');
const axios = require('axios');

const {
  getValores,
  salvarConversa,
} = require('./services/sheets');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const ATENDENTE_NUMERO = process.env.ATENDENTE_NUMERO;

const NOME_OFICINA = process.env.NOME_OFICINA || 'BG GNV Macaé';

const ENDERECO_OFICINA =
  process.env.ENDERECO_OFICINA ||
  'Av. Carlos Augusto T. Garcia, nº 1618 — Sol e Mar, Macaé - RJ, CEP 27940-290';

const LINK_MAPS =
  process.env.LINK_MAPS ||
  'https://www.google.com/maps?q=-22.3914399,-41.7426833';

const HORARIO_OFICINA =
  process.env.HORARIO_OFICINA ||
  'Segunda a sexta: 8:00 às 18:00\nSábado: 8:00 às 12:00';

// Guarda clientes que clicaram em "Tenho interesse" e ainda vão mandar dados do carro
const atendimentosPendentes = {};

function estaDentroDoHorario() {
  const agora = new Date();

  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );

  const diaSemana = dataBrasil.getDay();
  const hora = dataBrasil.getHours();
  const minuto = dataBrasil.getMinutes();

  const horarioAtual = hora * 60 + minuto;

  const oitoHoras = 8 * 60;
  const meioDia = 12 * 60;
  const dezoitoHoras = 18 * 60;

  if (diaSemana === 0) {
    return false;
  }

  if (diaSemana >= 1 && diaSemana <= 5) {
    return horarioAtual >= oitoHoras && horarioAtual < dezoitoHoras;
  }

  if (diaSemana === 6) {
    return horarioAtual >= oitoHoras && horarioAtual < meioDia;
  }

  return false;
}

function mensagemForaDoHorario() {
  return `Olá! Recebemos sua mensagem ✅

No momento estamos fora do horário de atendimento.

🕒 Horário de funcionamento:
${HORARIO_OFICINA}

Mesmo assim, você pode ver as opções abaixo e nossa equipe responderá assim que possível.`;
}

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

function nomeServicoPorOpcao(opcao) {
  const servicos = {
    '1': 'Reteste de cilindro de GNV',
    '2': 'Retirada de kit GNV',
    '3': 'Revisão de kit GNV',
    '4': 'Instalação de kit GNV',
  };

  return servicos[opcao] || 'Serviço';
}

function mensagemPedidoDadosPorServico(opcaoServico, servico) {
  if (opcaoServico === '1') {
    return `✅ Interesse registrado!

Serviço:
${servico}

Para nossa equipe te atender melhor, envie por favor:

1. Modelo e ano do carro
2. Quantidade de cilindros, se souber
3. Se o cilindro já está vencido ou perto de vencer, se souber

Exemplo:
Civic 2015, 1 cilindro, vencendo esse mês

Nossa equipe recebeu sua solicitação e entrará em contato pelo WhatsApp.`;
  }

  if (opcaoServico === '2') {
    return `✅ Interesse registrado!

Serviço:
${servico}

Para nossa equipe te atender melhor, envie por favor:

1. Modelo e ano do carro
2. Se o kit é 3ª ou 5ª geração, se souber

Exemplo:
Palio 2014, kit 5ª geração

Nossa equipe recebeu sua solicitação e entrará em contato pelo WhatsApp.`;
  }

  if (opcaoServico === '3') {
    return `✅ Interesse registrado!

Serviço:
${servico}

Para nossa equipe te atender melhor, envie por favor:

1. Modelo e ano do carro
2. Se o kit é 3ª ou 5ª geração, se souber

Exemplo:
Onix 2018, kit 5ª geração

Nossa equipe recebeu sua solicitação e entrará em contato pelo WhatsApp.`;
  }

  if (opcaoServico === '4') {
    return `✅ Interesse registrado!

Serviço:
${servico}

Para nossa equipe te atender melhor, envie por favor:

1. Modelo e ano do carro
2. Se será instalação nova ou se já possui algum kit

Exemplo:
HB20 2020, instalação nova

Nossa equipe recebeu sua solicitação e entrará em contato pelo WhatsApp.`;
  }

  return `✅ Interesse registrado!

Serviço:
${servico}

Envie o modelo e ano do carro para nossa equipe te atender melhor.`;
}

function mensagemDadosRecebidos(opcaoServico, servico, dadosCarro) {
  if (opcaoServico === '1') {
    return `✅ Informações recebidas!

Nossa equipe já recebeu os dados do seu veículo e vai te chamar pelo WhatsApp.

Serviço:
${servico}

Dados enviados:
${dadosCarro}

Enquanto isso, deixe separado se possível:

• Documento do carro
• Documento do GNV, se tiver
• Informação da quantidade de cilindros, se souber

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Google Maps:
${LINK_MAPS}`;
  }

  if (opcaoServico === '2') {
    return `✅ Informações recebidas!

Nossa equipe já recebeu os dados do seu veículo e vai te chamar pelo WhatsApp.

Serviço:
${servico}

Dados enviados:
${dadosCarro}

Enquanto isso, deixe separado se possível:

• Documento do carro
• Documento do GNV, se tiver
• Informação se o kit é 3ª ou 5ª geração, se souber

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Google Maps:
${LINK_MAPS}`;
  }

  if (opcaoServico === '3') {
    return `✅ Informações recebidas!

Nossa equipe já recebeu os dados do seu veículo e vai te chamar pelo WhatsApp.

Serviço:
${servico}

Dados enviados:
${dadosCarro}

Enquanto isso, deixe separado se possível:

• Documento do carro
• Informação se o kit é 3ª ou 5ª geração, se souber

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Google Maps:
${LINK_MAPS}`;
  }

  if (opcaoServico === '4') {
    return `✅ Informações recebidas!

Nossa equipe já recebeu os dados do seu veículo e vai te chamar pelo WhatsApp.

Serviço:
${servico}

Dados enviados:
${dadosCarro}

Nossa equipe vai analisar o veículo e orientar sobre valores, documentos e prazo.

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Google Maps:
${LINK_MAPS}`;
  }

  return `✅ Informações recebidas!

Serviço:
${servico}

Dados enviados:
${dadosCarro}

Nossa equipe vai te chamar pelo WhatsApp.`;
}

async function montarResposta(opcao) {
  const valores = await carregarValores();

  if (opcao === '1') {
    return `✅ RETESTE DE CILINDRO DE GNV

Valor referente a 1 cilindro:

💳 Cartão: ${formatarMoeda(valores.reteste_cartao)} em até 3x sem juros
💵 À vista: ${formatarMoeda(valores.reteste_vista)}

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

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
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

🗺️ Abrir no Google Maps:
${LINK_MAPS}

Para realizar o serviço, basta trazer o carro até a oficina.`;
  }

  if (opcao === '4') {
    return `✅ INSTALAÇÃO DE KIT GNV

O valor da instalação é negociado diretamente com o atendente, pois pode variar conforme o veículo, o tipo de kit e as condições de instalação.

👨‍🔧 Nossa equipe pode te orientar melhor sobre valores, documentos e prazo.

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}`;
  }

  if (opcao === '5') {
    return `📄 DOCUMENTOS NECESSÁRIOS

Para reteste de cilindro de GNV ou retirada de kit GNV, é necessário trazer:

• Documento do carro ou documento do GNV
• Precisa estar no nome do último proprietário do veículo

Para instalação de kit GNV, fale com o atendente para receber a orientação correta.

Para ver o menu novamente, envie: menu`;
  }

  if (opcao === '6') {
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

  if (opcao === '7') {
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
    await axios.post(
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

    console.log('✅ Mensagem enviada para:', to);
  } catch (error) {
    console.error(
      '❌ Erro ao enviar mensagem:',
      error.response?.data || error.message
    );
  }
}

async function sendMenuInterativo(to, mensagemInicial = null) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.');
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const textoBody =
    mensagemInicial ||
    `Olá! Seja bem-vindo(a) à ${NOME_OFICINA} 🚗⛽

Toque no botão abaixo e escolha uma opção:`;

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: {
            type: 'text',
            text: 'BG GNV Macaé',
          },
          body: {
            text: textoBody,
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
                    title: 'Reteste cilindro GNV',
                    description: 'Informações e documentos',
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
                    title: 'Documentos',
                    description: 'O que precisa trazer',
                  },
                  {
                    id: 'opcao_6',
                    title: 'Endereço e horário',
                    description: 'Localização da oficina',
                  },
                  {
                    id: 'opcao_7',
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

    console.log('✅ Menu interativo enviado para:', to);
  } catch (error) {
    console.error(
      '❌ Erro ao enviar menu interativo:',
      error.response?.data || error.message
    );
  }
}

async function sendConfirmacaoServico(to, servico, opcaoServico) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.');
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: `Você deseja seguir com este serviço?

Serviço: ${servico}

Escolha uma opção abaixo:`,
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: `caminho_${opcaoServico}`,
                  title: 'Estou a caminho',
                },
              },
              {
                type: 'reply',
                reply: {
                  id: `interesse_${opcaoServico}`,
                  title: 'Tenho interesse',
                },
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

    console.log('✅ Confirmação de serviço enviada para:', to);
  } catch (error) {
    console.error(
      '❌ Erro ao enviar confirmação de serviço:',
      error.response?.data || error.message
    );
  }
}

function textoTemAlgumaPalavra(texto, palavras) {
  return palavras.some((palavra) => texto.includes(palavra));
}

function identificarOpcaoPorTexto(texto) {
  const textoMinusculo = texto.toLowerCase();

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'reteste',
      'retestar',
      'cilindro',
      'cilindro gnv',
      'requalificação',
      'requalificacao',
      'validade do cilindro',
      'vencido',
      'cilindro vencido',
      'quanto é o reteste',
      'quanto custa o reteste',
      'valor do reteste',
    ])
  ) {
    return '1';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'retirada',
      'retirar',
      'tirar kit',
      'remover kit',
      'remoção',
      'remocao',
      'desinstalar',
      'desinstalação',
      'desinstalacao',
      'quero tirar o kit',
      'tirar gnv',
      'retirar gnv',
      'remover gnv',
    ])
  ) {
    return '2';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'revisão',
      'revisao',
      'manutenção',
      'manutencao',
      'regular',
      'regulagem',
      'falhando',
      'falha',
      'vazamento',
      'cheiro de gás',
      'cheiro de gas',
      'não pega no gnv',
      'nao pega no gnv',
      'não funciona no gnv',
      'nao funciona no gnv',
      'carro falhando',
      'revisar kit',
    ])
  ) {
    return '3';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'instalação',
      'instalacao',
      'instalar',
      'instalar kit',
      'colocar gnv',
      'botar gnv',
      'converter para gnv',
      'conversão',
      'conversao',
      'kit novo',
      'instalar gnv',
      'quero colocar gnv',
      'quero instalar gnv',
    ])
  ) {
    return '4';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'documento',
      'documentos',
      'precisa levar',
      'o que levar',
      'quais documentos',
      'documentação',
      'documentacao',
      'crlv',
      'dut',
      'nota fiscal',
    ])
  ) {
    return '5';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'endereço',
      'endereco',
      'onde fica',
      'localização',
      'localizacao',
      'como chegar',
      'horário',
      'horario',
      'abre que horas',
      'fecha que horas',
      'funcionamento',
      'local',
      'maps',
      'endereco da loja',
      'rota',
      'localizacao da loja',
    ])
  ) {
    return '6';
  }

  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      'atendente',
      'humano',
      'pessoa',
      'falar com alguém',
      'falar com alguem',
      'falar com atendente',
      'quero atendimento',
      'me liga',
      'ligação',
      'ligacao',
      'telefone',
      'chamar atendente',
      'vendedor',
    ])
  ) {
    return '7';
  }

  return null;
}

function extrairOpcao(message) {
  if (message?.type === 'interactive') {
    const listReplyId = message.interactive?.list_reply?.id;
    const buttonReplyId = message.interactive?.button_reply?.id;
    const id = listReplyId || buttonReplyId || '';

    if (id.startsWith('opcao_')) {
      return id.replace('opcao_', '');
    }

    if (id.startsWith('caminho_')) {
      return id;
    }

    if (id.startsWith('interesse_')) {
      return id;
    }

    return id.replace(/[^0-9]/g, '');
  }

  const text = message?.text?.body?.trim() || '';
  const textoMinusculo = text.toLowerCase();

  const somenteNumeros = text.replace(/[^0-9]/g, '');
  if (['1', '2', '3', '4', '5', '6', '7'].includes(somenteNumeros)) {
    return somenteNumeros;
  }

  const opcaoPorTexto = identificarOpcaoPorTexto(text);
  if (opcaoPorTexto) {
    return opcaoPorTexto;
  }

  if (
    textoMinusculo === 'oi' ||
    textoMinusculo === 'olá' ||
    textoMinusculo === 'ola' ||
    textoMinusculo === 'menu' ||
    textoMinusculo === 'inicio' ||
    textoMinusculo === 'início' ||
    textoMinusculo === 'bom dia' ||
    textoMinusculo === 'boa tarde' ||
    textoMinusculo === 'boa noite' ||
    textoMinusculo === 'gnv' ||
    textoMinusculo.includes('informação') ||
    textoMinusculo.includes('informacoes') ||
    textoMinusculo.includes('informações')
  ) {
    return '';
  }

  return 'invalido';
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

  const texto = `🚨 Cliente precisa de atendimento

👤 Nome: ${nomeCliente || 'Não informado'}
📱 Número: ${clienteNumero}

💬 Situação:
${mensagemCliente || 'Cliente solicitou atendimento'}

Entre em contato com o cliente pelo WhatsApp.`;

  const atendentes = ATENDENTE_NUMERO.split(',')
    .map((numero) => numero.trim())
    .filter(Boolean);

  for (const atendente of atendentes) {
    await sendTextMessage(atendente, texto);
  }
}

async function avisarInteresseServico(clienteNumero, nomeCliente, servico, mensagemOriginal) {
  if (!ATENDENTE_NUMERO) {
    console.log('⚠️ ATENDENTE_NUMERO não configurado.');
    return;
  }

  const texto = `🚨 Novo cliente interessado

👤 Nome: ${nomeCliente || 'Não informado'}
📱 Número: ${clienteNumero}

✅ Serviço:
${servico}

📌 Ação:
Cliente pediu informações sobre este serviço.

💬 Mensagem original:
${mensagemOriginal || 'Cliente selecionou o serviço pelo menu.'}

Entre em contato com o cliente pelo WhatsApp.`;

  const atendentes = ATENDENTE_NUMERO.split(',')
    .map((numero) => numero.trim())
    .filter(Boolean);

  for (const atendente of atendentes) {
    await sendTextMessage(atendente, texto);
  }
}

async function avisarAcaoServico(clienteNumero, nomeCliente, servico, acao, mensagemOriginal) {
  if (!ATENDENTE_NUMERO) {
    console.log('⚠️ ATENDENTE_NUMERO não configurado.');
    return;
  }

  const texto = `🚨 Atualização de atendimento

👤 Nome: ${nomeCliente || 'Não informado'}
📱 Número: ${clienteNumero}

✅ Serviço:
${servico}

📌 Ação:
${acao}

💬 Mensagem original:
${mensagemOriginal || 'Cliente clicou em um botão do atendimento automático.'}

Entre em contato com o cliente pelo WhatsApp.`;

  const atendentes = ATENDENTE_NUMERO.split(',')
    .map((numero) => numero.trim())
    .filter(Boolean);

  for (const atendente of atendentes) {
    await sendTextMessage(atendente, texto);
  }
}

async function avisarDadosDoCarro(clienteNumero, nomeCliente, servico, dadosCarro) {
  if (!ATENDENTE_NUMERO) {
    console.log('⚠️ ATENDENTE_NUMERO não configurado.');
    return;
  }

  const texto = `🚗 Cliente enviou dados do veículo

👤 Nome: ${nomeCliente || 'Não informado'}
📱 Número: ${clienteNumero}

✅ Serviço de interesse:
${servico}

🚘 Dados enviados:
${dadosCarro}

📌 Próximo passo:
Chamar o cliente e confirmar valor, prazo e documentos necessários.

Entre em contato com o cliente pelo WhatsApp.`;

  const atendentes = ATENDENTE_NUMERO.split(',')
    .map((numero) => numero.trim())
    .filter(Boolean);

  for (const atendente of atendentes) {
    await sendTextMessage(atendente, texto);
  }
}

async function processarDadosDoCarroSePendente(from, nomeCliente, textoCliente) {
  const pendente = atendimentosPendentes[from];

  if (!pendente) {
    return false;
  }

  const texto = String(textoCliente || '').trim();
  const textoMinusculo = texto.toLowerCase();

  if (!texto) {
    return false;
  }

  if (textoMinusculo === 'menu' || textoMinusculo === 'cancelar') {
    delete atendimentosPendentes[from];

    await sendTextMessage(
      from,
      'Tudo bem, atendimento cancelado. Para ver as opções novamente, envie: menu'
    );

    return true;
  }

  await sendTextMessage(
    from,
    mensagemDadosRecebidos(pendente.opcaoServico, pendente.servico, texto)
  );

  await avisarDadosDoCarro(from, nomeCliente, pendente.servico, texto);

  delete atendimentosPendentes[from];

  return true;
}

async function processarConfirmacaoServico(opcao, from, nomeCliente) {
  if (opcao.startsWith('caminho_')) {
    const opcaoServico = opcao.replace('caminho_', '');
    const servico = nomeServicoPorOpcao(opcaoServico);

    delete atendimentosPendentes[from];

    await sendTextMessage(
      from,
      `✅ Confirmado! Estamos te esperando.

Serviço:
${servico}

📍 Endereço:
${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
${LINK_MAPS}

🕒 Horário:
${HORARIO_OFICINA}`
    );

    await avisarAcaoServico(
      from,
      nomeCliente,
      servico,
      'Cliente clicou em "Estou a caminho".',
      'Estou a caminho'
    );

    return true;
  }

  if (opcao.startsWith('interesse_')) {
    const opcaoServico = opcao.replace('interesse_', '');
    const servico = nomeServicoPorOpcao(opcaoServico);

    atendimentosPendentes[from] = {
      servico,
      opcaoServico,
      criadoEm: new Date().toISOString(),
    };

    await sendTextMessage(
      from,
      mensagemPedidoDadosPorServico(opcaoServico, servico)
    );

    await avisarAcaoServico(
      from,
      nomeCliente,
      servico,
      'Cliente clicou em "Tenho interesse" e o bot pediu as informações corretas do veículo.',
      'Tenho interesse'
    );

    return true;
  }

  return false;
}

app.get('/', (req, res) => {
  res.send('Bot BG GNV Macaé online ✅');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Verificação de webhook recebida');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }

  console.log('❌ Falha na verificação do webhook.');
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  console.log('📩 Webhook POST recebido');

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
    const textoCliente = obterTextoCliente(message);

    console.log('👤 Cliente:', from);
    console.log('🏷️ Nome:', nomeCliente);
    console.log('💬 Mensagem:', textoCliente);

    try {
      await salvarConversa({
        numero: from,
        nome: nomeCliente,
        mensagem: textoCliente || 'menu',
        opcao: 'recebida',
      });

      console.log('✅ Conversa salva na planilha.');
    } catch (error) {
      console.error('❌ Erro ao salvar conversa na planilha:', error.message);
    }

    if (message.type === 'text') {
      const resolveuPendente = await processarDadosDoCarroSePendente(
        from,
        nomeCliente,
        textoCliente
      );

      if (resolveuPendente) {
        return res.sendStatus(200);
      }
    }

    const opcao = extrairOpcao(message);

    console.log('🔢 Opção detectada:', opcao || 'menu');

    const foraDoHorario = !estaDentroDoHorario();

    if (foraDoHorario && !opcao) {
      console.log('🌙 Cliente chamou fora do horário. Enviando aviso + menu...');
      await sendMenuInterativo(from, mensagemForaDoHorario());
      return res.sendStatus(200);
    }

    if (opcao && (opcao.startsWith('caminho_') || opcao.startsWith('interesse_'))) {
      await processarConfirmacaoServico(opcao, from, nomeCliente);
      return res.sendStatus(200);
    }

    if (!opcao) {
      console.log('📤 Enviando menu interativo...');
      await sendMenuInterativo(from);
      return res.sendStatus(200);
    }

    const resposta = await montarResposta(opcao);

    if (!resposta) {
      console.log('📤 Mensagem não entendida. Enviando menu interativo...');

      const mensagemPadrao = foraDoHorario
        ? mensagemForaDoHorario()
        : `Não entendi sua mensagem.

Toque no botão abaixo para ver as opções de atendimento:`;

      await sendMenuInterativo(from, mensagemPadrao);
      return res.sendStatus(200);
    }

    console.log('📤 Enviando resposta...');

    if (foraDoHorario) {
      await sendTextMessage(
        from,
        `Estamos fora do horário de atendimento no momento, mas sua solicitação foi recebida ✅

Nossa equipe responderá assim que possível.

🕒 Horário:
${HORARIO_OFICINA}`
      );
    }

    await sendTextMessage(from, resposta);
    console.log('✅ Resposta processada.');

    if (['1', '2', '3', '4'].includes(opcao)) {
      const servico = nomeServicoPorOpcao(opcao);

      console.log('📢 Avisando atendente sobre interesse no serviço...');
      await avisarInteresseServico(from, nomeCliente, servico, textoCliente);

      console.log('📤 Enviando confirmação do serviço...');
      await sendConfirmacaoServico(from, servico, opcao);
    }

    if (opcao === '7') {
      console.log('📢 Avisando atendente...');
      await avisarAtendente(from, nomeCliente, 'Cliente solicitou atendimento humano.');
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