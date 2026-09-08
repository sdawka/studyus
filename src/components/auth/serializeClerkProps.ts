const htmlSafeEscapes: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function serializeClerkProps(props: Record<string, unknown>): string {
  return (JSON.stringify(props) ?? '{}').replace(/[<>&\u2028\u2029]/g, (character) => htmlSafeEscapes[character]);
}
