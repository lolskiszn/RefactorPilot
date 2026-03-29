# RefactorPilot Deployment

## Honest Status

- Core engine: MVP ready
- GitHub App production runtime: beta
- Marketplace: scaffold
- Enterprise policy engine: scaffold
- Dashboard: scaffold

## Recommended Production Topology

- `github-app`: webhook/API service
- `analysis-engine`: ephemeral workers for repo analysis
- `orchestrator`: durable workflow runner
- `redis`: queueing and caching
- `postgres`: metadata only, never source code
- `object storage`: encrypted temporary artifacts with 24h TTL

## Security Model

- analyze customer code in ephemeral workspaces only
- store metadata, not source code
- separate tenant queues and secrets
- read-only GitHub App by default

## Rollout

1. Closed beta with self-hosted GitHub App
2. Enable private-repo billing
3. Add marketplace submission review
4. Add enterprise policy automation
