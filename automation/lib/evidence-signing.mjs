// //TR: Bu helper Phase0'da oluşturulan Ed25519 control-plane key ile durable evidence/attestation imzalar ve verify eder; private key run loglarına veya model contextine girmez.
import fs from "node:fs";import crypto from "node:crypto";import {stableStringify} from "./atomic-json.mjs";
export function signEvidence(value,privateKeyFile){const key=fs.readFileSync(privateKeyFile);const payload=Buffer.from(stableStringify(value));return crypto.sign(null,payload,key).toString("base64")}
export function verifyEvidence(value,signature,publicKeyFile){const key=fs.readFileSync(publicKeyFile);return crypto.verify(null,Buffer.from(stableStringify(value)),key,Buffer.from(signature,"base64"))}
