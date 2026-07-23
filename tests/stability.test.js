"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DisconnectReason } = require("@whiskeysockets/baileys");

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-gnv-test-"));
process.env.SESSION_DIR = sessionDir;
process.env.SKIP_WHATSAPP_START = "true";

const bot = require("../index");

test.after(() => {
  fs.rmSync(sessionDir, { recursive: true, force: true });
});

test("normaliza texto e reconhece palavras-chave", () => {
  assert.equal(bot.normalizarTexto("  Revisão do GNV  "), "revisao do gnv");
  assert.equal(bot.extrairOpcao("quero fazer o reteste do cilindro"), "1");
  assert.equal(bot.extrairOpcao("quero tirar o kit"), "2");
  assert.equal(bot.extrairOpcao("onde fica a oficina?"), "8");
  assert.equal(bot.extrairOpcao("9"), "9");
});

test("le texto de mensagens comuns, temporarias e botoes", () => {
  assert.equal(bot.getMessageText({ conversation: "Olá" }), "Olá");
  assert.equal(
    bot.getMessageText({ ephemeralMessage: { message: { extendedTextMessage: { text: "reteste" } } } }),
    "reteste"
  );
  assert.equal(
    bot.getMessageText({ buttonsResponseMessage: { selectedDisplayText: "Endereço" } }),
    "Endereço"
  );
});

test("nao reconecta automaticamente em sessao encerrada", () => {
  assert.equal(bot.deveReconectar(DisconnectReason.loggedOut), false);
  if (Number.isFinite(Number(DisconnectReason.connectionReplaced))) {
    assert.equal(bot.deveReconectar(DisconnectReason.connectionReplaced), false);
  }
  assert.equal(bot.deveReconectar(DisconnectReason.connectionClosed), true);
  assert.equal(bot.deveReconectar(null), true);
});

test("backoff de reconexao respeita os limites", () => {
  assert.equal(bot.calcularAtrasoReconexao(1, 0), 3000);
  assert.equal(bot.calcularAtrasoReconexao(2, 0), 6000);
  assert.ok(bot.calcularAtrasoReconexao(20, 1) <= 60000);
});

test("ignora repeticao do mesmo ID de mensagem", () => {
  const message = { key: { id: "ABC123", remoteJid: "5522999999999@s.whatsapp.net" } };
  assert.equal(bot.mensagemJaProcessada(message), false);
  assert.equal(bot.mensagemJaProcessada(message), true);
});

test("fila preserva a ordem dentro da mesma conversa", async () => {
  const resultado = [];
  const jid = "5522888888888@s.whatsapp.net";

  const primeira = bot.enfileirarPorConversa(jid, async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    resultado.push(1);
  });
  const segunda = bot.enfileirarPorConversa(jid, async () => {
    resultado.push(2);
  });

  await Promise.all([primeira, segunda]);
  assert.deepEqual(resultado, [1, 2]);
});

test("limites diarios continuam ativos", () => {
  const telefone = String(Date.now());
  assert.equal(bot.deveEnviarAvisoMensagemNaoEntendida(telefone), true);
  assert.equal(bot.deveEnviarAvisoMensagemNaoEntendida(telefone), false);
  assert.equal(bot.deveResponderPalavraChaveHoje(telefone, "1"), true);
  assert.equal(bot.deveResponderPalavraChaveHoje(telefone, "1"), false);
  assert.equal(bot.deveResponderPalavraChaveHoje(telefone, "2"), true);
});

test("estado diario e gravado dentro da pasta de sessao", () => {
  bot.salvarEstadoRuntime();
  const stateFile = path.join(sessionDir, "runtime-state.json");
  assert.equal(fs.existsSync(stateFile), true);
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.version, 1);
  assert.equal(typeof state.respostasPalavrasChavePorDia, "object");
});

test("erros conhecidos de criptografia sao classificados sem derrubar o bot", () => {
  assert.equal(bot.erroCriptografiaIgnoravel(new Error("Bad MAC")), true);
  assert.equal(bot.erroCriptografiaIgnoravel(new Error("failed to decrypt message")), true);
  assert.equal(bot.erroCriptografiaIgnoravel(new Error("erro comum")), false);
});

test("health check expoe diagnostico de estabilidade", () => {
  const health = bot.montarHealthCheck();
  assert.equal(health.ok, true);
  assert.equal(typeof health.uptimeSeconds, "number");
  assert.equal(typeof health.whatsapp.status, "string");
  assert.equal(typeof health.processing.activeConversationQueues, "number");
});

test("fluxo antigo de confirmacao foi removido", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.equal(source.includes("Você deseja seguir com este serviço?"), false);
  assert.equal(source.includes("mensagemConfirmacaoServico"), false);
  assert.equal(source.includes("confirmacoesPendentes"), false);
});
