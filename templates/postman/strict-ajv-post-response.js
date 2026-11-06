// //TR: Bu Postman post-response template'i contract schema + Ajv + recursive null/empty + header checks için adapter tarafından gerçek schema/policy ile doldurulur; tek response'tan sahte expected contract üretmez.
// UASCO-T0129: politika anahtarları, varsayılanları ve hata metinleri core/qa/api/strict-json-validator.ts ile AYNIDIR (postman-strict-test.ts doldurur; parite testle bağlıdır).
// ajv-formats yoksa "format" kullanan şema derlenmez ve test başarısız olur (fail-closed; format sessizce atlanmaz).
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: true });
try { require('ajv-formats')(ajv); } catch (e) { /* format yok: format kullanan şema derlemede hata verir */ }

// Adapter bu sabitleri approved contract/policy'den üretir.
const schema = __UASCO_SCHEMA__;
const policy = __UASCO_POLICY__;
const requiredHeaders = __UASCO_REQUIRED_HEADERS__;

function pathMatches(path, patterns) {
  return (patterns || []).some(pattern => {
    const a = pattern.split('.'); const b = path.split('.');
    return a.length === b.length && a.every((x, i) => x === '*' || x === b[i]);
  });
}
function scan(value, path = '$', errors = []) {
  if (value === null) {
    if (!pathMatches(path, policy.allowNullPaths)) errors.push(`${path}: null forbidden`);
    return errors;
  }
  if (typeof value === 'string') {
    const empty = value.length === 0, ws = value.trim().length === 0;
    if (((policy.denyEmptyStrings !== false && empty) || (policy.denyWhitespaceStrings !== false && ws)) && !pathMatches(path, policy.allowEmptyPaths)) errors.push(`${path}: empty string forbidden`);
    return errors;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 && policy.denyEmptyArrays && !pathMatches(path, policy.allowEmptyPaths)) errors.push(`${path}: empty array forbidden`);
    value.forEach((item, i) => scan(item, `${path}.${i}`, errors));
    return errors;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && policy.denyEmptyObjects && !pathMatches(path, policy.allowEmptyPaths)) errors.push(`${path}: empty object forbidden`);
    keys.forEach(k => scan(value[k], `${path}.${k}`, errors));
  }
  return errors;
}

pm.test('Status contract ile uyumlu', () => pm.expect(pm.response.code).to.be.oneOf(policy.allowedStatusCodes));
for (const h of requiredHeaders) pm.test(`Header mevcut: ${h}`, () => pm.expect(pm.response.headers.has(h)).to.eql(true));
const body = pm.response.json();
const validate = ajv.compile(schema);
pm.test('JSON Schema geçerli', () => pm.expect(validate(body), JSON.stringify(validate.errors, null, 2)).to.eql(true));
pm.test('Null / empty policy geçerli', () => pm.expect(scan(body), 'Null/empty violations').to.eql([]));
