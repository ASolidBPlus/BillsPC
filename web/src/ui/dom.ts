/**
 * Tiny DOM helper shared by every ui/ module. Kept private (no `__tests__/`
 * cross-import) so it can churn freely.
 */
export function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | Node)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === 'string') e.append(document.createTextNode(c));
    else e.append(c);
  }
  return e;
}

export function img(attrs: Record<string, string> = {}): HTMLImageElement {
  const i = document.createElement('img');
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}
