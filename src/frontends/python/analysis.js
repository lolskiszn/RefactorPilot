"use strict";

import path from "node:path";
import fs from "node:fs";

export function analyzePythonFile(filePath, options = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  return analyzePythonSource(source, { ...options, filePath });
}

export function analyzePythonSource(source, options = {}) {
  const filePath = normalizePath(options.filePath || "<memory>");
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const imports = [];
  const symbols = [];
  const boundaryClues = [];
  const edges = [];
  const blockStack = [];
  const pendingDecorators = [];
  let boundarySeq = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentWidth(rawLine);

    if (trimmed.startsWith("@")) {
      pendingDecorators.push({
        raw: trimmed,
        line: index + 1,
        parsed: parseDecorator(trimmed),
      });
      continue;
    }

    while (blockStack.length && indent <= blockStack[blockStack.length - 1].indent) {
      const ended = blockStack.pop();
      if (ended && ended.symbol) {
        ended.symbol.endLine = Math.max(ended.symbol.endLine, index);
      }
    }

    if (looksLikeImport(trimmed)) {
      const parsedImport = parseImport(trimmed, index + 1, filePath);
      if (parsedImport) {
        imports.push(parsedImport);
      }
      pendingDecorators.length = 0;
      continue;
    }

    if (looksLikeClassOrFunction(trimmed)) {
      const statement = collectStatement(lines, index);
      const header = statement.text.trim();
      index = statement.endIndex;

      if (looksLikeClass(header)) {
        const parentSymbol = findParentSymbol(blockStack);
        const className = parseClassName(header);
        const symbol = createSymbol({
          filePath,
          kind: "class",
          name: className,
          qualifiedName: makeQualifiedName(blockStack, className, false),
          parentId: parentSymbol ? parentSymbol.id : null,
          startLine: statement.startLine,
          endLine: statement.endLine,
          decorators: pendingDecorators.map((decorator) => decorator.raw),
        });
        symbols.push(symbol);
        blockStack.push({
          kind: "class",
          indent,
          symbol,
        });
        pendingDecorators.length = 0;
        continue;
      }

      if (looksLikeFunction(header)) {
        const functionInfo = parseFunctionHeader(header);
        const parentSymbol = findParentSymbol(blockStack);
        const kind = parentSymbol && parentSymbol.kind === "class" ? "method" : "function";
        const symbol = createSymbol({
          filePath,
          kind,
          name: functionInfo.name,
          qualifiedName: makeQualifiedName(blockStack, functionInfo.name, kind === "method"),
          parentId: parentSymbol ? parentSymbol.id : null,
          startLine: statement.startLine,
          endLine: statement.endLine,
          async: functionInfo.async,
          decorators: pendingDecorators.map((decorator) => decorator.raw),
          parameters: functionInfo.parameters,
        });
        symbols.push(symbol);
        blockStack.push({
          kind,
          indent,
          symbol,
        });

        for (const decorator of pendingDecorators) {
          const routeClue = parseRouteDecorator(decorator, symbol, filePath, decorator.line);
          if (routeClue) {
            boundaryClues.push(routeClue);
            edges.push({
              id: makeEdgeId(filePath, edges.length + 1),
              kind: "emits-boundary",
              from: symbol.id,
              to: routeClue.id,
            });
          }
        }

        pendingDecorators.length = 0;
        continue;
      }
    }

    pendingDecorators.length = 0;

    const activeSymbol = findActiveExecutableSymbol(blockStack);
    const lineClues = scanBoundaryClues(trimmed, rawLine, {
      filePath,
      line: index + 1,
      symbolId: activeSymbol ? activeSymbol.id : null,
      nextBoundarySeq() {
        boundarySeq += 1;
        return boundarySeq;
      },
    });

    for (const clue of lineClues) {
      boundaryClues.push(clue);
      if (activeSymbol) {
        edges.push({
          id: makeEdgeId(filePath, edges.length + 1),
          kind: "emits-boundary",
          from: activeSymbol.id,
          to: clue.id,
        });
      }
    }

    for (const block of blockStack) {
      if (block.symbol) {
        block.symbol.endLine = Math.max(block.symbol.endLine, index + 1);
      }
    }
  }

  return {
    language: "python",
    filePath,
    imports,
    symbols,
    boundaryClues,
    edges,
  };
}

function looksLikeImport(line) {
  return line.startsWith("import ") || line.startsWith("from ");
}

function looksLikeClassOrFunction(line) {
  return line.startsWith("class ") || line.startsWith("def ") || line.startsWith("async def ");
}

function looksLikeClass(line) {
  return line.startsWith("class ");
}

function looksLikeFunction(line) {
  return line.startsWith("def ") || line.startsWith("async def ");
}

function parseClassName(header) {
  const match = header.match(/^class\s+([A-Za-z_]\w*)/);
  return match ? match[1] : "anonymous";
}

function parseFunctionHeader(header) {
  const async = header.startsWith("async def ");
  const match = header.match(/^(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*:/);
  if (!match) {
    return { async, name: "anonymous", parameters: [] };
  }

  return {
    async,
    name: match[1],
    parameters: parseParameters(match[2]),
  };
}

function parseParameters(parameterText) {
  const parameters = [];
  for (const chunk of splitTopLevel(parameterText, ",")) {
    const text = chunk.trim();
    if (!text || text === "/" || text === "*" || text.startsWith("**")) {
      continue;
    }

    let namePart = text;
    let annotation = null;
    let defaultValue = null;

    const equalsIndex = findTopLevelChar(text, "=");
    if (equalsIndex !== -1) {
      defaultValue = text.slice(equalsIndex + 1).trim() || null;
      namePart = text.slice(0, equalsIndex).trim();
    }

    const colonIndex = findTopLevelChar(namePart, ":");
    if (colonIndex !== -1) {
      annotation = namePart.slice(colonIndex + 1).trim() || null;
      namePart = namePart.slice(0, colonIndex).trim();
    }

    namePart = namePart.replace(/^\*+/, "");
    if (!namePart) {
      continue;
    }

    parameters.push({
      name: namePart,
      annotation,
      defaultValue,
    });
  }

  return parameters;
}

function parseImport(line, lineNumber, filePath) {
  if (line.startsWith("import ")) {
    return {
      id: makeImportId(filePath, lineNumber, "import"),
      kind: "import",
      line: lineNumber,
      source: line,
      modules: splitTopLevel(line.slice("import ".length), ",")
        .map((item) => parseImportItem(item.trim()))
        .filter(Boolean),
    };
  }

  const match = line.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    id: makeImportId(filePath, lineNumber, "from-import"),
    kind: "from-import",
    line: lineNumber,
    source: line,
    module: match[1],
    names: splitTopLevel(match[2], ",")
      .map((item) => parseImportItem(item.trim()))
      .filter(Boolean),
  };
}

function parseImportItem(item) {
  if (!item) {
    return null;
  }

  const match = item.match(/^([A-Za-z0-9_.]+)(?:\s+as\s+([A-Za-z_]\w*))?$/);
  if (!match) {
    return { name: item, alias: null };
  }

  return {
    name: match[1],
    alias: match[2] || null,
  };
}

function parseDecorator(decoratorLine) {
  const text = decoratorLine.startsWith("@") ? decoratorLine.slice(1).trim() : decoratorLine.trim();
  const callMatch = text.match(/^([A-Za-z0-9_.]+)\s*\(([\s\S]*)\)$/);
  if (!callMatch) {
    return {
      raw: decoratorLine,
      name: text,
      args: [],
    };
  }

  return {
    raw: decoratorLine,
    name: callMatch[1],
    args: splitTopLevel(callMatch[2], ",").map((part) => part.trim()).filter(Boolean),
  };
}

function parseRouteDecorator(decorator, symbol, filePath, lineNumber) {
  const parsed = decorator.parsed || parseDecorator(decorator.raw);
  const name = parsed.name;
  const decoratorText = decorator.raw;
  const pathValue = firstStringLiteral(parsed.args[0] || "") || firstStringLiteral(decoratorText);
  const routeStyle = name.match(/(?:^|\.)(route|api_route|get|post|put|delete|patch|head|options|websocket|ws)$/);
  const apiViewStyle = name.endsWith("api_view");

  if (!routeStyle && !apiViewStyle) {
    return null;
  }

  let methods = [];
  if (routeStyle) {
    const method = routeStyle[1].toUpperCase();
    if (method === "ROUTE" || method === "API_ROUTE") {
      methods = extractMethodsFromDecoratorArgs(parsed.args);
    } else if (method === "WS" || method === "WEBSOCKET") {
      methods = ["WEBSOCKET"];
    } else {
      methods = [method];
    }
  }

  if (apiViewStyle) {
    methods = extractMethodsFromDecoratorArgs(parsed.args);
  }

  return {
    id: makeBoundaryId(filePath, lineNumber),
    kind: "http-inbound",
    line: lineNumber,
    ownerSymbolId: symbol.id,
    source: decoratorText,
    route: pathValue,
    methods: methods.length ? methods : ["UNKNOWN"],
    framework: inferRouteFramework(name, decoratorText),
  };
}

function extractMethodsFromDecoratorArgs(args) {
  for (const arg of args) {
    const methodsMatch = arg.match(/methods\s*=\s*\[([^\]]*)\]/i);
    if (methodsMatch) {
      const methods = extractQuotedStrings(methodsMatch[1]).map((method) => method.toUpperCase());
      if (methods.length) {
        return methods;
      }
    }

    if (arg.startsWith("[") || arg.startsWith("(")) {
      const methods = extractQuotedStrings(arg).map((method) => method.toUpperCase());
      if (methods.length) {
        return methods;
      }
    }
  }

  return [];
}

function inferRouteFramework(name, decoratorText) {
  if (name.includes("fastapi") || decoratorText.includes("APIRouter") || decoratorText.includes("FastAPI")) {
    return "fastapi";
  }
  if (name.includes("django") || decoratorText.includes("api_view")) {
    return "django-rest-framework";
  }
  if (name.includes("flask") || decoratorText.includes(".route(")) {
    return "flask";
  }
  return "python";
}

function scanBoundaryClues(trimmed, rawLine, context) {
  const clues = [];
  const { filePath, line, symbolId, nextBoundarySeq } = context;

  const httpPatterns = [
    { regex: /\brequests\.(get|post|put|delete|patch|head|options|request)\s*\(/i, client: "requests" },
    { regex: /\bhttpx\.(get|post|put|delete|patch|head|options|request)\s*\(/i, client: "httpx" },
    { regex: /\b(?:aiohttp\.ClientSession|ClientSession)\s*\([^)]*\)\.(get|post|put|delete|patch|head|options|request)\s*\(/i, client: "aiohttp" },
    { regex: /\burllib\.request\.urlopen\s*\(/i, client: "urllib" },
    { regex: /\burllib3\.[A-Za-z_]\w*\.request\s*\(/i, client: "urllib3" },
  ];

  for (const pattern of httpPatterns) {
    const match = trimmed.match(pattern.regex);
    if (!match) {
      continue;
    }

    const callDetails = parseHttpCallDetails(trimmed, pattern.client, match[1] ? match[1].toUpperCase() : "REQUEST");
    clues.push({
      id: makeBoundaryId(filePath, nextBoundarySeq()),
      kind: "http-outbound",
      line,
      ownerSymbolId: symbolId,
      source: rawLine.trim(),
      client: pattern.client,
      method: callDetails.method,
      target: callDetails.target,
      requestBody: callDetails.requestBody,
      headers: callDetails.headers,
    });
  }

  const jsonSignals = [
    { regex: /\bjson\.dumps\s*\(/i, kind: "json-serialize", signal: "json.dumps" },
    { regex: /\bjson\.loads\s*\(/i, kind: "json-deserialize", signal: "json.loads" },
    { regex: /\.\s*json\s*\(\s*\)/i, kind: "json-deserialize", signal: "response.json" },
    { regex: /\bget_json\s*\(/i, kind: "json-deserialize", signal: "get_json" },
    { regex: /\b(?:model_dump|dict|asdict|to_dict|from_dict)\s*\(/i, kind: "json-serialize", signal: "object-conversion" },
  ];

  for (const signal of jsonSignals) {
    if (!signal.regex.test(trimmed)) {
      continue;
    }

    clues.push({
      id: makeBoundaryId(filePath, nextBoundarySeq()),
      kind: signal.kind,
      line,
      ownerSymbolId: symbolId,
      source: rawLine.trim(),
      signal: signal.signal,
    });
  }

  if (/\bjson\s*=\s*/i.test(trimmed)) {
    clues.push({
      id: makeBoundaryId(filePath, nextBoundarySeq()),
      kind: "json-payload",
      line,
      ownerSymbolId: symbolId,
      source: rawLine.trim(),
      signal: "json-body-argument",
    });
  }

  return clues;
}

function parseHttpCallDetails(line, client, fallbackMethod) {
  let method = fallbackMethod;
  let target = null;
  let requestBody = null;
  let headers = null;

  const callArgs = extractCallArguments(line);
  if (!callArgs) {
    return { method, target, requestBody, headers };
  }

  const positionalStrings = extractQuotedStrings(callArgs);
  const methodMatch = callArgs.match(/\bmethod\s*=\s*["']([A-Za-z]+)["']/i);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  if ((client === "requests" || client === "httpx") && positionalStrings.length >= 2 && method === "REQUEST") {
    method = positionalStrings[0].toUpperCase();
    target = positionalStrings[1];
  } else if (client === "urllib") {
    target = positionalStrings.length ? positionalStrings[0] : null;
    method = "REQUEST";
  } else {
    target = positionalStrings.length ? positionalStrings[positionalStrings.length - 1] : null;
  }

  const jsonBodyMatch = callArgs.match(/\bjson\s*=\s*([^,]+)/i);
  if (jsonBodyMatch) {
    requestBody = jsonBodyMatch[1].trim();
  }

  const dataBodyMatch = callArgs.match(/\bdata\s*=\s*([^,]+)/i);
  if (dataBodyMatch) {
    requestBody = dataBodyMatch[1].trim();
  }

  const headersMatch = callArgs.match(/\bheaders\s*=\s*([^,]+)/i);
  if (headersMatch) {
    headers = headersMatch[1].trim();
  }

  return { method, target, requestBody, headers };
}

function extractCallArguments(line) {
  const openIndex = line.indexOf("(");
  if (openIndex === -1) {
    return null;
  }

  const closeIndex = findMatchingParen(line, openIndex);
  if (closeIndex === -1) {
    return line.slice(openIndex + 1);
  }

  return line.slice(openIndex + 1, closeIndex);
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      if (quote.length === 1) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (text.slice(i, i + 3) === quote) {
        quote = null;
        i += 2;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (text.slice(i, i + 3) === char.repeat(3)) {
        quote = char.repeat(3);
        i += 2;
      } else {
        quote = char;
      }
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function collectStatement(lines, startIndex) {
  const startLine = startIndex + 1;
  const parts = [];
  let balance = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index];
    parts.push(rawLine);
    balance += bracketDelta(rawLine);
    if (rawLine.trim().endsWith(":") && balance <= 0) {
      return {
        text: parts.join("\n"),
        startLine,
        endLine: index + 1,
        endIndex: index,
      };
    }
  }

  return {
    text: parts.join("\n"),
    startLine,
    endLine: lines.length,
    endIndex: lines.length - 1,
  };
}

function bracketDelta(text) {
  let delta = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      if (quote.length === 1) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (text.slice(i, i + 3) === quote) {
        quote = null;
        i += 2;
      }
      continue;
    }

    if (char === "#") {
      break;
    }

    if (char === "'" || char === '"') {
      if (text.slice(i, i + 3) === char.repeat(3)) {
        quote = char.repeat(3);
        i += 2;
      } else {
        quote = char;
      }
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      delta += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      delta -= 1;
    }
  }

  return delta;
}

function splitTopLevel(text, separator) {
  const result = [];
  let current = "";
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      current += char;
      if (quote.length === 1) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
      } else if (text.slice(i, i + 3) === quote) {
        current += text.slice(i + 1, i + 3);
        quote = null;
        i += 2;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (text.slice(i, i + 3) === char.repeat(3)) {
        quote = char.repeat(3);
        current += quote;
        i += 2;
      } else {
        quote = char;
        current += char;
      }
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    }

    if (depth === 0 && char === separator) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function findTopLevelChar(text, targetChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      if (quote.length === 1) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (text.slice(i, i + 3) === quote) {
        quote = null;
        i += 2;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (text.slice(i, i + 3) === char.repeat(3)) {
        quote = char.repeat(3);
        i += 2;
      } else {
        quote = char;
      }
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    }

    if (depth === 0 && char === targetChar) {
      return i;
    }
  }

  return -1;
}

function extractQuotedStrings(text) {
  const matches = [];
  const regex = /(["'])(?:\\.|(?!\1).)*\1/g;
  let match;
  while ((match = regex.exec(text))) {
    matches.push(unquote(match[0]));
  }
  return matches;
}

function firstStringLiteral(text) {
  const match = text.match(/(["'])(?:\\.|(?!\1).)*\1/);
  return match ? unquote(match[0]) : null;
}

function unquote(text) {
  if (!text || text.length < 2) {
    return text;
  }

  const quote = text[0];
  if ((quote !== "'" && quote !== '"') || text[text.length - 1] !== quote) {
    return text;
  }

  return text.slice(1, -1).replace(new RegExp(`\\\\${quote}`, "g"), quote);
}

function getIndentWidth(line) {
  let width = 0;
  for (const char of line) {
    if (char === " ") {
      width += 1;
    } else if (char === "\t") {
      width += 4;
    } else {
      break;
    }
  }
  return width;
}

function findParentSymbol(blockStack) {
  for (let index = blockStack.length - 1; index >= 0; index -= 1) {
    const block = blockStack[index];
    if (block && block.symbol) {
      return block.symbol;
    }
  }
  return null;
}

function findActiveExecutableSymbol(blockStack) {
  for (let index = blockStack.length - 1; index >= 0; index -= 1) {
    const block = blockStack[index];
    if (block && block.symbol && (block.kind === "function" || block.kind === "method")) {
      return block.symbol;
    }
  }
  return null;
}

function makeQualifiedName(blockStack, name, methodLike) {
  const parts = [];
  for (const block of blockStack) {
    if (!block.symbol) {
      continue;
    }
    if (block.kind === "class") {
      parts.push(block.symbol.name);
      continue;
    }
    if (!methodLike && (block.kind === "function" || block.kind === "method")) {
      parts.push(block.symbol.name);
    }
  }
  parts.push(name);
  return parts.join(".");
}

function createSymbol({
  filePath,
  kind,
  name,
  qualifiedName,
  parentId,
  startLine,
  endLine,
  async = false,
  decorators = [],
  parameters = [],
}) {
  return {
    id: makeSymbolId(filePath, kind, qualifiedName, startLine),
    kind,
    name,
    qualifiedName,
    parentId: parentId || null,
    startLine,
    endLine,
    async,
    decorators,
    parameters,
  };
}

function makeSymbolId(filePath, kind, name, line) {
  return `python:${filePath}#symbol:${kind}:${name}@${line}`;
}

function makeBoundaryId(filePath, lineOrSequence) {
  return `python:${filePath}#boundary:${String(lineOrSequence).padStart(4, "0")}`;
}

function makeEdgeId(filePath, index) {
  return `python:${filePath}#edge:${String(index).padStart(4, "0")}`;
}

function makeImportId(filePath, line, kind) {
  return `python:${filePath}#import:${kind}@${line}`;
}

function normalizePath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/");
}

