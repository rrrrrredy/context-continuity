import { boundedText } from "./util.mjs";

const SECRET_PATTERNS = [
  {
    name: "private_key_block",
    pattern: /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g
  },
  {
    name: "authorization_header",
    pattern: /\bAuthorization\s*:\s*(?:Basic|Bearer)\s+[^\s,;]+/gi
  },
  {
    name: "slack_token",
    pattern: /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/gi
  },
  {
    name: "openai_key",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g
  },
  {
    name: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}\b/g
  },
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi
  },
  {
    name: "assigned_secret",
    pattern: /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;]{6,})/gi
  }
];

export function redactText(value, maximum = 2000) {
  let text = String(value ?? "");
  const findings = [];
  for (const entry of SECRET_PATTERNS) {
    text = text.replace(entry.pattern, (match, label) => {
      findings.push(entry.name);
      if (entry.name === "assigned_secret" && label) {
        return String(label) + "=[REDACTED]";
      }
      return "[REDACTED:" + entry.name + "]";
    });
  }
  const bounded = boundedText(text, maximum);
  return {
    text: bounded.text,
    truncated: bounded.truncated,
    redacted: findings.length > 0,
    findings: [...new Set(findings)]
  };
}
