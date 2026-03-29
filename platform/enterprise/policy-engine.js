function matchesSelector(repo, selector = {}) {
  if (selector.languages?.length) {
    const repoLanguages = new Set(repo.languages ?? []);
    if (!selector.languages.some((language) => repoLanguages.has(language))) {
      return false;
    }
  }

  if (selector.tags?.length) {
    const repoTags = new Set(repo.tags ?? []);
    if (!selector.tags.every((tag) => repoTags.has(tag))) {
      return false;
    }
  }

  return true;
}

export function evaluatePolicies(repos, policies) {
  const violations = [];

  for (const policy of policies) {
    for (const repo of repos) {
      if (!matchesSelector(repo, policy.selector)) {
        continue;
      }

      if (policy.kind === "migration-required" && !repo.capabilities?.includes(policy.requiredPattern)) {
        violations.push({
          policyId: policy.id,
          repo: repo.name,
          severity: policy.severity ?? "medium",
          suggestedPattern: policy.requiredPattern,
        });
      }
    }
  }

  return {
    violations,
  };
}
