export function buildCampaign(repos, policy, options = {}) {
  const batches = [];
  const sorted = [...repos].sort((left, right) => left.name.localeCompare(right.name));
  const batchSize = options.batchSize ?? 2;

  for (let index = 0; index < sorted.length; index += batchSize) {
    batches.push({
      repos: sorted.slice(index, index + batchSize).map((repo) => repo.name),
      sequence: batches.length + 1,
    });
  }

  return {
    batchSize,
    batches,
    id: policy.id,
    policyId: policy.id,
    status: "planned",
  };
}
