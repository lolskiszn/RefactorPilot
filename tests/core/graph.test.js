import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import {
  EDGE_KINDS,
  NODE_KINDS,
  createGraph,
  deserializeGraph,
  serializeGraph,
} from '../../src/core/index.js';

const tests = [];

function test(name, fn) {
  tests.push({ fn, name });
}

test('graph indexes nodes and edges for API boundary analysis', () => {
  const graph = createGraph({
    metadata: { project: 'refactorpilot' },
    nodes: [
      {
        id: 'go.handler',
        kind: NODE_KINDS.FUNCTION,
        language: 'go',
        name: 'CreateUser',
        attributes: { method: 'POST', path: '/users' },
      },
      {
        id: 'py.client',
        kind: NODE_KINDS.SYMBOL,
        language: 'python',
        name: 'create_user',
        attributes: { transport: 'http' },
      },
    ],
  });

  graph.addEdge({
    from: 'go.handler',
    kind: EDGE_KINDS.CROSSES_BOUNDARY,
    to: 'py.client',
  });

  assert.equal(graph.hasNode('go.handler'), true);
  assert.equal(graph.outgoing('go.handler').length, 1);
  assert.equal(graph.incoming('py.client').length, 1);
  assert.equal(graph.findNodesByLanguage('python').length, 1);
  assert.equal(graph.findEdgesByKind(EDGE_KINDS.CROSSES_BOUNDARY).length, 1);
  assert.equal(graph.boundaryEdges().length, 1);
  assert.equal(graph.validate().valid, true);
});

test('graph serializes deterministically and round-trips', () => {
  const graph = createGraph({
    metadata: { b: 2, a: 1 },
    nodes: [
      {
        id: 'schema.user',
        kind: NODE_KINDS.DATA_SCHEMA,
        name: 'User',
        attributes: {
          fields: ['id', 'email'],
        },
      },
    ],
  });

  const first = serializeGraph(graph);
  const second = serializeGraph(deserializeGraph(first));

  assert.equal(first, second);
  assert.equal(
    first,
    '{"edges":[],"metadata":{"a":1,"b":2},"nodes":[{"attributes":{"fields":["id","email"]},"id":"schema.user","kind":"data.schema","name":"User"}],"version":1}'
  );
});

test('graph rejects dangling edges', () => {
  const graph = createGraph({
    nodes: [
      {
        id: 'existing',
        kind: NODE_KINDS.FILE,
      },
    ],
  });

  assert.throws(
    () =>
      graph.addEdge({
        from: 'existing',
        kind: EDGE_KINDS.CONTAINS,
        to: 'missing',
      }),
    /Edge target node not found/
  );
});

async function run() {
  const failures = [];

  for (const { fn, name } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push({ error, name });
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

export { run };
