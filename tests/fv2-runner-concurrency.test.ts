// //TR: FV2 korumalı MissionRunner eşzamanlılığı: server.ts maxConcurrentRuns'ı opts.runner'dan ya da UASCO_WORKOS_MAX_CONCURRENT_RUNS'tan geçirir; ayarsızken davranış değişmez (1), geçersiz değer runner'ı başlatmaz (sessizce 1'e düşmez), etkin değer WORKOS_RUNNER_STARTED denetim kaydında görünür.
import {describe, it, expect, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildServer} from "../apps/control-api/src/server.js";

const TOKEN = "t".repeat(32);
const apps: Array<{close: () => Promise<unknown>}> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); delete process.env.UASCO_WORKOS_MAX_CONCURRENT_RUNS; });

async function start(runner: Record<string, unknown>, env?: string) {
  if (env !== undefined) process.env.UASCO_WORKOS_MAX_CONCURRENT_RUNS = env; else delete process.env.UASCO_WORKOS_MAX_CONCURRENT_RUNS;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-runner-"));
  for (const d of ["runtime", "control"]) fs.mkdirSync(path.join(tmp, d), {recursive: true});
  const {FakeExecutors} = await import("../core/workos/executors.js");
  const fake = new FakeExecutors({implement: () => ({files: {"f.txt": "x\n"}, message: "fake"}), review: () => ({verdict: "CLEAN"})});
  const app = buildServer({controlToken: TOKEN, runtime: path.join(tmp, "runtime"), dataDir: path.join(tmp, "data"), controlRoot: path.join(tmp, "control"), tenantId: "tA", port: 3210, logger: false,
    executors: fake.pair(), runner: {enabled: true, intervalMs: 600_000, ...runner}} as never);
  apps.push(app);
  await app.ready();
  const f = path.join(tmp, "runtime", "control-api-events.jsonl");
  const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  return lines.filter(e => String(e.event ?? e.type ?? "").startsWith("WORKOS_RUNNER"));
}
const startedWith = (ev: Array<Record<string, any>>) => { const e = ev.find(x => (x.event ?? x.type) === "WORKOS_RUNNER_STARTED"); return e ? (e.details ?? e).maxConcurrentRuns : undefined; };

describe("FV2 protected change: MissionRunner concurrency wiring in server.ts", () => {
  it("unset: unchanged behaviour (1)", async () => { expect(startedWith(await start({}))).toBe(1); });
  it("UASCO_WORKOS_MAX_CONCURRENT_RUNS=8 -> 8", async () => { expect(startedWith(await start({}, "8"))).toBe(8); });
  it("opts.runner.maxConcurrentRuns overrides the environment", async () => { expect(startedWith(await start({maxConcurrentRuns: 3}, "8"))).toBe(3); });
  it.each(["0", "17", "2.5", "abc", ""])("invalid %j: runner not started (never a silent fallback to 1)", async v => {
    const ev = await start({}, v);
    expect(startedWith(ev)).toBeUndefined();
    expect(ev.some(e => (e.event ?? e.type) === "WORKOS_RUNNER_NOT_STARTED")).toBe(true);
  });
});
