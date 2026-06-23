import type { Config } from "tailwindcss";

// Design tokens are declared as CSS variables in app/globals.css (single source
// of truth) and surfaced to Tailwind here. No ad-hoc hex values in components.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--base)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        bone: "var(--bone)",
        sand: "var(--sand)",
        faint: "var(--faint)",
        ember: "var(--ember)",
        hairline: "var(--hairline)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        title: ["1.6rem", { lineHeight: "1.15", letterSpacing: "-0.01em" }],
        data: ["0.8125rem", { lineHeight: "1.2", letterSpacing: "0.01em" }],
      },
      maxWidth: { reading: "44rem", shell: "72rem" },
      transitionTimingFunction: { quiet: "cubic-bezier(0.22, 1, 0.36, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
