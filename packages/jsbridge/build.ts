import * as Bun from "bun";

const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    outdir: "../../dist",
    naming: `jsbridge.js`,
    target: "browser",
    format: "iife",
    minify: true,
    sourcemap: "none",
});

if (result.success) {
    console.log("Build succeeded:");
    for (const output of result.outputs) {
        console.log(`  ${output.path} (${output.size} bytes)`);
    }
} else {
    console.error("Build failed:");
    for (const log of result.logs) {
        console.error(`  ${log.message}`);
    }
    process.exit(1);
}