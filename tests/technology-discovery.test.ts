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
