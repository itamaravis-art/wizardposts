/**
 * cn — small className merger.
 * Accepts strings, falsy values, arrays, and { className: boolean } objects.
 * Intentionally dependency-free — does NOT do tailwind-merge conflict resolution.
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (val: ClassValue) => {
    if (!val) return;
    if (typeof val === 'string' || typeof val === 'number') {
      out.push(String(val));
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) walk(v);
      return;
    }
    if (typeof val === 'object') {
      for (const key in val) {
        if (val[key]) out.push(key);
      }
    }
  };

  for (const i of inputs) walk(i);
  return out.join(' ');
}

export default cn;
