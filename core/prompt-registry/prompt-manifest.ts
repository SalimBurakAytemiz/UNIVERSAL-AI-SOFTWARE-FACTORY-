// //TR: UASCO-T0117 istem manifesti: istem kimliği -> kaynak + YALNIZ EKLENEN sürüm geçmişi (sürüm, sha256). İçerik değişince son sürüm yeniden yazılmaz; yeni bir {version: n+1, sha256} eklenir.
// tests/support/prompt-versioning-t0117.cases.ts güncel içeriği bu manifestle karşılaştırır ve sürüm artırılmadan yapılan her içerik değişikliğinde düşer (önerilen yeni manifesti yazdırır).
import type {PromptManifest} from "./versioning.js";

export const PROMPT_MANIFEST: PromptManifest = Object.freeze({
    "schemaVersion": 1,
    "prompts": {
      "cloud.planner": {
        "source": "core/cloud/task-orchestrator.ts#plannerPrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "b9d727ca0fe7f443857cb7557cb62f4d4c053fa3fc19983af1cf1d3e8a5a463f"
          }
        ]
      },
      "factory.auto-builder": {
        "source": "prompts/AUTO-BUILDER.md",
        "versions": [
          {
            "version": 1,
            "sha256": "5fa5708dea98cc105024631003abb7ed9a4c15921ca1caba748daa6947a7a81a"
          }
        ]
      },
      "factory.auto-remediation": {
        "source": "prompts/AUTO-REMEDIATION.md",
        "versions": [
          {
            "version": 1,
            "sha256": "a06e0d860df775dfe20f172a6d01e8f79f68145ecfc35adf1cadb1e9779edff3"
          }
        ]
      },
      "factory.auto-review": {
        "source": "prompts/AUTO-REVIEW.md",
        "versions": [
          {
            "version": 1,
            "sha256": "832448c5855218072348e3053601b1e1a2838b51bf01c95f8ecedd26af7e2170"
          }
        ]
      },
      "factory.auto-validation-fix": {
        "source": "prompts/AUTO-VALIDATION-FIX.md",
        "versions": [
          {
            "version": 1,
            "sha256": "214849b0fdbfcafca6cecf04de0cebea24a484a0a93bfc6fd0da69aea1a0b1a2"
          }
        ]
      },
      "factory.claude-reviewer-system": {
        "source": "prompts/CLAUDE-REVIEWER-SYSTEM.md",
        "versions": [
          {
            "version": 1,
            "sha256": "3c4e916aa030a10d1c52fa79275e2648307a571751756058791a2d57e7d14762"
          }
        ]
      },
      "factory.governed-frozen-bundle-review": {
        "source": "prompts/GOVERNED-FROZEN-BUNDLE-REVIEW.txt",
        "versions": [
          {
            "version": 1,
            "sha256": "284d20bd330f92a31a821053958ec833cdfd9300bdd60f734e41a6dc5eb8949c"
          }
        ]
      },
      "factory.release-audit-review": {
        "source": "prompts/RELEASE-AUDIT-REVIEW.txt",
        "versions": [
          {
            "version": 1,
            "sha256": "2a742f32eb1eb68269ecd9ace00123b441006bc647cf442f451671c4e39c80f4"
          }
        ]
      },
      "predev.role.Architecture": {
        "source": "core/workos/predev/role-prompts.ts#composeRolePrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "914f53bfbb3c783e8f64c419007a0e81c6933ca0974d62a949c374d6be1af016"
          }
        ]
      },
      "predev.role.BusinessAnalysis": {
        "source": "core/workos/predev/role-prompts.ts#composeRolePrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "277cb709790bd3b1304d26b951b1808c858251ef49eeae1cc412de52cb08b3a1"
          }
        ]
      },
      "predev.role.Plan": {
        "source": "core/workos/predev/role-prompts.ts#composeRolePrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "eb1d3c6e349e29785291fca68cf8c06ceb31f66557df6e044569d2c9c080ffd4"
          }
        ]
      },
      "predev.role.Requirements": {
        "source": "core/workos/predev/role-prompts.ts#composeRolePrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "f36187bf1517b86c7c5850ee2c7f53045d04c323e1ba5f4469ca4096453755a3"
          }
        ]
      },
      "predev.role.UxSpec": {
        "source": "core/workos/predev/role-prompts.ts#composeRolePrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "21413522fdd966f83bc5ed6c394fa9e1f75aaa1e80aa750686791bb82d1b3f45"
          }
        ]
      },
      "workos.executor.implement": {
        "source": "core/workos/executors.ts#implementPrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "2e8c4577e0920e518e84aa142015021da1e223a242a376ad1e682ead693a5c0f"
          }
        ]
      },
      "workos.executor.review": {
        "source": "core/workos/executors.ts#reviewPrompt",
        "versions": [
          {
            "version": 1,
            "sha256": "37db44ebee212c528bdb6916afc09d1e6ad7a9e87368c37e122339d2269cc386"
          }
        ]
      }
    }
  }
) as PromptManifest;
