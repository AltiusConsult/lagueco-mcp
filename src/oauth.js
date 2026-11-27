// Servidor de autorização OAuth 2.1 mínimo e sem estado, para os conectores MCP
// (Claude, ChatGPT e outros que exigem OAuth com PKCE e registro dinâmico de cliente).
//
// Como funciona: na tela de autorização a pessoa informa a chave da API da Lagueco.
// A chave é conferida na Lagueco e vai cifrada (AES-256-GCM) dentro do código e dos tokens.
// Nada é gravado no servidor. Revogar a chave na Lagueco derruba a conexão.

import crypto from "node:crypto";
import { LaguecoApi } from "./api.js";

const ACESSO_SEG = 60 * 60;            // token de acesso: 1 hora
const RENOVACAO_SEG = 90 * 24 * 3600;  // token de renovação: 90 dias
const CODIGO_SEG = 5 * 60;             // código de autorização: 5 minutos
const PREFIXO = "lgc1.";

// ---------- cifra
function chaveCifra() {
  const segredo = process.env.MCP_TOKEN_SECRET;
  if (!segredo || segredo.length < 32) throw new Error("MCP_TOKEN_SECRET ausente ou curto (mínimo 32 caracteres).");
  return crypto.createHash("sha256").update(segredo).digest();
}
export function selar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chaveCifra(), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return PREFIXO + Buffer.concat([iv, c.getAuthTag(), dados]).toString("base64url");
}
export function abrir(texto, tipo) {
  if (typeof texto !== "string" || !texto.startsWith(PREFIXO)) return null;
  try {
    const b = Buffer.from(texto.slice(PREFIXO.length), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", chaveCifra(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
    if (tipo && obj.t !== tipo) return null;
    if (obj.exp && obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}
const agora = () => Math.floor(Date.now() / 1000);

// ---------- utilidades HTTP
export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}
function json(res, status, corpo, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(corpo));
}
function erroOAuth(res, status, erro, descricao) {
  json(res, status, { error: erro, error_description: descricao });
}
function lerForm(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") return Object.fromEntries(new URLSearchParams(b));
  if (Buffer.isBuffer(b)) return Object.fromEntries(new URLSearchParams(b.toString("utf8")));
  return b;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function urlRedirecionamentoValida(u) {
  try {
    const x = new URL(u);
    if (x.protocol === "https:") return true;
    return x.protocol === "http:" && (x.hostname === "localhost" || x.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

// ---------- metadados
export function metadadosRecurso(req, res) {
  const b = baseUrl(req);
  json(res, 200, {
    resource: `${b}/mcp`,
    authorization_servers: [b],
    bearer_methods_supported: ["header"],
    resource_name: "Lagueco",
    resource_documentation: "https://github.com/AltiusConsult/lagueco-mcp",
  });
}
export function metadadosAutorizacao(req, res) {
  const b = baseUrl(req);
  json(res, 200, {
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["lagueco"],
    service_documentation: "https://github.com/AltiusConsult/lagueco-mcp",
  });
}

// ---------- registro dinâmico de cliente (RFC 7591)
export function registrar(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return erroOAuth(res, 405, "invalid_request", "Use POST.");
  const b = typeof req.body === "object" && req.body ? req.body : {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u) => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(urlRedirecionamentoValida)) {
    return erroOAuth(res, 400, "invalid_redirect_uri", "Informe redirect_uris com endereços https (ou http em localhost).");
  }
  const nome = typeof b.client_name === "string" ? b.client_name.slice(0, 100) : "Assistente de IA";
  const client_id = selar({ t: "cliente", u: uris, n: nome, iat: agora() });
  json(res, 201, {
    client_id,
    client_id_issued_at: agora(),
    client_name: nome,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

// ---------- autorização
function validarPedido(q) {
  const cliente = abrir(q.client_id, "cliente");
  if (!cliente) return { erro: "Cliente não reconhecido. Remova o conector e adicione de novo." };
  if (!q.redirect_uri || !cliente.u.includes(q.redirect_uri)) return { erro: "Endereço de retorno não autorizado para este cliente." };
  if (q.response_type !== "code") return { erro: "response_type precisa ser code.", voltar: true };
  if (!q.code_challenge || q.code_challenge_method !== "S256") return { erro: "PKCE com S256 é obrigatório.", voltar: true };
  return { cliente };
}
function voltarComErro(res, q, erro, descricao) {
  const u = new URL(q.redirect_uri);
  u.searchParams.set("error", erro);
  if (descricao) u.searchParams.set("error_description", descricao);
  if (q.state) u.searchParams.set("state", q.state);
  res.statusCode = 302;
  res.setHeader("Location", u.toString());
  res.end();
}

function pagina({ nomeCliente, pedido, erro }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar a Lagueco</title>
<style>
:root{--bg:#F5F4FA;--ink:#0D0F24;--ink2:#4A4C66;--line:#DEDCEA;--grad:linear-gradient(90deg,#C23AE8,#6E3FE0 55%,#1E9FD8)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
main{max-width:460px;margin:6vh auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px}
.marca{font-weight:800;font-size:22px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
h1{font-size:20px;margin:14px 0 6px}p{margin:0 0 12px;color:var(--ink2)}
label{display:block;font-weight:700;margin:18px 0 6px}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font:15px ui-monospace,monospace}
input:focus{outline:2px solid #6E3FE0;outline-offset:1px}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:999px;background:var(--grad);color:#fff;font-weight:800;font-size:16px;cursor:pointer}
.erro{background:#FDECEC;color:#8A1C1C;border-radius:8px;padding:10px 12px;margin-top:14px}
.nota{font-size:13px;margin-top:16px}
</style></head><body><main>
<div class="marca">Lagueco</div>
<h1>Conectar ${esc(nomeCliente)} à Lagueco</h1>
<p>O assistente vai poder consultar e, se a chave permitir, alterar dados da sua conta: leads, funis, tarefas, relatórios e automações.</p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="pedido" value="${esc(pedido)}">
<label for="chave">Chave da API da Lagueco</label>
<input id="chave" name="chave" type="password" autocomplete="off" placeholder="alt_live_..." required>
<p class="nota">Crie a chave na Lagueco em Integrações &gt; Para desenvolvedores. Para só consultar, escolha "Só ler dados". Você pode revogar a chave a qualquer momento, e a conexão para na hora.</p>
${erro ? `<div class="erro">${esc(erro)}</div>` : ""}
<button type="submit">Autorizar</button>
</form>
<p class="nota">A Lagueco é um produto da Altius Analytics. <a href="https://altiusanalytics.com.br/privacidade">Política de privacidade</a>.</p>
</main></body></html>`;
}
function enviarPagina(res, html, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  res.end(html);
}

export async function autorizar(req, res) {
  if (req.method === "GET") {
    const q = { ...Object.fromEntries(new URL(req.url, "http://x").searchParams), ...(req.query || {}) };
    delete q.rota;
    const v = validarPedido(q);
    if (v.erro && !v.voltar) return enviarPagina(res, `<p>${esc(v.erro)}</p>`, 400);
    if (v.erro) return voltarComErro(res, q, "invalid_request", v.erro);
    const pedido = selar({
      t: "pedido", c: q.client_id, r: q.redirect_uri, s: q.state ?? null,
      cc: q.code_challenge, res: q.resource ?? null, exp: agora() + 15 * 60,
    });
    return enviarPagina(res, pagina({ nomeCliente: v.cliente.n, pedido }));
  }
  if (req.method !== "POST") return erroOAuth(res, 405, "invalid_request", "Use GET ou POST.");

  const f = lerForm(req);
  const p = abrir(f.pedido, "pedido");
  if (!p) return enviarPagina(res, "<p>O pedido expirou. Volte ao assistente e tente conectar de novo.</p>", 400);
  const cliente = abrir(p.c, "cliente");
  const chave = String(f.chave || "").trim();
  const repetir = (erro) => enviarPagina(res, pagina({ nomeCliente: cliente?.n ?? "o assistente", pedido: f.pedido, erro }), 400);
  if (!chave) return repetir("Informe a chave.");

  let conta;
  try {
    conta = await new LaguecoApi({ chave, baseUrl: process.env.LAGUECO_API_URL }).get("/me");
  } catch (e) {
    return repetir("A Lagueco não aceitou essa chave. Confira se ela foi copiada inteira e se não foi revogada.");
  }

  const codigo = selar({ t: "codigo", k: chave, c: p.c, r: p.r, cc: p.cc, w: conta?.workspace?.name ?? null, exp: agora() + CODIGO_SEG });
  const u = new URL(p.r);
  u.searchParams.set("code", codigo);
  if (p.s) u.searchParams.set("state", p.s);
  res.statusCode = 302;
  res.setHeader("Location", u.toString());
  res.end();
}

// ---------- token
function emitir(res, chave, clientId) {
  json(res, 200, {
    access_token: selar({ t: "acesso", k: chave, c: clientId, exp: agora() + ACESSO_SEG }),
    token_type: "Bearer",
    expires_in: ACESSO_SEG,
    refresh_token: selar({ t: "renovacao", k: chave, c: clientId, exp: agora() + RENOVACAO_SEG }),
    scope: "lagueco",
  });
}

export function token(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return erroOAuth(res, 405, "invalid_request", "Use POST.");
  const f = lerForm(req);

  if (f.grant_type === "authorization_code") {
    const cod = abrir(f.code, "codigo");
    if (!cod) return erroOAuth(res, 400, "invalid_grant", "Código inválido ou expirado.");
    if (f.client_id && f.client_id !== cod.c) return erroOAuth(res, 400, "invalid_grant", "O código não é deste cliente.");
    if (f.redirect_uri && f.redirect_uri !== cod.r) return erroOAuth(res, 400, "invalid_grant", "redirect_uri diferente do pedido.");
    const desafio = crypto.createHash("sha256").update(String(f.code_verifier || "")).digest("base64url");
    if (!f.code_verifier || desafio !== cod.cc) return erroOAuth(res, 400, "invalid_grant", "code_verifier não confere (PKCE).");
    return emitir(res, cod.k, cod.c);
  }

  if (f.grant_type === "refresh_token") {
    const ren = abrir(f.refresh_token, "renovacao");
    if (!ren) return erroOAuth(res, 400, "invalid_grant", "Token de renovação inválido ou expirado.");
    if (f.client_id && f.client_id !== ren.c) return erroOAuth(res, 400, "invalid_grant", "O token não é deste cliente.");
    return emitir(res, ren.k, ren.c);
  }

  return erroOAuth(res, 400, "unsupported_grant_type", "Use authorization_code ou refresh_token.");
}

// ---------- uso pelo endpoint /mcp
export function chaveDoToken(valor) {
  const a = abrir(valor, "acesso");
  return a ? a.k : null;
}
