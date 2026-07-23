# BG GNV Macaé — Bot estável com Baileys

Versão do bot da BG GNV sem a etapa “Tenho interesse / Estou a caminho” e com reforços de estabilidade semelhantes aos usados no bot da Toca do Lobo.

## Melhorias de estabilidade

- Reconexão automática com atraso progressivo, evitando várias conexões simultâneas.
- Watchdog que verifica se o bot ficou desconectado sem tentativa de reconexão.
- Tratamento de `Bad MAC`, `No session`, `failed to decrypt`, `unsupported-chat` e erros de pre-key sem derrubar o processo.
- Fila separada por conversa para manter a ordem das mensagens de cada cliente.
- Bloqueio de mensagens repetidas pelo ID do WhatsApp e pelo texto recebido em poucos segundos.
- Tentativas automáticas de reenvio quando uma resposta falha.
- Leitura de mensagens normais, temporárias, respostas de botões e listas.
- Encerramento seguro em reinícios e deploys do Render.
- Health check detalhado em `/health` e `/api/health`.
- As limitações diárias de palavras-chave e mensagem não entendida ficam salvas dentro da pasta de sessão e sobrevivem a reinícios quando há Persistent Disk.
- Falha ao registrar uma conversa no Google Sheets não impede o bot de responder ao cliente.

## Fluxo atual

Ao escolher um serviço por número ou palavra-chave, o cliente recebe diretamente as informações. Não existe mais a mensagem:

```text
Você deseja seguir com este serviço?
1 Tenho interesse
2 Estou a caminho
0 Cancelar
```

A opção `9 - Falar com atendente` e os comandos de atendimento humano continuam ativos.

## Render

Use um serviço que permaneça ativo e configure um Persistent Disk:

```text
Mount Path: /var/data
SESSION_DIR=/var/data/auth_info_baileys
```

Isso mantém a sessão do WhatsApp e o controle diário mesmo após deploys e reinicializações.

Configure o Health Check Path como:

```text
/health
```

O endpoint sempre responde HTTP 200 para não criar um ciclo de reinicialização quando o WhatsApp estiver aguardando QR Code. O estado real da conexão aparece no campo `whatsapp.connected`.

## Instalação

```bash
npm install
npm run check
npm test
npm start
```

Abra o QR Code em:

```text
https://SEU-SERVICO.onrender.com/qr
```

## Testes incluídos

Os testes verificam:

- palavras-chave e opções numéricas;
- leitura de mensagens temporárias e botões;
- motivos de reconexão;
- atraso progressivo de reconexão;
- bloqueio por ID da mensagem;
- ordem da fila por conversa;
- limites diários;
- gravação do estado diário;
- classificação de erros de criptografia;
- health check;
- ausência do fluxo antigo de confirmação.

Execute:

```bash
npm test
```

## Segurança

Não envie para o GitHub:

```text
.env
google-credentials.json
auth_info_baileys/
node_modules/
```
