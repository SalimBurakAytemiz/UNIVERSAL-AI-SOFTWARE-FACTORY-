// //TR: V3-T1012.a / V3-AC-F057-2: web-node ve node-lib şablonlarının bağımlılıksız package-lock.json taşıdığını, şablonun UASCO dışındaki temiz bir geçici dizinde gerçek `npm ci && npm test` ile geçtiğini (kilitsiz hâlinin `npm ci`'de düştüğünü) ve proje dışa aktarımının kilit dosyası durumunu raporladığını kanıtlar.
import {describe,it,expect,beforeAll,afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {renderTemplate,lockfileStatus} from "../../core/workos/project-templates.js";
import {ProjectStudio,StudioError} from "../../core/workos/project-studio.js";
import {listZipEntries,readZipEntry} from "../../core/workos/zip.js";
import type {Project} from "../../core/workos/types.js";

const ENV_POLICY=path.resolve("config","environment-policy.json");
const WIN=process.platform==="win32";
// npm runs in a clean temp dir outside the repo with its own empty cache and no user/global config; zero dependencies means nothing is fetched.
const npm=(cwd:string,args:string[])=>{
  // inherited npm_* / NPM_CONFIG_* (e.g. from an outer `npm run` or a CI userconfig) are dropped: mixed-case duplicates make npm abort before reading config
  const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^npm_/i.test(k)));
  const cache=path.join(cwd,"..","npm-cache"),env={...base,npm_config_cache:cache,npm_config_userconfig:path.join(cwd,"..","no-npmrc"),npm_config_globalconfig:path.join(cwd,"..","no-global-npmrc"),npm_config_audit:"false",npm_config_fund:"false",npm_config_update_notifier:"false"};
  const r=spawnSync(WIN?"npm.cmd":"npm",args,{cwd,env,encoding:"utf8",shell:WIN,timeout:120_000,windowsHide:true});
  return {code:r.status,out:`${r.stdout??""}${r.stderr??""}${r.error?String(r.error):""}`};
};
const write=(dir:string,files:Record<string,string>)=>{for(const [rel,c] of Object.entries(files)){const f=path.join(dir,...rel.split("/"));fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,c)}};

export function registerTemplateLockfileCases():void{
  describe("V3-T1012.a templates ship a lockfile; the delivery passes npm ci && npm test outside UASCO (V3-AC-F057-2)",()=>{
    let root:string;
    beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-t1012a-"))});
    afterAll(()=>{fs.rmSync(root,{recursive:true,force:true})});

    it("web-node and node-lib carry a lockfileVersion 3 lock that matches their package.json and has no dependencies; empty has none",()=>{
      for(const t of ["web-node","node-lib"] as const){
        const f=renderTemplate(t,"My Demo App").files,pkg=JSON.parse(f["package.json"]!),lock=JSON.parse(f["package-lock.json"]!);
        expect(lock,t).toEqual({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{"":{name:pkg.name,version:pkg.version,license:pkg.license}}});
        expect(pkg.dependencies??{},t).toEqual({});expect(pkg.devDependencies??{},t).toEqual({});
        expect(lockfileStatus(Object.keys(f)),t).toBe("PRESENT");
      }
      expect(Object.keys(renderTemplate("empty","x").files)).not.toContain("package-lock.json");
      expect(lockfileStatus(Object.keys(renderTemplate("empty","x").files))).toBe("NOT_APPLICABLE");
    });

    it("lockfileStatus: package.json without a lock is MISSING; shrinkwrap counts as a lock; only root names matter",()=>{
      expect(lockfileStatus(["package.json","index.js"])).toBe("MISSING");
      expect(lockfileStatus(["package.json","npm-shrinkwrap.json"])).toBe("PRESENT");
      expect(lockfileStatus(["package.json","sub/package-lock.json"])).toBe("MISSING");
      expect(lockfileStatus(["README.md"])).toBe("NOT_APPLICABLE");
    });

    for(const t of ["web-node","node-lib"] as const)it(`${t}: a copy in a clean temp dir passes real \`npm ci && npm test\`; without its lock \`npm ci\` fails`,()=>{
      const dir=path.join(root,t,"app");fs.mkdirSync(dir,{recursive:true});
      write(dir,renderTemplate(t,`Demo ${t}`).files);
      const ci=npm(dir,["ci","--offline","--ignore-scripts"]);expect(ci.code,ci.out).toBe(0);
      const test=npm(dir,["test"]);expect(test.code,test.out).toBe(0);expect(test.out).toMatch(/pass/i);
      const bare=path.join(root,t,"nolock");fs.mkdirSync(bare,{recursive:true});
      const files={...renderTemplate(t,`Demo ${t}`).files};delete files["package-lock.json"];write(bare,files);
      const ci2=npm(bare,["ci","--offline","--ignore-scripts"]);expect(ci2.code,ci2.out).not.toBe(0);
    },180_000);

    it("project export: PRESENT for the template (record + README); once the lock is removed the export is REFUSED (EXPORT_LOCKFILE_MISSING 409) and nothing is written",()=>{
      const dataDir=path.join(root,"data"),studio=new ProjectStudio({dataDir,envPolicyFile:ENV_POLICY});
      const readme=(file:string)=>{const buf=fs.readFileSync(path.join(dataDir,file));const e=listZipEntries(buf).find(x=>x.name==="README.md")!;return readZipEntry(buf,e).toString("utf8")};
      const id="prj_"+"a".repeat(24),repo=studio.createTemplateRepository(id,"node-lib","Lock Demo");
      const project={projectId:id,name:"Lock Demo",repository:{path:repo.path,managed:true},testCommand:["node","test.js"]} as unknown as Project;
      const ok=studio.exportProject(project,[],undefined,"tester");
      expect(ok.lockfile).toBe("PRESENT");expect(readme(ok.file)).toContain("| Lockfile | PRESENT");
      const g=(args:string[])=>{const r=spawnSync("git",args,{cwd:repo.path,encoding:"utf8",env:{...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@x",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@x"}});expect(r.status,r.stderr).toBe(0)};
      g(["rm","-q","package-lock.json"]);g(["commit","-q","-m","drop lock"]);
      // V3-T1012.a (#324 NB-1): "teslimde kilit dosyası zorunlu": kilitsiz Node teslimi reddedilir; exports dizinine hiçbir şey (zip ya da geçici dizin) yazılmaz
      const exportsDir=path.join(dataDir,"exports"),before=fs.readdirSync(exportsDir).sort();
      let refused:unknown=null;try{studio.exportProject(project,[],undefined,"tester")}catch(e){refused=e}
      expect(refused).toBeInstanceOf(StudioError);
      expect({code:(refused as StudioError).code,status:(refused as StudioError).status}).toEqual({code:"EXPORT_LOCKFILE_MISSING",status:409});
      expect(fs.readdirSync(exportsDir).sort(),"no zip, no temp dir").toEqual(before);
      expect(before.filter(f=>f.endsWith(".zip"))).toEqual([`${ok.exportId}.zip`]);
      const eid="prj_"+"b".repeat(24),erepo=studio.createTemplateRepository(eid,"empty","Empty");
      expect(studio.exportProject({projectId:eid,name:"Empty",repository:{path:erepo.path,managed:true}} as unknown as Project,[],undefined,"tester").lockfile).toBe("NOT_APPLICABLE");
    },60_000);
  });
}
