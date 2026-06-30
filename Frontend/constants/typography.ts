/**
 * Typography System — Native System Fonts (Apple HIG)
 * ──────────────────────────────────────────────────────────────
 * NO custom fonts. By NOT specifying `fontFamily`, React Native uses the
 * platform's native font automatically:
 *   • iOS      → San Francisco (SF Pro)
 *   • Android  → Roboto
 *
 * Each token defines only fontSize / fontWeight / lineHeight / letterSpacing.
 * Import these tokens instead of hardcoding font styles:
 *
 *   import { Type } from '@/constants/typography';
 *   <Text style={Type.screenTitle}>Profile</Text>
 *   <Text style={[Type.body, { color: C.subtext }]}>...</Text>
 *
 * Accessibility: do NOT set fixed heights on text containers — these line
 * heights give comfortable spacing while still allowing Dynamic Type to scale.
 * ──────────────────────────────────────────────────────────────
 */

import { TextStyle } from 'react-native';

// Allowed weights only (Regular / Medium / Semibold / Bold).
export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

type TypeToken = Pick<TextStyle, 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing'>;

export const Type = {
  // Display
  displayLarge:  { fontSize: 34, fontWeight: '700', lineHeight: 42, letterSpacing: 0.2 },
  displayMedium: { fontSize: 28, fontWeight: '700', lineHeight: 36, letterSpacing: 0.2 },

  // Titles
  screenTitle:   { fontSize: 24, fontWeight: '700', lineHeight: 34, letterSpacing: 0.2 },
  sectionTitle:  { fontSize: 20, fontWeight: '600', lineHeight: 30, letterSpacing: 0.15 },
  cardTitle:     { fontSize: 18, fontWeight: '600', lineHeight: 28, letterSpacing: 0.1 },

  // Actions
  button:        { fontSize: 17, fontWeight: '600', lineHeight: 22, letterSpacing: 0.1 },

  // Body
  body:          { fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0.1 },
  secondaryBody: { fontSize: 15, fontWeight: '400', lineHeight: 22, letterSpacing: 0.1 },

  // Supporting
  label:         { fontSize: 14, fontWeight: '500', lineHeight: 20, letterSpacing: 0.1 },
  caption:       { fontSize: 13, fontWeight: '400', lineHeight: 18, letterSpacing: 0.1 },
  smallCaption:  { fontSize: 12, fontWeight: '400', lineHeight: 16, letterSpacing: 0.2 },
} satisfies Record<string, TypeToken>;

/**
 * Numeric / metric styles — large stats (calories, protein, BMI, steps…).
 * Bold, generous size, tight-but-readable line height, no aggressive tracking.
 */
export const Metric = {
  hero:   { fontSize: 40, fontWeight: '800', lineHeight: 46, letterSpacing: -0.5 }, // big hero number
  large:  { fontSize: 28, fontWeight: '800', lineHeight: 34, letterSpacing: -0.3 },
  medium: { fontSize: 22, fontWeight: '800', lineHeight: 28, letterSpacing: -0.2 },
  small:  { fontSize: 18, fontWeight: '700', lineHeight: 24, letterSpacing: 0 },
} satisfies Record<string, TypeToken>;

export default Type;
