// Privacy check of a Replay_File before it is public (R27.15, task 17.6): secret patterns, private facts and
// given site values. Only rule names are reported, never the matched text.
import { findSecretPatterns } from "./secretPatterns.ts";
export const PRIVATE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Windows drive path", re: /\b[A-Za-z]:\\\\/ },
  { name: "macOS home path", re: /\/Users\/[A-Za-z0-9._-]+/ },
  { name: "Linux home path", re: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "private VPN address (100.64.0.0/10)", re: /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/ },
  { name: "e-mail address", re: /\b[A-Za-z0-9._%+-]+@(outlook|gmail|qq|163|hotmail|icloud)\.com\b/i },
];

/** Problem names in a Replay text: secret patterns, private patterns and site values (named by position only). */
export function privacyProblems(text: string, site: readonly string[]): string[] {
  return [
    ...findSecretPatterns(text).map((n) => `secret pattern: ${n}`),
    ...PRIVATE_PATTERNS.filter((p) => p.re.test(text)).map((p) => `private: ${p.name}`),
    ...site.flatMap((v, i) => (text.includes(v) ? [`private: site value ${i + 1}`] : [])),
  ];
}
