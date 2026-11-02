import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LOCAL_RECOMMEND_MOCK } from './local-mock';

export interface RecommendResult {
  systemName: string;
  date: string;
  userText: string;
  redLabel: string;
  blueLabel: string;
  redBalls: string[];
  blueBalls: string[];
  summary: string;
  disclaimer: string;
}

interface UserConfigInput {
  name?: string;
  gender?: string;
  birth?: string;
}

interface LunarInfoInput {
  solarDate?: string;
  lunar?: string;
  ganZhi?: Record<string, string>;
  constellation?: string;
}

const ASTROLOGY_TEMPLATE = `你是星座占星推演助手。请基于以下信息，为用户生成一组彩票号码并给出简短分析。

用户信息：
- 姓名：{name}
- 性别：{gender}
- 出生日期：{birth}
- 今日：{date}
- 今日干支：{ganZhi}
- 星座：{constellation}
- 彩种：{lotteryName}

要求：
1. 双色球：6 个红球（01-33）+ 1 个蓝球（01-16）；大乐透：5 个前区（01-35）+ 2 个后区（01-12）
2. 输出严格 JSON，字段：systemName/date/userText/redLabel/blueLabel/redBalls/blueBalls/summary/disclaimer
3. summary 控制在 80 字以内
4. disclaimer 固定为："本推荐仅供娱乐，不构成任何购彩建议"
只输出 JSON，不要解释。`;

const ICHING_TEMPLATE = `你是五行推命推演助手。请基于以下信息，结合今日卦象与五行旺相，为用户生成一组彩票号码。

用户信息：{userBlock}

要求：
1. 双色球：6 红（01-33）+ 1 蓝（01-16）；大乐透：5 前区（01-35）+ 2 后区（01-12）
2. 输出严格 JSON，字段：systemName/date/userText/redLabel/blueLabel/redBalls/blueBalls/summary/disclaimer
3. summary 控制在 80 字以内
只输出 JSON，不要解释。`;

/**
 * 火山方舟 doubao-seed-2-1-pro 集成（文档 §6.3）：
 * openai npm 包兼容协议；model 填推理接入点 ID（ep-xxx）。
 * 无 ARK_API_KEY / ARK_LLM_ENDPOINT_ID 时返回本地 mock。
 */
@Injectable()
export class ArkService {
  private readonly logger = new Logger(ArkService.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('arkApiKey');
    if (key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: this.config.get<string>('arkBaseUrl'),
        timeout: 90_000, // LLM 生成上限 90s，避免请求悬挂
      });
    }
  }

  async generateRecommendation(
    userConfig: UserConfigInput,
    lunarInfo: LunarInfoInput,
    system: 'astrology' | 'iching',
    lottery: 'ssq' | 'dlt',
  ): Promise<RecommendResult> {
    const userText = `${userConfig.name || '彩友'} · ${userConfig.birth || '生日未填'} 生 · 今日 ${lunarInfo.lunar ?? ''}`;

    // 本地无 Key 兜底
    const endpointId = this.config.get<string>('arkLlmEndpointId');
    if (!this.client || !endpointId) {
      this.logger.warn('未配置 ARK_API_KEY / ARK_LLM_ENDPOINT_ID，推荐返回本地 mock');
      const key = `${lottery}${system === 'iching' ? 'Iching' : 'Astrology'}`;
      const mock = LOCAL_RECOMMEND_MOCK[key] ?? LOCAL_RECOMMEND_MOCK.ssqAstrology;
      return {
        systemName: system === 'astrology' ? '星座占星' : '五行推命',
        date: lunarInfo.solarDate ?? '',
        userText,
        redLabel: '',
        blueLabel: '',
        redBalls: mock.redBalls,
        blueBalls: mock.blueBalls,
        summary: mock.summary,
        disclaimer: '本推荐仅供娱乐，不构成任何购彩建议',
      };
    }

    const lotteryName = lottery === 'ssq' ? '双色球' : '大乐透';
    const ganZhi = lunarInfo.ganZhi ? JSON.stringify(lunarInfo.ganZhi) : '';
    const prompt =
      system === 'astrology'
        ? ASTROLOGY_TEMPLATE.replace('{name}', userConfig.name ?? '')
            .replace('{gender}', userConfig.gender ?? '')
            .replace('{birth}', userConfig.birth ?? '')
            .replace('{date}', lunarInfo.solarDate ?? '')
            .replace('{ganZhi}', ganZhi)
            .replace('{constellation}', lunarInfo.constellation ?? '')
            .replace('{lotteryName}', lotteryName)
        : ICHING_TEMPLATE.replace(
            '{userBlock}',
            `姓名：${userConfig.name ?? ''} / 性别：${userConfig.gender ?? ''} / 生日：${userConfig.birth ?? ''} / 今日：${lunarInfo.solarDate ?? ''} / 干支：${ganZhi} / 彩种：${lotteryName}`,
          );

    const completion = await (this.client.chat.completions.create as any)({
      model: endpointId,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      // 关闭深度思考：推荐场景要速度，开启 thinking 会让响应慢数倍
      thinking: { type: 'disabled' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as RecommendResult;
    return { ...parsed, userText };
  }
}
