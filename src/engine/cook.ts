// Kahn order, then a family partition.
// Wires never cross families, so a CHOP is not a POP's ancestor. CHOPs still
// cook first in the frame: op('e_amp')['chan1'] on a POP reads this frame.
// A CHOP expression that names a CHOP it is not upstream of reads the previous frame.

export function topo(ids: string[], edges: { source: string; target: string }[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!indeg.has(edge.source) || !indeg.has(edge.target)) continue;
    next.get(edge.source)?.push(edge.target);
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const child of next.get(id) ?? []) {
      const left = (indeg.get(child) ?? 1) - 1;
      indeg.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  return order.length === ids.length ? order : ids;
}

/** Topo order with every CHOP before every POP before every TOP. */
export function cookOrder(ids: string[], familyOf: (id: string) => string, edges: { source: string; target: string }[]): string[] {
  const order = topo(ids, edges);
  const take = (...families: string[]) => order.filter((id) => families.includes(familyOf(id)));
  const known = new Set(["CHOP", "POP", "MAT", "COMP", "TOP"]);
  return [...take("CHOP"), ...take("POP"), ...take("MAT", "COMP"), ...take("TOP"), ...order.filter((id) => !known.has(familyOf(id)))];
}
