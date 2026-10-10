/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // B-25: theme-aware via CSS channels (see globals.css :root /
        // [data-theme='light']). Opacity modifiers (bg-accent/20) keep working.
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-light': 'rgb(var(--surface-light) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        // Semantic status tokens — bands desaturate upward:
        // neutral → info → caution → danger (see CODEMAP > ui/).
        info: 'rgb(var(--info) / <alpha-value>)',
        caution: 'rgb(var(--caution) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
      },
      fontFamily: {
        // Inter is loaded via next/font in src/app/layout.tsx (`--font-inter`).
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Phase 0 hygiene: structural safe-area tokens. `tabbar-clear` reserves
      // the mobile fixed bottom tab bar height + home-indicator safe area so
      // page content never renders under it; `safe-bottom` is the raw
      // home-indicator inset for bars/pills that sit at the viewport edge.
      // Applied at the app shell level ((app)/layout.tsx + MobileBottomNav),
      // so every page is fixed at once — not per-page.
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'tabbar-clear': 'calc(6rem + env(safe-area-inset-bottom, 0px))',
      },
    },
  },
  plugins: [],
};
