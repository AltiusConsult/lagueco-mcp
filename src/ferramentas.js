// Ferramentas da Lagueco, usadas pela versão instalada (stdio) e pela hospedada (HTTP).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LaguecoErro } from "./api.js";

export const VERSAO = "0.2.2";

export function criarServidor(api) {
  const server = new McpServer(
    { name: "lagueco", version: VERSAO },
    {
      instructions:
        "Ferramentas da Lagueco, CRM e plataforma de marketing para agências. " +
        "Comece por lagueco_catalogo para saber quais recursos, campos, filtros e relatórios a chave pode usar. " +
        "Use lagueco_listar com recurso 'funis' para descobrir pipeline_id e stage_id antes de criar ou mover leads. " +
        "As ferramentas que criam ou alteram dados agem na conta real do cliente: confirme com a pessoa antes de usá-las.",
    },
  );

  // ---------- utilidades
  const recurso = z
    .string()
    .regex(/^[a-z_]+$/, "Use o nome do recurso como aparece no catálogo, por exemplo leads ou tarefas_crm.")
    .describe("Nome do recurso, como aparece em lagueco_catalogo (ex.: leads, funis, tarefas_crm, clientes, projetos).");
  const id = z.string().min(1).describe("Identificador do registro.");
  const dados = z.record(z.any()).describe("Campos a gravar. Use só os campos editáveis do recurso, listados em lagueco_catalogo.");

  const LEITURA = { readOnlyHint: true, openWorldHint: true };
  const ESCRITA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const ALTERACAO = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

  function resposta(dadosApi) {
    return { content: [{ type: "text", text: JSON.stringify(dadosApi, null, 2) }] };
  }
  function falha(e) {
    const msg = e instanceof LaguecoErro ? e.message : `Erro inesperado: ${e?.message ?? e}`;
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
  function ferramenta(nome, def, fn) {
    server.registerTool(nome, def, async (args) => {
      try {
        return resposta(await fn(args ?? {}));
      } catch (e) {
        return falha(e);
      }
    });
  }

  // ---------- conta e catálogo
  ferramenta(
    "lagueco_conta",
    {
      title: "Conta conectada",
      description: "Mostra a empresa (workspace) da chave, o nome da chave, as permissões e o limite de uso da API.",
      inputSchema: {},
      annotations: LEITURA,
    },
    () => api.get("/me"),
  );

  ferramenta(
    "lagueco_catalogo",
    {
      title: "Catálogo da API",
      description:
        "Lista os recursos (leads, funis, tarefas, clientes, projetos, financeiro, marketing etc.), com campos, campos editáveis, " +
        "obrigatórios, valores aceitos, filtros e busca; os relatórios disponíveis; e as ações. Consulte antes de listar, criar ou editar.",
      inputSchema: {},
      annotations: LEITURA,
    },
    () => api.get("/catalogo"),
  );

  // ---------- operações genéricas
  ferramenta(
    "lagueco_listar",
    {
      title: "Listar registros",
      description:
        "Lista registros de um recurso, com busca por texto, filtros por campo e paginação. " +
        "Os filtros aceitos por recurso estão em lagueco_catalogo.",
      inputSchema: {
        recurso,
        busca: z.string().optional().describe("Texto para buscar nos campos de busca do recurso (ex.: nome, empresa, e-mail)."),
        filtros: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Filtros por campo, ex.: { \"stage_id\": \"...\", \"uf\": \"SP\" }."),
        desde: z.string().optional().describe("Só registros alterados desde esta data (AAAA-MM-DD ou ISO 8601)."),
        limite: z.number().int().min(1).max(100).default(25).describe("Quantos registros trazer (até 100)."),
        offset: z.number().int().min(0).default(0).describe("Quantos pular, para paginar."),
      },
      annotations: LEITURA,
    },
    ({ recurso: r, busca, filtros, desde, limite, offset }) =>
      api.get(`/${r}`, { ...(filtros ?? {}), q: busca, desde, limit: limite, offset }),
  );

  ferramenta(
    "lagueco_ver",
    {
      title: "Ver registro",
      description: "Traz um registro de um recurso pelo id.",
      inputSchema: { recurso, id },
      annotations: LEITURA,
    },
    ({ recurso: r, id: i }) => api.get(`/${r}/${encodeURIComponent(i)}`),
  );

  ferramenta(
    "lagueco_criar",
    {
      title: "Criar registro",
      description:
        "Cria um registro num recurso editável (ex.: leads, contatos, clientes, projetos, tarefas_projeto). " +
        "Respeite os campos obrigatórios e os valores aceitos do catálogo. Grava na conta real: confirme antes com a pessoa.",
      inputSchema: { recurso, dados },
      annotations: ESCRITA,
    },
    ({ recurso: r, dados: d }) => api.post(`/${r}`, d),
  );

  ferramenta(
    "lagueco_atualizar",
    {
      title: "Atualizar registro",
      description:
        "Altera campos de um registro existente. Em leads, mudar stage_id move o card no funil. Grava na conta real: confirme antes com a pessoa.",
      inputSchema: { recurso, id, dados },
      annotations: ALTERACAO,
    },
    ({ recurso: r, id: i, dados: d }) => api.patch(`/${r}/${encodeURIComponent(i)}`, d),
  );

  // ---------- CRM
  ferramenta(
    "lagueco_mover_lead",
    {
      title: "Mover lead de etapa",
      description: "Move um lead para outra etapa do funil. Descubra o stage_id com lagueco_listar no recurso funis.",
      inputSchema: { lead_id: id, stage_id: z.string().min(1).describe("Etapa de destino.") },
      annotations: ALTERACAO,
    },
    ({ lead_id, stage_id }) => api.patch(`/leads/${encodeURIComponent(lead_id)}`, { stage_id }),
  );

  ferramenta(
    "lagueco_tarefas_do_lead",
    {
      title: "Tarefas de um lead",
      description: "Lista ligações, follow-ups e reuniões de um lead.",
      inputSchema: { lead_id: id },
      annotations: LEITURA,
    },
    ({ lead_id }) => api.get(`/leads/${encodeURIComponent(lead_id)}/tasks`),
  );

  ferramenta(
    "lagueco_criar_tarefa",
    {
      title: "Criar tarefa no lead",
      description: "Agenda uma tarefa num lead (ligação, WhatsApp, e-mail, follow-up, proposta, reunião ou outro).",
      inputSchema: {
        lead_id: id,
        tipo: z.enum(["ligacao", "whatsapp", "email", "follow_up", "proposta", "reuniao", "outro"]),
        due_at: z.string().describe("Data e hora em ISO 8601, ex.: 2026-12-01T14:00:00-03:00."),
        title: z.string().optional().describe("Título curto da tarefa."),
        body: z.string().optional().describe("Detalhes."),
        assignee_user_id: z.string().optional().describe("Responsável. Sem informar, fica com o dono da chave ou do lead."),
      },
      annotations: ESCRITA,
    },
    ({ lead_id, ...resto }) => api.post(`/leads/${encodeURIComponent(lead_id)}/tasks`, resto),
  );

  ferramenta(
    "lagueco_concluir_tarefa",
    {
      title: "Concluir tarefa",
      description: "Marca uma tarefa como realizada e registra o resultado.",
      inputSchema: {
        tarefa_id: id,
        resultado: z.enum([
          "sem_resposta", "caixa_postal", "numero_errado", "falou_secretaria", "falou_decisor",
          "pediu_retorno", "pediu_material", "agendou", "sem_interesse", "enviado", "respondeu",
        ]),
        nota_resultado: z.string().optional().describe("Observação sobre o resultado."),
      },
      annotations: ALTERACAO,
    },
    ({ tarefa_id, ...resto }) => api.post(`/tasks/${encodeURIComponent(tarefa_id)}/complete`, resto),
  );

  ferramenta(
    "lagueco_notas_do_lead",
    {
      title: "Notas de um lead",
      description: "Lista as notas internas de um lead.",
      inputSchema: { lead_id: id },
      annotations: LEITURA,
    },
    ({ lead_id }) => api.get(`/leads/${encodeURIComponent(lead_id)}/notes`),
  );

  ferramenta(
    "lagueco_criar_nota",
    {
      title: "Anotar no lead",
      description: "Grava uma nota interna na ficha do lead.",
      inputSchema: { lead_id: id, body: z.string().min(1).describe("Texto da nota.") },
      annotations: ESCRITA,
    },
    ({ lead_id, body }) => api.post(`/leads/${encodeURIComponent(lead_id)}/notes`, { body }),
  );

  // ---------- relatórios e automações
  ferramenta(
    "lagueco_relatorio",
    {
      title: "Relatório",
      description:
        "Gera um relatório: funil, vendas, atividades, financeiro, projetos, marketing, anuncios (Meta) ou atribuicao. " +
        "Sem datas, vale o mês atual.",
      inputSchema: {
        nome: z.enum(["funil", "vendas", "atividades", "financeiro", "projetos", "marketing", "anuncios", "atribuicao"]),
        de: z.string().optional().describe("Início, AAAA-MM-DD."),
        ate: z.string().optional().describe("Fim, AAAA-MM-DD."),
        por: z.string().optional().describe("Agrupamento. anuncios: cliente, conta, campanha ou criativo. atribuicao: origem, campanha ou meio."),
        cliente: z.string().optional().describe("Só em anuncios: nome ou id do cliente."),
      },
      annotations: LEITURA,
    },
    ({ nome, ...params }) => api.get(`/relatorios/${nome}`, params),
  );

  ferramenta(
    "lagueco_executar_automacao",
    {
      title: "Disparar automação",
      description:
        "Dispara uma automação ativa da Lagueco. Os campos enviados viram {{payload.campo}} nos passos. " +
        "Pode enviar mensagens ou alterar dados: confirme antes com a pessoa.",
      inputSchema: {
        automacao_id: id,
        payload: z.record(z.any()).optional().describe("Dados repassados para a automação."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ automacao_id, payload }) => api.post(`/automacoes/${encodeURIComponent(automacao_id)}/executar`, payload ?? {}),
  );


  return server;
}
