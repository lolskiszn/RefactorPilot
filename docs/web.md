# RefactorPilot Web App

The web app is a minimal local review surface backed by the same scan and preview engine used by the CLI.

## Run

```bash
node src/web/server.js --workspace . --port 3333
```

## Endpoints

- `GET /api/health` returns the configured workspace.
- `GET /api/scan?workspace=...` returns scan summary and graph stats.
- `POST /api/preview` returns a rename preview report.
- `POST /api/validate` returns validation issues for a proposed rename.
- `POST /api/apply` performs a guarded rename with backups and rollback.

## UI

The UI renders:

- workspace summary
- graph stats
- rename form
- impacted files
- replacement preview
- warnings and confidence
- apply results

## Safety

Apply mode is blocked when the plan has no impacts, low confidence, or overlapping replacement candidates. Files are backed up before writes and restored on failure.
