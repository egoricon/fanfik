// Minimal line-art chapter icons, 48x48 viewBox, stroke-based "manga sketch" style.
const ICONS = {
  spill: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 8h10l-1.5 20a3.5 5 0 01-7 0L17 8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M16 8h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M27 22c3 1 6 4 7 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="0.5 4"/>
    <circle cx="37" cy="33" r="1.6" fill="currentColor"/>
    <circle cx="40.5" cy="38" r="1.1" fill="currentColor"/>
    <path d="M31 32c1.5 2 2 4.5 1 7-1.2 3-4.4 3.6-5.8.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,
  laptop: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="12" width="28" height="18" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
    <path d="M6 34h36l-3 4H9l-3-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M15 24l4-4 4 4M25 26l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  voice: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="7" width="12" height="20" rx="6" stroke="currentColor" stroke-width="1.6"/>
    <path d="M12 22a12 12 0 0024 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M24 34v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M17 40h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M35 15c2.5 2.5 2.5 8 0 10.5M39 12c4.5 4.5 4.5 14 0 18.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>
  </svg>`,
  clock: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="22" cy="26" r="13" stroke="currentColor" stroke-width="1.6"/>
    <path d="M22 18v8l6 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18 6h8M22 6v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M35 15l3-3M9 15l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,
  exam: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 6h18l6 6v30H12V6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M30 6v6h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M17 20h14M17 26h14M17 32h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M32 30l5 5-10 10-5.5 1.5L23 41l9-9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
  </svg>`,
  mandarin: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="23" cy="27" r="14" stroke="currentColor" stroke-width="1.6"/>
    <path d="M23 13c-2 3-2 8 0 11M23 13c2 3 2 8 0 11" stroke="currentColor" stroke-width="1.1" opacity="0.6"/>
    <path d="M23 13v-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M23 8c3-3 7-3 9-1-2 3-6 4-9 1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`,
  moon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M31 8a16 16 0 100 30 13 13 0 01-9-13c0-8 5-13.5 9-17z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M10 14l1.4 3.2L14.5 18l-3.1 1.3L10 22.5l-1.3-3.2L5.5 18l3.2-.8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="37" cy="30" r="1.3" fill="currentColor"/>
  </svg>`,
  pot: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 22h28l-2.5 15a3 3 0 01-3 2.5H15.5a3 3 0 01-3-2.5L10 22z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8 22h32" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M6 19l4 3M42 19l-4 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M18 15c-2-3 0-5-1-8M25 15c-2-3 1-6-1-10M32 15c-2-3 0-5-1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
  </svg>`,
  rings: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="19" cy="26" r="10" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="29" cy="26" r="10" stroke="currentColor" stroke-width="1.6"/>
    <path d="M19 12l1.6 3.6L24 17l-3.4 1.6L19 22l-1.6-3.4L14 17l3.4-1.4z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  </svg>`,
};
module.exports.ICONS = ICONS;
