# Lagueco MCP

Servidor MCP da Lagueco. Deixa assistentes de IA (Claude, ChatGPT, Cursor, VS Code e outros compatíveis com MCP) consultar e atualizar o CRM, os funis, as tarefas, os relatórios e as automações de uma conta da Lagueco, pela API pública.

Produto da Altius Analytics (Altius Desenvolvimento de Programa Ltda.).

## O que ele faz

| Ferramenta | O que faz | Grava dados |
|---|---|---|
| `lagueco_conta` | Empresa, chave, permissões e limite de uso | não |
| `lagueco_catalogo` | Recursos, campos, filtros, relatórios e ações disponíveis | não |
| `lagueco_listar` | Lista registros de qualquer recurso, com busca, filtros e paginação | não |
| `lagueco_ver` | Traz um registro pelo id | não |
| `lagueco_criar` | Cria um registro (lead, contato, cliente, projeto etc.) | sim |
| `lagueco_atualizar` | Altera um registro | sim |
| `lagueco_mover_lead` | Move um lead de etapa no funil | sim |
| `lagueco_tarefas_do_lead` | Lista tarefas de um lead | não |
| `lagueco_criar_tarefa` | Agenda ligação, WhatsApp, e-mail, follow-up, proposta ou reunião | sim |
| `lagueco_concluir_tarefa` | Conclui uma tarefa com o resultado | sim |
| `lagueco_notas_do_lead` | Lista as notas de um lead | não |
| `lagueco_criar_nota` | Anota na ficha do lead | sim |
| `lagueco_relatorio` | Funil, vendas, atividades, financeiro, projetos, marketing, anúncios da Meta e atribuição | não |
| `lagueco_executar_automacao` | Dispara uma automação ativa | sim |

O que cada chave enxerga depende das permissões dela. Uma ferramenta sem permissão responde com o erro 403 e diz qual permissão falta.

## Como usar

1. Na Lagueco, vá em **Integrações > Para desenvolvedores** e crie uma chave. Para começar, prefira **Só ler dados**.
2. Configure o assistente. Exemplo para o Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lagueco": {
      "command": "npx",
      "args": ["-y", "@altiusanalytics/lagueco-mcp"],
      "env": { "LAGUECO_API_KEY": "alt_live_..." }
    }
  }
}
```

Enquanto o pacote não estiver publicado no npm, use o caminho local: `"command": "node", "args": ["/caminho/lagueco-mcp/src/index.js"]`.

Variáveis:

- `LAGUECO_API_KEY` (obrigatória): chave da API.
- `LAGUECO_API_URL` (opcional): padrão `https://plataforma.altiusanalytics.com.br/api/v1`.

Requer Node 20 ou mais novo.

## Segurança e dados pessoais

- A chave dá acesso a dados de clientes e leads. Guarde como senha e revogue em Integrações se vazar.
- O servidor roda na máquina de quem usa. Os dados vão da Lagueco para o assistente de IA escolhido pela empresa. A empresa cliente é a controladora desses dados (LGPD) e deve usar um assistente com contrato e política adequados.
- As ferramentas que gravam vêm marcadas para o assistente pedir confirmação antes de agir.
- Limite da API: 120 pedidos por minuto por chave. Acima disso, a API responde 429.
