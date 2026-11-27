// Servidor MCP da Lagueco, versão hospedada (Streamable HTTP, sem estado).
// Cada pedido traz a chave da API da Lagueco do próprio cliente:
//   Authorization: Bearer alt_live_...   (ou o cabeçalho X-Lagueco-Api-Key)
// O servidor não guarda a chave nem registra o conteúdo dos pedidos.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LaguecoApi } from "../src/api.js";
import { criarServidor, VERSAO } from "../src/ferramentas.js";

function erroJsonRpc(res, status, mensagem) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: mensagem }, id: null }));
}

function chaveDoPedido(req) {
  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const alt = req.headers["x-lagueco-api-key"];
  return typeof alt === "string" ? alt.trim() : "";
}

export default async function handler(req, res) {
  if (req.method === "GET" && !String(req.headers.accept || "").includes("text/event-stream")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      nome: "Lagueco MCP",
      versao: VERSAO,
      transporte: "streamable-http",
      autenticacao: "Authorization: Bearer <chave da API da Lagueco>",
      documentacao: "https://github.com/AltiusConsult/lagueco-mcp",
    }));
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return erroJsonRpc(res, 405, "Use POST. Este servidor não mantém sessão.");
  }

  const chave = chaveDoPedido(req);
  if (!chave) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="lagueco"');
    return erroJsonRpc(res, 401, "Envie a chave da API da Lagueco no cabeçalho Authorization: Bearer alt_live_... (Integrações > Para desenvolvedores).");
  }

  const servidor = criarServidor(new LaguecoApi({ chave, baseUrl: process.env.LAGUECO_API_URL }));
  const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transporte.close();
    servidor.close();
  });
  try {
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) erroJsonRpc(res, 500, "Erro interno do servidor MCP da Lagueco.");
  }
}
