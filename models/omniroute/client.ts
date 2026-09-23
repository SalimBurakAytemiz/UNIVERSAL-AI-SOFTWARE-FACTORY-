// //TR: Bu dosya harici local OmniRoute endpoint'inden mevcut model envanterini okumak için minimal client sağlar; OmniRoute kaynak kodu UASCO içine kopyalanmaz.
export interface OmniModel { id: string; owned_by?: string }

export async function discoverOmniRouteModels(
  baseUrl = process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1",
  apiKey = process.env.OMNIROUTE_API_KEY ?? ""
): Promise<OmniModel[]> {
  const headers: Record<string,string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) throw new Error(`OmniRoute discovery failed: HTTP ${response.status}`);
  const body = await response.json() as { data?: OmniModel[] };
  return Array.isArray(body.data) ? body.data : [];
}
