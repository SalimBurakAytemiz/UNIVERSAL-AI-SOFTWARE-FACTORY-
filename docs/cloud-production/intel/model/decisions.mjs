//TR: Founder kararları: founderQueue (kimliksizlere metin özetinden kimlik), entegrasyon kararları D1-D11 ve Wave 0 FD-1..FD-10. Durum: kanıtla çözülmüş (metin bir PR'ı merge/kapatma ister ve PR GitHub'da o durumdaysa) RESOLVED_BY_EVIDENCE; aksi halde OPEN (kayıt der ki bekliyor); metin yoksa UNKNOWN. İlk görülme zamanı ilgili dosyada metni ilk getiren commit'tir (pickaxe).
import { prRefs } from '../core/ids.mjs';
import { cmp, natCmp, uniqSorted } from '../core/canonical-json.mjs';
import { hoursBetween, round1 } from '../core/time.mjs';

export function buildDecisions({ coordinator, resolver, pulls, firstSeen, nowIso, overlayState, staleHours }) {
  const src = [
    ...coordinator.founderQueue.map((f) => ({ id: f.id, source: 'PRODUCTION-QUEUE.json founderQueue', text: `${f.text}${f.why ? ` (why: ${f.why})` : ''}`, synthesized: f.synthesized })),
    ...coordinator.integrationDecisions.map((d) => ({ id: d.id, source: 'PRODUCTION-QUEUE.json integrationQueue.founderDecisions', text: d.text, synthesized: false })),
    ...coordinator.wave0FounderDecisions.map((d) => ({ id: d.id, source: 'inputs/wave0-baseline.json founderDecisions', text: d.text, synthesized: false })),
  ];
  return src.map((d) => {
    const refs = uniqSorted(prRefs(d.text).filter((n) => pulls.has(n)));
    const ids = resolver.resolveText(d.text);
    let state = d.text ? 'OPEN' : 'UNKNOWN', resolution = null;
    const ov = overlayState.get(d.id);
    if (ov) { state = ov.value; resolution = `overlay:${ov.by} ${ov.reason}`; }
    else {
      // Imperative only: the verb must be among the first 4 words of the action; refs are taken from that clause up to a stop word/punctuation.
      const body = d.text.replace(/^(D\d+|FD-\d+)\b[^:]{0,60}:\s*/, '');
      const head = body.split(/\s+/).slice(0, 4).join(' ');
      const vm = /\b(merg(?:e|es|ing)|land|clos(?:e|es|ing))\b/i.exec(head);
      if (vm) {
        const clause = body.slice(body.indexOf(vm[0])).split(/[.;:(]|\b(?:as|by|after|until|once|if|when|given)\b/i)[0];
        const act = uniqSorted(prRefs(clause).filter((n) => pulls.has(n)));
        const isClose = /^clos/i.test(vm[1]);
        if (act.length && act.every((n) => (isClose ? pulls.get(n).state === 'closed' : !!pulls.get(n).mergedAt))) { state = 'RESOLVED_BY_EVIDENCE'; resolution = act.map((n) => { const p = pulls.get(n); return `#${n} ${p.mergedAt ? `merged ${p.mergedAt}` : `closed ${p.closedAt}`}`; }).join('; '); }
      }
    }
    const refsAllFinal = refs.length > 0 && refs.every((n) => pulls.get(n).state === 'closed');
    const fs = firstSeen[d.id] || null;
    const ageHours = fs ? round1(hoursBetween(fs.at, nowIso)) : null;
    const blocksItems = uniqSorted([...ids]);
    return { id: d.id, source: d.source, text: d.text, synthesized: d.synthesized, refs: refs.map((n) => `#${n}`), itemRefs: ids, state, resolution, firstSeenAt: fs ? fs.at : null, firstSeenCommit: fs ? fs.sha.slice(0, 7) : null, ageHours, refsAllFinal, stale: state === 'OPEN' && ageHours !== null && ageHours > staleHours, blocksItems };
  }).sort((a, b) => cmp(a.source, b.source) || natCmp(a.id, b.id));
}
