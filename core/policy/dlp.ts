// //TR: Bu dosya model/provider/report/export öncesi basit Day-0 credential/secret sinyallerini fail-closed yakalayan DLP başlangıç katmanını sağlar; production DLP roadmap'te genişletilir.
export interface DlpFinding { type:string; start:number; end:number }

const patterns: Array<[string,RegExp]> = [
  ["PRIVATE_KEY",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["AWS_ACCESS_KEY",/\bAKIA[0-9A-Z]{16}\b/g],
  ["BEARER_TOKEN",/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g],
  ["GENERIC_SECRET",/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi]
];

export function scanDlp(input:string): DlpFinding[] {
  const out:DlpFinding[]=[];
  for(const [type,re] of patterns){
    re.lastIndex=0;
    for(const m of input.matchAll(re)) out.push({type,start:m.index??0,end:(m.index??0)+m[0].length});
  }
  return out;
}

export function assertNoSensitiveEgress(input:string): void {
  const findings=scanDlp(input);
  if(findings.length) throw new Error(`DLP blocked egress: ${findings.map(x=>x.type).join(",")}`);
}
