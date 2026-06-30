# BG Requalificadora Bot

Autoatendimento de WhatsApp para a oficina BG Requalificadora.

## O que o bot faz

- Mostra valores dos serviços;
- Informa documentos necessários;
- Informa prazo de entrega;
- Mostra endereço e horário;
- Encaminha para atendente na opção 8.

## Serviços cadastrados

- Reteste de GNV;
- Retirada de kit GNV;
- Revisão de kit GNV.

## Como instalar

No terminal, dentro da pasta do projeto:

```bash
npm install
```

Depois rode:

```bash
npm start
```

## Configuração

1. Renomeie o arquivo `.env.example` para `.env`.
2. Preencha as informações do WhatsApp Cloud API.
3. Preencha o ID da planilha no campo `SPREADSHEET_ID`.
4. Substitua o conteúdo de `google-credentials.json` pelas credenciais reais da conta de serviço do Google.

## Planilha Google Sheets

Crie uma planilha com uma aba chamada exatamente:

```txt
Valores
```

Coloque estas colunas:

| Código | Serviço | Valor |
|---|---|---:|
| reteste_cartao | Reteste GNV — cartão até 3x sem juros | 480 |
| reteste_vista | Reteste GNV — à vista | 450 |
| retirada_kit_5 | Retirada kit GNV 5ª geração | 500 |
| retirada_kit_3 | Retirada kit GNV 3ª geração | 400 |
| revisao_kit_3_cartao | Revisão kit GNV 3ª geração — cartão até 3x sem juros | 280 |
| revisao_kit_3_vista | Revisão kit GNV 3ª geração — à vista | 250 |
| revisao_kit_5_cartao | Revisão kit GNV 5ª geração — cartão até 3x sem juros | 430 |
| revisao_kit_5_vista | Revisão kit GNV 5ª geração — à vista | 400 |

O cliente deve alterar apenas a coluna **Valor**.
