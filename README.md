# Bot WhatsApp via QR Code com Baileys

Este projeto substitui a conexao antiga pela WhatsApp Cloud API por uma conexao via QR Code usando `@whiskeysockets/baileys`.

O numero principal continua no WhatsApp Business do celular. O bot entra como aparelho vinculado, como se fosse o WhatsApp Web.

## O que mudou

- Nao usa webhook da Meta.
- Nao usa `WHATSAPP_TOKEN`.
- Nao usa `PHONE_NUMBER_ID`.
- Mostra o QR Code em `/qr`.
- Salva a sessao localmente em `SESSION_DIR`.
- Responde mensagens recebidas pelo WhatsApp conectado.
- Ignora mensagens enviadas pelo proprio bot.
- Usa texto simples no lugar dos botoes interativos da Cloud API.
- Mantem registro de conversas e leads no Google Sheets.
- Mantem aviso para atendentes quando o cliente demonstra interesse.
- Mantem `/politica-de-privacidade`.

## Arquivos principais

- `package.json`: dependencias e scripts.
- `index.js`: servidor Express, conexao Baileys, QR Code e fluxo do bot.
- `services/sheets.js`: integracao com Google Sheets.
- `.env.example`: variaveis de ambiente.

## Como configurar localmente

1. Instale as dependencias:

   ```bash
   npm install
   ```

2. Crie o arquivo `.env` a partir do exemplo:

   ```bash
   cp .env.example .env
   ```

3. Preencha no `.env`:

   - `BUSINESS_NAME`
   - `ATTENDANT_NUMBERS`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_CREDENTIALS_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS`

4. Inicie:

   ```bash
   npm start
   ```

5. Abra no navegador:

   ```text
   http://localhost:3000/qr
   ```

6. No WhatsApp Business do celular principal, acesse aparelhos conectados e leia o QR Code.

## Google Sheets

Crie duas abas na planilha:

- `Conversas`
- `Leads`

Cabecalhos sugeridos para `Conversas`:

```text
Data | Direcao | Nome | Telefone | Servico | Mensagem
```

Cabecalhos sugeridos para `Leads`:

```text
Data | Nome | Telefone | Servico | Mensagem | Status
```

Compartilhe a planilha com o e-mail da conta de servico do Google.

## Ajustar menu, palavras-chave, servicos e valores

No arquivo `index.js`, edite o bloco `services`:

```js
const services = [
  {
    id: "1",
    name: "Reteste cilindro GNV",
    aliases: ["reteste", "cilindro", "validade do cilindro"],
    priceLines: ["Cartao: R$ 480,00 em ate 3x sem juros", "A vista: R$ 450,00"],
    details: ["Documento necessario: documento do carro ou documento do GNV no nome do ultimo proprietario"],
    vehiclePrompt: "Mensagem pedindo os dados do veiculo para esse servico."
  }
];
```

Tambem podem ser ajustados:

- `greetingKeywords`
- `priceKeywords`
- `interestKeywords`

## Deploy no Render

1. Crie um novo Web Service no Render.
2. Conecte o repositorio do projeto.
3. Configure:

   ```text
   Build Command: npm install
   Start Command: npm start
   ```

4. Adicione as variaveis de ambiente do `.env.example`.
5. Crie um Persistent Disk no Render.
6. Monte o disco em:

   ```text
   /var/data
   ```

7. Configure:

   ```text
   SESSION_DIR=/var/data/auth_info_baileys
   ```

8. Depois do deploy, abra:

   ```text
   https://SEU-SERVICO.onrender.com/qr
   ```

9. Escaneie o QR Code com o WhatsApp Business do celular principal.

## Aviso importante sobre sessao no Render

O Persistent Disk e necessario para manter a pasta da sessao. Sem ele, o Render pode apagar os arquivos da sessao em novos deploys ou reinicios, e voce precisara escanear o QR Code novamente.

Se usar plano gratuito com hibernacao, a conexao pode cair quando o servico dormir. Para uso em producao, prefira um servico que permaneça ativo.
