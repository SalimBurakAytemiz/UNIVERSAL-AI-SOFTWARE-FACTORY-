// //TR: Bu vaka dosyası (kayıtlı tests/v7-core-predev-driver.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0117 istem sürümleme bekçisidir:
// (1) prompts/ altındaki HER istem dosyası ve ürünün kod içi istemleri manifestte sürüm + sha256 ile kayıtlıdır; (2) bir istemin içeriği değişip sürümü artırılmazsa test düşer
// ve önerilen yeni manifesti yazdırır; (3) sürüm geçmişi yalnız eklenerek büyür (kesin artan sürüm, ardışık aynı özet yok); (4) GERÇEK pre-dev sürücüsü ve Control API audit'i,
// gönderilen rol isteminin sürümünü + şablon özetini + gönderilen gerçek metnin özetini kaydeder. prompts/ yalnız okunur.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {checkManifest, proposeManifest, promptDigest, promptRef, latestVersion, type PromptManifest} from "../../core/prompt-registry/versioning.js";
import {PROMPT_MANIFEST} from "../../core/prompt-registry/prompt-manifest.js";
import {currentPromptDigests, FILE_PROMPTS, codePrompts, rolePromptId} from "../../core/prompt-registry/sources.js";
import {composeRolePrompt, ROLE_PROMPTS} from "../../core/workos/predev/role-prompts.js";

const ROOT = path.resolve(__dirname, "..", "..");
const H = (c: string) => c.repeat(64);
// Doğrulayıcılardan geçen kayıtlı BusinessAnalysis yanıtı (tests/v7-core-predev-driver.test.ts ile aynı biçim).
const BA = {
  problem: "Ekipler işi tek yerde görünür kılamıyor.", stakeholders: ["Ekip üyeleri"],
  goals: [{id: "G1", statement: "Kullanıcılar güvenli şekilde oturum açabilsin"}],
  constraints: ["Web tabanlı"], successMetrics: ["ASSUMPTION: metrik bağlanmadı"], assumptions: ["iç ekip aracı"], risks: ["yetki sızıntısı"]
};

export function registerPromptVersioningT0117Cases(): void {
  describe("UASCO-T0117: routine prompt versioning (manifest id -> version -> sha256)", () => {
    it("every prompt (all prompts/ files + product code prompts) is in the manifest and its content matches the latest version; a change without a version bump fails", () => {
      const current = currentPromptDigests(ROOT);
      const issues = checkManifest(PROMPT_MANIFEST, current);
      // Düşerse: istemi değiştirdiyseniz core/prompt-registry/prompt-manifest.ts içine aşağıdaki önerilen sürümü EKLEYİN (geçmişi yeniden yazmayın).
      expect(issues, `${issues.join("\n")}\nPROPOSED MANIFEST:\n${JSON.stringify(proposeManifest(PROMPT_MANIFEST, current), null, 2)}`).toEqual([]);
      expect(Object.keys(current).length).toBe(Object.keys(FILE_PROMPTS).length + Object.keys(codePrompts()).length);
    });

    it("the inventory covers every file under prompts/ (a new governed prompt file must be versioned) and every pre-dev role", () => {
      const onDisk = fs.readdirSync(path.join(ROOT, "prompts")).filter(f => fs.statSync(path.join(ROOT, "prompts", f)).isFile()).map(f => `prompts/${f}`).sort();
      expect(Object.keys(FILE_PROMPTS).sort()).toEqual(onDisk);
      for (const kind of Object.keys(ROLE_PROMPTS)) expect(latestVersion(PROMPT_MANIFEST, rolePromptId(kind as never)), kind).not.toBeNull();
      for (const id of ["factory.claude-reviewer-system", "factory.auto-review", "workos.executor.review", "workos.executor.implement", "cloud.planner"]) expect(latestVersion(PROMPT_MANIFEST, id), id).not.toBeNull();
    });

    it("checkManifest is fail-closed: content change, rewritten history, repeated digest, non-increasing version, unknown/missing ids and source drift are all reported", () => {
      const cur = {"a.x": {source: "s", sha256: H("b")}};
      const m = (versions: Array<{version: number; sha256: string}>, source = "s"): PromptManifest => ({schemaVersion: 1, prompts: {"a.x": {source, versions}}});
      expect(checkManifest(m([{version: 1, sha256: H("b")}]), cur)).toEqual([]);
      expect(checkManifest(m([{version: 1, sha256: H("a")}]), cur)[0]).toMatch(/^PROMPT_CHANGED_WITHOUT_VERSION_BUMP a\.x/);
      expect(checkManifest(m([{version: 1, sha256: H("a")}, {version: 2, sha256: H("b")}]), cur)).toEqual([]);
      expect(checkManifest(m([{version: 2, sha256: H("a")}, {version: 2, sha256: H("b")}]), cur)).toContain("PROMPT_VERSION_INVALID a.x@2");
      expect(checkManifest(m([{version: 0, sha256: H("b")}]), cur)).toContain("PROMPT_VERSION_INVALID a.x@0");
      expect(checkManifest(m([{version: 1, sha256: H("b")}, {version: 2, sha256: H("b")}]), cur)).toContain("PROMPT_DIGEST_REPEATED a.x@2");
      expect(checkManifest(m([{version: 1, sha256: "zz"}]), cur)).toContain("PROMPT_SHA256_INVALID a.x@1");
      expect(checkManifest(m([]), cur)).toContain("PROMPT_VERSIONS_EMPTY a.x");
      expect(checkManifest(m([{version: 1, sha256: H("b")}], "other"), cur)).toContain("PROMPT_SOURCE_INVALID a.x");
      expect(checkManifest(m([{version: 1, sha256: H("b")}]), {...cur, "a.y": {source: "s", sha256: H("c")}})).toContain("PROMPT_NOT_IN_MANIFEST a.y");
      expect(checkManifest(m([{version: 1, sha256: H("b")}]), {})).toContain("PROMPT_NOT_PRODUCED a.x");
      expect(checkManifest({schemaVersion: 2} as never, cur)).toEqual(["PROMPT_MANIFEST_INVALID"]);
      // öneri: değişen istem için yalnız yeni sürüm eklenir, geçmiş korunur
      const next = proposeManifest(m([{version: 1, sha256: H("a")}]), cur);
      expect(next.prompts["a.x"].versions).toEqual([{version: 1, sha256: H("a")}, {version: 2, sha256: H("b")}]);
      expect(checkManifest(next, cur)).toEqual([]);
    });

    it("digests are line-ending independent and the real manifest bumps when a real prompt file changes (simulated on a copy, prompts/ is only read)", () => {
      expect(promptDigest("a\r\nb\rc")).toBe(promptDigest("a\nb\nc"));
      const text = fs.readFileSync(path.join(ROOT, "prompts", "CLAUDE-REVIEWER-SYSTEM.md"), "utf8");
      const cur = currentPromptDigests(ROOT);
      const edited = {...cur, "factory.claude-reviewer-system": {...cur["factory.claude-reviewer-system"], sha256: promptDigest(`${text}\nextra rule`)}};
      expect(checkManifest(PROMPT_MANIFEST, edited).some(i => i.startsWith("PROMPT_CHANGED_WITHOUT_VERSION_BUMP factory.claude-reviewer-system"))).toBe(true);
      expect(() => promptRef(PROMPT_MANIFEST, "nope.unknown")).toThrow("PROMPT_NOT_VERSIONED:nope.unknown");
    });

    it("the real pre-dev driver records the prompt version it used: id, manifest version, template digest and the digest of the exact text sent to the builder (REJECTED and RECORDED)", async () => {
      const {PreDevDriver} = await import("../../core/workos/predev/driver.js");
      const {WorkOsStore} = await import("../../core/workos/store.js");
      const {TASKHUB_BRIEF} = await import("../../core/workos/predev/fixtures/taskhub-brief.js");
      const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0117-"));
      try {
        const store = new WorkOsStore(tmp), S = {tenantId: "t-t0117"};
        const p = store.createProject({tenantId: S.tenantId, orgId: "org1", name: "proj", environmentId: "env-dev", createdBy: "impl@local.invalid"});
        const mid = store.createMission({tenantId: S.tenantId, projectId: p.projectId, title: "Mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: "impl@local.invalid"}).missionId;
        store.transitionMission(S, mid, "PREFLIGHT", "preflight", "impl@local.invalid");
        store.transitionMission(S, mid, "AUTHORIZED", "authorized", "impl@local.invalid");
        const sent: string[] = [], answers = ["not json", JSON.stringify(BA)];
        const drv = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: {produce: async (_k: unknown, prompt: string) => { sent.push(prompt); return answers.shift()!; }}});
        drv.start(S, mid, "impl@local.invalid");
        const v = latestVersion(PROMPT_MANIFEST, "predev.role.BusinessAnalysis")!;
        const rej = await drv.produceCurrentPhase(S, mid, "impl@local.invalid");
        expect(rej.status).toBe("REJECTED");
        expect(rej.prompt).toEqual({id: "predev.role.BusinessAnalysis", version: v.version, templateSha256: v.sha256, renderedSha256: promptDigest(sent[0])});
        const rec = await drv.produceCurrentPhase(S, mid, "impl@local.invalid");
        expect(rec.status).toBe("RECORDED");
        expect(rec.prompt).toEqual({id: "predev.role.BusinessAnalysis", version: v.version, templateSha256: v.sha256, renderedSha256: promptDigest(sent[1])});
        // gönderilen metin manifestteki şablonun gerçek birleştirmesidir (kanonik olmayan bağlamla üretildiği için özeti şablon özetinden farklıdır)
        expect(sent[1]).toBe(composeRolePrompt("BusinessAnalysis", {brief: TASKHUB_BRIEF, approvedUpstream: {}}));
        expect(rec.prompt.renderedSha256).not.toBe(v.sha256);
      } finally { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } }
    });
  });
}
