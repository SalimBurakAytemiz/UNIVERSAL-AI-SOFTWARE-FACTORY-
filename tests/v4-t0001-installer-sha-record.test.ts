// //TR: Bu test V4-T0001 kurulum .exe SHA kaydını doğrular: scripts/release/installer-sha-record.mjs'in sahte (gerçek kurulum olmayan) bir UASCO-Setup-*.exe dosyasının SHA-256 değerini gerçekten hesapladığını (node:crypto ile bağımsız karşılaştırma), commit SHA'sına bağladığını, BUILD-SUMMARY.json ile çapraz kontrol ettiğini, sıfır/çoklu .exe, geçersiz commit ve uyuşmazlıkta fail-closed reddettiğini ve verify adımının tek bayt değişikliğini yakaladığını gösterir. Gerçek bir Windows kurulum paketinin doğrulandığını iddia etmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "release", "installer-sha-record.mjs");
const load = async (): Promise<any> => import(pathToFileURL(script).href);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const EXE = "UASCO-Setup-1.2.3-win-x64.exe";
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

let dir: string;
let payload: Buffer;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "v4-t0001-"));
  payload = crypto.randomBytes(256 * 1024 + 7); // spans several stream chunks
  fs.writeFileSync(path.join(dir, EXE), payload);
});
afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));
const writeSummary = (over: Record<string, unknown> = {}) =>
  fs.writeFileSync(path.join(dir, "BUILD-SUMMARY.json"), JSON.stringify({variant: "release", artifact: `D:\\a\\_temp\\uasco-build\\dist-installer\\${EXE}`, bytes: payload.length, sha256: sha(payload), version: "1.2.3", signed: false, ...over}));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {encoding: "utf8", env: {...process.env, UASCO_HEAD_SHA: ""}});

describe("V4-T0001 installer SHA record", () => {
  it("records name, size and an independently re-computed SHA-256 bound to the commit", async () => {
    const m = await load();
    writeSummary();
    const rec = await m.createRecord(dir, COMMIT.toUpperCase(), {now: () => new Date("2026-11-23T00:00:00Z")});
    expect(rec.schema).toBe(m.RECORD_SCHEMA);
    expect(rec.commitSha).toBe(COMMIT);
    expect(rec.installer).toEqual({fileName: EXE, bytes: payload.length, sha256: sha(payload)});
    expect(rec.buildSummary).toMatchObject({present: true, matches: true, version: "1.2.3", signed: false});
    expect(rec.recordedAt).toBe("2026-11-23T00:00:00.000Z");
  });

  it("works without BUILD-SUMMARY.json and accepts the test variant name", async () => {
    const m = await load();
    fs.renameSync(path.join(dir, EXE), path.join(dir, "UASCO-Test-Setup-1.2.3-win-x64.exe"));
    const rec = await m.createRecord(dir, COMMIT);
    expect(rec.buildSummary).toEqual({present: false});
    expect(rec.installer.fileName).toBe("UASCO-Test-Setup-1.2.3-win-x64.exe");
    expect(rec.installer.sha256).toBe(sha(payload));
  });

  it("fails closed on bad commit, zero/multiple installers, empty file and BUILD-SUMMARY mismatch", async () => {
    const m = await load();
    for (const bad of ["", "abc", "g".repeat(40), undefined]) await expect(m.createRecord(dir, bad)).rejects.toMatchObject({code: "INVALID_COMMIT_SHA"});
    writeSummary({sha256: "0".repeat(64)});
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "BUILD_SUMMARY_SHA256_MISMATCH"});
    writeSummary({bytes: 1});
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "BUILD_SUMMARY_BYTES_MISMATCH"});
    writeSummary({artifact: "UASCO-Setup-9.9.9-win-x64.exe"});
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "BUILD_SUMMARY_ARTIFACT_MISMATCH"});
    fs.rmSync(path.join(dir, "BUILD-SUMMARY.json"));
    fs.writeFileSync(path.join(dir, "UASCO-Setup-1.2.4-win-x64.exe"), "x");
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "MULTIPLE_INSTALLERS"});
    fs.rmSync(path.join(dir, "UASCO-Setup-1.2.4-win-x64.exe"));
    fs.writeFileSync(path.join(dir, EXE), "");
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "INSTALLER_EMPTY"});
    fs.rmSync(path.join(dir, EXE));
    fs.writeFileSync(path.join(dir, "other.exe"), "x");
    await expect(m.createRecord(dir, COMMIT)).rejects.toMatchObject({code: "INSTALLER_NOT_FOUND"});
    await expect(m.createRecord(path.join(dir, "nope"), COMMIT)).rejects.toMatchObject({code: "DIST_DIR_MISSING"});
  });

  it("verify passes for the recorded file and catches a one-byte change, rename or commit mismatch", async () => {
    const m = await load();
    const rec = await m.createRecord(dir, COMMIT);
    const exe = path.join(dir, EXE);
    expect((await m.verifyRecord(rec, exe, {commit: COMMIT})).ok).toBe(true);
    const tampered = Buffer.from(payload); tampered[1000] ^= 0xff;
    fs.writeFileSync(exe, tampered);
    const r = await m.verifyRecord(rec, exe);
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((x: any) => x.field)).toEqual(["sha256"]);
    fs.writeFileSync(exe, payload);
    expect((await m.verifyRecord(rec, exe, {commit: "f".repeat(40)})).mismatches.map((x: any) => x.field)).toEqual(["commitSha"]);
    const renamed = path.join(dir, "UASCO-Setup-1.2.4-win-x64.exe");
    fs.renameSync(exe, renamed);
    expect((await m.verifyRecord(rec, renamed)).mismatches.map((x: any) => x.field)).toEqual(["fileName"]);
    await expect(m.verifyRecord({...rec, schema: "x"}, renamed)).rejects.toMatchObject({code: "RECORD_SCHEMA_MISMATCH"});
    await expect(m.verifyRecord({...rec, installer: {...rec.installer, sha256: "zz"}}, renamed)).rejects.toMatchObject({code: "RECORD_INVALID"});
  });

  it("CLI record writes INSTALLER-RECORD.json (no overwrite) and CLI verify exits 0/1", () => {
    const rr = run("record", dir, "--commit", COMMIT);
    expect(rr.status, rr.stderr).toBe(0);
    expect(rr.stdout).toContain(`sha256=${sha(payload)}`);
    const recFile = path.join(dir, "INSTALLER-RECORD.json");
    const rec = JSON.parse(fs.readFileSync(recFile, "utf8"));
    expect(rec.installer.sha256).toBe(sha(payload));
    expect(run("record", dir, "--commit", COMMIT).status).toBe(1); // refuses to overwrite
    expect(run("verify", recFile, path.join(dir, EXE), "--commit", COMMIT).status).toBe(0);
    fs.appendFileSync(path.join(dir, EXE), "x");
    const bad = run("verify", recFile, path.join(dir, EXE));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("INSTALLER_SHA_VERIFY: FAIL");
    expect(run("record", dir).status).toBe(1); // no commit -> INVALID_COMMIT_SHA
    expect(run("bogus").status).toBe(2);
  });
});
