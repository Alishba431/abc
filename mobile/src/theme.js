// Broadcast-style dark palette used by every screen (high contrast, gold accent, red for LIVE).
export const theme = {
  navy: '#050913',
  primary: '#2563EB',
  primaryText: '#60A5FA',
  primarySoft: '#16223D',
  accent: '#FFC21A',
  live: '#E11D48',
  bg: '#070B16',
  card: '#111A2E',
  cardAlt: '#16223D',
  text: '#F8FAFC',
  muted: '#94A3B8',
  border: '#1F2B47',
  danger: '#DC2626',
  dangerText: '#FCA5A5',
  dangerSoft: '#3A1418',
  success: '#22C55E',
  successText: '#86EFAC',
  successSoft: '#0F2A1C',
  warning: '#F59E0B',
  warningSoft: '#33240A',
  radius: 16,
  space: (n) => n * 8,
  font: { body: 16, small: 14, title: 22, score: 52 },
  touch: 48,
  shadow: {
    shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
};

const CREST = ['#2563EB', '#DC2626', '#16A34A', '#9333EA', '#EA580C', '#0891B2', '#CA8A04', '#DB2777'];
export function crestColor(id = '') {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CREST[h % CREST.length];
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
