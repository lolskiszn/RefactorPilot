import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import {
  analyzeGoSource,
  classifyBoundaryCall,
} from '../../src/frontends/go/index.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('classifies common Go boundary calls', () => {
  assert.deepEqual(classifyBoundaryCall('json.Marshal'), {
    kind: 'json-boundary',
    category: 'json',
  });
  assert.deepEqual(classifyBoundaryCall('http.HandleFunc'), {
    kind: 'http-boundary',
    category: 'http',
  });
  assert.deepEqual(classifyBoundaryCall('client.Do'), {
    kind: 'http-client-call',
    category: 'http',
  });
});

test('extracts symbols, json tags, handlers, and graph nodes', () => {
  const source = `
package sample

import (
  "encoding/json"
  "net/http"
)

type User struct {
  ID int \`json:"id"\`
  Name string
  Profile *Profile \`json:"profile,omitempty"\`
  embeddedMeta
}

type embeddedMeta struct {
  TraceID string \`json:"trace_id"\`
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
  payload := json.NewDecoder(r.Body)
  _ = payload.Decode(&User{})
  _ = json.NewEncoder(w).Encode(User{})
  w.Header().Set("Content-Type", "application/json")
}

func Register(mux *http.ServeMux) {
  mux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {})
  client := &http.Client{}
  req, _ := http.NewRequest(http.MethodPost, "/users", nil)
  _, _ = client.Do(req)
}
`;

  const analysis = analyzeGoSource(source, { filePath: 'sample.go' });

  assert.equal(analysis.language, 'go');
  assert.equal(analysis.filePath, 'sample.go');
  assert.equal(analysis.structs.length, 2);
  assert.equal(analysis.functions.length, 2);
  assert.ok(analysis.symbols.some((symbol) => symbol.kind === 'struct' && symbol.name === 'User'));
  assert.ok(analysis.symbols.some((symbol) => symbol.kind === 'function' && symbol.name === 'Register'));

  const userStruct = analysis.structs.find((item) => item.name === 'User');
  assert.ok(userStruct);
  assert.equal(userStruct.fields[0].jsonName, 'id');
  assert.equal(userStruct.fields[2].jsonName, 'profile');
  assert.equal(userStruct.fields[3].embedded, true);

  const handlerClues = analysis.boundaryClues.filter((clue) => clue.kind === 'http-handler');
  const jsonClues = analysis.boundaryClues.filter((clue) => clue.kind === 'json-boundary');
  const routeClues = analysis.boundaryClues.filter((clue) => clue.kind === 'http-route-registration');
  const clientClues = analysis.boundaryClues.filter((clue) => clue.kind === 'http-client-call');
  const jsonFieldClues = analysis.boundaryClues.filter((clue) => clue.kind === 'json-field');

  assert.ok(handlerClues.length >= 1);
  assert.ok(jsonClues.length >= 2);
  assert.ok(routeClues.length >= 1);
  assert.ok(clientClues.length >= 1);
  assert.ok(jsonFieldClues.length >= 2);

  assert.ok(analysis.graph.nodes.some((node) => node.kind === 'boundary'));
  assert.ok(analysis.graph.edges.some((edge) => edge.kind === 'json-field'));
});

async function run() {
  const failures = [];

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push({ name, error });
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
