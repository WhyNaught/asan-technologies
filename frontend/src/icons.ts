const paths: Record<string, string> = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
  area: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/><path d="M8 8h8v8H8z"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 5v6h6"/>',
  play: '<path d="m9 5 10 7-10 7V5Z"/>', pause: '<path d="M9 5v14M15 5v14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', chevron: '<path d="m8 10 4 4 4-4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  compare: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  expand: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
  chart: '<path d="M4 4v16h16M7 15l4-5 4 3 5-7"/>',
  check: '<path d="m5 12 4 4L19 6"/>', tilt: '<path d="m3 17 7-11 11 11H3Zm7-11 3 11"/>',
};
export function icon(name: string) { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.globe}</svg>`; }
