import type { Config } from "tailwindcss";

/*
 * Brand palette: Black #0C0D0F, Charcoal #1A1B1E, Remnant Red #9E303C, Stone #E8E6E1.
 * Surfaces are tints of black/charcoal, text is stone at different opacities, and red is the only accent.
 * The "ok" and "warn" tones exist solely so status indicators stay distinguishable at a glance.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: "#E8E6E1",
        stone: "#E8E6E1",
        ink: { 950: "#0c0d0f", 900: "#141518", 850: "#1a1b1e", 800: "#202125", 700: "#2a2b30", 600: "#393a40", 500: "#55565c" },
        blood: { 800: "#5f1d25", 700: "#7a242e", 600: "#9e303c", 500: "#b83e4b", 400: "#d0606b", 300: "#e08a93" },
        ok: "#8fb59b",
        warn: "#d4b06a",
        orange: "#e8873a",
      },
      fontFamily: {
        display: ["Impact", "Haettenschweiler", "Arial Narrow Bold", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(232,230,225,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.8)",
        glow: "0 0 0 1px rgba(158,48,60,0.5), 0 0 24px -4px rgba(158,48,60,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
