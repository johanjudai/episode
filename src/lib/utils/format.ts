export function formatEpisodeCode(season: number, episode: number): string {
  const s = String(season).padStart(2, '0');
  const e = String(episode).padStart(2, '0');
  return `S${s}E${e}`;
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  return `${minutes} min`;
}

export function formatTotalTime(totalMinutes: number): { value: number; unit: 'min' | 'h' } {
  if (totalMinutes < 60) return { value: totalMinutes, unit: 'min' };
  return { value: Math.round(totalMinutes / 60), unit: 'h' };
}

export function seriesInitials(name: string): string {
  const cleaned = name.replace(/[^a-zA-ZÀ-ÿ0-9 ]+/g, '').trim();
  if (!cleaned) return '??';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function initialOf(name: string): string {
  return seriesInitials(name).slice(0, 1);
}
