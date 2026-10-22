// //TR: Bu test registry'de bilinmeyen teknoloji geldiğinde sistemin "biliyorum" varsaymak yerine DETECTED gap üretmesini doğrular.
import {describe,it,expect} from "vitest";
import {requireKnownOrGap} from "../core/knowledge/technology-discovery.js";
describe("technology discovery",()=>{
  it("returns known technology",()=>{
    const x=requireKnownOrGap("React",[{id:"TECH-REACT",name:"React",aliases:[]}],"M1","package.json");
    expect("id" in x && x.id).toBe("TECH-REACT");
  });
  it("creates gap for unknown technology",()=>{
    const x=requireKnownOrGap("FutureFrameworkX",[],"M1","package.json");
    expect("state" in x && x.state).toBe("DETECTED");
  });
});

// //TR: SC-14 Proje Belleği çekirdeği: append/okuma, zincir doğrulama (tamper/sıra/yırtık kuyruk yalnız raporlanır), secret/yol/sınır reddi, supersession, provenance, deterministik saat ve aynı dosyada iki örnek.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach} from "vitest";
import {ProjectMemory} from "../core/knowledge/project-memory.js";
import {MEMORY_LIMITS, ProjectMemoryError} from "../core/knowledge/project-memory-types.js";
describe("SC-14 Project Memory core",()=>{
  const PID="prj_"+"a1".repeat(12);
  const dirs:string[]=[];
  afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true})});
  const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"pm-"));dirs.push(d);return d};
  const clock=(start="2026-10-21T00:00:00.000Z")=>{let t=Date.parse(start);return ()=>{const d=new Date(t);t+=1000;return d}};
  const mk=(root:string,now=clock())=>new ProjectMemory({rootDir:root,projectId:PID,now});
  const author={role:"FOUNDER",sessionId:"s-1"};
  const src={ref:"docs/adr/0001.md",sha256:"f".repeat(64),retrievedAt:"2026-10-20T10:00:00.000Z"};
  const code=(fn:()=>unknown)=>{try{fn()}catch(e){expect(e).toBeInstanceOf(ProjectMemoryError);return (e as ProjectMemoryError).code}return "NO_THROW"};
  const seed=(m:ProjectMemory)=>{
    const a=m.append({kind:"DECISION",title:"Use SQLite",body:"Local-first store",sources:[src],tags:["db","arch"],author});
    const b=m.append({kind:"FACT",title:"Node 22",body:"Runtime is Node 22",tags:["runtime"],author:{role:"BUILDER"}});
    const c=m.append({kind:"NOTE",title:"Open question",body:"Backup cadence TBD",author});
    return [a,b,c];
  };
  it("appends and reads back records round-trip with a valid chain",()=>{
    const root=tmp(),m=mk(root);
    expect(m.verify().state).toBe("ABSENT");
    const [a,b,c]=seed(m);
    expect([a.seq,b.seq,c.seq]).toEqual([1,2,3]);
    expect(a.prevHash).toBe("0".repeat(64));expect(b.prevHash).toBe(a.hash);expect(c.prevHash).toBe(b.hash);
    expect(m.get(a.id)).toEqual(a);
    expect(mk(root).all()).toEqual([a,b,c]);
    expect(m.verify()).toMatchObject({state:"OK",reason:null,records:3,lastSeq:3,lastHash:c.hash});
    // Çekirdek yolu realpathSync.native ile kanonikleştirir (Windows: 8.3 kısa ad genişler); beklenen değer de aynı çözücüyle üretilir.
    expect(m.journalFile).toBe(path.join(fs.realpathSync.native(root),"projects",PID,"memory","journal.jsonl"));
  });
  it("reports TAMPERED for edited content and reordered lines, refusing reads and writes without repairing",()=>{
    const root=tmp(),m=mk(root);seed(m);
    const f=m.journalFile,orig=fs.readFileSync(f,"utf8");
    fs.writeFileSync(f,orig.replace("Local-first store","Cloud store"));
    expect(m.verify()).toMatchObject({state:"TAMPERED",reason:"HASH_MISMATCH:1"});
    expect(code(()=>m.all())).toBe("MEMORY_TAMPERED");
    expect(code(()=>m.append({kind:"NOTE",title:"x",body:"y",author}))).toBe("MEMORY_TAMPERED");
    const lines=orig.split("\n");
    fs.writeFileSync(f,[lines[1],lines[0],lines[2],""].join("\n"));
    expect(m.verify().state).toBe("TAMPERED");
    expect(m.verify().reason).toMatch(/^(SEQUENCE_BROKEN|CHAIN_BROKEN):1$/);
    expect(fs.readFileSync(f,"utf8")).toBe([lines[1],lines[0],lines[2],""].join("\n"));
  });
  it("reports TORN_TAIL for a truncated last line, keeps the verified prefix readable and refuses writes",()=>{
    const root=tmp(),m=mk(root);const [a,b]=seed(m);
    const f=m.journalFile,orig=fs.readFileSync(f);
    fs.writeFileSync(f,orig.subarray(0,orig.length-20));
    const h=m.verify();
    expect(h).toMatchObject({state:"TORN_TAIL",reason:"TORN_TAIL:3",records:2,lastSeq:2});
    expect(h.tornTailBytes).toBeGreaterThan(0);
    expect(m.all()).toEqual([a,b]);
    expect(code(()=>m.append({kind:"NOTE",title:"x",body:"y",author}))).toBe("MEMORY_READ_ONLY");
    expect(fs.readFileSync(f).length).toBe(orig.length-20);
    fs.writeFileSync(f,Buffer.concat([orig,Buffer.from("garbage")]));
    expect(m.verify()).toMatchObject({state:"TAMPERED",reason:"TRAILING_GARBAGE"});
  });
  it("rejects secrets in body, title, source refs and tags without writing",()=>{
    const m=mk(tmp());
    const aws="AKIA"+"ABCDEFGHIJKLMNOP",gh="ghp_"+"x".repeat(36);
    expect(code(()=>m.append({kind:"FACT",title:"t",body:`key=${aws}`,author}))).toBe("MEMORY_SECRET_REJECTED");
    expect(code(()=>m.append({kind:"FACT",title:`tok ${gh}`,body:"b",author}))).toBe("MEMORY_SECRET_REJECTED");
    expect(code(()=>m.append({kind:"SOURCE",title:"t",body:"b",sources:[{ref:`https://x/?k=${aws}`,retrievedAt:src.retrievedAt}],author}))).toBe("MEMORY_SECRET_REJECTED");
    try{m.append({kind:"FACT",title:"t",body:aws,author})}catch(e){expect((e as Error).message).not.toContain(aws)}
    expect(m.verify().state).toBe("ABSENT");
  });
  it("rejects bad project ids, path traversal and a memory dir escaping the root via symlink",()=>{
    const root=tmp();
    for(const projectId of ["../../etc","prj_../x","prj_"+"A".repeat(24),"prj_"+"a".repeat(23),""," prj_"+"a".repeat(24)])
      expect(code(()=>new ProjectMemory({rootDir:root,projectId}))).toBe("MEMORY_INVALID_PROJECT_ID");
    expect(code(()=>new ProjectMemory({rootDir:"bad\u0000root",projectId:PID}))).toBe("MEMORY_PATH_REJECTED");
    const outside=tmp();
    fs.symlinkSync(outside,path.join(root,"projects"),"dir");
    expect(code(()=>new ProjectMemory({rootDir:root,projectId:PID}))).toBe("MEMORY_PATH_REJECTED");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("enforces size limits and rejects unknown kinds, malformed fields and missing supersedes targets",()=>{
    const m=mk(tmp());
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"x".repeat(MEMORY_LIMITS.bodyBytes+1),author}))).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"ğ".repeat(MEMORY_LIMITS.bodyBytes/2+1),author}))).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(m.append({kind:"FACT",title:"t",body:"x".repeat(MEMORY_LIMITS.bodyBytes),author}).body.length).toBe(32768);
    expect(code(()=>m.append({kind:"FACT",title:"t".repeat(201),body:"b",author}))).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(m.append({kind:"FACT",title:"t".repeat(200),body:"b",author}).title.length).toBe(200);
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"b",sources:Array.from({length:33},()=>src),author}))).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(m.append({kind:"FACT",title:"t",body:"b",sources:Array.from({length:32},()=>src),author}).sources).toHaveLength(32);
    expect(code(()=>m.append({kind:"OPINION" as never,title:"t",body:"b",author}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.list({kind:"OPINION" as never}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.append({kind:"FACT",title:"",body:"b",author}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"b",author:{role:""}}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"b",sources:[{ref:"r",retrievedAt:"yesterday"}],author}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.append({kind:"FACT",title:"t",body:"b",sources:[{ref:"r",sha256:"abc",retrievedAt:src.retrievedAt}],author}))).toBe("MEMORY_INVALID_INPUT");
    expect(code(()=>m.append({kind:"REVISION",title:"t",body:"b",supersedes:"mem_999999",author}))).toBe("MEMORY_SUPERSEDES_MISSING");
    expect(m.verify()).toMatchObject({state:"OK",records:3});
  });
  it("resolves supersession in currentView and refuses forking an already superseded record",()=>{
    const m=mk(tmp());const [a,b,c]=seed(m);
    const r1=m.append({kind:"REVISION",title:"Use Postgres",body:"Revised: Postgres",supersedes:a.id,tags:["db"],author});
    const r2=m.append({kind:"REVISION",title:"Use SQLite+WAL",body:"Revised again",supersedes:r1.id,tags:["db"],author});
    expect(code(()=>m.append({kind:"REVISION",title:"fork",body:"x",supersedes:a.id,author}))).toBe("MEMORY_SUPERSEDES_NOT_HEAD");
    const view=m.currentView();
    expect(view.map(v=>v.head.id)).toEqual([b.id,c.id,r2.id]);
    expect(view.find(v=>v.head.id===r2.id)?.history).toEqual([a.id,r1.id,r2.id]);
    expect(m.list({kind:"REVISION"}).map(r=>r.id)).toEqual([r1.id,r2.id]);
    expect(m.list({tag:"db"}).map(r=>r.id)).toEqual([a.id,r1.id,r2.id]);
    expect(m.list({kind:"DECISION",tag:"arch"}).map(r=>r.id)).toEqual([a.id]);
    expect(m.search("postgres").map(r=>r.id)).toEqual([r1.id]);
    expect(m.search("RUNTIME").map(r=>r.id)).toEqual([b.id]);
    expect(m.search("(.*)")).toEqual([]);
    expect(m.verify().state).toBe("OK");
  });
  it("returns provenance lineage with sources and the current head",()=>{
    const m=mk(tmp());const [a]=seed(m);
    const s2={ref:"https://example.invalid/rfc",retrievedAt:"2026-10-21T09:00:00.000Z"};
    const r1=m.append({kind:"REVISION",title:"Use Postgres",body:"b",sources:[s2],supersedes:a.id,author:{role:"ARCHITECT"}});
    const p=m.provenance(r1.id);
    expect(p.currentHeadId).toBe(r1.id);
    expect(p.lineage.map(s=>s.id)).toEqual([a.id,r1.id]);
    expect(p.lineage[0].sources).toEqual([src]);expect(p.lineage[1].sources).toEqual([s2]);
    expect(p.lineage[1].author).toEqual({role:"ARCHITECT"});
    expect(m.provenance(a.id)).toMatchObject({currentHeadId:r1.id,lineage:[{id:a.id,hash:a.hash}]});
    expect(code(()=>m.provenance("mem_000099"))).toBe("MEMORY_NOT_FOUND");
  });
  it("uses the injected clock deterministically and produces identical chains for identical inputs",()=>{
    const r1=tmp(),r2=tmp();
    const x=seed(mk(r1,clock())),y=seed(mk(r2,clock()));
    expect(x.map(r=>r.at)).toEqual(["2026-10-21T00:00:00.000Z","2026-10-21T00:00:01.000Z","2026-10-21T00:00:02.000Z"]);
    expect(x.map(r=>r.hash)).toEqual(y.map(r=>r.hash));
    expect(fs.readFileSync(mk(r1).journalFile)).toEqual(fs.readFileSync(mk(r2).journalFile));
  });
  it("lets two instances on the same file append in sequence without breaking the chain",()=>{
    const root=tmp(),m1=mk(root,clock()),m2=mk(root,clock("2026-10-22T00:00:00.000Z"));
    const a=m1.append({kind:"FACT",title:"one",body:"1",author});
    const b=m2.append({kind:"FACT",title:"two",body:"2",author});
    const c=m1.append({kind:"REVISION",title:"one'",body:"1'",supersedes:a.id,author});
    expect([a.seq,b.seq,c.seq]).toEqual([1,2,3]);
    expect(b.prevHash).toBe(a.hash);expect(c.prevHash).toBe(b.hash);
    expect(m2.verify()).toMatchObject({state:"OK",records:3});
    expect(m2.currentView().map(v=>v.head.id)).toEqual([b.id,c.id]);
    expect(code(()=>m2.append({kind:"REVISION",title:"x",body:"x",supersedes:a.id,author}))).toBe("MEMORY_SUPERSEDES_NOT_HEAD");
  });
});
