// Same hues and initials as the mobile app's TeamBadge, one shade darker so white initials meet WCAG AA (>= 4.5:1).
const CREST = ['#1D4ED8', '#B91C1C', '#15803D', '#7E22CE', '#C2410C', '#0E7490', '#A16207', '#BE185D'];
function crestColor(id = '') {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CREST[h % CREST.length];
}
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
module.exports = { crestColor, initials };
