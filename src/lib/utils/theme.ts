export type ThemeChoice = 'auto' | 'light' | 'dark';

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'auto') return prefersDark ? 'dark' : 'light';
  return choice;
}

export function applyTheme(theme: 'light' | 'dark', doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
}
