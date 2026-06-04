export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    provider: "MiniMax",
    configured: Boolean(process.env.MINIMAX_API_KEY),
    baseUrls: splitList(process.env.MINIMAX_BASE_URLS || process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1,https://api.minimax.io/v1,https://api.minimax.chat/v1").map(maskUrl),
    models: splitList(process.env.MINIMAX_MODELS || process.env.MINIMAX_MODEL || "MiniMax-M2.7,MiniMax-M2.5,MiniMax-M2")
  });
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function maskUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value;
  }
}
