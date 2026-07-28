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
- Pausa automática ao detectar mídia do cliente ou resposta manual do atendente.
- Controle em memória e no Google Sheets para impedir que o bot entre no meio do atendimento humano.

## Fluxo atual

Ao escolher um serviço por número ou palavra-chave, o cliente recebe diretamente as informações. Não existe mais a mensagem:

```text
Você deseja seguir com este serviço?
1 Tenho interesse
2 Estou a caminho
0 Cancelar
```

A opção `9 - Falar com atendente` e os comandos de atendimento humano continuam ativos.


## Conciliação entre bot e atendente

O bot agora pausa automaticamente a conversa quando ocorre uma destas situações:

- o cliente envia áudio, imagem, vídeo, documento, figurinha, localização ou contato;
- um atendente envia qualquer mensagem manualmente pelo WhatsApp Web, Desktop ou celular vinculado.

Quando o cliente envia uma mídia e ainda não existe atendimento humano ativo, ele recebe uma única mensagem:

```text
Recebemos sua mensagem. Um atendente continuará o atendimento por aqui.
```

Depois disso, o bot fica em silêncio naquela conversa. Cada nova mensagem manual do atendente renova a pausa por 2 horas a partir daquele momento. As mensagens enviadas automaticamente pelo próprio bot são identificadas pelo ID e pelo conteúdo recente, para não serem confundidas com intervenção humana.

Comandos disponíveis:

```text
#assumir
#status
#renovar
#liberar
```

A pausa também fica salva em `runtime-state.json` dentro da pasta de sessão. Com Persistent Disk, ela sobrevive a reinicializações do Render.

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
- ausência do fluxo antigo de confirmação;
- reconhecimento de mídias;
- identificação de mensagens automáticas do próprio bot;
- pausa automática por intervenção humana.

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
