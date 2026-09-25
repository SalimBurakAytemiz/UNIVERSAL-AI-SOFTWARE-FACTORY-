// //TR: Bu helper builder/reviewer/validation logları diske yazılmadan önce yaygın credential/secret pattern'lerini redakte eder; production DLP'nin yerini almaz fakat bootstrap log leakage riskini azaltır.
const patterns=[
  [/(https?:\/\/)[^\s\/@:]+:[^\s\/@]+@/gi,"$1[REDACTED_URL_CREDENTIAL]@"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,"[REDACTED_PRIVATE_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g,"[REDACTED_AWS_ACCESS_KEY]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,"[REDACTED_GITHUB_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,"[REDACTED_GITHUB_TOKEN]"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,"[REDACTED_ANTHROPIC_KEY]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g,"[REDACTED_API_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,"Bearer [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,"[REDACTED_JWT]"],
  [/\b(?:password|passwd|pwd|api[_-]?key|secret|token|credential)\s*[:=]\s*["']?[^"'\s]{8,}/gi,"[REDACTED_SECRET_ASSIGNMENT]"]
];
export function redactText(input){
  let out=String(input??"");
  for(const [re,repl] of patterns) out=out.replace(re,repl);
  return out;
}

export function sensitiveTypes(input){
  const text=String(input??""),out=[];
  const named=[
    ["PRIVATE_KEY",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["AWS_ACCESS_KEY",/\bAKIA[0-9A-Z]{16}\b/],
    ["GITHUB_TOKEN",/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
    ["ANTHROPIC_KEY",/\bsk-ant-[A-Za-z0-9_-]{16,}\b/],
    ["API_KEY",/\bsk-[A-Za-z0-9_-]{20,}\b/],
    ["BEARER_TOKEN",/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i],
    ["JWT",/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/],
    ["SECRET_ASSIGNMENT",/\b(?:password|passwd|pwd|api[_-]?key|secret|token|credential)\s*[:=]\s*["']?[^"'\s]{8,}/i]
  ];
  for(const [name,re] of named) if(re.test(text)) out.push(name);
  return out;
}
