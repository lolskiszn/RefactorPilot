export class BaseParser {
  constructor(manifest = {}) {
    this.manifest = Object.freeze({
      id: manifest.id ?? "plugin:unknown",
      language: manifest.language ?? "unknown",
      name: manifest.name ?? "Unnamed parser",
      version: manifest.version ?? "0.0.0",
    });
  }

  get id() {
    return this.manifest.id;
  }

  get language() {
    return this.manifest.language;
  }

  get name() {
    return this.manifest.name;
  }

  get version() {
    return this.manifest.version;
  }

  parse() {
    throw new Error("BaseParser.parse() must be implemented by a subclass.");
  }

  analyzeFile(file) {
    return this.parse(file?.source ?? "", file?.path ?? null, file);
  }

  analyzeWorkspace(files = []) {
    return {
      files: files.map((file) => this.analyzeFile(file)),
      language: this.language,
      parser: this.manifest,
    };
  }
}
