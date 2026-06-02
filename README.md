# 内容直播参谋 Skill

这是一个面向知识型直播的 AI 直播策划工作台原型，适合历史、军事史、国际关系、文化、科普、读书会等内容方向。

在线静态版可长期访问，但 GitHub Pages 不能安全保存 MiniMax API Key，所以线上页面会优先使用本地规则生成基础结果。需要 MiniMax 增强生成时，请在本地或未来的云端代理中配置密钥。

## 功能

- 推荐热点选题
- 生成完整直播话术
- 主播提词器
- 复盘与边界审校
- Markdown / JSON 导出

## 本地运行 MiniMax 增强版

1. 创建环境变量文件：

```bash
cp work/minimax_live_server/.env.example work/minimax_live_server/.env
```

2. 在 `work/minimax_live_server/.env` 中填入自己的 MiniMax API Key：

```bash
MINIMAX_API_KEY=你的_key
```

3. 启动本地服务：

```bash
npm start
```

4. 打开：

```text
http://127.0.0.1:8765/liveops_skill_demo.html
```

## 密钥安全

`work/minimax_live_server/.env` 已加入 `.gitignore`，不要把真实 API Key 提交到 GitHub。若要部署可长期使用的大模型增强版，应使用 Vercel、Cloudflare Workers、Render 等后端代理服务保存环境变量，再让前端访问代理接口。
