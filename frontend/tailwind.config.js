/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        surface: '#1e293b',
        'surface-light': '#334155',
        accent: '#3b82f6',
        'accent-hover': '#2563eb',
        positive: '#22c55e',
        warning: '#ef4444',
        muted: '#94a3b8',
      },
    },
  },
  plugins: [],
};
