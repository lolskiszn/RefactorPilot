import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(".");
const distDir = path.join(rootDir, "dist", "oss-package");
const includePaths = [
  "src",
  "benchmarks",
  "docs",
  "README.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md",
  "third-party-licenses.txt",
];

async function fileSize(targetPath) {
  const stats = await fs.stat(targetPath);
  if (stats.isFile()) {
    return stats.size;
  }

  let total = 0;
  for (const entry of await fs.readdir(targetPath, { withFileTypes: true })) {
    total += await fileSize(path.join(targetPath, entry.name));
  }
  return total;
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  for (const entry of includePaths) {
    await fs.cp(path.join(rootDir, entry), path.join(distDir, entry), { recursive: true });
  }

  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const bundlePackage = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    bin: pkg.bin,
    engines: pkg.engines,
    license: pkg.license,
  };
  await fs.writeFile(path.join(distDir, "package.json"), JSON.stringify(bundlePackage, null, 2), "utf8");

  const totalBytes = await fileSize(distDir);
  const report = {
    distDir,
    included: includePaths,
    sizeBytes: totalBytes,
    sizeMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
  };
  await fs.writeFile(path.join(distDir, "bundle-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
