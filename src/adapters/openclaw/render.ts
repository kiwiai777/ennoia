export interface UserModelItem {
  kind: 'goal' | 'preference' | 'constraint' | string;
  label: string;
}

export function renderUserModelToNaturalLanguage(items: UserModelItem[]): string {
  if (!items || items.length === 0) {
    return '';
  }

  const lines = items.map(item => {
    const content = item.label.replace(/^[-*]\s+/, '').trim();
    const hasChinese = /[\u4e00-\u9fff]/.test(content);

    if (hasChinese) {
      switch (item.kind) {
        case 'preference':
          return `用户偏好 ${content}。`;
        case 'goal':
          return `用户的目标是 ${content}。`;
        case 'constraint':
          return `用户要求 ${content}。`;
        default:
          return `用户备注：${content}。`;
      }
    } else {
      switch (item.kind) {
        case 'preference':
          return `The user prefers ${content}.`;
        case 'goal':
          return `The user's goal is to ${content}.`;
        case 'constraint':
          return `The user requires that ${content}.`;
        default:
          return `The user has noted: ${content}.`;
      }
    }
  });

  return lines.join('\n');
}
