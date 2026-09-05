import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Every custom color is backed by a CSS variable (RGB triplet) that
        // changes per theme (:root = light, .dark = dark) — see globals.css.
        // The `rgb(var(--x) / <alpha-value>)` form keeps Tailwind's /opacity
        // modifiers working (e.g. text-parchment/60) across both themes.
        soil: {
          950: "rgb(var(--soil-950) / <alpha-value>)",
          900: "rgb(var(--soil-900) / <alpha-value>)",
          800: "rgb(var(--soil-800) / <alpha-value>)",
          700: "rgb(var(--soil-700) / <alpha-value>)",
          600: "rgb(var(--soil-600) / <alpha-value>)",
        },
        olive: {
          400: "rgb(var(--olive-400) / <alpha-value>)",
          500: "rgb(var(--olive-500) / <alpha-value>)",
          600: "rgb(var(--olive-600) / <alpha-value>)",
          700: "rgb(var(--olive-700) / <alpha-value>)",
          800: "rgb(var(--olive-800) / <alpha-value>)",
          950: "rgb(var(--olive-950) / <alpha-value>)",
        },
        wheat: {
          400: "rgb(var(--wheat-400) / <alpha-value>)",
          500: "rgb(var(--wheat-500) / <alpha-value>)",
          600: "rgb(var(--wheat-600) / <alpha-value>)",
          950: "rgb(var(--wheat-950) / <alpha-value>)",
        },
        clay: {
          300: "rgb(var(--clay-300) / <alpha-value>)",
          400: "rgb(var(--clay-400) / <alpha-value>)",
          500: "rgb(var(--clay-500) / <alpha-value>)",
          600: "rgb(var(--clay-600) / <alpha-value>)",
          950: "rgb(var(--clay-950) / <alpha-value>)",
        },
        parchment: "rgb(var(--parchment) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Fraunces", "serif"],
        serif: ["var(--font-fraunces)", "Fraunces", "serif"],
        sans: ["var(--font-plex-sans)", "IBM Plex Sans", "sans-serif"],
        mono: ["var(--font-plex-mono)", "IBM Plex Mono", "monospace"],
      },
      keyframes: {
        "pulse-critical": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(1.15)" },
        },
        "ripple": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        }
      },
      animation: {
        "pulse-critical": "pulse-critical 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "ripple": "ripple 2.5s cubic-bezier(0, 0.2, 0.8, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
