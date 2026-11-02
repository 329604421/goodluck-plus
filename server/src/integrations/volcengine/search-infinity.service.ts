import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SearchInfinity（豆包搜索 Custom 版）集成（文档 §6.1）：
 * - 端点：https://open.feedcoopapi.com/search_api/web_search（API Key 接入；旧 torchlight 端点已失效）
 * - 请求字段大小写敏感：Query / SearchType / Count / Filter
 * - 响应：Result.WebResults[]（Content 正文 / Summary 摘要 / Title / Url）
 * - 后端正则二次解析红蓝球（兼容"红球…蓝球…"与官方公告"开奖号码：6红+1蓝"两种格式）
 * - 无 VOLC_SEARCH_API_KEY 时抛错由上层任务跳过（本地联调不依赖真实数据）
 */
/**
 * 站点过滤按彩种区分（2026-08-30 修复）：
 * 原先统一用 cwl.gov.cn（中国福利彩票，仅双色球官方站）|sporttery.cn|zhcw.com，
 * 大乐透（体彩）官方站 www.lottery.gov.cn 不在列表内 → 大乐透首轮召回极差、
 * 几乎必然落到"首轮解析失败"，长期表现为"大乐透开奖号码查不到"。
 */
const SEARCH_SITES: Record<string, string> = {
  ssq: 'cwl.gov.cn|zhcw.com|500.com|sina.com.cn',
  dlt: 'lottery.gov.cn|sporttery.cn|zhcw.com|500.com|sina.com.cn',
};
const DEFAULT_SITES = 'cwl.gov.cn|lottery.gov.cn|sporttery.cn|zhcw.com|500.com';

/** 搜索用彩种名：体彩官方称"超级大乐透"，仅用"大乐透"召回质量明显更差 */
const SEARCH_NAMES: Record<string, string> = { ssq: '双色球', dlt: '超级大乐透' };

@Injectable()
export class SearchInfinityService {
  private readonly logger = new Logger(SearchInfinityService.name);

  constructor(private readonly config: ConfigService) {}

  private get enabled(): boolean {
    return !!this.config.get<string>('volcSearchApiKey');
  }

  /**
   * 搜索开奖结果。
   * @param opts.noSiteFilter 历史期补差时置 true：官方三站（cwl/sporttery/zhcw）对
   *        较早期号的召回不足（常只返回最新期列表页/开机号页），去掉站点过滤后
   *        地方福彩公告页（贵州/深圳/上海等）与门户站可召回完整号码正文。
   */
  async searchDrawResult(
    lotteryName: string,
    issueNo: string,
    opts?: { noSiteFilter?: boolean; lotteryType?: string },
  ): Promise<unknown> {
    if (!this.enabled) {
      throw new Error('未配置 VOLC_SEARCH_API_KEY，跳过开奖同步（本地联调可忽略）');
    }
    const type = opts?.lotteryType ?? '';
    const searchName = SEARCH_NAMES[type] ?? lotteryName;
    const payload: Record<string, unknown> = {
      Query: issueNo
        ? `${searchName} 第 ${issueNo} 期 开奖号码`
        : `${searchName} 最新一期 开奖号码`,
      SearchType: 'web',
      Count: 10,
    };
    if (!opts?.noSiteFilter) {
      payload.Filter = { Sites: SEARCH_SITES[type] ?? DEFAULT_SITES };
    }
    this.logger.log(
      `SearchInfinity 查询: "${payload.Query}"${opts?.noSiteFilter ? '（无站点过滤）' : ''}`,
    );
    const res = await fetch('https://open.feedcoopapi.com/search_api/web_search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get<string>('volcSearchApiKey')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`SearchInfinity HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    // 业务错误（HTTP 200 但 ResponseMetadata.Error 存在）也视为失败
    const err = (json.ResponseMetadata as { Error?: { Code?: string; Message?: string } })?.Error;
    if (err) throw new Error(`SearchInfinity ${err.Code}: ${err.Message}`);
    return json;
  }

  /** 从搜索响应解析双色球（6 红 + 1 蓝）；issueNo 用于过滤非目标期页面 */
  parseSsqDraw(searchResponse: unknown, issueNo?: string): ParsedDraw | null {
    return this.parseDraw(searchResponse, 6, 33, issueNo);
  }

  /** 从搜索响应解析大乐透（5 前区 + 2 后区）；issueNo 用于过滤非目标期页面 */
  parseDltDraw(searchResponse: unknown, issueNo?: string): ParsedDraw | null {
    return this.parseDraw(searchResponse, 5, 35, issueNo);
  }

  /** 兼容两种响应结构：Result.WebResults[]（新）与 data.search_results[]（旧） */
  private extractItems(searchResponse: unknown): Array<Record<string, unknown>> {
    const root = searchResponse as {
      Result?: { WebResults?: Array<Record<string, unknown>> };
      data?: { search_results?: Array<Record<string, unknown>> };
    };
    return root?.Result?.WebResults ?? root?.data?.search_results ?? [];
  }

  private parseDraw(
    searchResponse: unknown,
    redCount: number,
    redMax: number,
    issueNo?: string,
  ): ParsedDraw | null {
    const items = this.extractItems(searchResponse);
    // 强制要求内容含目标期号（搜索 query 即"第 xxx 期"，含期号才是目标页；否则可能误取综合页/主页）
    const issueKey = issueNo ? issueNo.replace(/^20/, '') : ''; // 2026092 → 26092（公告常见写法）
    const ordered = [...items]
      .filter((item) => !this.isJunkPage(item))
      .filter((item) => !this.isBadUrl(item))
      .filter((item) => (issueNo ? this.matchesIssue(item, issueNo, issueKey) : true))
      .sort((a, b) => {
        // 优先：含「开奖公告」；其次按 URL 长度（综合页通常无 URL）
        const scoreA = this.pageScore(a, issueNo, issueKey);
        const scoreB = this.pageScore(b, issueNo, issueKey);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const urlA = String(a['Url'] ?? a['url'] ?? '');
        const urlB = String(b['Url'] ?? b['url'] ?? '');
        return urlB.length - urlA.length;
      });

    // 多候选投票：每页只取第一个成功解析（页内去重），页间按号码组合投票。
    // 背景：实测存在"错误页面号码格式合法"的脏数据风险（dlt 26090 曾误取无关页号码），
    // 官方公告/多地福彩公告对同期号码表述一致 → 众数即高置信结果。
    const candidates: Array<{ parsed: ParsedDraw; key: string; title: string }> = [];
    // 「号码矩阵表头」误读识别（2026-10-07 事故修复）：
    // 走势页/首页常把全部可选号码排成表头「前区 后区 01 02 03 04 05 06 07 08 …」，
    // 兜底模式 D 会把最前面 redCount+needBlue 个数字当成开奖号码——实测大乐透
    // 26114 期因此写入「01 02 03 04 05 + 06 07」。真开奖号码从 01 起整段连号概率
    // 极低，且模式 A/B/C 优先级更高，故该过滤无误伤风险。
    const needBlueCount = redCount === 6 ? 1 : 2;
    const isNumberHeader = (p: ParsedDraw): boolean => {
      const red = p.redBalls.map(Number).sort((a, b) => a - b);
      const blue = p.blueBalls.map(Number).sort((a, b) => a - b);
      return (
        red.length > 0 &&
        red.every((v, i) => v === i + 1) &&
        blue.every((v, i) => v === redCount + i + 1)
      );
    };
    for (const item of ordered) {
      const content = String(item['Content'] ?? item['content'] ?? item['Summary'] ?? '');
      const parsed = this.parseContentNearIssue(content, issueNo, issueKey, redCount, redMax, item);
      if (!parsed) continue;
      if (isNumberHeader(parsed)) {
        this.logger.warn(
          `疑似号码矩阵表头，已丢弃：红${parsed.redBalls.join(',')} 蓝${parsed.blueBalls.join(',')}` +
            `（${String(item['Url'] ?? item['url'] ?? '')}）`,
        );
        continue;
      }
      candidates.push({
        parsed,
        key: `${parsed.redBalls.join(',')}|${parsed.blueBalls.join(',')}`,
        title: String(item['Title'] ?? '').slice(0, 40),
      });
    }
    if (!candidates.length) return null;

    // 奖池提取：从所有通过期号过滤的页面正文中提取"奖池（累计/滚存）金额"，
    // 官方公告的"下期一等奖奖池累计金额"正是下一期（当前待开期）的奖池 → 取数值最大者
    let prizePoolCent = 0;
    for (const item of ordered) {
      const content = String(item['Content'] ?? item['content'] ?? item['Summary'] ?? '');
      const cent = this.extractPrizePoolCent(content);
      if (cent > prizePoolCent) prizePoolCent = cent;
    }

    // 投票取众数
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
    let bestKey = candidates[0].key;
    let bestN = 0;
    for (const [k, n] of counts) {
      if (n > bestN) { bestN = n; bestKey = k; }
    }
    const best = candidates.find((c) => c.key === bestKey)!;
    if (bestN === 1) {
      // 单一来源：接受但提示低置信（历史期偶发；多源一致时 bestN >= 2）
      this.logger.warn(
        `开奖号码仅单一来源（${best.title}），建议核对：红${best.parsed.redBalls.join(',')} 蓝${best.parsed.blueBalls.join(',')}`,
      );
    } else {
      this.logger.log(`开奖号码多源一致（${bestN} 个来源）`);
    }
    if (prizePoolCent > 0) {
      best.parsed.prizePoolCent = prizePoolCent;
      this.logger.log(`奖池提取: ${prizePoolCent} 分`);
    }
    return best.parsed;
  }

  /**
   * 在目标期号**邻近窗口**内解析开奖号码（2026-08-20 强化）。
   * 背景：主页/列表页/分类页常把多期数据混排（期号在表格头、号码在另一行甚至不同期），
   * 旧逻辑全文匹配会把"期号 A + 号码 B"错误拼接 → 期号对、号码错。
   * 修复：只在期号出现位置前后（-60 ~ +400 字符）内找号码，并扩展新闻式写法
   * （"前区开出…后区开出…"、"开出号码："、"26091期 08月12日 - 03 - 04…"）。
   */
  private parseContentNearIssue(
    content: string,
    issueNo?: string,
    issueKey?: string,
    redCount?: number,
    redMax?: number,
    item?: Record<string, unknown>,
  ): ParsedDraw | null {
    if (!redCount || !redMax) return null;
    const needBlue = redCount === 6 ? 1 : 2;
    const inRange = (v: string, max: number) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= max;
    };
    const trySplit = (raw: string, rn: number, bn: number): { red: string[]; blue: string[] } | null => {
      const nums = raw
        .split(/[\s+;；,，|、-]+/)
        .filter((x) => /^\d{1,2}$/.test(x.trim()))
        .map((x) => String(Number(x)).padStart(2, '0'));
      if (nums.length < rn + bn) return null;
      const red = [...new Set(nums.slice(0, rn))].sort();
      const blue = [...new Set(nums.slice(rn, rn + bn))].sort();
      if (red.length === rn && red.every((x) => inRange(x, redMax)) && blue.length >= bn && blue.every((x) => inRange(x, 16))) {
        return { red, blue };
      }
      return null;
    };

    for (const key of [issueNo, issueKey]) {
      if (!key) continue;
      let idx = -1;
      while ((idx = content.indexOf(key, idx + 1)) !== -1) {
        // 2026-09-01 二次修复（防"期号对、号码错"）：扫描区在第一个【其他期号】处截断，
        // 汇总页混排（第26098期… 第26099期…）不会把 26098 的号码卷入 26099。
        // 目标期号自身的再次出现不截断（新闻常先提期号再报号码）。
        const afterIssue = content.slice(idx + key.length, idx + 400);
        const trustLen = this.trustEnd(afterIssue, key);
        const segment = content.slice(idx, idx + key.length + trustLen);
        // 模式 A：官方公告/新闻「开奖号码/中奖号码/开出号码：…」（兼容"号码为"写法）
        const mA = segment.match(/(?:开奖|中奖|开出)号码?[：:为\s]*([\d\s+;；,，|、-]{5,60})/);
        if (mA && mA[1] && !(redCount === 6 && /\+/.test(mA[1]))) {
          const r = trySplit(mA[1], redCount, needBlue);
          if (r) return this.buildFromSplit(r, item);
        }
        // 模式 B：站点/新闻「前区(开出)(号码)… 后区(开出)(号码)…」「红球…蓝球…」
        // 2026-09-01：允许省略"号码"字样与"为"字（"开奖号码为前区02、17、20、29、33，后区08、09"）
        const mB = segment.match(
          /(?:前区|红球)(?:开出)?(?:号码)?[：:为\s]*([\d\s;；,，|、-]+)(?:后区|蓝球)(?:开出)?(?:号码)?[：:为\s]*([\d\s;；,，|、-]{1,16})/,
        );
        if (mB) {
          const red = [...new Set(mB[1].split(/[\s;；,，|、-]+/).filter((x) => /^\d{1,2}$/.test(x)))].sort();
          const blue = [...new Set(mB[2].split(/[\s;；,，|、-]+/).filter((x) => /^\d{1,2}$/.test(x)))].sort();
          if (red.length === redCount && red.every((x) => inRange(x, redMax)) && blue.length >= needBlue && blue.every((x) => inRange(x, 16))) {
            return this.buildResultFromLists(red, blue, redCount, redMax, item);
          }
        }
        // 模式 C：微博/表格「26091期 08月12日 - 03 - 04 - 07 - 12 - 32 - 01 - 02」
        // 2026-09-01：期号与"期"之间允许空格（"第 26099 期"）；分隔符扩展支持 + 和空格
        // （楚天都市报「第26099期 02 17 20 29 33+08 09」）
        const mC = segment.match(
          /(?:第\s*)?\d{4,7}\s*期[^\d]{0,40}(?:周[一二三四五六日])?[^\d]{0,40}(?:[-+—–]|\s)?\s*([\d]{2}(?:[\s+—–-]{1,3}[\d]{2}){5,8})/,
        );
        if (mC && mC[1]) {
          const r = trySplit(mC[1], redCount, needBlue);
          if (r) return this.buildFromSplit(r, item);
        }
        // 模式 D（2026-09-01 兜底）：剥离日期/星期噪声后，直接提取"红蓝总数"长的数字序列。
        // 背景：体彩官网「乐透数字」页写法为「第26099期 08月31日 周一 02 17 20 29 33 08 09」，
        // 无任何引导词且夹日期星期，A/B/C 全不命中 → 26099 期同步连续失败。
        // 只在期号之后扫描（afterIssue）；期号与号码之间若夹了其他期号则该段不可信，跳过。
        // 防脏数据：三位数金额（千分位）因位数超限被过滤；重复号码导致去重后数量不足被过滤
        // （如 7星彩 8 个一位数）；解析结果仍进入多候选投票机制。
        const cleaned = afterIssue.slice(0, trustLen)
          .replace(/\d{2,4}[年/.\-]\d{1,2}[月/.\-]\d{1,2}[日]?/g, ' ')
          .replace(/[周星期][一二三四五六日天]/g, ' ');
        const seqRe = /(?:^|[^\d])(\d{1,2}(?:[\s+、,，;；|·]+\d{1,2}){4,9})(?![\d])/g;
        let sm: RegExpExecArray | null;
        while ((sm = seqRe.exec(cleaned)) !== null) {
          // 期号与号码之间出现其他期号 → 号码可能属于其他期（汇总页混排），跳过该段
          if (/\d{4,7}\s*期/.test(cleaned.slice(0, sm.index))) continue;
          const r = trySplit(sm[1], redCount, needBlue);
          if (r) return this.buildFromSplit(r, item);
        }
      }
    }
    return null;
  }

  /**
   * 可信扫描长度：afterIssue 中第一个【其他期号】（≠目标期）出现位置之前的部分。
   * 用于防汇总页混排：第26098期开奖号码…第26099期开奖号码…，26099 的扫描区
   * 必须在 26098/26100 等其他期号处截断；目标期号自身的再次出现不截断。
   */
  private trustEnd(s: string, issueKey: string): number {
    const re = /\d{4,7}\s*期/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const num = m[0].replace(/[^\d]/g, '').replace(/^20/, '');
      if (num !== issueKey) return m.index;
    }
    return s.length;
  }

  /** 模式 A/C 用：按"前 redCount 个红 + 后 blue 个蓝"切分并构造结果 */
  private buildFromSplit(
    r: { red: string[]; blue: string[] },
    item?: Record<string, unknown>,
  ): ParsedDraw {
    return {
      redBalls: r.red.map((x) => String(Number(x)).padStart(2, '0')),
      blueBalls: r.blue.map((x) => String(Number(x)).padStart(2, '0')),
      sourceName: String(item?.['SourceName'] ?? item?.['source'] ?? ''),
      sourceUrl: String(item?.['Url'] ?? item?.['url'] ?? ''),
      sourceRaw: String(item?.['Content'] ?? item?.['content'] ?? item?.['Summary'] ?? '').slice(0, 500),
    };
  }

  /**
   * 从正文提取奖池金额（分）。兼容两种写法：
   * - 精确到元：「下期一等奖奖池累计金额：616,242,219元」「奖池累计：628,888,733元」
   * - 以亿为单位：「奖池金额 5.45亿」
   */
  private extractPrizePoolCent(content: string): number {
    // 先匹配带"元"的精确数值（优先）
    const mYuan = content.match(/(?:奖池(?:累计|滚存)?(?:金额)?[：:为是]?\s*)[¥￥]?([\d,]+(?:\.\d+)?)\s*元/);
    if (mYuan) {
      const yuan = Number(mYuan[1].replace(/,/g, ''));
      if (Number.isFinite(yuan) && yuan > 0) return Math.round(yuan * 100);
    }
    // 再匹配"X.X 亿"（少数站点写法）
    const mYi = content.match(/(?:奖池(?:累计|滚存)?(?:金额)?[：:为是]?\s*)([\d.]+)\s*亿/);
    if (mYi) {
      const yi = Number(mYi[1]);
      if (Number.isFinite(yi) && yi > 0) return Math.round(yi * 1e10);
    }
    return 0;
  }

  /**
   * 是否非开奖公告类页面（开机号/试机号/预测/推荐/走势/分析等）。
   * 2026-08-20 修复：改为**全字段拼接**后检测——旧实现用 `Title ?? Content ?? Summary`
   * 只检查第一个非空字段，Title 存在时 Content 里的「开机号」漏检（实测 8200.cn 页面
   * 正文含"096期开机号：07 11 14 27 29 31"却未被拦截 → 期号对、号码错）。
   */
  private isJunkPage(item: Record<string, unknown>): boolean {
    const parts = [
      item['Title'],
      item['title'],
      item['Content'],
      item['content'],
      item['Summary'],
      item['summary'],
    ];
    const s = parts.filter(Boolean).map(String).join(' ||| ');
    // 2026-10-07 补充：擂台赛/彩评师推荐页也会给出「期号 + 一注号码」的合法组合，
    // 实测双色球 2026114 期因此写入彩评师推荐号（02 03 04 09 13 14 + 15）。
    return /开机号|试机号|开机号码|试机号码|预测|推荐|走势|分析|复盘|精选|同尾号|振幅|跨度|擂台|彩评师|评分标准|胆码|杀号|杀码|独胆|定胆|缩水|必出|稳赚|包中/.test(
      s,
    );
  }

  /**
   * URL 黑名单：主页/分类页/列表页/垃圾站——这些页面混排多期数据，
   * 期号与号码分属不同区块，即使邻近窗口也可能拼错（2026-08-20 新增）。
   */
  private isBadUrl(item: Record<string, unknown>): boolean {
    const url = String(item['Url'] ?? item['url'] ?? '');
    if (!url) return false;
    // 2026-10-07 补充：站点首页（path 为空或 "/"）一律剔除。
    // 首页没有"期号—号码"的对应结构，正文里混着导航、推荐位、号码矩阵表头；
    // 实测 https://www.lottery.gov.cn/?form=… 被抓成"大乐透 26114 期开奖公告"，
    // 兜底解析把表头 01 02 03 04 05 06 07 写进了 draw_results。
    if (/^https?:\/\/[^/?#]+\/?(?:[?#].*)?$/.test(url)) return true;
    return /\/Result\/|\/Category\/|\?f=h5|\/jj\/tj\/|ph158|nb999|8200\.cn|list_|page\.html\?type/.test(url);
  }

  /** 页面质量评分：命中目标期号 +20；含「开奖公告」 +10；含「开奖号码」 +5 */
  private pageScore(item: Record<string, unknown>, issueNo?: string, issueKey?: string): number {
    let score = 0;
    const s = String(item['Content'] ?? item['content'] ?? item['Summary'] ?? item['Title'] ?? '');
    if (issueNo && (s.includes(issueNo) || (!!issueKey && s.includes(issueKey)))) score += 20;
    if (s.includes('开奖公告')) score += 10;
    if (s.includes('开奖号码') || s.includes('中奖号码')) score += 5;
    return score;
  }

  /** 内容是否匹配目标期号（兼容 "2026092" 与 "26092" 两种写法） */
  private matchesIssue(item: Record<string, unknown>, issueNo?: string, issueKey?: string): boolean {
    if (!issueNo) return true;
    const content = String(item['Content'] ?? item['content'] ?? item['Summary'] ?? item['Title'] ?? '');
    return content.includes(issueNo) || (!!issueKey && content.includes(issueKey));
  }

  /** 模式 1 用：把分隔符字符串拆成列表并校验 */
  private buildResult(
    redRaw: string,
    blueRaw: string,
    redCount: number,
    redMax: number,
    item: Record<string, unknown>,
  ): ParsedDraw | null {
    const red = [...new Set(redRaw.split(/[\s;；,，|]+/).filter((x) => /^\d{1,2}$/.test(x)))].sort();
    const blue = [...new Set(blueRaw.split(/[\s;；,，|]+/).filter((x) => /^\d{1,2}$/.test(x)))].sort();
    return this.buildResultFromLists(red, blue, redCount, redMax, item);
  }

  private buildResultFromLists(
    red: string[],
    blue: string[],
    redCount: number,
    redMax: number,
    item?: Record<string, unknown>,
  ): ParsedDraw | null {
    const inRange = (v: string, max: number) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= max;
    };
    const needBlue = redCount === 6 ? 1 : 2;
    if (
      red.length === redCount &&
      red.every((x) => inRange(x, redMax)) &&
      blue.length >= needBlue &&
      blue.every((x) => inRange(x, 16))
    ) {
      const it = item ?? {};
      const content = String(it['Content'] ?? it['content'] ?? it['Summary'] ?? '');
      return {
        redBalls: red.map((x) => String(Number(x)).padStart(2, '0')),
        blueBalls: blue.slice(0, needBlue).map((x) => String(Number(x)).padStart(2, '0')),
        sourceName: String(it['SourceName'] ?? it['source'] ?? ''),
        sourceUrl: String(it['Url'] ?? it['url'] ?? ''),
        sourceRaw: content.slice(0, 500),
      };
    }
    return null;
  }
}

export interface ParsedDraw {
  redBalls: string[];
  blueBalls: string[];
  sourceName?: string;
  sourceUrl?: string;
  sourceRaw?: string;
  /** 奖池金额（分），从公告正文提取（下期奖池 ≈ 当前待开期奖池） */
  prizePoolCent?: number;
}
