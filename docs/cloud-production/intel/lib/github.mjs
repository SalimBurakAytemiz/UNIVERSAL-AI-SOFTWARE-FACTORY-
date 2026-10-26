//TR: Saf olmayan GitHub kenarı: curl ile salt okunur REST (vekil ve CA paketi geçerli kalır). Asla fırlatmaz; ETag ile koşullu GET (304 hız kotası harcamaz), artımlı imleçler, çağrı tavanları ve hız rezervi. Rezervin altına inilirse sonuç PARTIAL olur ve imleç ertesi geceye kalır. Gövde metni saklanmaz; yalnız aday kimlik belirteçleri ve sha256'sı saklanır.
import { execFile } from 'node:child_process';
import { sha256 } from '../core/canonical-json.mjs';
import { ID_RE } from '../core/ids.mjs';

const runCurl = (args) => new Promise((resolve) => {
  execFile('curl', args, { encoding: 'utf8', maxBuffer: 1 << 28 }, (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
});

function parseResponse(text) {
  let rest = text;
  let headers = null, status = 0;
  for (;;) {
    if (!/^HTTP\/[\d.]+ \d{3}/.test(rest)) break;
    let idx = rest.indexOf('\r\n\r\n'); let sep = 4;
    if (idx < 0) { idx = rest.indexOf('\n\n'); sep = 2; }
    if (idx < 0) { headers = rest; rest = ''; break; }
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + sep);
    const st = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(block)[1]);
    if ((st === 200 && /connection established/i.test(block.split('\n')[0])) || st === 100) continue;
    status = st; headers = block; break;
  }
  const h = {};
  for (const line of (headers || '').split(/\r?\n/).slice(1)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return { status, headers: h, body: rest };
}

// Body tokens: candidate id strings (upper-cased) independent of the current id set, so cached PRs stay valid when the id set grows.
export function bodyTokens(text) {
  const s = String(text ?? '');
  const set = new Set();
  for (const m of s.matchAll(ID_RE)) set.add(m[1].toUpperCase());
  for (const m of s.toUpperCase().matchAll(/(?<![A-Z0-9-])BL-REQ-[A-Z0-9-]+/g)) set.add(m[0].replace(/-+$/, ''));
  return [...set].sort();
}

export function createGithub({ api, rateReserve = 500, concurrency = 8, fetcher = null, etags = {} }) {
  const state = { calls: 0, notModified: 0, rateRemaining: null, rateReset: null, partial: false, errors: [], etags: { ...etags } };
  let active = 0; const waiters = [];
  const acquire = () => new Promise((r) => { if (active < concurrency) { active++; r(); } else waiters.push(r); });
  const release = () => { active--; const w = waiters.shift(); if (w) { active++; w(); } };

  async function getJson(path, { useEtag = true } = {}) {
    if (state.rateRemaining !== null && state.rateRemaining < rateReserve) { state.partial = true; return { status: 0, error: 'RATE_RESERVE', json: null }; }
    const url = path.startsWith('http') ? path : api + path;
    await acquire();
    try {
      state.calls++;
      if (fetcher) { // injected (tests): must return {status, etag, json, rateRemaining}
        try { const r = await fetcher(url, useEtag ? state.etags[url] : null); if (r.etag) state.etags[url] = r.etag; if (typeof r.rateRemaining === 'number') state.rateRemaining = r.rateRemaining; if (r.status === 304) state.notModified++; return r; }
        catch (e) { state.errors.push(String(e.message || e)); return { status: 0, error: String(e.message || e), json: null }; }
      }
      const args = ['-sS', '-i', '--compressed', '--max-time', '60', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
      if (useEtag && state.etags[url]) args.push('-H', `If-None-Match: ${state.etags[url]}`);
      args.push(url);
      const r = await runCurl(args);
      if (r.err && !r.stdout) { state.errors.push(`${url}: ${String(r.stderr || r.err.message).trim().slice(0, 200)}`); return { status: 0, error: 'NETWORK', json: null }; }
      const p = parseResponse(r.stdout);
      if (p.headers['x-ratelimit-remaining'] !== undefined) state.rateRemaining = Number(p.headers['x-ratelimit-remaining']);
      if (p.headers['x-ratelimit-reset'] !== undefined) state.rateReset = Number(p.headers['x-ratelimit-reset']);
      if (p.status === 304) { state.notModified++; return { status: 304, json: null, etag: state.etags[url] }; }
      if (p.status !== 200) { state.errors.push(`${url}: HTTP ${p.status}`); return { status: p.status, error: `HTTP_${p.status}`, json: null }; }
      let json = null; try { json = JSON.parse(p.body); } catch { state.errors.push(`${url}: BAD_JSON`); return { status: 0, error: 'BAD_JSON', json: null }; }
      if (p.headers.etag) state.etags[url] = p.headers.etag;
      return { status: 200, json, etag: p.headers.etag || null };
    } finally { release(); }
  }

  const compactPull = (p) => ({
    number: p.number, state: p.state, draft: !!p.draft, title: String(p.title || ''), headRef: p.head?.ref ?? null, headSha: p.head?.sha ?? null,
    base: p.base?.ref ?? null, createdAt: p.created_at, updatedAt: p.updated_at, closedAt: p.closed_at ?? null, mergedAt: p.merged_at ?? null,
    mergeCommitSha: p.merge_commit_sha ?? null, autoMerge: !!p.auto_merge, user: p.user?.login ?? null, url: p.html_url,
    bodyTokens: bodyTokens(p.body), bodySha: sha256(String(p.body ?? '')),
  });

  // Pulls sorted by updated desc; stop once a page's oldest entry is at/below the cursor. Page-1 304 = unchanged.
  async function fetchPullsIncremental(table, cursor) {
    const out = new Map((table || []).map((p) => [p.number, p]));
    let complete = true, pages = 0;
    for (let page = 1; page <= 50; page++) {
      const r = await getJson(`/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, { useEtag: page === 1 && !!cursor });
      pages++;
      if (r.status === 304) break;
      if (r.status !== 200 || !Array.isArray(r.json)) { complete = false; break; }
      for (const p of r.json) { const prev = out.get(p.number); const c = compactPull(p); if (prev && prev.mergedBy !== undefined) c.mergedBy = prev.mergedBy; out.set(p.number, c); }
      if (r.json.length < 100) break;
      const oldest = r.json[r.json.length - 1].updated_at;
      if (cursor && oldest <= cursor) break;
    }
    const pulls = [...out.values()].sort((a, b) => a.number - b.number);
    const newCursor = pulls.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), cursor || '');
    return { pulls, cursor: complete ? newCursor : cursor, complete, pages };
  }

  const compactRun = (r) => ({
    id: r.id, name: r.name, event: r.event, status: r.status, conclusion: r.conclusion ?? null, runAttempt: r.run_attempt ?? 1,
    headSha: r.head_sha, headBranch: r.head_branch ?? null, createdAt: r.created_at, updatedAt: r.updated_at, runStartedAt: r.run_started_at ?? null,
    prs: (r.pull_requests || []).map((x) => x.number).sort((a, b) => a - b),
  });
  // Runs newest-first, unfiltered (the filtered listing caps at 1000 results); stop below the cutoff.
  async function fetchRunsIncremental(table, cutoffIso) {
    const out = new Map((table || []).map((r) => [r.id, r]));
    let complete = true, pages = 0;
    for (let page = 1; page <= 100; page++) {
      const r = await getJson(`/actions/runs?per_page=100&page=${page}`, { useEtag: false });
      pages++;
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.workflow_runs)) { complete = false; break; }
      const runs = r.json.workflow_runs;
      for (const x of runs) out.set(x.id, compactRun(x));
      if (runs.length < 100) break;
      if (cutoffIso && runs[runs.length - 1].created_at < cutoffIso) break;
    }
    return { runs: [...out.values()].sort((a, b) => a.id - b.id), complete, pages };
  }
  async function fetchChecks(sha) {
    const r = await getJson(`/commits/${sha}/check-runs?per_page=100`, { useEtag: false });
    if (r.status !== 200 || !r.json) return null;
    return (r.json.check_runs || []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null, startedAt: c.started_at ?? null, completedAt: c.completed_at ?? null }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.startedAt || '') < (b.startedAt || '') ? -1 : 1));
  }
  async function fetchRunTiming(id) {
    const r = await getJson(`/actions/runs/${id}/timing`, { useEtag: false });
    return r.status === 200 && r.json && typeof r.json.run_duration_ms === 'number' ? { runDurationMs: r.json.run_duration_ms } : null;
  }
  async function fetchJobs(id) {
    const r = await getJson(`/actions/runs/${id}/jobs?per_page=100`, { useEtag: false });
    if (r.status !== 200 || !r.json) return null;
    return (r.json.jobs || []).map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion ?? null, startedAt: j.started_at ?? null, completedAt: j.completed_at ?? null }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  async function fetchPrFiles(n) {
    const r = await getJson(`/pulls/${n}/files?per_page=100`, { useEtag: false });
    return r.status === 200 && Array.isArray(r.json) ? r.json.map((f) => f.filename).sort() : null;
  }
  async function fetchMergedBy(n) {
    const r = await getJson(`/pulls/${n}`, { useEtag: false });
    return r.status === 200 && r.json ? (r.json.merged_by?.login ?? null) : undefined;
  }
  return { state, getJson, fetchPullsIncremental, fetchRunsIncremental, fetchChecks, fetchRunTiming, fetchJobs, fetchPrFiles, fetchMergedBy };
}

export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
