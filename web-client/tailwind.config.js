/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        topicplan: { fg: '#669CF6', bg: '#EDF7FF', ribbon: '#78AAFC', dimmed: '#BCDBFE' },
        topicrecall: { fg: '#42CA26', bg: '#EFF6EE', ribbon: '#66CA63', dimmed: '#DDF3C9' },
        topicfree: { fg: '#FD974B', bg: '#FEF5D8', ribbon: '#FFAA6B', dimmed: '#FDE193' },
        card: {
          // Fitzgerald Key convention: nouns/things=orange, verbs=green, descriptors=blue, function/core words=pink
          topic: '#FFE3C2',
          action: '#D9F2D0',
          emotion: '#D6E8FB',
          core: '#FCD9E5',
        },
      },
      fontFamily: {
        sans: ['OpenDyslexic', 'system-ui', 'sans-serif'],
      },
      // Bumped ~10% over Tailwind defaults so text reads larger everywhere. Only fontSize is
      // touched (not spacing/width/height), so this can't push fixed-px layouts past the
      // viewport — see uiScale.ts for why that constraint matters here.
      fontSize: {
        xs: '0.8125rem',
        sm: '0.9375rem',
        base: '1.0625rem',
        lg: '1.1875rem',
        xl: '1.375rem',
        '2xl': '1.625rem',
        '3xl': '2rem',
        '4xl': '2.5rem',
        '5xl': '3.25rem',
        '6xl': '4rem',
        '7xl': '4.75rem',
      },
    },
  },
  plugins: [],
};
