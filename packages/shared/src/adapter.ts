// Adapter contract (design.md, "Adapter contract"; R13.3, R39.10, Open item 41). Everything the Studio needs from one
// target software. Declarative values live in adapters/<id>/adapter.json (validated by AdapterJsonSchema at server
// start); hooks are code in adapters/<id>/index.ts. Studio modules use only these types.
// Deliberately absent: any build or start procedure for the MODIFIED target (R39.10). The schema is strict, so an
// adapter.json that carries such a field (or any unknown field) is refused.
import { z } from "zod";

const text = z.string().trim().min(1);
const digestRef = z.string().regex(/@sha256:[0-9a-f]{64}$/, "pinned by digest");
export const EndpointSchema = z.object({ method: z.enum(["GET", "POST", "PATCH", "PUT"]), path: text.regex(/^\//), query: z.record(z.string(), z.string()).optional() }).strict();
export type Endpoint = z.infer<typeof EndpointSchema>;

export const AdapterJsonSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,40}$/),
    match: z.object({ owner: text, repo: text }).strict(),
    source: z.object({ upstreamUrl: z.string().url(), releaseTag: text, commit: z.string().regex(/^[0-9a-f]{40}$/) }).strict(),
    baseline: z
      .object({
        image: digestRef,
        platformManifestDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
        configDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
        port: z.number().int().min(1).max(65535),
        healthPath: text.regex(/^\//),
        env: z.record(z.string(), z.string()),
        secretEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
        dataVolumePath: text.regex(/^\//),
        readinessTimeoutS: z.number().int().positive().max(600),
      })
      .strict(),
    api: z
      .object({
        read: z.array(EndpointSchema).min(1),
        write: z.array(EndpointSchema.extend({ op: z.string().regex(/^[a-z_]+$/) }).strict()),
        itemCap: z.number().int().positive().max(10), // may lower GL_DEMO_CASE_MAX_ITEMS (10), never raise it (R18.11)
        /** How Studio code adds a provisioned credential to target requests (the credential is named by provision). */
        auth: z.object({ header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/), prefix: z.string().max(20), credential: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/) }).strict(),
      })
      .strict(),
    devSandbox: z
      .object({
        baseImage: digestRef,
        preinstalled: z.array(text),
        /** Shell file next to adapter.json, run at image build in the pinned unmodified source (dependencies only). */
        dependencySetup: text.regex(/^[A-Za-z0-9._/-]+\.sh$/).refine((p) => !p.split("/").includes(".."), "inside the Adapter directory"),
        /** Directories put in front of PATH in the image. */
        path: z.array(text.regex(/^\/[A-Za-z0-9._/-]*$/)),
        /** Toolchain environment in the development, test and run containers (for example: use the preinstalled venv, no package sync). */
        env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string()).default({}),
        /** Gitignored dependency and build output copied from /opt/target-src into the Worktree at sandbox start. */
        prebuilt: z.array(text.regex(/^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/).refine((p) => !p.split("/").includes(".."), "relative, inside the source")),
      })
      .strict(),
    /** How Studio code logs in for browser checks; the values come from the generated secretEnv names. */
    browserLogin: z.object({ path: text.regex(/^\//), usernameLabel: text, passwordLabel: text, submitLabel: text, usernameEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/), passwordEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }).strict().optional(),
    testSelectionHint: text,
    /** The whole suite for the Regression_Check (R22.10): the command, the output parser, the time limit. */
    regression: z.object({ suite: z.array(text).min(1), format: z.literal("django"), timeoutS: z.number().int().positive().max(3600) }).strict().optional(),
    testData: text, // file name of the fixed test data set next to adapter.json
    runtimeRulesChecklist: text,
  })
  .strict();
export type AdapterJson = z.infer<typeof AdapterJsonSchema>;

/** One item of the target as the comparator sees it (for linkding: a bookmark). */
export type TargetItem = Record<string, unknown>;
/** What an `api_readback` check expects for one item (key and fields as the Adapter defines them). */
export interface Expectation {
  key: string;
  mustExist: boolean;
  fields: Record<string, unknown>;
}
/** One per-item result, the unit of every Verifier result (R22). */
export interface ItemResult {
  item: string;
  pass: boolean;
  expected: string;
  actual: string;
}
/** A credential created by provisioning; the value is registered with the redactor before use (R13.5). */
export interface TargetCredential {
  name: string;
  value: string;
}
/** HTTP access to the running baseline through its relay; every call is checked against the allow-list by the caller. */
export interface TargetClient {
  request(method: Endpoint["method"], path: string, body?: unknown): Promise<{ status: number; json: unknown }>;
}
/** The running baseline container, as the provisioning and reset hooks see it. */
export interface BaselineHandle {
  /** Runs a command inside the container (no shell interpolation of Studio values); returns stdout. */
  exec(cmd: string[], opts?: { workdir?: string; env?: Record<string, string> }): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Replaces the container with a fresh one on a fresh data volume and waits for readiness (reset and restore). */
  recreate(): Promise<void>;
  /** The generated secret environment values of this start (for example the superuser name). */
  secretEnv: Record<string, string>;
  /** Where the app's code lives in this container (the baseline image's own directory, or /tmp/app in a Run_Environment). */
  appDir: string;
}
/** The hooks an Adapter implements in code (adapters/<id>/index.ts). */
export interface AdapterHooks {
  provision(b: BaselineHandle): Promise<TargetCredential[]>;
  testData: {
    seed(c: TargetClient): Promise<void>;
    reset(b: BaselineHandle): Promise<void>;
    equals(c: TargetClient): Promise<ItemResult[]>;
  };
  /** Schema of the fields of a Demo_Case item and of an expectation (R18.10). */
  itemFields: z.ZodType;
  comparator: {
    key(item: TargetItem): string;
    compare(expect: Expectation, readBack: TargetItem[], preState: TargetItem[]): ItemResult;
  };
  /** Reads every item through the read endpoints (all pages), for the readback check and the equality check. */
  readAll(c: TargetClient): Promise<TargetItem[]>;
}
export interface Adapter extends AdapterJson {
  hooks: AdapterHooks;
}
/**
 * The fields an Adapter must never carry: a build or start procedure for the modified target (R39.10). A field name
 * is split into its camelCase or snake_case words; a field is refused when one word names such a procedure
 * ("startCommand", "build_script", "entrypoint"), so "runtimeRulesChecklist" is fine.
 */
const FORBIDDEN_WORDS = new Set(["start", "run", "build", "launch", "serve", "command", "cmd", "entrypoint", "script", "recipe"]);
export function isForbiddenAdapterField(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .some((w) => FORBIDDEN_WORDS.has(w.toLowerCase()));
}
