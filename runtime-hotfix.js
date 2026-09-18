const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const sourcePath = path.join(__dirname, "index.js");
const runtimePath = path.join(__dirname, ".index.runtime.js");

let source = fs.readFileSync(sourcePath, "utf8");

// O libsignal usado pelo Baileys escreve alguns detalhes de sessao diretamente
// em console.*, ignorando o logger configurado no socket. Alguns desses logs
// incluem material criptografico interno (inclusive chaves privadas). O filtro
// abaixo roda dentro do processo real do bot e remove somente essas mensagens
// conhecidas, preservando os demais logs da aplicacao.
const logProtection = String.raw`
(() => {
  const originais = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  const prefixosSensiveis = [
    "Closing session:",
    "Closing open session in favor of incoming prekey bundle",
    "Closing stale open session for new outgoing prekey bundle",
    "Removing old closed session:",
    "Session error:Error: Bad MAC",
    "Failed to decrypt message with any known session"
  ];
  let ultimoResumo = 0;

  const proteger = (metodo) => (...args) => {
    const primeira = typeof args[0] === "string" ? args[0] : "";
    if (prefixosSensiveis.some((prefixo) => primeira.startsWith(prefixo))) {
      const agora = Date.now();
      if (agora - ultimoResumo >= 60000) {
        ultimoResumo = agora;
        originais.warn(
          "[whatsapp-signal] Evento interno de sessao detectado; detalhes criptograficos foram omitidos do log."
        );
      }
      return;
    }
    originais[metodo](...args);
  };

  console.log = proteger("log");
  console.warn = proteger("warn");
  console.error = proteger("error");
})();
`;

source = logProtection + "\n" + source;

const startMarker = "\nfunction chaveConteudoMensagemBot";
const endMarker = "\nfunction ativarPausaHumanaLocal";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error("Nao foi possivel aplicar o hotfix de conciliacao: marcadores nao encontrados.");
}

const replacement = `
function chaveConteudoMensagemBot(jid, texto) {
  return \`\${String(jid || "").trim()}:\${normalizarTexto(texto || "")}\`;
}

function chaveConteudoGlobalMensagemBot(texto) {
  return \`*:\${normalizarTexto(texto || "")}\`;
}

function adicionarRegistroEnvioBot(chave, horario = Date.now()) {
  const registros = enviosRecentesDoBot.get(chave) || [];
  registros.push(horario);
  enviosRecentesDoBot.set(chave, registros);
}

function registrarEnvioPendenteDoBot(jid, texto) {
  const horario = Date.now();
  const chaves = [
    chaveConteudoMensagemBot(jid, texto),
    chaveConteudoGlobalMensagemBot(texto)
  ];

  for (const chave of chaves) adicionarRegistroEnvioBot(chave, horario);
  return chaves;
}

function removerEnvioPendenteDoBot(chaveOuChaves) {
  const chaves = Array.isArray(chaveOuChaves) ? chaveOuChaves : [chaveOuChaves];
  let removido = false;

  for (const chave of chaves) {
    const registros = enviosRecentesDoBot.get(chave) || [];
    if (!registros.length) continue;

    registros.shift();
    removido = true;

    if (registros.length) enviosRecentesDoBot.set(chave, registros);
    else enviosRecentesDoBot.delete(chave);
  }

  return removido;
}

function consumirRegistroEnvioBot(chave, ttlMs) {
  const registros = enviosRecentesDoBot.get(chave) || [];
  const agora = Date.now();
  const indiceValido = registros.findIndex((horario) => agora - horario <= ttlMs);

  if (indiceValido < 0) return false;

  registros.splice(indiceValido, 1);
  if (registros.length) enviosRecentesDoBot.set(chave, registros);
  else enviosRecentesDoBot.delete(chave);
  return true;
}

function registrarIdMensagemEnviadaPeloBot(resultado, jid) {
  const id = String(resultado?.key?.id || "").trim();
  if (!id) return;
  const agora = Date.now();
  idsMensagensEnviadasPeloBot.set(id, agora);
  idsMensagensEnviadasPeloBot.set(\`\${String(jid || "").trim()}:\${id}\`, agora);
}

function foiMensagemEnviadaPeloBot(message, texto = "") {
  const jid = String(message?.key?.remoteJid || "").trim();
  const id = String(message?.key?.id || "").trim();
  const chaveId = \`\${jid}:\${id}\`;
  const chaveEspecifica = chaveConteudoMensagemBot(jid, texto);
  const chaveGlobal = chaveConteudoGlobalMensagemBot(texto);

  if (id && (idsMensagensEnviadasPeloBot.has(id) || idsMensagensEnviadasPeloBot.has(chaveId))) {
    idsMensagensEnviadasPeloBot.delete(id);
    idsMensagensEnviadasPeloBot.delete(chaveId);
    removerEnvioPendenteDoBot([chaveEspecifica, chaveGlobal]);
    return true;
  }

  if (consumirRegistroEnvioBot(chaveEspecifica, BOT_MESSAGE_TRACK_TTL_MS)) {
    consumirRegistroEnvioBot(chaveGlobal, BOT_MESSAGE_TRACK_TTL_MS);
    return true;
  }

  const ttlGlobal = Math.min(BOT_MESSAGE_TRACK_TTL_MS, 30000);
  if (consumirRegistroEnvioBot(chaveGlobal, ttlGlobal)) {
    return true;
  }

  return false;
}
`;

source = source.slice(0, start) + "\n" + replacement.trim() + source.slice(end);

const loadMarker =
  'for (const [telefone, pausa] of Object.entries(estado.pausasHumanas || {})) {\n';
const migration = `for (const [telefone, pausa] of Object.entries(estado.pausasHumanas || {})) {
      const pausaAutomaticaAntiga =
        Number(estado.version || 0) < 4 &&
        String(pausa?.observacao || "").includes("Pausa automática: atendente respondeu manualmente");
      if (pausaAutomaticaAntiga) continue;
`;

if (!source.includes(loadMarker)) {
  throw new Error("Nao foi possivel aplicar a migracao das pausas antigas.");
}
source = source.replace(loadMarker, migration);
source = source.replace("version: 2,", "version: 4,");

const fromMeMarker = `  if (fromMe) {
    if (foiMensagemEnviadaPeloBot(message, text)) return;

    await processarMensagemManualAtendente({`;

const fromMeReplacement = `  if (fromMe) {
    if (foiMensagemEnviadaPeloBot(message, text)) return;

    if (String(jid).endsWith("@lid") && !telefoneReal) {
      console.log(
        "Mensagem enviada no chat LID sem telefone real ignorada para conciliacao humana:",
        jid
      );
      lastMessageProcessedAt = agoraIso();
      return;
    }

    await processarMensagemManualAtendente({`;

if (!source.includes(fromMeMarker)) {
  throw new Error("Nao foi possivel aplicar a protecao para JID LID sem telefone real.");
}
source = source.replace(fromMeMarker, fromMeReplacement);

const manualMarker = `async function processarMensagemManualAtendente({ jid, text, pushName, tipoMidia }) {
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return false;

  const telefone = telefoneLimpoPorJid(jid);`;

const manualReplacement = `async function processarMensagemManualAtendente({ jid, text, pushName, tipoMidia }) {
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return false;

  if (String(jid).endsWith("@lid") && !telefonesReaisPorJid.get(String(jid))) {
    console.log("Pausa humana nao ativada: JID LID ainda sem telefone real.", jid);
    return false;
  }

  const telefone = telefoneLimpoPorJid(jid);`;

if (!source.includes(manualMarker)) {
  throw new Error("Nao foi possivel reforcar a protecao da pausa humana para JID LID.");
}
source = source.replace(manualMarker, manualReplacement);

// O exemplo atual do Baileys recomenda reconectar em fechamentos que nao sejam
// logout. Aqui mantemos connectionReplaced/multideviceMismatch como terminais
// para evitar duas instancias disputando a mesma conta, mas tratamos badSession
// como recuperavel. Isso formaliza o comportamento que o watchdog ja provocava
// indiretamente e reduz o tempo offline apos um erro 500 transitório.
const reconnectMarker = `function deveReconectar(codigo) {
  const motivosTerminais = [
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.connectionReplaced,
    DisconnectReason.multideviceMismatch
  ].filter((valor) => Number.isFinite(Number(valor)));

  return !motivosTerminais.includes(Number(codigo));
}`;

const reconnectReplacement = `function deveReconectar(codigo) {
  const motivosTerminais = [
    DisconnectReason.loggedOut,
    DisconnectReason.connectionReplaced,
    DisconnectReason.multideviceMismatch
  ].filter((valor) => Number.isFinite(Number(valor)));

  return !motivosTerminais.includes(Number(codigo));
}`;

if (!source.includes(reconnectMarker)) {
  throw new Error("Nao foi possivel aplicar a politica segura de reconexao.");
}
source = source.replace(reconnectMarker, reconnectReplacement);

const watchdogMarker = `    if (!sock || estadosQuePrecisamReconexao.has(connectionStatus)) {
      agendarReconexao("watchdog");
    }`;

const watchdogReplacement = `    // Estados realmente terminais precisam de nova vinculacao/decisao humana.
    // Nao deixe o watchdog recriar sockets indefinidamente nesses casos.
    if (connectionStatus === "sessao precisa de novo QR Code") return;

    if (!sock || estadosQuePrecisamReconexao.has(connectionStatus)) {
      agendarReconexao("watchdog");
    }`;

if (!source.includes(watchdogMarker)) {
  throw new Error("Nao foi possivel proteger o watchdog contra sessoes terminais.");
}
source = source.replace(watchdogMarker, watchdogReplacement);

fs.writeFileSync(runtimePath, source, "utf8");

const child = spawn(process.execPath, [runtimePath], {
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
    fs.unlinkSync(runtimePath);
  } catch {}
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
