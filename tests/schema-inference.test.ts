// //TR: Bu test sample'dan çıkarılan schema'nın contract diye yalan söylenmeyip INFERRED_CANDIDATE_NOT_CONTRACT provenance taşıdığını doğrular.
import { describe, expect, it } from "vitest";
import { inferSchemaCandidate } from "../core/qa/api/infer-schema-candidate.js";
describe("schema inference",()=>{it("marks candidate provenance",()=>expect(inferSchemaCandidate({id:1}).provenance).toBe("INFERRED_CANDIDATE_NOT_CONTRACT"));});
