# DoodleBot

Template completo de bot do Discord com foco em moderação, conversa rápida e um painel de controle acessível pelo navegador.

## Recursos

- ✅ Comandos *slash* de moderação (`/ban`, `/kick`) com validações básicas.
- 💬 Comando `/chat` para respostas simpáticas rápidas.
- 🛡️ Sistema simples de *cooldown* para evitar spam de comandos.
- 🌐 Painel em Express com API REST e interface estática pronta para ser servida no Chrome.
- ⚙️ Estrutura modular para adicionar novos comandos e rotas com facilidade.

## Requisitos

- Node.js 18 ou superior
- Uma aplicação registrada no [Discord Developer Portal](https://discord.com/developers/applications)
- Token do bot, *Client ID* e o ID de um servidor para registrar comandos

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo `.env.example` para `.env` e preencha com os seus dados:

   ```bash
   cp .env.example .env
   ```

   | Variável        | Descrição                                                                 |
   | --------------- | ------------------------------------------------------------------------- |
   | `DISCORD_TOKEN` | Token do bot gerado no portal do Discord                                  |
   | `CLIENT_ID`     | ID da aplicação (Application ID)                                          |
   | `GUILD_ID`      | ID do servidor onde os comandos serão registrados (opcional em produção)  |
   | `DASHBOARD_PORT`| Porta onde o painel web será servido                                      |
   | `BOT_PREFIX`    | Prefixo utilizado para comandos de texto (ex: `!ajuda`)                   |

3. Inicie o bot e o painel:

   ```bash
   npm run dev
   ```

   O painel ficará disponível em `http://localhost:3000` por padrão. Abra no Chrome para visualizar o status, lista de comandos e enviar mensagens de teste.

## Estrutura de pastas

```
src/
├── bot/                # Helpers do cliente Discord
├── commands/           # Comandos slash organizados por categoria
├── dashboard/          # Servidor Express + assets do painel
└── index.js            # Ponto de entrada
```

## Próximos passos sugeridos

- Adicionar autenticação no painel (OAuth2, JWT ou outra solução).
- Configurar persistência de logs de moderação em um banco de dados.
- Expandir o módulo de conversa integrando uma API de IA se desejar respostas mais complexas.
- Automatizar o deploy em um serviço como Railway, Render ou Fly.io.

## Licença

Distribuído sob a licença MIT. Sinta-se livre para usar e adaptar.
