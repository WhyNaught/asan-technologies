// SI was at least partially used to write the code in this file
export interface TourStep { title: string; body: () => string; run?: () => Promise<void> | void }
let steps: TourStep[] = [], index = 0, token = 0;
const card = () => document.querySelector<HTMLElement>('#tour')!;
export function startTour(next: TourStep[]) { steps = next; index = 0; void show(); }
export function stopTour() { token++; card().hidden = true; document.body.classList.remove('touring'); }
async function show() {
  const mine = ++token, step = steps[index], el = card();
  el.hidden = false; document.body.classList.add('touring');
  el.innerHTML = `<div class="tour-progress" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= index ? 'on' : ''}"></i>`).join('')}</div><p class="tour-count">Detective tour · ${index + 1} of ${steps.length}</p><h2 tabindex="-1">${step.title}</h2><div class="tour-body"><p>Loading…</p></div><div class="tour-actions"><button class="text-button" data-tour="stop">Skip tour</button><span></span>${index ? '<button class="text-button" data-tour="back">Back</button>' : ''}<button class="primary" data-tour="next" disabled>${index === steps.length - 1 ? 'Start investigating' : 'Next'}</button></div>`;
  try { await step.run?.(); } catch (e) { if (mine === token) el.querySelector('.tour-body')!.innerHTML = `<p>${(e as Error).message}</p>`; }
  if (mine !== token) return;
  el.querySelector('.tour-body')!.innerHTML = step.body();
  el.querySelector<HTMLButtonElement>('[data-tour=next]')!.disabled = false;
  el.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true });
}
document.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-tour]')?.dataset.tour;
  if (!action) return;
  if (action === 'stop' || (action === 'next' && index === steps.length - 1)) return stopTour();
  index += action === 'next' ? 1 : -1; void show();
});
