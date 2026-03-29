function unique(values) {
  return [...new Set(values)];
}

export function buildDistributedCampaignPlan({ graph, repos, maxBatchSize = 3 }) {
  const order = graph?.topologicalOrder ?? repos.map((repo) => repo.name);
  const batches = [];

  for (let index = 0; index < order.length; index += maxBatchSize) {
    batches.push({
      repos: order.slice(index, index + maxBatchSize),
      sequence: batches.length + 1,
    });
  }

  return {
    batches,
    canary: {
      percentages: [1, 10, 100],
    },
    circuitBreaker: {
      pauseOnErrorRateAbove: 0.05,
    },
    impactedRepos: unique(order),
  };
}
