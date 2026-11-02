/**
 * 火山引擎配置一键验证（不依赖数据库/后端服务，直接测三个产品连通性）
 * 用法：npm run check:volcengine
 *
 * ① 豆包搜索（SearchInfinity）→ VOLC_SEARCH_API_KEY
 * ② 方舟 LLM（号码推荐）       → ARK_API_KEY + ARK_LLM_ENDPOINT_ID
 * ③ 方舟 Vision（OCR）         → ARK_API_KEY + ARK_VISION_MODEL
 */
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

// ---------- 简易 .env 解析（避免额外依赖） ----------
function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) {
    console.log('❌ 未找到 .env，请先执行: cp .env.example .env 并填入 Key');
    process.exit(1);
  }
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();
const log = (name: string, ok: boolean, detail = '') =>
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);

let pass = 0;
let fail = 0;

async function main() {
  console.log('== 火山引擎配置检查 ==\n');

  // ---------- ① 豆包搜索 ----------
  const searchKey = env.VOLC_SEARCH_API_KEY;
  console.log('① 开奖查询 · SearchInfinity（豆包搜索）');
  if (!searchKey) {
    log('VOLC_SEARCH_API_KEY 未配置', false, '留空则开奖同步跳过（不影响其他功能）');
    fail++;
  } else {
    try {
      const resp = await fetch('https://torchlight.byteintlapi.com/search_api/web_search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${searchKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '双色球 最新一期 开奖号码 红球 蓝球', count: 2, language: 'ZH-HANS' }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const json = (await resp.json()) as any;
        const n = json?.data?.search_results?.length ?? 0;
        log('搜索 API 连通', true, `返回 ${n} 条结果`);
        pass++;
      } else {
        log(`搜索 API 返回 HTTP ${resp.status}`, false, await resp.text().then((t) => t.slice(0, 120)));
        fail++;
      }
    } catch (err) {
      log('搜索 API 调用异常', false, (err as Error).message.slice(0, 120));
      fail++;
    }
  }
  console.log();

  // ---------- ② 方舟 LLM ----------
  const arkKey = env.ARK_API_KEY;
  const endpointId = env.ARK_LLM_ENDPOINT_ID;
  console.log('② 号码推荐 · 方舟 LLM');
  if (!arkKey || !endpointId) {
    log('ARK_API_KEY / ARK_LLM_ENDPOINT_ID 未配置', false, '留空则推荐返回本地 mock（不影响联调）');
    fail++;
  } else {
    try {
      const client = new OpenAI({ apiKey: arkKey, baseURL: env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3' });
      const completion = await client.chat.completions.create({
        model: endpointId,
        messages: [{ role: 'user', content: '只输出 JSON：{"redBalls":["01","08","15"],"blueBalls":["09"]}' }],
        max_tokens: 64,
      });
      const content = completion.choices[0]?.message?.content ?? '';
      log('LLM 连通', true, `接入点 ${endpointId.slice(0, 16)}… 返回: ${content.slice(0, 40)}`);
      pass++;
    } catch (err: any) {
      const msg = err?.status ? `HTTP ${err.status}` : (err as Error).message;
      log('LLM 调用失败', false, `${msg} — 常见原因见 docs/火山引擎配置指南.md §5`);
      fail++;
    }
  }
  console.log();

  // ---------- ③ 方舟 Vision（OCR） ----------
  const visionModel = env.ARK_VISION_MODEL || 'deepseek-v4-1-flash-261017';
  console.log('③ 彩票 OCR · 方舟 Vision');
  if (!arkKey) {
    log('ARK_API_KEY 未配置', false, '留空则 OCR 返回本地 mock（不影响联调）');
    fail++;
  } else {
    try {
      const client = new OpenAI({ apiKey: arkKey, baseURL: env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3' });
      // 32x32 红色 PNG（仅验证鉴权与模型可用，非真实彩票识别；注意模型最小支持 14px）
      const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGM4ISdHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULACXLED3NSh4NAAAAAElFTkSuQmCC';
      const completion = await client.chat.completions.create({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '这张图片主色是什么？用中文一句话回答。' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}` } },
            ],
          },
        ],
        max_tokens: 64,
      });
      const content = completion.choices[0]?.message?.content ?? '';
      log('Vision 模型连通', true, `${visionModel} → ${content.slice(0, 40)}`);
      pass++;
    } catch (err: any) {
      const msg = err?.status ? `HTTP ${err.status}` : (err as Error).message;
      log('Vision 调用失败', false, `${msg} — 常见原因见 docs/火山引擎配置指南.md §5`);
      fail++;
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 未通过`);
  console.log(fail === 0 ? '\n🎉 三件套全部连通，可以填 Key 开始真实调用！' : '\n有失败项，对照 docs/火山引擎配置指南.md §5 排查后重试');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
