import React from 'react';

/**
 * icons.jsx
 * Minimal inline SVG icon set (Tabler-style outline). No external icon package —
 * this app has no UI library, so a handful of hand-drawn strokes keeps things dependency-free.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconMenu({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

export function IconUser({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function IconBook({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5" />
      <path d="M4 5.5v15" />
      <path d="M20 18H6.5A2.5 2.5 0 0 0 4 20.5" />
    </svg>
  );
}

export function IconChecklist({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 15 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <path d="M10.3 3.9 1.9 18a1.8 1.8 0 0 0 1.5 2.7h17.2a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function IconArrowUp({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function IconPlus({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconTrash({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

export function IconSearch({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <circle cx="10" cy="10" r="6" />
      <line x1="20" y1="20" x2="14.5" y2="14.5" />
    </svg>
  );
}

export function IconX({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base} aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}
