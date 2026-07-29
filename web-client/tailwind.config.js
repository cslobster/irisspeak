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
        sans: ['Fredoka', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
