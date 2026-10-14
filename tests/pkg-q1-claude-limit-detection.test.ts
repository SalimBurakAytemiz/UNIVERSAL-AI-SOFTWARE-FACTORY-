// //TR: Bu test, Claude CLI'nin stdout'a yazdığı limit mesajlarının (oturum, haftalık, epoch biçimi) sağlayıcı beklemesi olarak algılandığını, mevcut stderr biçimlerinin korunduğunu ve başarılı bir çağrının veya ilgisiz bir hatanın asla kota sayılmadığını doğrular (PKG-Q1).
import {describe,it,expect} from "vitest";

// //TR: Modül tip bildirimi olmayan korumalı bir .mjs olduğundan URL ile dinamik yüklenir ve kullanılan iki fonksiyonun tipi burada bildirilir.
type QuotaBlock={quota:boolean;lines:string[]};
type ReviewPipeline={detectQuotaBlock:(run:{exitCode:number;stdout:string;stderr:string})=>QuotaBlock;parseRetryAfter:(text:string,now?:Date)=>string|null};
const {detectQuotaBlock,parseRetryAfter}=(await import(new URL("../automation/lib/review-pipeline.mjs",import.meta.url).href)) as ReviewPipeline;

const session="You've hit your session limit · resets 1:10am (Europe/Istanbul)";

describe("Claude limit detection (PKG-Q1)",()=>{
  it("treats the Claude CLI session-limit message on stdout with a non-zero exit as a provider wait and keeps its reset time",()=>{
    const q=detectQuotaBlock({exitCode:1,stdout:`${session}\n`,stderr:""});
    expect(q.quota).toBe(true);
    expect(q.lines).toEqual([session]);
    const now=new Date(2026,9,5,22,0,0,0);
    expect(parseRetryAfter(q.lines.join(" "),now)).toBe(new Date(2026,9,6,1,10,0,0).toISOString());
  });
  it("recognises the same message on both streams, the weekly limit, a typographic apostrophe and the epoch form",()=>{
    expect(detectQuotaBlock({exitCode:1,stdout:`${session}\n`,stderr:`${session}\n`})).toEqual({quota:true,lines:[session]});
    expect(detectQuotaBlock({exitCode:1,stdout:"You've hit your weekly limit · resets Oct 9, 3pm\n",stderr:""}).quota).toBe(true);
    expect(detectQuotaBlock({exitCode:1,stdout:"You’ve hit your session limit · resets 4am\n",stderr:""}).quota).toBe(true);
    const epoch=detectQuotaBlock({exitCode:1,stdout:"Claude AI usage limit reached|1760000000\n",stderr:""});
    expect(epoch.quota).toBe(true);
    expect(parseRetryAfter(epoch.lines.join(" "))).toBe(new Date(1760000000*1000).toISOString());
  });
  it("treats a stdout made only of a limit line as a provider wait even when the exit code is zero",()=>{
    expect(detectQuotaBlock({exitCode:0,stdout:`${session}\n`,stderr:""}).quota).toBe(true);
  });
  it("keeps the existing stderr forms",()=>{
    expect(detectQuotaBlock({exitCode:1,stdout:"",stderr:"ERROR: You've hit your usage limit."}).quota).toBe(true);
    expect(detectQuotaBlock({exitCode:1,stdout:"",stderr:"5-hour limit reached ∙ resets 3pm"}).quota).toBe(true);
    expect(detectQuotaBlock({exitCode:1,stdout:"",stderr:"stream error: rate limit exceeded"}).quota).toBe(true);
    expect(detectQuotaBlock({exitCode:1,stdout:"",stderr:"You've hit your session limit"}).quota).toBe(true);
  });
  it("never treats a successful call, an unrelated failure or prose about limits on stdout as a provider wait",()=>{
    const review=JSON.stringify({result:"BLOCKED",findings:[{observed:"You've hit your session limit is printed by the CLI when the rate limit is reached"}]},null,2);
    expect(detectQuotaBlock({exitCode:0,stdout:review,stderr:""}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:0,stdout:review,stderr:"warning: approaching the rate limit; usage limit reached soon"}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:1,stdout:review,stderr:""}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:1,stdout:"Error: patch failed; the rate limit of the proxy was not involved\n",stderr:""}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:128,stdout:"",stderr:"fatal: not a git repository (or any of the parent directories): .git"}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:0,stdout:"done\n",stderr:""}).quota).toBe(false);
    expect(detectQuotaBlock({exitCode:1,stdout:`${session} ${"x".repeat(320)}`,stderr:""}).quota).toBe(false);
  });
});
