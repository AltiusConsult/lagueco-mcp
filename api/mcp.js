// Servidor MCP da Lagueco, versão hospedada (Streamable HTTP, sem estado).
// Cada pedido traz a chave da API da Lagueco do próprio cliente:
//   Authorization: Bearer alt_live_...   (ou o cabeçalho X-Lagueco-Api-Key)
// O servidor não guarda a chave nem registra o conteúdo dos pedidos.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LaguecoApi } from "../src/api.js";
import { criarServidor, VERSAO } from "../src/ferramentas.js";
import { baseUrl, chaveDoToken } from "../src/oauth.js";

function erroJsonRpc(res, status, mensagem) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: mensagem }, id: null }));
}

// Aceita três formas de autenticação:
//   1. token OAuth emitido por este servidor (Authorization: Bearer lgc1....)
//   2. chave da API direto (Authorization: Bearer alt_live_...)
//   3. chave da API no cabeçalho X-Lagueco-Api-Key
function chaveDoPedido(req) {
  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const valor = m[1].trim();
    if (valor.startsWith("lgc1.")) return { chave: chaveDoToken(valor), oauth: true };
    return { chave: valor };
  }
  const alt = req.headers["x-lagueco-api-key"];
  return { chave: typeof alt === "string" ? alt.trim() : "" };
}

function pedirLogin(req, res, motivo) {
  const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${meta}"${motivo ? `, error="invalid_token", error_description="${motivo}"` : ""}`);
  return erroJsonRpc(res, 401, motivo || "Autentique com OAuth ou envie a chave da API da Lagueco em Authorization: Bearer alt_live_...");
}

export default async function handler(req, res) {
  if (req.method === "GET" && !String(req.headers.accept || "").includes("text/event-stream")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      nome: "Lagueco MCP",
      versao: VERSAO,
      transporte: "streamable-http",
      autenticacao: "OAuth 2.1 (PKCE) ou Authorization: Bearer <chave da API da Lagueco>",
      documentacao: "https://github.com/AltiusConsult/lagueco-mcp",
    }));
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return erroJsonRpc(res, 405, "Use POST. Este servidor não mantém sessão.");
  }

  const { chave, oauth } = chaveDoPedido(req);
  if (!chave) return pedirLogin(req, res, oauth ? "Token expirado ou inválido. Renove o acesso." : "");

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
