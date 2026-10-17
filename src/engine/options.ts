// Every option the renderer understands, with Card studio's defaults.
export const defaults = {
  orient: 'v' as 'v' | 'h',
  layout: 'single',
  nameText: 'Cardholder Name',
  name: 'back' as 'front' | 'back' | 'both',
  holo: 'none' as 'none' | 'front' | 'back',
  chipColor: 'gold',
  chipPattern: 'classic',
  markPos: 'br' as 'tl' | 'tr' | 'bl' | 'br' | 'chip',
  markStyle: 'standard',
  ident: 'none',
  identText: '',
  fAccount: 'none',
  contactless: true,
  stripe: 'standard' as 'standard' | 'custom' | 'none',
  stripeColor: '#2b2f45',
  sig: true,
  cvv: 'panel',
  bAccount: 'none',
  service: true,
  color: '#c8cfdb',
  material: 'brushed',
  sparkle: 'off',
  edge: 'match',
  mood: 'studio',
  keyDir: 'left',
  bright: 1,
  expo: 1,
  spin: false,
  drift: false,
  amount: 1,
  speed: 1,
  turn: 0,
  tilt: -0.15,
  rollBase: -0.3,
  bg: '#000000',
  shadow: true,
  shadowStrength: 0.22,
  shadowBlur: 4,
  shadowDist: 6.8,
  exportSize: '4k' as 'hd' | '4k',
  exportBg: 'include' as 'include' | 'transparent',
  videoSeconds: '10' as '5' | '10' | '15',
  videoMotion: 'spin' as 'spin' | 'drift' | 'both',
}

export type Options = typeof defaults

export const CARD_COLOURS = [
  ['#141416', 'Black'], ['#3a3c42', 'Graphite'], ['#c8cfdb', 'Silver'], ['#f2efe8', 'Cream'],
  ['#9fe06a', 'Lime'], ['#2443c8', 'Cobalt'], ['#7a2ee0', 'Violet'],
] as const

export const BG_COLOURS = [
  ['#000000', 'Black'], ['#16171b', 'Charcoal'], ['#1b2133', 'Navy'], ['#3a3d45', 'Slate'],
  ['#d9d4cc', 'Stone'], ['#ecebe8', 'Light grey'], ['#ffffff', 'White'],
] as const
