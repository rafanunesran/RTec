/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        brand2: "hsl(var(--brand-2))",
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        sidebar: { DEFAULT: "hsl(var(--sidebar))", accent: "hsl(var(--sidebar-accent))", border: "hsl(var(--sidebar-border))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--primary-foreground))" },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
      },
      borderRadius: { "3xl": "1.5rem", "2xl": "1.125rem", xl: "0.875rem", lg: "0.75rem", md: "0.5rem", sm: "0.375rem" },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 10px 40px -12px hsl(var(--primary) / 0.55)",
        card: "inset 0 1px 0 0 hsl(0 0% 100% / 0.04), 0 20px 40px -24px hsl(0 0% 0% / 0.8)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "pop-in": { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "rise-in": "rise-in 0.45s ease-out",
        "pop-in": "pop-in 0.2s ease-out",
        "slide-in-left": "slide-in-left 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
