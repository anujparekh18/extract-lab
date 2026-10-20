/** Parses `a.b[2].c` into ["a", "b", 2, "c"]. */
export function parsePath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  for (const part of path.split(".")) {
    const match = part.match(/^([^[]*)((?:\[\d+\])*)$/);
    if (!match) {
      out.push(part);
      continue;
    }
    if (match[1]) out.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) out.push(Number(index[1]));
  }
  return out;
}

export function getAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** Returns a copy of `root` with `path` set to `next`, creating objects/arrays on the way. */
export function setAtPath(root: unknown, path: string, next: unknown): unknown {
  const segments = parsePath(path);
  const write = (node: unknown, index: number): unknown => {
    if (index === segments.length) return next;
    const segment = segments[index];
    if (typeof segment === "number") {
      const array = Array.isArray(node) ? [...node] : [];
      while (array.length < segment) array.push(null);
      array[segment] = write(array[segment], index + 1);
      return array;
    }
    const object = node && typeof node === "object" && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
    object[segment] = write(object[segment], index + 1);
    return object;
  };
  return write(root, 0);
}

