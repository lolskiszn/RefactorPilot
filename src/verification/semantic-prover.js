function extractProtoFields(protoContent) {
  return [...String(protoContent ?? "").matchAll(/^\s*[A-Za-z0-9_.]+\s+([a-zA-Z_][A-Za-z0-9_]*)\s*=\s*\d+\s*;/gm)].map((match) => match[1]);
}

export async function proveSemanticEquivalence(changeSet, options = {}) {
  if (typeof options.compare === "function") {
    return options.compare(changeSet, options);
  }

  const proto = changeSet.outputs.find((entry) => entry.kind === "proto");
  const goFile = changeSet.outputs.find((entry) => entry.path.endsWith(".go"));
  const routeParams = changeSet.transformAnalysis?.handlers?.[0]?.routeParams ?? [];
  const protoFields = extractProtoFields(proto?.content ?? "");
  const issues = [];

  for (const param of routeParams) {
    if (!protoFields.includes(param) && !protoFields.includes(param.toLowerCase())) {
      issues.push({
        category: "ContractMismatch",
        message: `Route parameter ${param} is not represented in the generated proto request/response.`,
      });
    }
  }

  if ((changeSet.transformAnalysis?.handlers?.[0]?.errors?.length ?? 0) > 0 && !/status\.Errorf|status\.New/.test(goFile?.content ?? "")) {
    issues.push({
      category: "ErrorMappingGap",
      message: "HTTP error paths were detected but no gRPC status mapping was generated.",
    });
  }

  return {
    checked: true,
    equivalent: issues.length === 0,
    issues,
    mode: "contract",
    status: issues.length === 0 ? "passed" : "warning",
  };
}
