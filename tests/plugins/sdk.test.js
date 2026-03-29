import assert from "node:assert/strict";

import { BaseParser, createPatternPlugin } from "../../packages/language-sdk/src/index.js";
import djangoToFastApiPlugin, { preview as previewDjangoToFastApi } from "../../examples/plugins-example/django-to-fastapi/src/index.js";

class ExampleParser extends BaseParser {
  parse(source, filePath) {
    return {
      filePath,
      lines: String(source ?? "").split(/\r?\n/).length,
      parserId: this.id,
    };
  }
}

export async function run() {
  const parser = new ExampleParser({
    id: "parser:example",
    language: "python",
    name: "Example Parser",
    version: "1.0.0",
  });
  const analysis = parser.analyzeWorkspace([
    { path: "example.py", source: "print('hi')\n" },
  ]);
  assert.equal(analysis.files[0].lines, 2);
  assert.equal(analysis.parser.id, "parser:example");

  const plugin = createPatternPlugin({
    id: "pattern:sample",
    name: "Sample",
    version: "1.0.0",
  });
  const preview = await plugin.preview({ files: [] });
  assert.equal(preview.preview, true);

  const examplePreview = await previewDjangoToFastApi({
    files: [
      {
        language: "python",
        path: "views.py",
        source: "from django.views import View\nurlpatterns = [path('a', view)]\n",
      },
    ],
  });
  assert.equal(examplePreview.summary.matchedFiles, 1);
  assert.equal(djangoToFastApiPlugin.manifest.name, "Django to FastAPI");

  console.log("plugin sdk checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
