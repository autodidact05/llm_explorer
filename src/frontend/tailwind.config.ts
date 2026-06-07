import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#eef2f8',
          100: '#dce4f0',
          200: '#b8c9de',
          300: '#8aa3c4',
          400: '#5c7da8',
          500: '#3d5f8a',
          600: '#2f4a6e',
          700: '#1a3560',
          800: '#0f2442',
          900: '#0a1628',
          950: '#061018',
        },
        gold: {
          50: '#fdf8eb',
          100: '#f5ecd0',
          200: '#e8d494',
          300: '#d4b44a',
          400: '#c9a227',
          500: '#b8921f',
          600: '#9a7818',
          700: '#7a5e14',
          800: '#5c4710',
          900: '#3d300b',
        },
        cream: {
          DEFAULT: '#f8f6f1',
          50: '#fffef9',
          100: '#f8f6f1',
          200: '#f0ede4',
          300: '#e5e0d3',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
