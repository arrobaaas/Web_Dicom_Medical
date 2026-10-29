import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom: las clases de UI y el visor usan window / document / HTMLElement.
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["js/**/*.js"],
      // vendor: librerías de terceros. main.js: solo composición (sin lógica).
      exclude: ["js/vendor/**", "js/main.js"],
      reporter: ["text", "html"],
    },
  },
});
