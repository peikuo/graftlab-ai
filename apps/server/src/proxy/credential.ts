// Per-Task proxy credential (design: LLM_Proxy, Secret redactor). Generated on the server, registered with the
// redactor before it is handed to any container, unregistered at Task end (the proxy is then removed, so a
// leaked value is useless).
import { randomBytes } from "node:crypto";
import type { SecretRegistry } from "@graftlab/shared";

export const PROXY_SECRET_NAME = "proxy_credential";

export function issueProxyCredential(secrets: SecretRegistry): string {
  const value = `glp_${randomBytes(32).toString("base64url")}`;
  secrets.register(PROXY_SECRET_NAME, value);
  return value;
}
