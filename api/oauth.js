// Rotas OAuth do servidor MCP da Lagueco (ver src/oauth.js).
// O vercel.json reescreve os endereços públicos para cá com ?rota=...

import { metadadosRecurso, metadadosAutorizacao, registrar, autorizar, token } from "../src/oauth.js";

export default async function handler(req, res) {
  const rota = (req.query && req.query.rota) || new URL(req.url, "http://x").searchParams.get("rota");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
    res.statusCode = 204;
    return res.end();
  }
  try {
    switch (rota) {
      case "recurso": return metadadosRecurso(req, res);
      case "servidor": return metadadosAutorizacao(req, res);
      case "registrar": return registrar(req, res);
      case "autorizar": return await autorizar(req, res);
      case "token": return token(req, res);
      default:
        res.statusCode = 404;
        return res.end("Não encontrado");
    }
  } catch (e) {
    console.error("Erro OAuth:", e?.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "server_error", error_description: "Erro interno do servidor de autorização." }));
    }
  }
}
