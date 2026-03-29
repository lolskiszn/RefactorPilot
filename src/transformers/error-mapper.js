export const HTTP_TO_GRPC_STATUS = Object.freeze({
  400: "codes.InvalidArgument",
  401: "codes.Unauthenticated",
  403: "codes.PermissionDenied",
  404: "codes.NotFound",
  409: "codes.AlreadyExists",
  429: "codes.ResourceExhausted",
  500: "codes.Internal",
  503: "codes.Unavailable",
  504: "codes.DeadlineExceeded",
});

const HTTP_ERROR_RE = /http\.Error\(\s*\w+\s*,\s*([^,]+)\s*,\s*(\d{3})\s*\)/g;
const WRITE_HEADER_RE = /\.WriteHeader\(\s*(\d{3})\s*\)/g;
const CUSTOM_HTTP_ERROR_RE = /(?:HTTPError|ApiError|APIError)\s*\{[^}]*Code:\s*(\d{3})[^}]*Msg:\s*([^,}]+)/g;

export function mapHttpStatusToGrpc(code) {
  return HTTP_TO_GRPC_STATUS[Number(code)] ?? "codes.Unknown";
}

export function analyzeHttpErrors(source) {
  const text = String(source ?? "");
  const findings = [];

  for (const match of text.matchAll(HTTP_ERROR_RE)) {
    findings.push({
      grpcCode: mapHttpStatusToGrpc(match[2]),
      httpCode: Number(match[2]),
      kind: "http.Error",
      messageExpression: match[1].trim(),
    });
  }

  for (const match of text.matchAll(WRITE_HEADER_RE)) {
    findings.push({
      grpcCode: mapHttpStatusToGrpc(match[1]),
      httpCode: Number(match[1]),
      kind: "WriteHeader",
      messageExpression: null,
    });
  }

  for (const match of text.matchAll(CUSTOM_HTTP_ERROR_RE)) {
    findings.push({
      grpcCode: mapHttpStatusToGrpc(match[1]),
      httpCode: Number(match[1]),
      kind: "custom-error",
      messageExpression: match[2].trim(),
    });
  }

  return findings;
}

export function renderGrpcErrorReturn(finding) {
  const message = finding.messageExpression ?? `"HTTP ${finding.httpCode}"`;
  return `return nil, status.Errorf(${finding.grpcCode}, %s)`.replace("%s", message);
}
