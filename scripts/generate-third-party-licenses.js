import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));
  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
  const devDependencies = Object.keys(packageJson.devDependencies ?? {});
  const lines = [
    "RefactorPilot Third-Party Licenses",
    "==================================",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Runtime dependencies: ${runtimeDependencies.length}`,
    `Development dependencies: ${devDependencies.length}`,
    "",
    "This repository currently ships without npm runtime or development dependencies.",
    "All distributed source files are authored within this repository and licensed under MIT unless otherwise noted.",
  ];

  const outputPath = path.resolve("third-party-licenses.txt");
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
