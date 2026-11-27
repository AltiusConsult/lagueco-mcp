#!/usr/bin/env node
// Servidor MCP da Lagueco, versão instalada (stdio).
// Autenticação: chave da API criada em Integrações > Para desenvolvedores (alt_live_...).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LaguecoApi } from "./api.js";
import { criarServidor } from "./ferramentas.js";

const chave = process.env.LAGUECO_API_KEY;
if (!chave) {
  console.error("Defina LAGUECO_API_KEY com a chave da API da Lagueco (Integrações > Para desenvolvedores).");
  process.exit(1);
}
const api = new LaguecoApi({ chave, baseUrl: process.env.LAGUECO_API_URL });
await criarServidor(api).connect(new StdioServerTransport());
