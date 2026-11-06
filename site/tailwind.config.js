/** Tailwind config for the Launchbench site. Built by tools/build_site.py. */
module.exports = {
  content: ["./templates/**/*.html", "./assets/site.js"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0E1A2B", 800: "#16263C", 700: "#22344D", 600: "#3B4B63", 500: "#5B6779", 400: "#8A93A3", 300: "#B9C0CB" },
        brand: { 50: "#FFF5EC", 100: "#FFE7D2", 200: "#FFCBA3", 300: "#FFA76B", 400: "#FB8740", 500: "#F26B1D", 600: "#DB5710", 700: "#B4440D" },
        cream: { DEFAULT: "#FBF8F3", 100: "#F6F1E9", 200: "#EDE5D8" },
        leaf: { 100: "#E3F1E7", 600: "#2F7A4B" },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(14,26,43,.04), 0 8px 24px -8px rgba(14,26,43,.10)",
        lift: "0 2px 4px rgba(14,26,43,.04), 0 24px 48px -16px rgba(14,26,43,.22)",
      },
      maxWidth: { site: "76rem" },
    },
  },
};
