// Text helpers shared by server and web (pure).

/** Removes internal evidence and proposal ids ("[E3]", "(E1, E2)", "see E4", "P2") from text shown to the Judge (R11.13). */
export function stripIds(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text
    .replace(/\s*[[(](?:(?:E|P)\d+(?:\s*[,;/]\s*|\s+and\s+)?)+[\])]/g, () => (removed++, ""))
    .replace(/\s*\b(?:see\s+)?(?:evidence\s+)?[EP]\d+\b/gi, () => (removed++, ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])[.!?]+/g, "$1")
    .trim();
  return { text: out, removed };
}
