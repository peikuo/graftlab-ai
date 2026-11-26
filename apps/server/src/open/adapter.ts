// Open execution (R42): the Adapter Studio code generates for a repository without one, so the existing development
// stage can run on it. It has no browser login, no API, no regression suite and no AI client library, and its hooks
// do nothing: the app is never started, so every check is a test run.
import type { Adapter, ItemResult } from "@graftlab/shared";
import { z } from "zod";
import { openDevEnv, type EnvironmentProposal } from "./env.ts";

export function openAdapterId(owner: string, repo: string): string {
  return `open-${`${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 40).replace(/-+$/, "");
}

export function openAdapter(o: { owner: string; repo: string; commit: string; image: string; proposal: EnvironmentProposal }): Adapter {
  const { env, prebuilt } = openDevEnv(o.proposal);
  const none = async (): Promise<ItemResult[]> => [];
  return {
    id: openAdapterId(o.owner, o.repo),
    match: { owner: o.owner, repo: o.repo },
    source: { upstreamUrl: `https://github.com/${o.owner}/${o.repo}`, releaseTag: "open-execution", commit: o.commit },
    baseline: { image: o.image, port: 1, healthPath: "/", env: {}, secretEnv: [], dataVolumePath: "/data", readinessTimeoutS: 1 },
    api: { read: [{ method: "GET", path: "/" }], write: [], itemCap: 1, auth: { header: "Authorization", prefix: "", credential: "none" } },
    devSandbox: { baseImage: o.image, preinstalled: [`${o.proposal.language} dependencies from the confirmed proposal`], dependencySetup: "setup.sh", path: [], env, prebuilt },
    testSelectionHint: `Run tests with: ${o.proposal.test.join(" ")} (in /work, without internet)`,
    environmentFacts: `Open execution without an Adapter (R42): the app is not started and there is no demonstration; every acceptance check is a test_suite check run in /work without internet, for example \`${o.proposal.test.join(" ")}\``,
    testData: "none",
    runtimeRulesChecklist: "none",
    hooks: {
      provision: async () => [],
      testData: { seed: async () => {}, reset: async () => {}, equals: none },
      itemFields: z.object({}),
      comparator: { key: () => "", compare: () => ({ item: "none", pass: false, expected: "", actual: "no Adapter" }) },
      readAll: async () => [],
    },
  };
}
