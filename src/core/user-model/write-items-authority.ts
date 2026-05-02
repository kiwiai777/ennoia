// Authority comparison helper (extracted for testing)
// CT-0027-04

/**
 * 比��权威性��reflect > sync(deterministic) > sync(llm)
 * 返回 true 表��� newSource 更权���
 */
export function compareAuthority(newSource: string, existingSource: string): boolean {
  const rank = (s: string) => {
    if (s.startsWith('cli:reflect:')) return 3;
    if (s.startsWith('cli:sync:llm:')) return 1;
    if (s.startsWith('cli:sync:')) return 2;
    return 0;
  };
  return rank(newSource) > rank(existingSource);
}
