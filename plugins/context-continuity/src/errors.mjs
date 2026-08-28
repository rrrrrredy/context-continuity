export class ContinuityError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ContinuityError";
    this.code = code;
    this.details = details;
  }
}

export function assertCondition(condition, code, message, details = undefined) {
  if (!condition) {
    throw new ContinuityError(code, message, details);
  }
}

const MAX_PUBLIC_ERROR_STRING_CHARS = 1024;
const MAX_PUBLIC_ERROR_ARRAY_ITEMS = 16;
const MAX_PUBLIC_ERROR_OBJECT_KEYS = 24;
const MAX_PUBLIC_ERROR_DEPTH = 4;

function boundedPublicValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_PUBLIC_ERROR_STRING_CHARS);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (depth >= MAX_PUBLIC_ERROR_DEPTH) {
    return "[details omitted]";
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_PUBLIC_ERROR_ARRAY_ITEMS)
      .map((entry) => boundedPublicValue(entry, depth + 1));
    if (value.length > result.length) {
      result.push("[" + (value.length - result.length) + " entries omitted]");
    }
    return result;
  }
  if (typeof value === "object") {
    const result = {};
    let entries;
    try {
      entries = Object.entries(value).slice(0, MAX_PUBLIC_ERROR_OBJECT_KEYS);
    } catch {
      return "[details unavailable]";
    }
    for (const [rawKey, entry] of entries) {
      const key = String(rawKey).slice(0, 128);
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }
      result[key] = boundedPublicValue(entry, depth + 1);
    }
    if (Object.keys(value).length > entries.length) {
      result.omitted_detail_fields = Object.keys(value).length - entries.length;
    }
    return result;
  }
  return String(value).slice(0, MAX_PUBLIC_ERROR_STRING_CHARS);
}

export function publicError(error) {
  if (error instanceof ContinuityError) {
    const value = {
      code: String(error.code || "CONTINUITY_ERROR").slice(0, 128),
      message: String(error.message || "Context Continuity rejected the request.")
        .slice(0, MAX_PUBLIC_ERROR_STRING_CHARS)
    };
    if (error.details !== undefined) {
      value.details = boundedPublicValue(error.details);
    }
    return value;
  }
  return {
    code: "CONTINUITY_INTERNAL_ERROR",
    message: "Context Continuity encountered an internal error."
  };
}
