import { run as runStrategyInterface } from "./strategy-interface.test.js";

export async function run() {
  await runStrategyInterface();
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
