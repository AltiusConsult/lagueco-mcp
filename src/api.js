// Cliente mínimo da API pública da Lagueco (/api/v1).

export class LaguecoErro extends Error {}

const BASE_PADRAO = "https://plataforma.altiusanalytics.com.br/api/v1";

export class LaguecoApi {
  constructor({ chave, baseUrl }) {
    this.chave = chave;
    this.base = (baseUrl || BASE_PADRAO).replace(/\/+$/, "");
  }

  async req(metodo, caminho, { query, corpo } = {}) {
    const url = new URL(this.base + caminho);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    let r;
    try {
      r = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.chave}`,
          Accept: "application/json",
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
          "User-Agent": "lagueco-mcp",
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new LaguecoErro(`Não foi possível falar com a Lagueco (${e.name === "TimeoutError" ? "tempo esgotado" : e.message}).`);
    }

    const texto = await r.text();
    let json;
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch {
      json = { bruto: texto.slice(0, 500) };
    }

    if (!r.ok) {
      const msg = json?.error?.message || json?.message || texto.slice(0, 300) || r.statusText;
      if (r.status === 401) throw new LaguecoErro(`Chave inválida ou revogada (401). ${msg}`);
      if (r.status === 403) throw new LaguecoErro(`Sem permissão (403). ${msg} Peça uma chave com essa permissão em Integrações > Para desenvolvedores.`);
      if (r.status === 404) throw new LaguecoErro(`Não encontrado (404). ${msg}`);
      if (r.status === 429) throw new LaguecoErro(`Limite de uso da API atingido (429). Tente de novo em ${r.headers.get("retry-after") || 60} segundos.`);
      throw new LaguecoErro(`A Lagueco respondeu ${r.status}. ${msg}`);
    }
    return json;
  }

  get(caminho, query) { return this.req("GET", caminho, { query }); }
  post(caminho, corpo) { return this.req("POST", caminho, { corpo }); }
  patch(caminho, corpo) { return this.req("PATCH", caminho, { corpo }); }
}
