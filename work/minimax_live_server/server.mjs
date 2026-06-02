import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const workspaceRoot = resolve(process.cwd());
const outputDir = resolve(workspaceRoot, "outputs");
const envPath = resolve(workspaceRoot, "work/minimax_live_server/.env");
const port = Number(process.env.PORT || 8765);

loadEnvFile(envPath);

const config = {
  apiKey: process.env.MINIMAX_API_KEY || "",
  baseUrls: splitList(process.env.MINIMAX_BASE_URLS || process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1,https://api.minimax.io/v1,https://api.minimax.chat/v1"),
  models: splitList(process.env.MINIMAX_MODELS || process.env.MINIMAX_MODEL || "MiniMax-M2.7,MiniMax-M2.5,MiniMax-M2"),
  timeoutMs: Number(process.env.MINIMAX_TIMEOUT_MS || 45000)
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        provider: "MiniMax",
        configured: Boolean(config.apiKey),
        baseUrls: config.baseUrls.map(maskUrl),
        models: config.models
      });
    }

    if (url.pathname === "/api/generate" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await generateWithMiniMax(body);
      return json(res, 200, { ok: true, result });
    }

    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { ok: false, error: "API route not found" });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = error.statusCode || 500;
    return json(res, status, {
      ok: false,
      error: sanitizeError(error.message || "Server error")
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`内容直播参谋已启动: http://127.0.0.1:${port}/liveops_skill_demo.html`);
  console.log(`MiniMax: ${config.apiKey ? "已读取本地密钥" : "未配置 MINIMAX_API_KEY"}`);
});

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/liveops_skill_demo.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(outputDir, normalized));

  if (!filePath.startsWith(outputDir)) {
    return json(res, 403, { ok: false, error: "Forbidden" });
  }

  if (!existsSync(filePath)) {
    return json(res, 404, { ok: false, error: "File not found" });
  }

  const content = await readFile(filePath);
  const type = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(content);
}

async function generateWithMiniMax(body) {
  if (!config.apiKey) {
    const error = new Error("MiniMax API key is not configured");
    error.statusCode = 500;
    throw error;
  }

  const mode = body?.mode;
  const input = body?.input || {};
  const state = body?.state || {};
  if (!["hotspots", "topics", "script", "replay", "compliance"].includes(mode)) {
    const error = new Error("Invalid generation mode");
    error.statusCode = 400;
    throw error;
  }

  const prompt = buildPrompt(mode, input, state);
  const messages = [
    {
      role: "system",
      content: [
        "你是一个内容型直播策划 Skill 引擎，服务历史、军事史、国际关系、文化、科普、读书会等知识内容账号。",
        "你不做直播带货，不生成商品销售、价格促销、成交转化话术。",
        "军事相关内容只能基于公开资料、历史叙事、战略文化和观点讨论，不能输出具体战术、现实行动、武器制造/改装、敏感坐标、规避监管或伤害性操作。",
        "请只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。"
      ].join("\n")
    },
    { role: "user", content: prompt }
  ];

  let lastError;
  for (const baseUrl of config.baseUrls) {
    for (const model of config.models) {
      try {
        const content = await callChatCompletions(baseUrl, model, messages);
        return parseModelJson(content);
      } catch (error) {
        lastError = error;
        if (!shouldTryNext(error)) throw error;
      }
    }
  }

  throw lastError || new Error("MiniMax request failed");
}

async function callChatCompletions(baseUrl, model, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.35,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        stream: false
      }),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`MiniMax API ${response.status}: ${sanitizeError(text).slice(0, 300)}`);
      error.statusCode = response.status >= 500 ? 502 : 400;
      error.apiStatus = response.status;
      throw error;
    }

    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      const error = new Error("MiniMax response did not include message content");
      error.statusCode = 502;
      throw error;
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(mode, input, state) {
  const compact = {
    mode,
    currentDate: new Date().toISOString().slice(0, 10),
    input,
    selectedTopic: state.selectedTopic || null,
    selectedHotspot: state.selectedHotspot || null,
    hotspots: state.hotspots || [],
    topics: state.topics || [],
    script: state.script || [],
    qna: state.qna || []
  };

  const schemas = {
    hotspots: {
      hotspots: [
        {
          title: "string",
          why: "string",
          angle: "string",
          seed: "string",
          tags: ["string"],
          freshness: "今日可用 | 本周可用 | 长线可用",
          risk: "string"
        }
      ]
    },
    topics: {
      topics: [
        {
          title: "string",
          score: 0,
          angle: "string",
          structure: "string",
          tags: ["string"],
          source: "string",
          risk: "string"
        }
      ]
    },
    script: {
      title: "string",
      subtitle: "string",
      hook: "string",
      script: [
        {
          time: "0-5 分钟",
          title: "string",
          goal: "string",
          key_points: ["string"],
          line: "string",
          interaction: "string"
        }
      ],
      transitions: ["string"],
      opening_scripts: ["string"],
      closing_scripts: ["string"],
      qna: [
        {
          q: "string",
          a: "string"
        }
      ],
      fact_checklist: ["string"]
    },
    replay: {
      replay: [
        {
          title: "string",
          body: "string"
        }
      ]
    },
    compliance: {
      compliance: [
        {
          level: "low | medium | high",
          title: "string",
          body: "string",
          tags: ["string"]
        }
      ]
    }
  };

  const task = {
    hotspots: "根据 input.domain、input.contentGoal、input.audience 和当前日期，推荐 6 个适合内容型直播的热点/选题入口。如果 input.topicSeed 非空，可以把它作为其中 1-2 个候选的灵感，但不要让所有热点都围绕它。热点可以是历史上的今天、近期公共讨论、纪念日、平台常见兴趣点、长线高互动问题。不能编造具体实时新闻事实；如不确定，标为“长线可用”。",
    topics: "围绕 selectedHotspot 或 input.topicSeed 生成 4 个内容型直播选题。优先使用 selectedHotspot；只有 selectedHotspot 为空且 input.topicSeed 非空时，才把 input.topicSeed 当主题约束。每个选题要有资料依据、叙事角度、内容结构和边界风险。score 为 0-100。",
    script: "根据 selectedHotspot、selectedTopic 或 input.topicSeed 生成一份完整直播话术，不是简单大纲。优先使用 selectedHotspot；只有没有选择热点时才使用 input.topicSeed。按直播时长拆成 6-8 段，每段 line 必须是可直接朗读的完整口播稿，建议 160-260 个中文字符；每段给出 key_points 和 interaction；再生成开场话术、转场话术、收尾话术、互动问答和事实核查清单。",
    replay: "根据播后数据、转写和评论摘录生成 4 条内容复盘建议，重点看留存、互动、资料可信度、下一场选题。",
    compliance: "生成 4 条边界审校结果，覆盖事实来源、争议标注、情绪煽动、军事安全/现实映射风险。"
  }[mode];

  return [
    `任务：${task}`,
    `输出 JSON schema：${JSON.stringify(schemas[mode])}`,
    "硬性要求：",
    "1. 必须返回合法 JSON 对象，顶层字段必须与 schema 一致。",
    "2. 不要直播带货话术，不要价格促销，不要成交转化。",
    "3. 主题优先级是 selectedHotspot > selectedTopic > input.topicSeed。只有用户填写 input.topicSeed 且没有选择热点时，它才是硬约束。",
    "4. 历史和军事史内容必须强调公开资料、史料不确定性和现实边界。",
    "5. 字符串内部不要使用英文双引号；如需引用，请使用中文引号“”。",
    "6. 语言要能直接给主播使用，具体、清楚、有节目感。",
    "",
    `输入数据：${JSON.stringify(compact, null, 2)}`
  ].join("\n");
}

function parseModelJson(content) {
  const cleaned = String(content)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      return JSON.parse(extracted);
    }
    const error = new Error("MiniMax did not return valid JSON");
    error.statusCode = 502;
    throw error;
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return "";
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
  }
  return body ? JSON.parse(body) : {};
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSyncText(filePath);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readFileSyncText(filePath) {
  return existsSync(filePath) ? String(readFileSync(filePath, "utf8")) : "";
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeError(value) {
  const key = config?.apiKey;
  let text = String(value || "");
  if (key) text = text.replaceAll(key, "[redacted]");
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}

function shouldTryNext(error) {
  return [400, 401, 403, 404, 429, 500, 502, 503, 504].includes(error.apiStatus) || error.statusCode === 502 || error.name === "AbortError";
}

function maskUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value;
  }
}
