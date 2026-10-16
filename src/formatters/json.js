/** JSON export: the unified schema verbatim, including inactive branches. */
export function toJson(conv) {
  return JSON.stringify(conv, null, 2) + '\n'
}
