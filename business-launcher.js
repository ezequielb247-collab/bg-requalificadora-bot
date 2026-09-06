const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const hotfixPath = path.join(__dirname, "runtime-hotfix.js");
const runtimeHotfixPath = path.join(__dirname, ".runtime-hotfix.business.js");

function aplicarAtualizacaoComercialBG(source) {
  function substituirObrigatorio(antes, depois, descricao) {
    if (!source.includes(antes)) {
      throw new Error("Nao foi possivel aplicar atualizacao BG GNV: " + descricao + ".");
    }
    source = source.replace(antes, depois);
  }

  function substituirTodosObrigatorio(antes, depois, descricao) {
    if (!source.includes(antes)) {
      throw new Error("Nao foi possivel aplicar atualizacao BG GNV: " + descricao + ".");
    }
    source = source.split(antes).join(depois);
  }

  // Move as opcoes informativas atuais para abrir a nova opcao 7.
  substituirTodosObrigatorio('opcao === "9"', 'opcao === "10"', "mover atendimento humano para opcao 10");
  substituirTodosObrigatorio('return "9";', 'return "10";', "mover palavras-chave de atendimento para opcao 10");
  substituirTodosObrigatorio('opcao === "8"', 'opcao === "9"', "mover endereco para opcao 9");
  substituirTodosObrigatorio('return "8";', 'return "9";', "mover palavras-chave de endereco para opcao 9");
  substituirTodosObrigatorio('opcao === "7"', 'opcao === "8"', "mover documentos para opcao 8");
  substituirTodosObrigatorio('return "7";', 'return "8";', "mover palavras-chave de documentos para opcao 8");

  substituirObrigatorio(
    'return /^[1-9]$/.test(normalized) ? normalized : null;',
    'return /^(?:[1-9]|10)$/.test(normalized) ? normalized : null;',
    "aceitar opcao 10"
  );

  substituirObrigatorio(
    '7. Documentos\n8. Endereço e horário\n9. Falar com atendente',
    '7. GNV para caminhões\n8. Documentos\n9. Unidades e horários\n10. Falar com atendente',
    "atualizar menu principal"
  );

  substituirObrigatorio(
    'Somos especializados em serviços automotivos e GNV em Macaé-RJ.',
    'Somos especializados em serviços automotivos e GNV para veículos leves e pesados.\n\nAtendimento em Macaé e São Pedro da Aldeia-RJ.',
    "atualizar apresentacao"
  );

  const marcadorDocumentos = '  if (opcao === "8") {\n    return `📄 DOCUMENTOS NECESSÁRIOS';
  const respostaCaminhoes = [
    '  if (opcao === "7") {',
    '    return `🚛 GNV PARA CAMINHÕES E VEÍCULOS PESADOS',
    '',
    'A BG GNV, em parceria com a ZN48, oferece soluções Diesel + GNV para caminhões e veículos pesados.',
    '',
    '✅ Projeto de acordo com a aplicação do veículo',
    '✅ Instalação especializada',
    '✅ Cilindros, suportes, válvulas e conexões',
    '✅ Foco em segurança, eficiência e desempenho',
    '',
    '💰 Economia:',
    'A tecnologia pode proporcionar economia de até 15% no custo com combustível, conforme a aplicação e a operação do veículo.',
    '',
    '📋 Orçamento:',
    'O valor é analisado diretamente com o atendente, pois varia conforme caminhão, motorização, configuração e necessidade da operação.',
    '',
    '📍 Macaé - RJ | Robson / Victor',
    '📲 22 99101-6400',
    '${ENDERECO_OFICINA}',
    '',
    '📍 São Pedro da Aldeia - RJ | Marcelo',
    '📲 22 99875-7227',
    'Travessa José Portela, 20 - Bairro Grande',
    '',
    '📧 requalificarservicos@gmail.com',
    '',
    'Para falar com um atendente, envie: 10`;',
    '  }',
    ''
  ].join("\n");

  substituirObrigatorio(
    marcadorDocumentos,
    respostaCaminhoes + marcadorDocumentos,
    "adicionar resposta de caminhoes"
  );

  const marcadorInstalacao = `  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "instalacao",`;

  const palavrasCaminhoes = `  if (
    textoTemAlgumaPalavra(textoMinusculo, [
      "gnv para caminhao",
      "gnv para caminhoes",
      "caminhao gnv",
      "caminhoes gnv",
      "kit gnv caminhao",
      "kit gnv para caminhao",
      "diesel gnv",
      "diesel + gnv",
      "diesel e gnv",
      "veiculo pesado",
      "veiculos pesados",
      "caminhao",
      "caminhoes",
      "frota de caminhoes",
      "frotas de caminhoes",
      "cavalo mecanico",
      "carreta gnv"
    ])
  ) {
    return "7";
  }

`;

  substituirObrigatorio(
    marcadorInstalacao,
    palavrasCaminhoes + marcadorInstalacao,
    "adicionar palavras-chave de caminhoes"
  );

  substituirObrigatorio(
    '      "funciona sabado"\n    ])',
    '      "funciona sabado",\n      "unidades",\n      "outra unidade",\n      "macae",\n      "sao pedro",\n      "sao pedro da aldeia",\n      "cabo frio"\n    ])',
    "adicionar palavras-chave das unidades"
  );

  const regexEndereco = /  if \(opcao === "9"\) \{\n    return `📍 ENDEREÇO E HORÁRIO[\s\S]*?Para ver o menu novamente, envie: menu`;\n  \}/;
  if (!regexEndereco.test(source)) {
    throw new Error("Nao foi possivel aplicar atualizacao BG GNV: atualizar unidades e contatos.");
  }

  source = source.replace(
    regexEndereco,
    `  if (opcao === "9") {
    return \`📍 UNIDADES E CONTATOS

📍 MACAÉ - RJ | Robson / Victor
📲 WhatsApp: 22 99101-6400
📍 \${ENDERECO_OFICINA}

🗺️ Abrir no Google Maps:
\${LINK_MAPS}

🕒 Horário de funcionamento em Macaé:
\${HORARIO_OFICINA}

📍 SÃO PEDRO DA ALDEIA - RJ | Marcelo
📲 WhatsApp: 22 99875-7227
📍 Travessa José Portela, 20 - Bairro Grande

Para confirmar o horário de São Pedro da Aldeia, fale diretamente com Marcelo.

📧 requalificarservicos@gmail.com

Para ver o menu novamente, envie: menu\`;
  }`
  );

  substituirObrigatorio(
    '✅ Instalação de kit GNV\nO valor é negociado diretamente com o atendente, pois varia conforme o veículo, tipo de kit e condições de instalação.\n\n📍 Endereço:',
    '✅ Instalação de kit GNV\nO valor é negociado diretamente com o atendente, pois varia conforme o veículo, tipo de kit e condições de instalação.\n\n🚛 GNV para caminhões e veículos pesados\nEm parceria com a ZN48. Orçamento analisado diretamente com o atendente.\n\n📍 Endereço:',
    "incluir caminhoes na tabela de valores"
  );

  // Compatibilidade com versoes do fluxo que tratam opcoes de servico em uma lista.
  source = source.replace(
    '["1", "2", "3", "4", "5", "6"].includes(opcao)',
    '["1", "2", "3", "4", "5", "6", "7"].includes(opcao)'
  );
  source = source.replace(
    'opcao && /^[1-6]$/.test(opcao)',
    'opcao && /^[1-7]$/.test(opcao)'
  );

  return source;
}

let hotfix = fs.readFileSync(hotfixPath, "utf8");
const marker = 'fs.writeFileSync(runtimePath, source, "utf8");';

if (!hotfix.includes(marker)) {
  throw new Error("Nao foi possivel preparar o launcher comercial: marcador do runtime-hotfix nao encontrado.");
}

const injection = `\nsource = (${aplicarAtualizacaoComercialBG.toString()})(source);\n\n`;
hotfix = hotfix.replace(marker, injection + marker);

fs.writeFileSync(runtimeHotfixPath, hotfix, "utf8");

const child = spawn(process.execPath, [runtimeHotfixPath], {
  cwd: __dirname,
  stdio: "inherit",
  env: process.env
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));

child.on("exit", (code, signal) => {
  try {
    fs.unlinkSync(runtimeHotfixPath);
  } catch {}

  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
