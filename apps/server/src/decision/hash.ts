// Content hash of a Decision_Doc version (R16.5): sha256 hex over the canonical JSON of the content only.
import { createHash } from "node:crypto";
import { canonicalJson } from "@graftlab/shared";

export const contentHash = (content: unknown): string => createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
