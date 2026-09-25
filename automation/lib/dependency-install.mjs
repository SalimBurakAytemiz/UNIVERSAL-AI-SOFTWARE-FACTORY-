// //TR: Bu helper source-reviewed lock, canonical registry/integrity, gerçek installed-tree digest ve Ed25519 marker seal ile dependency reuse/install sınırını fail-closed uygular.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {safeChildEnv} from "./env-policy.mjs";
import {resolveNpmInvocation} from "./npm-invocation.mjs";

const sha256=b=>crypto.createHash("sha256").update(b).digest("hex");
const readJson=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sections=["dependencies","devDependencies","optionalDependencies","peerDependencies"];
const DEFAULT_REGISTRY="https://registry.npmjs.org/";
const MARKER_SCHEMA="2.0.0";
const markerName=".uasco-dependency-state.json";
const canonicalPath=/^node_modules\/(?:@[^/]+\/[^/]+|[^/@][^/]*)(?:\/node_modules\/(?:@[^/]+\/[^/]+|[^/@][^/]*))*$/;

function sameMap(a={},b={}){const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return JSON.stringify(ak)===JSON.stringify(bk)&&ak.every(k=>a[k]===b[k])}
function isInside(parent,child){const rel=path.relative(parent,child);return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel))}
function packageNameFromRel(rel){const parts=rel.split("/");const i=parts.lastIndexOf("node_modules");const tail=parts.slice(i+1);return tail[0]?.startsWith("@")?`${tail[0]}/${tail[1]}`:tail[0]}
function assertSha512SRI(value,rel){if(typeof value!=="string"||!value.startsWith("sha512-"))throw new Error(`TRANSITIVE_INTEGRITY_SHA512_REQUIRED:${rel}`);let raw;try{raw=Buffer.from(value.slice(7),"base64")}catch{throw new Error(`TRANSITIVE_INTEGRITY_INVALID:${rel}`)}if(raw.length!==64||raw.toString("base64")!==value.slice(7))throw new Error(`TRANSITIVE_INTEGRITY_INVALID:${rel}`)}
function policy(root){const p=path.join(root,"config/supply-chain-policy.json");if(!fs.existsSync(p))return {allowedRegistryHosts:["registry.npmjs.org"],requireHttpsRegistry:true,requireTransitiveIntegrity:true};return readJson(p)}
function assertResolvedUrl(raw,rel,p){let u;try{u=new URL(String(raw))}catch{throw new Error(`REGISTRY_URL_INVALID:${rel}`)}const allowed=new Set((p.allowedRegistryHosts??["registry.npmjs.org"]).map(x=>String(x).toLowerCase()));if(p.requireHttpsRegistry===true&&u.protocol!=="https:")throw new Error(`REGISTRY_PROTOCOL_DENIED:${rel}:${u.protocol}`);if(!allowed.has(u.hostname.toLowerCase()))throw new Error(`REGISTRY_HOST_DENIED:${rel}:${u.hostname}`);if(u.port)throw new Error(`REGISTRY_PORT_DENIED:${rel}:${u.port}`);if(u.username||u.password)throw new Error(`REGISTRY_URL_CREDENTIAL_DENIED:${rel}`);if(u.search||u.hash)throw new Error(`REGISTRY_URL_DECORATION_DENIED:${rel}`)}

function validateLock(root,pkg,lock){
 const rootEntry=lock.packages?.[""];if(!rootEntry)throw new Error("PACKAGE_LOCK_ROOT_ENTRY_MISSING");
 if(pkg.name!==lock.name||pkg.version!==lock.version||pkg.name!==rootEntry.name||pkg.version!==rootEntry.version)throw new Error("PACKAGE_LOCK_ROOT_IDENTITY_MISMATCH");
 for(const section of sections)if(!sameMap(pkg[section]??{},rootEntry[section]??{}))throw new Error(`PACKAGE_LOCK_ROOT_MISMATCH:${section}`);
 const p=policy(root),allDirect=new Set();for(const section of sections)for(const name of Object.keys(pkg[section]??{}))allDirect.add(name);
 for(const name of allDirect){const rel=`node_modules/${name}`;if(!lock.packages?.[rel])throw new Error(`PACKAGE_LOCK_DIRECT_ENTRY_MISSING:${name}`)}
 for(const [rel,entry] of Object.entries(lock.packages??{})){
   if(rel==="")continue;
   if(!canonicalPath.test(rel)||rel.includes("/../")||rel.includes("/./"))throw new Error(`LOCK_PACKAGE_PATH_NONCANONICAL:${rel}`);
   if(entry?.link===true)throw new Error(`LOCK_LINK_PACKAGE_DENIED:${rel}`);
   if(!entry?.resolved)throw new Error(`RESOLVED_URL_MISSING:${rel}`);assertResolvedUrl(entry.resolved,rel,p);
   if(p.requireTransitiveIntegrity===true)assertSha512SRI(entry?.integrity,rel);
 }
}

export function dependencyState(root){
 root=path.resolve(root);const pkgFile=path.join(root,"package.json"),lockFile=path.join(root,"package-lock.json");
 if(!fs.existsSync(pkgFile))throw new Error("PACKAGE_JSON_MISSING");
 if(!fs.existsSync(lockFile))throw new Error("SOURCE_REVIEWED_PACKAGE_LOCK_REQUIRED");
 const pkgBytes=fs.readFileSync(pkgFile),lockBytes=fs.readFileSync(lockFile),lock=JSON.parse(lockBytes.toString("utf8").replace(/^\uFEFF/,"")),pkg=JSON.parse(pkgBytes.toString("utf8").replace(/^\uFEFF/,""));
 if(lock.lockfileVersion!==3)throw new Error(`PACKAGE_LOCK_VERSION_UNSUPPORTED:${lock.lockfileVersion??"MISSING"}`);
 validateLock(root,pkg,lock);
 return {lockSha256:sha256(lockBytes),packageSha256:sha256(pkgBytes)};
}

function hashPackageTree(pkgDir){
 const rootReal=fs.realpathSync(pkgDir),rows=[];const walk=(dir,relBase="")=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(e.name==="node_modules")continue;const abs=path.join(dir,e.name),rel=relBase?`${relBase}/${e.name}`:e.name;const st=fs.lstatSync(abs);if(st.isSymbolicLink())throw new Error(`INSTALLED_PACKAGE_SYMLINK_DENIED:${abs}`);if(st.isDirectory())walk(abs,rel);else if(st.isFile()){const real=fs.realpathSync(abs);if(!isInside(rootReal,real))throw new Error(`INSTALLED_PACKAGE_REALPATH_ESCAPE:${abs}`);rows.push(`${rel}\0${sha256(fs.readFileSync(abs))}`)}}};walk(pkgDir);return sha256(Buffer.from(rows.join("\n"),"utf8"));
}
function enumerateInstalled(modulesDir){const out=[];if(!fs.existsSync(modulesDir))return out;const visit=(nm,prefix="")=>{for(const e of fs.readdirSync(nm,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(e.name===markerName||e.name.startsWith("."))continue;const ep=path.join(nm,e.name);if(e.isSymbolicLink())throw new Error(`INSTALLED_NODE_MODULES_SYMLINK_DENIED:${ep}`);if(!e.isDirectory())continue;if(e.name.startsWith("@")){for(const c of fs.readdirSync(ep,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(!c.isDirectory()||c.isSymbolicLink())continue;const rel=prefix?`${prefix}/node_modules/${e.name}/${c.name}`:`node_modules/${e.name}/${c.name}`,pkg=path.join(ep,c.name);out.push(rel);const nested=path.join(pkg,"node_modules");if(fs.existsSync(nested))visit(nested,rel)}}else{const rel=prefix?`${prefix}/node_modules/${e.name}`:`node_modules/${e.name}`,pkg=ep;out.push(rel);const nested=path.join(pkg,"node_modules");if(fs.existsSync(nested))visit(nested,rel)}}};visit(modulesDir);return out}

export function installedDependencyInventory(root){
 root=path.resolve(root);const lock=readJson(path.join(root,"package-lock.json")),modules=path.join(root,"node_modules");if(!fs.existsSync(modules))throw new Error("NODE_MODULES_MISSING_FOR_INSTALLED_VALIDATION");const expected=new Set(Object.keys(lock.packages??{}).filter(x=>x));const actual=enumerateInstalled(modules);for(const rel of actual)if(!expected.has(rel))throw new Error(`INSTALLED_EXTRA_PACKAGE:${rel}`);const rows=[];
 for(const rel of [...expected].sort()){const entry=lock.packages[rel],pkgDir=path.join(root,rel);if(!fs.existsSync(pkgDir)){if(entry?.optional===true)continue;throw new Error(`INSTALLED_PACKAGE_MISSING:${rel}`)}const lst=fs.lstatSync(pkgDir);if(lst.isSymbolicLink())throw new Error(`INSTALLED_PACKAGE_SYMLINK_DENIED:${rel}`);const real=fs.realpathSync(pkgDir);if(!isInside(path.join(root,"node_modules"),real))throw new Error(`INSTALLED_PACKAGE_REALPATH_ESCAPE:${rel}`);const pj=path.join(pkgDir,"package.json");if(!fs.existsSync(pj))throw new Error(`INSTALLED_PACKAGE_JSON_MISSING:${rel}`);const j=readJson(pj),expectedName=packageNameFromRel(rel);if(j.name!==expectedName||j.version!==entry.version)throw new Error(`INSTALLED_IDENTITY_MISMATCH:${rel}:${j.name??"?"}@${j.version??"?"}:${expectedName}@${entry.version??"?"}`);rows.push(`${rel}\0${hashPackageTree(pkgDir)}`)}
 return {installedTreeSha256:sha256(Buffer.from(rows.join("\n"),"utf8")),installedPackageCount:rows.length};
}
function signingPaths(root){const dir=path.join(root,".ai/runtime/keys");return {priv:path.join(dir,"evidence-ed25519-private.pem"),pub:path.join(dir,"evidence-ed25519-public.pem"),state:path.join(root,".ai/runtime/EVIDENCE_SIGNING.json")}}
function markerPayload(m){return {schemaVersion:MARKER_SCHEMA,lockSha256:m.lockSha256,packageSha256:m.packageSha256,installedTreeSha256:m.installedTreeSha256,installedPackageCount:m.installedPackageCount}}
function payloadBytes(m){return Buffer.from(JSON.stringify(markerPayload(m)),"utf8")}
function signingStarted(root){const p=signingPaths(root);return fs.existsSync(p.state)||fs.existsSync(p.pub)||fs.existsSync(p.priv)}
function verifyMarkerSeal(root,m){if(!signingStarted(root))return true;const {pub}=signingPaths(root);if(!fs.existsSync(pub))throw new Error("DEPENDENCY_STATE_PUBLIC_KEY_MISSING");if(m.sealAlgorithm!=="Ed25519"||typeof m.sealSignature!=="string"||!m.sealSignature)throw new Error("DEPENDENCY_STATE_SIGNATURE_REQUIRED");const pubBytes=fs.readFileSync(pub),fp=sha256(pubBytes);if(m.publicKeyFingerprint!==fp)throw new Error("DEPENDENCY_STATE_PUBLIC_KEY_FINGERPRINT_MISMATCH");let ok=false;try{ok=crypto.verify(null,payloadBytes(m),crypto.createPublicKey(pubBytes),Buffer.from(m.sealSignature,"base64"))}catch{}if(!ok)throw new Error("DEPENDENCY_STATE_SIGNATURE_INVALID");return true}
function writeMarker(root,state){const marker=path.join(root,"node_modules",markerName),inv=installedDependencyInventory(root),base={"//TR":"Bu marker exact reviewed lock/package digestini, gerçek installed dependency tree digestini ve evidence key hazırsa Ed25519 seal'i taşır.",...markerPayload({...state,...inv}),sealStatus:"PENDING_EVIDENCE_KEY"};fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify(base,null,2)+"\n","utf8");if(signingStarted(root))sealInstalledDependencyState(root);return readJson(marker)}
export function sealInstalledDependencyState(root){root=path.resolve(root);const marker=path.join(root,"node_modules",markerName);if(!fs.existsSync(marker))return {status:"NO_MARKER"};const {priv,pub}=signingPaths(root);if(!fs.existsSync(priv)||!fs.existsSync(pub))throw new Error("DEPENDENCY_STATE_SIGNING_KEYPAIR_REQUIRED");const m=readJson(marker),state=dependencyState(root),inv=installedDependencyInventory(root);const current={...m,...state,...inv,schemaVersion:MARKER_SCHEMA};const pubBytes=fs.readFileSync(pub),privateKey=crypto.createPrivateKey(fs.readFileSync(priv));current.sealAlgorithm="Ed25519";current.publicKeyFingerprint=sha256(pubBytes);current.sealSignature=crypto.sign(null,payloadBytes(current),privateKey).toString("base64");current.sealStatus="SEALED";fs.writeFileSync(marker,JSON.stringify(current,null,2)+"\n","utf8");return {status:"SEALED",publicKeyFingerprint:current.publicKeyFingerprint}}
export function assertInstalledDependencyState(root){root=path.resolve(root);const state=dependencyState(root),marker=path.join(root,"node_modules",markerName);if(!fs.existsSync(marker))throw new Error("DEPENDENCY_STATE_MARKER_MISSING");let prior;try{prior=readJson(marker)}catch{throw new Error("DEPENDENCY_STATE_MARKER_INVALID")}if(prior.schemaVersion!==MARKER_SCHEMA)throw new Error("DEPENDENCY_STATE_MARKER_SCHEMA_UNSUPPORTED");if(prior.lockSha256!==state.lockSha256||prior.packageSha256!==state.packageSha256)throw new Error("DEPENDENCY_STATE_DIGEST_MISMATCH");const inv=installedDependencyInventory(root);if(prior.installedTreeSha256!==inv.installedTreeSha256||prior.installedPackageCount!==inv.installedPackageCount)throw new Error("DEPENDENCY_STATE_INSTALLED_TREE_MISMATCH");verifyMarkerSeal(root,prior);return {...state,...inv}}
function parseMajor(v){const m=String(v??"").trim().match(/^(\d+)/);return m?Number(m[1]):NaN}
function dependencyChildEnv(root){return safeChildEnv(path.join(root,"config/environment-policy.json"),{denyNetworkOverrides:true})}
function assertToolchain(root,npm,spawnSync){if(parseMajor(process.versions.node)<24)throw new Error(`NODE_VERSION_UNSUPPORTED:${process.versions.node}`);const r=spawnSync(npm.command,[...npm.prefixArgs,"--version"],{encoding:"utf8",windowsHide:true,env:dependencyChildEnv(root)});if(r.status!==0)throw new Error(`NPM_VERSION_UNAVAILABLE:${r.stderr||r.stdout||`exit=${r.status}`}`);const major=parseMajor(r.stdout);if(!Number.isFinite(major)||major<11)throw new Error(`NPM_VERSION_UNSUPPORTED:${String(r.stdout).trim()}`)}
export function ensureDependencies(root,{npmCommand=null,cacheDir=null,preferOffline=false,spawnSync=cp.spawnSync}={}){
 root=path.resolve(root);const state=dependencyState(root),modules=path.join(root,"node_modules");try{assertInstalledDependencyState(root);return {mode:"EXISTING_REVIEWED_LOCK",...state}}catch{}
 // //TR: Explicit npmCommand yalnız test/injection içindir; varsayılan yol Windows'ta shell'siz node + bundled npm-cli.js'dir ve çözülemezse node_modules silinmeden fail-closed durur.
 const npm=npmCommand?{command:npmCommand,prefixArgs:[]}:resolveNpmInvocation();assertToolchain(root,npm,spawnSync);fs.rmSync(modules,{recursive:true,force:true});const args=["ci","--ignore-scripts","--no-audit","--no-fund","--include=dev","--include=optional",`--registry=${DEFAULT_REGISTRY}`,"--strict-ssl=true","--engine-strict=true","--fetch-retries=0"];if(preferOffline)args.push("--prefer-offline");if(cacheDir){fs.mkdirSync(cacheDir,{recursive:true});args.push("--cache",cacheDir)}const r=spawnSync(npm.command,[...npm.prefixArgs,...args],{cwd:root,encoding:"utf8",windowsHide:true,env:dependencyChildEnv(root)});if(r.status!==0)throw new Error(`NPM_CI_REVIEWED_LOCK_FAILED:${r.stderr||r.stdout||`exit=${r.status}`}`);writeMarker(root,state);assertInstalledDependencyState(root);return {mode:"NPM_CI_REVIEWED_LOCK",...state};
}
