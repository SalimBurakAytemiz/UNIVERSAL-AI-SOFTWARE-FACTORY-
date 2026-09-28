// //TR: Bu helper final release artifact'inin kaynak dosya kümesini scripts/verify-artifact.mjs ile aynı dışlama kurallarıyla listeler, SHA256SUMS.txt'yi deterministik üretir/ayrıştırır/doğrular ve deterministik ZIP yazar/okur; symlink, düzenli olmayan dosya, güvensiz yol, yinelenen satır, büyük/küçük harf çakışması, ZIP64, şifreleme ve data descriptor fail-closed reddedilir. İmza/authenticity iddiası taşımaz.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {crc32 as zlibCrc32} from "node:zlib";
export const ARTIFACT_MANIFEST="SHA256SUMS.txt";
// //TR: scripts/verify-artifact.mjs walk() ile birebir aynı dışlanan dizinler; biri değişirse diğeri de değişmelidir.
export const ARTIFACT_EXCLUDED_DIRS=Object.freeze([".git","node_modules",".ai/runtime",".ai/automation"]);
const LINE=/^([0-9a-f]{64})\s{2}(.+)$/;
const byteOrder=(a,b)=>a<b?-1:a>b?1:0;
const excluded=rel=>ARTIFACT_EXCLUDED_DIRS.some(d=>rel===d||rel.startsWith(`${d}/`));
export function sha256File(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
export function unsafeArtifactPath(rel){return rel===""||rel.startsWith("/")||/^[A-Za-z]:/.test(rel)||rel.includes("\\")||rel.split("/").some(s=>s===""||s==="."||s==="..")||/[\u0000-\u001f]/.test(rel)}
export function listArtifactSourceFiles(root){
 const files=[],violations=[];
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll("\\","/");if(excluded(rel))continue;if(e.isSymbolicLink()){violations.push({path:rel,reason:"SYMLINK_NOT_ALLOWED"});continue}if(e.isDirectory()){walk(p);continue}if(!e.isFile()){violations.push({path:rel,reason:"NOT_REGULAR_FILE"});continue}if(rel!==ARTIFACT_MANIFEST)files.push(rel)}})(root);
 const seen=new Map();for(const f of files){const k=f.toLowerCase();if(seen.has(k))violations.push({path:f,reason:"CASE_COLLISION",other:seen.get(k)});else seen.set(k,f);if(unsafeArtifactPath(f))violations.push({path:f,reason:"UNSAFE_PATH"})}
 return {files:files.sort(byteOrder),violations};
}
export function parseSha256Sums(text){
 const entries=new Map(),errors=[];
 if(text.includes("\r"))errors.push({reason:"CRLF_NOT_ALLOWED"});
 if(text.length&&!text.endsWith("\n"))errors.push({reason:"MISSING_FINAL_NEWLINE"});
 for(const line of text.split("\n").filter(Boolean)){const m=line.match(LINE);if(!m){errors.push({line,reason:"MALFORMED"});continue}const [,sha,rel]=m;if(unsafeArtifactPath(rel)){errors.push({path:rel,reason:"UNSAFE_PATH"});continue}if(entries.has(rel)){errors.push({path:rel,reason:"DUPLICATE_ENTRY"});continue}entries.set(rel,sha)}
 const keys=[...entries.keys()];if(keys.some((k,i)=>i>0&&byteOrder(keys[i-1],k)>=0))errors.push({reason:"NOT_SORTED"});
 if(entries.has(ARTIFACT_MANIFEST))errors.push({path:ARTIFACT_MANIFEST,reason:"SELF_LISTED"});
 return {entries,errors};
}
export function buildSha256Sums(root){
 const {files,violations}=listArtifactSourceFiles(root);if(violations.length)throw new Error(`ARTIFACT_SOURCE_VIOLATIONS:${JSON.stringify(violations)}`);
 if(!files.includes("package-lock.json"))throw new Error("ARTIFACT_LOCKFILE_MISSING");
 const text=files.map(f=>`${sha256File(path.join(root,f))}  ${f}`).join("\n")+"\n";
 return {text,files,sha256:crypto.createHash("sha256").update(text).digest("hex")};
}
// //TR: Mevcut SHA256SUMS.txt'yi dosya kümesine ve içeriklere karşı yeniden doğrular; paketleme öncesi kurcalanmayı yakalar.
export function verifySha256Sums(root){
 const failures=[],file=path.join(root,ARTIFACT_MANIFEST);if(!fs.existsSync(file))return {ok:false,failures:[{reason:"MANIFEST_MISSING"}],entries:new Map()};
 const {entries,errors}=parseSha256Sums(fs.readFileSync(file,"utf8"));failures.push(...errors);
 const {files,violations}=listArtifactSourceFiles(root);failures.push(...violations);
 const actual=new Set(files);for(const f of files)if(!entries.has(f))failures.push({path:f,reason:"UNLISTED_SOURCE_FILE"});
 for(const [rel,sha] of entries){if(!actual.has(rel)){failures.push({path:rel,reason:"MANIFEST_FILE_NOT_IN_SOURCE_SET"});continue}const got=sha256File(path.join(root,rel));if(got!==sha)failures.push({path:rel,reason:"HASH_MISMATCH",expected:sha,actual:got})}
 if(!entries.has("package-lock.json"))failures.push({path:"package-lock.json",reason:"LOCKFILE_NOT_IN_ARTIFACT_MANIFEST"});
 return {ok:failures.length===0,failures,entries};
}
export function crc32(data){return zlibCrc32(data)>>>0}
// //TR: Deterministik ZIP: sabit 1980-01-01 zaman damgası, sabit öznitelikler, extra alan ve yorum yok, byte sırasına göre giriş; DEFLATE yalnız daha küçükse, yoksa STORE. ZIP64 gerektiren boyutlar reddedilir.
const DOS_TIME=0,DOS_DATE=0x21;
export function writeDeterministicZip(entries,{deflate}){
 const names=entries.map(e=>e.name);if(names.some((n,i)=>i>0&&byteOrder(names[i-1],n)>=0))throw new Error("ZIP_ENTRIES_NOT_SORTED_OR_DUPLICATE");if(entries.length>65534)throw new Error("ZIP64_NOT_SUPPORTED_ENTRIES");
 const chunks=[],central=[];let offset=0;
 for(const {name,data} of entries){if(unsafeArtifactPath(name))throw new Error(`ZIP_UNSAFE_NAME:${name}`);if(data.length>=0xffffffff||offset>=0xffffffff)throw new Error("ZIP64_NOT_SUPPORTED_SIZE");
  const nameBuf=Buffer.from(name,"utf8"),utf8=/[^\x20-\x7e]/.test(name)?0x0800:0,crc=crc32(data),packed=deflate(data),method=packed.length<data.length?8:0,body=method===8?packed:data;
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(utf8,6);lh.writeUInt16LE(method,8);lh.writeUInt16LE(DOS_TIME,10);lh.writeUInt16LE(DOS_DATE,12);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nameBuf.length,26);lh.writeUInt16LE(0,28);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(utf8,8);ch.writeUInt16LE(method,10);ch.writeUInt16LE(DOS_TIME,12);ch.writeUInt16LE(DOS_DATE,14);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(nameBuf.length,28);ch.writeUInt32LE(offset,42);
  chunks.push(lh,nameBuf,body);central.push(ch,nameBuf);offset+=30+nameBuf.length+body.length}
 const cd=Buffer.concat(central);if(offset+cd.length>=0xffffffff)throw new Error("ZIP64_NOT_SUPPORTED_SIZE");
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...chunks,cd,end]);
}
// //TR: ZIP merkezi dizinini okur; çoklu disk, ZIP64, yorum, şifreleme, data descriptor, bilinmeyen sıkıştırma, yinelenen/büyük-küçük harf çakışan ve güvensiz giriş adı fail-closed reddedilir.
export function readZipCentralDirectory(buf){
 if(buf.length<22)throw new Error("ZIP_TOO_SHORT");const e=buf.length-22;if(buf.readUInt32LE(e)!==0x06054b50)throw new Error("ZIP_EOCD_NOT_AT_END_OR_COMMENT_PRESENT");
 if(buf.readUInt16LE(e+4)!==0||buf.readUInt16LE(e+6)!==0)throw new Error("ZIP_MULTI_DISK");const count=buf.readUInt16LE(e+10),size=buf.readUInt32LE(e+12),start=buf.readUInt32LE(e+16);if(count===0xffff||size===0xffffffff||start===0xffffffff)throw new Error("ZIP64_NOT_SUPPORTED");if(start+size!==e)throw new Error("ZIP_CENTRAL_DIRECTORY_BOUNDS");
 const out=[],seen=new Set();let p=start;for(let i=0;i<count;i++){if(buf.readUInt32LE(p)!==0x02014b50)throw new Error("ZIP_CENTRAL_HEADER");const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),crc=buf.readUInt32LE(p+16),csize=buf.readUInt32LE(p+20),usize=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),xl=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),offset=buf.readUInt32LE(p+42),name=buf.subarray(p+46,p+46+nl).toString("utf8");
  if(flags&0x0001)throw new Error(`ZIP_ENCRYPTED:${name}`);if(flags&0x0008)throw new Error(`ZIP_DATA_DESCRIPTOR:${name}`);if(![0,8].includes(method))throw new Error(`ZIP_METHOD:${name}`);if(unsafeArtifactPath(name))throw new Error(`ZIP_UNSAFE_NAME:${name}`);if(seen.has(name.toLowerCase()))throw new Error(`ZIP_DUPLICATE_OR_CASE_COLLISION:${name}`);seen.add(name.toLowerCase());
  out.push({name,flags,method,crc,csize,usize,offset});p+=46+nl+xl+cl}
 if(p!==e)throw new Error("ZIP_CENTRAL_DIRECTORY_TRAILING_BYTES");return out;
}
