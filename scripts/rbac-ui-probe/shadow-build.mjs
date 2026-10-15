import {build} from "vite";
import vue from "@vitejs/plugin-vue";
import {readFile, writeFile} from "node:fs/promises";
import postcss from "postcss";
const phase1 = process.argv.includes("--phase1");
const output = phase1 ? "phase1" : "shadow";
await build({configFile: false, plugins: [vue()], define: {"process.env.NODE_ENV": JSON.stringify("production")}, build: {outDir: output, lib: {entry: phase1 ? "phase1-extension.js" : "shadow-extension.js", formats: ["es"], fileName: () => "extension.js", cssFileName: "shadow"}, cssCodeSplit: false}});
const original = await readFile(output + "/shadow.css", "utf8");
const parsed = postcss.parse(original);
parsed.walkAtRules("font-face", rule => rule.remove());
parsed.walkRules(rule => {
    rule.selector = rule.selector.replaceAll(/html\.dark\.dark-2/g, ":host(.dark-2)").replaceAll(/html\.dark-2/g, ":host(.dark-2)").replaceAll(/html\.dark/g, ":host(.dark)").replaceAll(/:root/g, ":host").replaceAll(/(^|[\s,>+~])html(?=$|[\s,.#:[>+~])/g, "$1:host").replaceAll(/(^|[\s,>+~])body(?=$|[\s,.#:[>+~])/g, "$1.shadow-body");
});
const adapted = parsed.toString();
await writeFile(output + "/shadow.css", adapted + "\n:host{display:block;font-family:inherit}.shadow-body{font-family:inherit}.probe-page{padding:24px;max-width:900px;margin:auto}.probe-page label{display:block;margin:16px 0}.probe-page .kel-empty{padding:12px}.probe-page .kel-pagination{flex-wrap:wrap}.probe-page nav{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.probe-page .kel-table{width:100%}\n");
await writeFile(output + "-build-summary.json", JSON.stringify({source: "published design-system CSS and component CSS", originalBytes: original.length, adaptedBytes: adapted.length, adaptation: "Shadow selectors only; no upstream source copied; fonts inherit host"}, null, 2));
