export const STATUS_LABEL = {
  upcoming: 'Upcoming', in_progress: 'Live', completed: 'Full time',
  postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled',
};
export const QUAL_LABEL = { clinched: 'Qualified', eliminated: 'Eliminated', still_possible: 'In contention' };

export function kickoffLabel(iso) {
  if (!iso) return 'Time to be confirmed';
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' · '
    + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const money = (minor) => `PKR ${(minor / 100).toFixed(2)}`;
