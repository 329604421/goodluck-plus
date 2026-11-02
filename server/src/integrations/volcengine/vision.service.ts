import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LOCAL_OCR_MOCK, LOCAL_RECOMMEND_MOCK } from './local-mock';

/**
 * 视觉理解模型 OCR（文档 §6.2）：
 * 图片 base64 直传，不落盘。无 ARK_API_KEY 时返回本地 mock（联调用）。
 *
 * ⚠️ 模型选型（2026-08 两次切换 → 2026-10-27 统一）：
 * - `doubao-1.5-vision-pro` 系列已于 2026-03-31 被官方下线（LAS 算子下线公告）
 * - `doubao-seed-1.6-vision` 亦将下线，不可继续依赖
 * - `doubao-seed-2.0-lite` 曾作为默认（2026-08）；2026-10-27 起统一为
 *   `deepseek-v4-1-flash-261017`（已实测支持 image_url + json_object + thinking:disabled，
 *   且 prompt 需含 "json" 字样才允许 response_format=json_object）
 * - 模型名直调失败则建推理接入点填 ep-xxx（ARK_VISION_MODEL 支持直填）
 */
export interface OcrResult {
  lotteryName: string;
  period: string;
  drawDate: string;
  ocrStatus: string;
  betCount: number;
  multiplier: number;
  totalAmount: string;
  bets: Array<{ id: number; red: string[]; blue: string[]; mult: number }>;
}

const OCR_PROMPT = `你是一个彩票识别助手。请仔细识别这张彩票照片，输出严格的 JSON 格式：
{
  "lotteryName": "双色球" 或 "大乐透",
  "period": "第 XXXXXXX 期",
  "drawDate": "YYYY-MM-DD",
  "betCount": 注数,
  "multiplier": 整体倍数,
  "bets": [
    { "id": 1, "red": ["01"-"33" 共 6 个 双色球 / "01"-"35" 共 5 个 大乐透],
      "blue": ["01"-"16" 共 1 个 双色球 / "01"-"12" 共 2 个 大乐透],
      "mult": 单注倍数 }
  ]
}
只输出 JSON，不要解释。`;

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('arkApiKey');
    if (key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: this.config.get<string>('arkBaseUrl'),
        timeout: 60_000, // OCR 识别上限 60s
      });
    }
  }

  async recognizeTicketImage(imageBytes: Buffer): Promise<OcrResult> {
    // 本地无 Key 兜底：返回 mock 识别结果（联调走通全流程）
    if (!this.client) {
      this.logger.warn('未配置 ARK_API_KEY，OCR 返回本地 mock 结果');
      return { ...LOCAL_OCR_MOCK };
    }

    const imageB64 = imageBytes.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${imageB64}`;

    // ⚠️ 实测（2026-10-27 共 12 次对比）：`deepseek-v4-1-flash` 在 content 里「文本在前」时，
    //    会把 response_format 回显成 {"type":"json_object"} 塞进输出（6/6 命中，其中 1 次整段只剩这个键），
    //    而「图片在前」6/6 输出干净、1.4~2.3s。所以图片必须排在 text 之前。
    //    兜底：输出无有效注数时重试一次（避免把空结果当成功返回给前端）。
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const completion = await (this.client.chat.completions.create as any)({
        model: this.config.get<string>('arkVisionModel') ?? 'deepseek-v4-1-flash-261017',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      });

      const raw = completion.choices[0]?.message?.content ?? '';
      const parsed = this.parseOcrJson(raw);
      if (parsed && Array.isArray(parsed.bets) && parsed.bets.length > 0) {
        return parsed;
      }
      lastErr = new Error(`OCR 输出不含有效注数（第 ${attempt} 次）: ${String(raw).slice(0, 120)}`);
      this.logger.warn(lastErr.message);
    }
    throw lastErr ?? new Error('OCR 输出不含有效注数');
  }

  /** JSON 解析（含 ```json 包裹 / 前后杂音的容错，LLM 即使在 json_object 下也会偶发包裹） */
  private parseOcrJson(raw: string): OcrResult | null {
    try {
      return JSON.parse(raw) as OcrResult;
    } catch (e) {
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as OcrResult;
        } catch (e2) {
          return null;
        }
      }
      return null;
    }
  }
}

export { LOCAL_RECOMMEND_MOCK };
