import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Every source file counts, including one no test imports: a module left
      // out of the suite is what this measures.
      include: ["src/**/*.ts"],
      // The executable takes stdio and ends the process as it is imported, so a
      // test that loads it takes the runner with it. What it wires is measured
      // where it is built.
      exclude: ["src/index.ts"],
      // The suite is written before the code it covers, so it starts whole and
      // stays there. A figure below this is a module nothing asked about.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
