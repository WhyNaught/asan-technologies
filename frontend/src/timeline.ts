// SI was at least partially used to write the code in this file
export interface TimelineState { start: number; end: number; index: number; playing: boolean; speed: number; step: 1 | 12 }
export function advance(t: TimelineState): number { return t.index + t.step > t.end ? t.start : Math.max(t.start, t.index + t.step); }
export function adjustPeriodEndpoint(start: number, end: number, changed: 'start' | 'end'): [number, number] {
  if (changed === 'start' && start > end - 2) {
    if (start > 117) throw new Error('The selected start month needs at least two later months in the study period.');
    end = start + 2;
  } else if (changed === 'end' && end < start + 2) {
    if (end < 2) throw new Error('The selected end month needs at least two earlier months in the study period.');
    start = end - 2;
  }
  return [start, end];
}
export function setPeriod(t: TimelineState, start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 119 || start > end - 2) throw new Error('Select at least three months between 2015 and 2024.');
  t.start = start; t.end = end; t.index = Math.max(start, Math.min(end, t.index));
}
