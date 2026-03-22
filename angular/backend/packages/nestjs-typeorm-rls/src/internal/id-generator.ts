let counter = 0;

export function generateUniqueKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${++counter}`;
}
