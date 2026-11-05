// //TR: Okuma hatası iletisi ekranda ham gösterilmez: köprünün/Electron'un sardığı metin (ör. "Error invoking remote method 'uasco:api-get': Error: /v1/academy: HTTP 500") yol ve iç ayrıntı taşır. Yalnız sabit biçimli kod (BÜYÜK_HARF_KOD), sarılmış iletideki son kod ya da "HTTP nnn" gösterilir; geri kalan serbest metin atılır (boş dize = kod satırı gösterilmez). Uydurma kod yoktur.
const FIXED_RE=/^[A-Z][A-Z0-9_]{0,63}$/,CODE_RE=/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,HTTP_RE=/HTTP (\d{3})(?!\d)/;
export function safeErrorCode(message){
  if(typeof message!=="string"||!message)return "";
  if(FIXED_RE.test(message))return message;
  const codes=message.match(CODE_RE);if(codes)return codes[codes.length-1];
  const http=HTTP_RE.exec(message);return http?`HTTP ${http[1]}`:"";
}
