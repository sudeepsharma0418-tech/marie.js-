/**
 * Companions mark the memories they used with [[Memory title]] at the end of a
 * reply. These helpers split the marks from the text so they can be shown as tags.
 */
export function splitRefs(text: string) {
  const refs: string[] = [];
  let body = text.replace(/\[\[([^\]\n]{1,120})\]\]/g, (_, t: string) => {
    const title = t.trim();
    if (title && !refs.includes(title)) refs.push(title);
    return "";
  });
  // While a reply is still streaming in, hide a half written mark.
  body = body.replace(/\[\[[^\]\n]*$/, "");
  return { body: body.trimEnd(), refs };
}

export const stripRefs = (text: string) => splitRefs(text).body;
