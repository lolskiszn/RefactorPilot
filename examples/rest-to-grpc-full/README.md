# REST to gRPC Full Golden Path

This example is the demo path for the flagship migration pattern.

Preview:

```bash
node ./src/cli/index.js preview ./examples/rest-to-grpc-full --pattern rest-to-grpc-full
```

Apply with blue-green deployment assets:

```bash
node ./src/cli/index.js apply ./examples/rest-to-grpc-full --pattern rest-to-grpc-full --strategy bluegreen --confirm-production
```
