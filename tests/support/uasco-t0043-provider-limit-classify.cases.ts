// //TR: UASCO-T0043 sağlayıcı kota/hız sınırı sınıflandırma testleri: tablo güdümlü, çapalı kurallar (her kural kimliği kendi pozitif satırıyla sabitlenir), yanlış pozitif korumaları (başarılı çıkış, çıktının ortasındaki keyfi içerik, genel "quota/rate" metni, ilgisiz JSON) ve runner uçtan uca (529 overloaded -> BLOCKED; içerikteki "API Error: 429" -> normal başarısızlık). Gerçek sağlayıcı çağrısı yok.
import {describe, expect, it, beforeEach, afterEach} from "vitest";
import {FakeExecutors} from "../../core/workos/executors.js";
import {PROVIDER_TAIL_LINES, PROVIDER_TEXT_RULES, classifyProviderLimit, executorLimit} from "../../core/workos/runner.js";
import {T, drive, okScript, rmTmp, runner, setup, startRun, tmpRoot} from "./relfx.js";

/** Registered from tests/v7-relfx-c2-remediation.test.ts (listed in config/validation.json); the suite's hooks are scoped to this describe. */
export function registerUascoT0043ProviderLimitSuite(): void {
  describe("UASCO-T0043 provider limit classification", () => {

    const procLog = (stdout: string, stderr: string, exit = 1) => `$ claude -p\n[exit=${exit} timedOut=false aborted=false]\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`;
    const filler = (n: number) => Array.from({length: n}, (_, i) => `progress line ${i + 1}`).join("\n");

    describe("UASCO-T0043 table-driven provider limit classification", () => {
      const POSITIVE: Array<[string, string, string, string]> = [
        // [rule id, log, expected limit, description]
        ["MARKER", "noise\nUASCO_PROVIDER_LIMIT: RATE_LIMIT", "RATE_LIMIT", "structured marker"],
        ["CLI_USAGE_LIMIT", "Claude AI usage limit reached|1760540400", "QUOTA_EXHAUSTED", "Claude CLI usage limit"],
        ["CLI_HIT_RATE_LIMIT", "You've hit your rate limit", "RATE_LIMIT", "CLI hit rate limit"],
        ["CLI_HIT_LIMIT", "You've hit your weekly limit · resets Mon 9am", "QUOTA_EXHAUSTED", "CLI hit weekly limit"],
        ["API_429", "API Error: 429 Too Many Requests", "RATE_LIMIT", "HTTP 429"],
        ["API_529_OVERLOADED", `API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, "RATE_LIMIT", "HTTP 529 overloaded"],
        ["API_CREDIT_LOW", `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`, "QUOTA_EXHAUSTED", "credit balance"],
        ["API_RATE_TEXT", `API Error: 503 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, "RATE_LIMIT", "typed overloaded under another status"],
        ["JSON_ERROR_RATE_LIMIT_ERROR", `{"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}`, "RATE_LIMIT", "bare provider error JSON"],
        ["JSON_ERROR_OVERLOADED_ERROR", `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, "RATE_LIMIT", "bare overloaded JSON"],
        ["JSON_ERROR_CREDIT_LOW", `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`, "QUOTA_EXHAUSTED", "bare credit JSON"],
        ["RESULT_CLI_USAGE_LIMIT", `{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1760540400"}`, "QUOTA_EXHAUSTED", "CLI result envelope"],
      ];

      it("every rule id is pinned by its own positive row (exit != 0, terminal line)", () => {
        for (const [rule, log, limit, what] of POSITIVE) expect(classifyProviderLimit(1, log), what).toEqual({limit, rule});
        const pinned = new Set(POSITIVE.map(p => p[0]));
        for (const r of PROVIDER_TEXT_RULES) expect(pinned.has(r.id), r.id).toBe(true);
      });

      it("false-positive guards: generic quota/rate text, unrelated JSON, non-anchored lines and successful exits are NOT provider limits", () => {
        const NEGATIVE: Array<[number | null, string, string]> = [
          [0, "API Error: 429 Too Many Requests", "exit 0 is never a provider limit"],
          [0, "UASCO_PROVIDER_LIMIT: QUOTA_EXHAUSTED", "exit 0 marker"],
          [1, `API Error: 500 {"type":"error","error":{"type":"api_error","message":"quota service unavailable"}}`, "500 mentioning quota (broad-classifier false positive)"],
          [1, `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens exceeds the rate limit for this model"}}`, "400 mentioning rate limit"],
          [1, `{"type":"error","error":{"type":"not_found_error","message":"rate limit docs not found"}}`, "unrelated provider error type"],
          [1, `{"rate_limit_error": true, "type": "fixture"}`, "user JSON containing the word"],
          [1, `{"type":"result","is_error":false,"result":"Claude AI usage limit reached|1760540400"}`, "result envelope that is not an error"],
          [1, "Note: you've hit your limit of retries in the test fixture", "not anchored at line start"],
          [1, "TypeError: rateLimiter is not a function", "code identifier"],
          [1, "Error: quota exceeded for widget store", "app quota"],
          [1, "API Error: 500 Internal server error", "plain 500"],
          [1, `{"type":"error","error":{"type":"invalid_request_error","message":"project quota exceeded; check the credit card on file"}}`, "invalid_request mentioning quota/credit (only the exact credit-balance message counts)"],
        ];
        for (const [exit, log, what] of NEGATIVE) expect(classifyProviderLimit(exit, log), what).toBeNull();
      });

      it("tail guard: only each channel's last lines count; the same line mid-output is content (killing) and at the tail is a limit (positive control)", () => {
        expect(PROVIDER_TAIL_LINES).toBe(3);
        const mid = procLog(`writing fixture...\nAPI Error: 429 Too Many Requests\n${filler(PROVIDER_TAIL_LINES)}`, "Error: 2 tests failed");
        expect(classifyProviderLimit(1, mid)).toBeNull();
        expect(executorLimit(1, mid)).toBeNull();
        const tailOut = procLog(`${filler(10)}\nAPI Error: 429 Too Many Requests`, "");
        expect(classifyProviderLimit(1, tailOut)).toEqual({limit: "RATE_LIMIT", rule: "API_429"});
        const tailErr = procLog(filler(10), `${filler(5)}\nClaude AI usage limit reached|1760540400`);
        expect(classifyProviderLimit(1, tailErr)).toEqual({limit: "QUOTA_EXHAUSTED", rule: "CLI_USAGE_LIMIT"});
        // a marker buried mid-output is content too
        expect(classifyProviderLimit(1, procLog(`UASCO_PROVIDER_LIMIT: QUOTA_EXHAUSTED\n${filler(PROVIDER_TAIL_LINES)}`, "boom"))).toBeNull();
        expect(classifyProviderLimit(1, procLog(filler(4), "UASCO_PROVIDER_LIMIT: QUOTA_EXHAUSTED"))).toEqual({limit: "QUOTA_EXHAUSTED", rule: "MARKER"});
        // the most recent tail line wins; disk-full lines are never provider limits
        expect(classifyProviderLimit(1, "API Error: 429 Too Many Requests\nClaude AI usage limit reached|1760540400")).toEqual({limit: "QUOTA_EXHAUSTED", rule: "CLI_USAGE_LIMIT"});
        expect(executorLimit(1, "API Error: 400 ENOSPC: no space left on device")).toBe("DISK_FULL");
        expect(classifyProviderLimit(1, "API Error: 429 ENOSPC: no space left on device")).toBeNull();   // a disk-full line is never a provider limit
        expect(executorLimit(1, "API Error: 429 ENOSPC: no space left on device")).toBe("DISK_FULL");
      });
    });

    describe("UASCO-T0043 runner end to end (FakeExecutors; no real provider)", () => {
      let tmp = "";
      beforeEach(() => { tmp = tmpRoot("uasco-t0043-"); });
      afterEach(() => rmTmp(tmp));

      it("reviewer 529 overloaded -> BLOCKED(PROVIDER_QUOTA), retry budget untouched, checkpoint limit RATE_LIMIT", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        const fake = new FakeExecutors(okScript({review: () => ({exitCode: 1, raw: `API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`})}));
        const created = startRun(c, fake);
        const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
        expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PROVIDER_QUOTA", retryCount: 0}));
        expect(run.checkpoints.at(-1)?.data).toEqual(expect.objectContaining({outcome: "BLOCKED_RESUMABLE", limit: "RATE_LIMIT", step: "REVIEW"}));
        expect(fake.calls.review).toBe(1);
      });

      it("implementer failure whose OUTPUT merely contains 'API Error: 429' mid-stream is a normal failure, not a provider block (positive control: same line last -> BLOCKED)", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        const content = new FakeExecutors(okScript({implement: () => ({exitCode: 1, stderr: `API Error: 429 Too Many Requests\n${filler(PROVIDER_TAIL_LINES)}\nError: build failed`})}));
        const r1 = await drive(c, runner(c, content, {maxRetries: 2}), startRun(c, content).runId);
        expect(r1.reason).not.toBe("PROVIDER_QUOTA");
        expect(r1.status).toBe("FAILED");
        expect(r1.reason).toBe("IMPLEMENT_FAILED");

        const c2 = setup(tmp, "tA");
        const real = new FakeExecutors(okScript({implement: () => ({exitCode: 1, stderr: `${filler(PROVIDER_TAIL_LINES)}\nAPI Error: 429 Too Many Requests`})}));
        const r2 = await drive(c2, runner(c2, real, {maxRetries: 2}), startRun(c2, real).runId);
        expect(r2).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PROVIDER_QUOTA", retryCount: 0}));
      });
    });

  });
}
