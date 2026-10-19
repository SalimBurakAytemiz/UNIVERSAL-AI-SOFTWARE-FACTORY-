// //TR: Canonical "tests" adimi 600 sn adim limitini asmamak icin sirali, bitisik kabuklara (tests, tests-2, tests-3, ...) bolunebilir. Bu yardimci kabuklarin dosya argumanlarini config sirasiyla birlestirerek TEK mantiksal test listesini verir; boylece "B4'ten hemen sonra B5", "ps1b cifti bitisik", "her dosya tam bir kez" gibi sira/teklik kurallari kabuk sinirindan bagimsiz ayni anlamla denetlenir. Tek "tests" adimi (bolunmemis) da gecerli bir girdidir.
export type ValidationStep = {id: string; command: string[]; platforms?: unknown};
export const isTestShardId = (id: string): boolean => id === "tests" || /^tests-([2-9]|[1-9]\d+)$/.test(id);
export const shardIdAt = (i: number): string => (i === 0 ? "tests" : `tests-${i + 1}`);
export function testShardSteps(cfg: {steps: ValidationStep[]}): ValidationStep[] {
  return cfg.steps.filter((s) => isTestShardId(s.id));
}
const fileArgs = (s: ValidationStep): string[] => s.command.slice(s.command.indexOf("run") + 1);
export function logicalTestFiles(cfg: {steps: ValidationStep[]}): string[] {
  return testShardSteps(cfg).flatMap(fileArgs);
}
// //TR: Yapisal kurallar: kabuk kimlikleri tam olarak tests, tests-2..tests-N sirasindadir; config icinde araya baska adim girmeden bitisiktir; hicbiri platform filtreli degildir ve hepsi incelenmis bagimlilik durumunu ister. Bos liste = kural ihlali yok.
export function checkTestShards(cfg: {steps: (ValidationStep & {requiresDependencies?: unknown})[]}): string[] {
  const errors: string[] = [];
  const idx = cfg.steps.map((s, i) => (isTestShardId(s.id) ? i : -1)).filter((i) => i >= 0);
  const shards = idx.map((i) => cfg.steps[i]);
  if (!shards.length) return ["no-tests-step"];
  shards.forEach((s, i) => { if (s.id !== shardIdAt(i)) errors.push(`shard-id-out-of-order:${s.id}@${i}`); });
  if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) errors.push("shards-not-contiguous");
  for (const s of shards) {
    if (Object.prototype.hasOwnProperty.call(s, "platforms")) errors.push(`shard-platform-filtered:${s.id}`);
    if (s.requiresDependencies !== true) errors.push(`shard-without-reviewed-dependencies:${s.id}`);
    if (s.command.slice(0, 3).join(" ") !== "node node_modules/vitest/vitest.mjs run") errors.push(`shard-not-canonical-vitest-run:${s.id}`);
    if (fileArgs(s).length === 0) errors.push(`shard-without-files:${s.id}`);
    if (fileArgs(s).some((a) => a.startsWith("-"))) errors.push(`shard-with-cli-flag:${s.id}`);
  }
  return errors;
}
