import { MAX_PROMPT_EXCERPT_CHARS } from "./constants.mjs";
import { redactText } from "./redact.mjs";
import { sha256 } from "./util.mjs";

const PATTERNS = [
  {
    name: "reset",
    pattern: /\b(?:new task|start over|forget (?:the )?previous|reset (?:the )?(?:task|continuity state))\b|新任务|重新开始|清除之前|忘掉之前|重置连续性状态/iu
  },
  {
    name: "correction",
    pattern: /\b(?:correction|actually|that(?:'s| is) wrong|not that|instead)\b|纠正|不对|不是.+而是|改成|应该是|我说的是/iu
  },
  {
    name: "goal_change",
    pattern: /\b(?:change (?:the )?goal|switch to|new goal|now I want|do this instead)\b|目标改|改为|换成|现在要|不要再/iu
  },
  {
    name: "constraint",
    pattern: /\b(?:must|must not|do not|never|required|only|avoid)\b|必须|不得|不要|只能|禁止|务必|避免/iu
  },
  {
    name: "authorization",
    pattern: /\b(?:authorize|authorization\s*(?::|is\b|was\b|has\b|changed\b|granted\b|revoked\b|denied\b|updated\b)|permission\s+(?:to\b|is\b|was\b|has\b|changed\b|granted\b|revoked\b|denied\b|updated\b)|go ahead and (?:push|publish|deploy|delete|install)|you can (?:push|publish|deploy|delete|install)|proceed with (?:the )?(?:push|publication|release|deployment|deletion|installation)|revoke (?:the )?(?:earlier )?permission|do not publish|do not delete|do not install)(?=\s|$|[.,;!?])|允许|授权|撤销授权|可以发布|可以推送|可以部署|不要发布|不要删除|不要安装|把它删掉/iu
  },
  {
    name: "management_delete",
    pattern: /\b(?:delete|remove) (?:the )?continuity state\b|删除连续性状态/iu
  },
  {
    name: "management_confirm",
    pattern: /\bconfirm (?:delete|reset) continuity state\b|确认(?:删除|重置)连续性状态/iu
  },
  {
    name: "continuity_off",
    pattern: /\b(?:(?:turn|switch) continuity off|disable continuity(?: for this task)?|confirm off continuity state)\b|关闭连续性(?:插件|状态)?/iu
  },
  {
    name: "continuity_on",
    pattern: /\b(?:(?:turn|switch) continuity on|enable continuity(?: for this task)?|confirm on continuity state)\b|开启连续性(?:插件|状态)?/iu
  },
  {
    name: "dispute",
    pattern: /\b(?:disagree|not convinced|unresolved disagreement)\b|不同意|有分歧|尚未解决/iu
  }
];
const EXCERPT_SIGNALS = new Set([
  "reset",
  "correction",
  "goal_change",
  "constraint",
  "authorization",
  "dispute"
]);


export function detectPromptSignals(prompt, projection) {
  const text = String(prompt || "");
  const signals = [];
  const hasState = projection.generation > 0
    || Object.keys(projection.pending_prompt_signals).length > 0;
  if (!hasState) {
    signals.push("first_prompt");
  }
  for (const entry of PATTERNS) {
    if (entry.pattern.test(text)) {
      signals.push(entry.name);
    }
  }
  return [...new Set(signals)];
}

export function promptSignalPayload(prompt, projection) {
  const text = String(prompt || "");
  const signals = detectPromptSignals(text, projection);
  const shouldStoreExcerpt = signals.some((signal) => EXCERPT_SIGNALS.has(signal));
  const redacted = shouldStoreExcerpt
    ? redactText(text, MAX_PROMPT_EXCERPT_CHARS)
    : {
      text: "",
      truncated: false,
      redacted: false,
      findings: []
    };
  return {
    prompt_sha256: sha256(text),
    prompt_length: text.length,
    signals,
    excerpt: shouldStoreExcerpt ? redacted.text : null,
    excerpt_truncated: shouldStoreExcerpt
      ? redacted.truncated || text.length > MAX_PROMPT_EXCERPT_CHARS
      : false,
    secret_redactions: redacted.findings
  };
}
