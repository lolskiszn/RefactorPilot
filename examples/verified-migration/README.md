# Verified Migration Example

This example exists to demonstrate RefactorPilot's verified-transformation loop:

1. Generate draft protocol-migration artifacts
2. Run compilation-style verification
3. Auto-repair missing imports and proto conflicts
4. Surface the final automation tier before apply

Use it together with the `rest-to-grpc-full` pattern and JSON output to inspect the verification summary.
