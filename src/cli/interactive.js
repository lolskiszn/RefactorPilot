import process from "node:process";
import readline from "node:readline/promises";

function color(code, value, enabled) {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function useColor() {
  return Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
}

export async function runInteractiveDisambiguation(report, options = {}) {
  const disambiguation = report.plan?.disambiguation;
  if (!disambiguation?.ambiguous) {
    return {
      includeAllAmbiguous: false,
      targetContext: null,
    };
  }

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const enabled = useColor();
  const rl = readline.createInterface({ input, output });
  const selection = {
    includeAllAmbiguous: false,
    targetContext: null,
  };

  try {
    output.write(`\n${color("1;36", "Interactive Disambiguation", enabled)}\n`);
    output.write("Choose how RefactorPilot should narrow ambiguous matches.\n\n");

    for (const group of disambiguation.groups ?? []) {
      output.write(`${color("1;37", group.title, enabled)}\n`);
      group.options.forEach((option, index) => {
        const recommended = option.recommended ? color("32", "recommended", enabled) : "optional";
        output.write(`  [${index + 1}] ${option.label} (${option.filePath}) confidence ${option.confidence} ${recommended}\n`);
        output.write(`      ${option.reasoning}\n`);
      });
      output.write("  [a] Keep all options in preview\n\n");

      const answer = (await rl.question(`Select ${group.kind} context [1-${group.options.length}, a, Enter=skip]: `)).trim().toLowerCase();
      if (answer === "a") {
        selection.includeAllAmbiguous = true;
        continue;
      }

      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= group.options.length) {
        selection.targetContext = group.options[index - 1].label;
      }
    }
  } finally {
    rl.close();
  }

  return selection;
}
