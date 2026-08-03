const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const sourcePath = path.join(__dirname, "index.js");
const runtimePath = path.join(__dirname, ".index.runtime.js");

let source = fs.readFileSync(sourcePath, "utf8");

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

  // No WhatsApp multi-dispositivo, a mesma mensagem pode voltar com JID LID,
  // embora tenha sido enviada para o JID de telefone. A comparacao global
  // curta cobre essa corrida sem confundir respostas manuais normais.
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
        Number(estado.version || 0) < 3 &&
        String(pausa?.observacao || "").includes("Pausa automática: atendente respondeu manualmente");
      if (pausaAutomaticaAntiga) continue;
`;

if (!source.includes(loadMarker)) {
  throw new Error("Nao foi possivel aplicar a migracao das pausas antigas.");
}
source = source.replace(loadMarker, migration);
source = source.replace("version: 2,", "version: 3,");

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
