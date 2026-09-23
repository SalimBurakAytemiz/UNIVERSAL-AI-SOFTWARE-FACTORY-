// //TR: Bu validator 363 rolün semantic requirement, role-specific primary technology, teknoloji-derinlik eşleşmesi ve kritik uzmanlık must-have setlerini tüm katalog üzerinde doğrular.
import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const profiles=read("registries/agent-competency-v2.json").agents;
const requirements=read("registries/agent-semantic-requirements.json").requirements;
const technologies=new Set(read("registries/technologies.json").technologies.map(x=>x.id));
const depthRows=read("registries/technology-agent-depth.json").assignments;
if(profiles.length!==363||requirements.length!==363) throw new Error("363-agent semantic registry incomplete");
const pm=new Map(profiles.map(x=>[x.agentId,x]));
const depth=new Map(depthRows.map(x=>[`${x.agentId}|${x.technologyId}`,x]));
for(const q of requirements){
  const a=pm.get(q.agentId); if(!a) throw new Error(`Missing profile ${q.agentId}`);
  for(const requiredId of q.requiredPrimaryTechnologyIds??[]){
    if(!technologies.has(requiredId)) throw new Error(`Unknown required technology ${requiredId} for ${q.agentId}`);
    if(!(a.primaryTechnologyIds??[]).includes(requiredId)) throw new Error(`Agent ${q.agentId} missing required primary technology ${requiredId}`);
  }
  for(const id of a.primaryTechnologyIds??[]){
    if(!technologies.has(id)) throw new Error(`Unknown technology ${id} for ${q.agentId}`);
    const d=depth.get(`${q.agentId}|${id}`);
    if(!d||d.relationship!=="PRIMARY_MASTERY") throw new Error(`Agent ${q.agentId} lacks primary depth row for ${id}`);
    for(const axis of ["fundamentals","implementation","debugging","testing","architecture","interoperability","security","performance","operations","migrationUpgrade","review","technologySelection"]){
      if(!Number.isInteger(d.depth?.[axis])||d.depth[axis]<0||d.depth[axis]>7) throw new Error(`Agent ${q.agentId} invalid ${axis} depth for ${id}`);
    }
  }
  if(q.technicalAgent&&!q.technologyAgnosticAllowed&&(a.primaryTechnologyIds??[]).length<q.minimumPrimaryTechnologyCount) throw new Error(`Technical role ${q.agentId} lacks primary technology`);
  if(q.technologyAgnosticAllowed&&!a.technologyAgnosticReason) throw new Error(`Agnostic role ${q.agentId} missing rationale`);
}
const must={
  "021":["TECH-TYPESCRIPT","TECH-JAVA","TECH-PYTHON","TECH-GO","TECH-RUST"],
  "024":["TECH-WEBSOCKET","TECH-SOCKETIO","TECH-GRPC","TECH-KAFKA"],
  "030":["TECH-TYPESCRIPT","TECH-REACT","TECH-NEXTJS"],
  "035":["TECH-TYPESCRIPT","TECH-FASTIFY","TECH-NESTJS"],
  "043":["TECH-POSTGRESQL","TECH-MYSQL","TECH-MONGODB","TECH-REDIS"],
  "050":["TECH-KOTLIN","TECH-SWIFT","TECH-FLUTTER","TECH-REACT-NATIVE","TECH-KOTLIN-MULTIPLATFORM"],
  "051":["TECH-KOTLIN","TECH-ANDROID-SDK","TECH-JETPACK-COMPOSE","TECH-KOTLIN-COROUTINES"],
  "052":["TECH-SWIFT","TECH-SWIFTUI","TECH-UIKIT","TECH-XCTEST"],
  "053":["TECH-DART","TECH-FLUTTER"],
  "054":["TECH-REACT-NATIVE","TECH-HERMES","TECH-REACT-NATIVE-JSI"],
  "096":["TECH-OPENAPI","TECH-JSON-SCHEMA","TECH-POSTMAN","TECH-NEWMAN","TECH-AJV"],
  "098":["TECH-WEBSOCKET","TECH-SOCKETIO","TECH-SIGNALR","TECH-GRPC","TECH-MQTT","TECH-KAFKA","TECH-NATS"],
  "108":["TECH-K6","TECH-JMETER","TECH-LOCUST","TECH-GATLING"],
  "132":["TECH-OWASP-ASVS","TECH-OWASP-WSTG","TECH-OWASP-API","TECH-CWE","TECH-CVSS"],
  "142":["TECH-DOCKER","TECH-KUBERNETES","TECH-HELM","TECH-TERRAFORM"],
  "148":["TECH-OPENTELEMETRY","TECH-PROMETHEUS","TECH-GRAFANA"],
  "210":["TECH-UNREAL-ENGINE","TECH-CPP"],
  "211":["TECH-UNITY"],
  "212":["TECH-GODOT"],
  "228":["TECH-CPP","TECH-RUST-EMBEDDED","TECH-FREERTOS","TECH-ZEPHYR","TECH-PLATFORMIO"],
  "229":["TECH-MQTT","TECH-ZEPHYR"],
  "232":["TECH-ROS2","TECH-CPP","TECH-PYTHON"]
};
for(const [id,ids] of Object.entries(must)){
  const a=pm.get(id); for(const x of ids) if(!a.primaryTechnologyIds.includes(x)) throw new Error(`Agent ${id} missing ${x}`);
}
console.log(`AGENT_SEMANTIC_VALIDATION: PASS agents=363 technical=${profiles.filter(x=>x.technicalAgent).length} depthRows=${depthRows.length}`);
