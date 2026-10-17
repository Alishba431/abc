// One palette and spacing scale for every screen; tenant branding overrides primary/accent.
export const theme = {
  primary: '#0B5FFF',
  accent: '#FFB800',
  bg: '#F5F7FB',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#4B5563',
  border: '#D1D5DB',
  danger: '#B42318',
  success: '#067647',
  warning: '#B54708',
  radius: 12,
  space: (n) => n * 8,
  font: { body: 16, small: 14, title: 22, score: 40 },
  touch: 48,
};
