import type { ThemeId } from '@shared/protocol';

export interface RoomThemeInfo {
  id: ThemeId;
  label: string;
  emoji: string;
  blurb: string;
  /** Emoji used by the floating decorations in this theme. */
  decor: string[];
  /** Swatch colors for the picker (CSS values). */
  swatch: [string, string];
}

export const ROOM_THEMES: RoomThemeInfo[] = [
  { id: 'strawberry', label: 'Strawberry Milk', emoji: '🍓', blurb: 'Sweet and rosy', decor: ['🍓', '💖', '✨'], swatch: ['#ffafcc', '#ffd6e5'] },
  { id: 'lavender', label: 'Lavender Dream', emoji: '💜', blurb: 'Soft and dreamy', decor: ['💜', '🦋', '✨'], swatch: ['#cdb4db', '#e6d9f0'] },
  { id: 'cloud', label: 'Cloud Nine', emoji: '☁️', blurb: 'Light and airy', decor: ['☁️', '🫧', '⭐'], swatch: ['#bde0fe', '#e0f0ff'] },
  { id: 'vanilla', label: 'Vanilla Latte', emoji: '🧁', blurb: 'Warm and cozy', decor: ['🧁', '🌼', '✨'], swatch: ['#ffe5b4', '#fff1d6'] },
  { id: 'starlight', label: 'Starlight Sleepover', emoji: '🌙', blurb: 'Quiet night sky', decor: ['🌙', '⭐', '💫'], swatch: ['#b8a4f0', '#d9ccfa'] },
  { id: 'bubblegum', label: 'Bubblegum Pop', emoji: '🫧', blurb: 'Playful pink and blue', decor: ['🫧', '🎀', '💖'], swatch: ['#ffafcc', '#bde0fe'] },
];

export function getRoomTheme(id: ThemeId | undefined): RoomThemeInfo {
  return ROOM_THEMES.find((t) => t.id === id) ?? ROOM_THEMES[0];
}
