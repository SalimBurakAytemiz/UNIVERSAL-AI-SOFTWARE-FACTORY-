// //TR: Bu dosya SBX-8 (C-01/C-02) için ajan yapılandırma yollarını tanır: .claude/** (her derinlikte), .mcp.json, .claude.json, CLAUDE.md, CLAUDE.local.md. Claude CLI bu dosyalardan hook, izin, MCP sunucusu ve talimat yükleyebildiği için
// //TR: Studio içe aktarması bunları karantinaya alır, edit-only builder çıktısı bunlara dokunursa reddedilir ve builder bu dosyaları içeren bir çalışma alanında hiç başlatılmaz. Karşılaştırma Windows'a göre yapılır: büyük/küçük harf duyarsız, sondaki nokta/boşluk ve ADS (":akış") yok sayılır, 8.3 kısa ad (CLAUDE~1) .claude sayılır.
export const AGENT_CONFIG_PATTERNS = [".claude/**", ".mcp.json", ".claude.json", "CLAUDE.md", "CLAUDE.local.md"] as const;
export type AgentConfigPattern = typeof AGENT_CONFIG_PATTERNS[number];

const normSeg = (seg: string): string => seg.split(":")[0].replace(/[. ]+$/, "").toLowerCase();
const FILE_NAMES: Record<string, AgentConfigPattern> = {".mcp.json": ".mcp.json", ".claude.json": ".claude.json", "claude.md": "CLAUDE.md", "claude.local.md": "CLAUDE.local.md"};

// Depo-göreli yol ("/" veya "\" ayraçlı) bir ajan yapılandırma yoluysa eşleşen deseni, değilse null döner.
export function agentConfigPattern(rel: string): AgentConfigPattern | null {
  const segs = String(rel ?? "").split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (!segs.length) return null;
  const n = segs.map(normSeg);
  if (n.some(s => s === ".claude" || /^claude~\d+$/.test(s))) return ".claude/**";
  // dosya adının kendisi: sondaki nokta/boşluk ve ADS soyulmuş halde (Windows bu biçimleri aynı dosyaya çözer)
  const last = n[n.length - 1];
  return FILE_NAMES[last] ?? null;
}
export const isAgentConfigPath = (rel: string): boolean => agentConfigPattern(rel) !== null;
