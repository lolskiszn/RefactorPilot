"use strict";

const assert = require("node:assert/strict");

const { analyzePythonSource } = require("../../src/frontends/python");

const source = [
  "from fastapi import APIRouter",
  "import requests",
  "import json",
  "",
  "router = APIRouter()",
  "",
  "@router.get('/users/{user_id}')",
  "async def get_user(",
  "    user_id: int,",
  "    include_profile: bool = False,",
  "):",
  "    response = requests.get('https://api.example.com/users/' + str(user_id))",
  "    payload = response.json()",
  "    return json.dumps({'user': payload})",
  "",
  "class Client:",
  "    @staticmethod",
  "    def from_dict(data):",
  "        return Client()",
  "",
  "    def post(self, payload):",
  "        return requests.post(",
  "            'https://api.example.com/users',",
  "            json=payload,",
  "        )",
].join("\n");

const analysis = analyzePythonSource(source, { filePath: "app.py" });

const classSymbol = analysis.symbols.find((symbol) => symbol.kind === "class" && symbol.name === "Client");
const functionSymbol = analysis.symbols.find((symbol) => symbol.kind === "function" && symbol.name === "get_user");
const methodSymbol = analysis.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "post");

assert.ok(classSymbol, "expected Client class symbol");
assert.ok(functionSymbol, "expected get_user function symbol");
assert.ok(methodSymbol, "expected Client.post method symbol");
assert.equal(functionSymbol.async, true);
assert.equal(methodSymbol.parentId, classSymbol.id);
assert.equal(functionSymbol.parameters.length, 2);
assert.equal(functionSymbol.parameters[0].name, "user_id");

const inbound = analysis.boundaryClues.filter((clue) => clue.kind === "http-inbound");
const outbound = analysis.boundaryClues.filter((clue) => clue.kind === "http-outbound");
const jsonClues = analysis.boundaryClues.filter((clue) => clue.kind.startsWith("json"));

assert.equal(inbound.length, 1);
assert.equal(inbound[0].route, "/users/{user_id}");
assert.deepEqual(inbound[0].methods, ["GET"]);
assert.equal(outbound.length, 2);
assert.ok(outbound.some((clue) => clue.client === "requests" && clue.method === "GET"));
assert.ok(outbound.some((clue) => clue.client === "requests" && clue.method === "POST"));
assert.ok(jsonClues.some((clue) => clue.signal === "response.json"));
assert.ok(jsonClues.some((clue) => clue.signal === "json.dumps"));
assert.ok(jsonClues.some((clue) => clue.kind === "json-payload"));
assert.ok(analysis.edges.length >= 2);

console.log("python analyzer smoke test passed");
