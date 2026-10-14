// //TR: Bu test, sağlayıcı mesajındaki tarihsiz saat en çok 10 dakika geçmişse (sınır dahil) yeniden denemenin şimdi+2 dakika olduğunu, daha eski saatlerin yarına, gelecekteki saatlerin bugüne kaldığını, açık tarihin değişmediğini ve tanınmayan metnin null döndüğünü sabit bir "şimdi" ile doğrular (PKG-Q2; 12:52:06'da "try again at 12:52 PM" 24 saatlik sahte bekleme olayı).
import {describe,it,expect} from "vitest";

// //TR: Modül tip bildirimi olmayan korumalı bir .mjs olduğundan URL ile dinamik yüklenir ve kullanılan fonksiyonun tipi burada bildirilir.
type ReviewPipeline={parseRetryAfter:(text:string,now?:Date)=>string|null};
const {parseRetryAfter}=(await import(new URL("../automation/lib/review-pipeline.mjs",import.meta.url).href)) as ReviewPipeline;

// //TR: Tüm zamanlar yerel saatle kurulur (parseRetryAfter tarihsiz saati yerel saat olarak okur); 2026-10-06/07 arasında DST geçişi yoktur.
const local=(day:number,h:number,min:number,s=0)=>new Date(2026,9,day,h,min,s,0);
const iso=(d:Date)=>d.toISOString();
const plusMinutes=(d:Date,n:number)=>new Date(d.getTime()+n*60_000).toISOString();
const codex=(t:string)=>`ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at ${t}.`;

describe("provider retry time grace for a stated time just passed (PKG-Q2)",()=>{
  it("treats the observed incident ('try again at 12:52 PM' read at 12:52:06) as a retry 2 minutes from now, not tomorrow",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter(codex("12:52 PM"),now)).toBe(plusMinutes(now,2));
    expect(parseRetryAfter(codex("12:52 PM"),now)).not.toBe(iso(local(7,12,52)));
  });
  it("treats a stated time equal to now or 3 minutes past as a retry 2 minutes from now",()=>{
    const exact=local(6,12,52,0);
    expect(parseRetryAfter("try again at 12:52 PM.",exact)).toBe(plusMinutes(exact,2));
    const now=local(6,12,52,0);
    expect(parseRetryAfter("try again at 12:49 PM.",now)).toBe(plusMinutes(now,2));
  });
  it("includes the boundary: exactly 10 minutes past is still a retry 2 minutes from now",()=>{
    const now=local(6,12,52,0);
    expect(parseRetryAfter("try again at 12:42 PM.",now)).toBe(plusMinutes(now,2));
  });
  it("rolls a time 10 minutes and 1 second past to the same time on the next day",()=>{
    const now=local(6,12,52,1);
    expect(parseRetryAfter("try again at 12:42 PM.",now)).toBe(iso(local(7,12,42)));
  });
  it("rolls a time 1 hour past to the same time on the next day",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter(codex("11:52 AM"),now)).toBe(iso(local(7,11,52)));
  });
  it("keeps a future time today",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter(codex("7:02 PM"),now)).toBe(iso(local(6,19,2)));
    expect(parseRetryAfter("try again at 12:53 PM.",now)).toBe(iso(local(6,12,53)));
  });
  it("returns an explicit date unchanged, also when it is a few seconds or weeks in the past",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter("try again at Sep 29th, 2026 7:02 PM",now)).toBe(iso(new Date(2026,8,29,19,2,0,0)));
    expect(parseRetryAfter("try again at Oct 6th, 2026 12:52 PM",now)).toBe(iso(local(6,12,52)));
  });
  it("applies the same rule to the date-less Claude CLI 'resets' time",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter("You've hit your session limit · resets 12:52pm (Europe/Istanbul)",now)).toBe(plusMinutes(now,2));
    const later=local(6,12,10,1);
    expect(parseRetryAfter("5-hour limit reached ∙ resets 12pm",later)).toBe(iso(local(7,12,0)));
    expect(parseRetryAfter("5-hour limit reached ∙ resets 3pm",later)).toBe(iso(local(6,15,0)));
  });
  it("returns null for text without a recognised time",()=>{
    const now=local(6,12,52,6);
    expect(parseRetryAfter("no time here",now)).toBeNull();
    expect(parseRetryAfter("try again later",now)).toBeNull();
    expect(parseRetryAfter("try again at 12:52",now)).toBeNull();
    expect(parseRetryAfter("try again at Foo 29th, 2026 7:02 PM",now)).toBeNull();
  });
});
