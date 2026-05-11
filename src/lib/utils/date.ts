/**
 * Date helpers — all assume ISO YYYY-MM-DD strings for "dates without time".
 */

const FR_WEEKDAY = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const FR_MONTH = [
  'Jan',
  'Fév',
  'Mar',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Août',
  'Sep',
  'Oct',
  'Nov',
  'Déc'
];

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Is the airDate (ISO YYYY-MM-DD) on or before the reference day? */
export function isReleased(airDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!airDate) return false;
  return airDate <= todayIso(now);
}

/** Difference in whole days between airDate and reference (positive = future). */
export function daysFromNow(airDate: string, now: Date = new Date()): number {
  const a = new Date(`${airDate}T00:00:00Z`);
  const b = new Date(`${todayIso(now)}T00:00:00Z`);
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function formatDayShortFr(date: string | Date): { weekday: string; day: number } {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  return {
    weekday: FR_WEEKDAY[d.getUTCDay()],
    day: d.getUTCDate()
  };
}

export function formatDateShortFr(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  return `${d.getUTCDate()} ${FR_MONTH[d.getUTCMonth()]}`;
}

export function relativeFr(airDate: string, now: Date = new Date()): string {
  const d = daysFromNow(airDate, now);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Demain';
  if (d === -1) return 'Hier';
  if (d > 0) return `+${d}j`;
  return `${d}j`;
}
