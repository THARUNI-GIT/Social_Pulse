export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.18)",
        "card-hover": "0 2px 4px rgba(16,24,40,.05), 0 16px 32px -14px rgba(16,24,40,.24)",
        nav: "0 -4px 20px -8px rgba(16,24,40,.12)",
      },
      keyframes: {
        pop: { "0%": { transform: "scale(1)" }, "35%": { transform: "scale(1.3)" }, "100%": { transform: "scale(1)" } },
        "fade-up": { "0%": { opacity: 0, transform: "translateY(10px)" }, "100%": { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { pop: "pop .35s ease-in-out", "fade-up": "fade-up .3s ease-out both" },
    },
  },
  plugins: [],
};
