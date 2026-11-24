// Per-Task proxy credential (design: LLM_Proxy, Secret redactor). Generated on the server, registered with the
// redactor before it is handed to any container, unregistered at Task end (the proxy is then removed, so a
// leaked value is useless).
import { randomBytes } from "node:crypto";
import type { SecretRegistry } from "@graftlab/shared";

export const PROXY_SECRET_NAME = "proxy_credential";

export const PROXY_APP_SECRET_NAME = "proxy_app_credential";
export function issueProxyCredential(secrets: SecretRegistry, name = PROXY_SECRET_NAME): string {
  const value = `glp_${randomBytes(32).toString("base64url")}`;
  secrets.register(name, value);
  return value;
}
