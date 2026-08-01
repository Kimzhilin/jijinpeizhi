// ============================================================
// 理财财 · 市场自适应策略引擎（自动运行，生成 strategy.js）
// 每日收盘后由 GitHub Actions 调用；本地也可 node generate-strategy.js 试跑。
// 逻辑：拉取 5 只基金真实净值 → 计算波动/回撤/动量/估值分位/成长价值轮动
//       → 按专业规则输出"随市场变化"的现金比例(10%~30%)+基金权重+阈值。
// 注意：本文件只写策略基线（平衡姿态）。用户风险偏好由界面叠加，不在这里。
// ============================================================
'use strict';

const FUNDS = [
  { code: '110020', name: '易方达沪深300ETF联接A',    cat: 'broad'  },
  { code: '022434', name: '南方中证A500ETF联接A',     cat: 'broad'  },
  { code: '007466', name: '华泰柏瑞中证红利低波ETF联接A', cat: 'value'  },
  { code: '011612', name: '华夏科创50ETF联接A',       cat: 'growth' },
  { code: '110026', name: '易方达创业板ETF联接A',     cat: 'growth' },
];

const BASE_WEIGHT = {        // 平衡姿态基线（合计 1.0）
  '110020': 0.20, '022434': 0.18, '007466': 0.27, '011612': 0.18, '110026': 0.17,
};
const TRADING_DAYS = 242;

// ---------- 数据获取 ----------
async function fetchNav(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?t=${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/' },
      signal: ctrl.signal,
    });
    const txt = await res.text();
    return txt;
  } finally {
    clearTimeout(timer);
  }
}

function parseNav(raw) {
  const i = raw.indexOf('Data_netWorthTrend');
  if (i < 0) return null;
  const j = raw.indexOf('[', i);
  if (j < 0) return null;
  let depth = 0, end = -1;
  for (let k = j; k < raw.length; k++) {
    if (raw[k] === '[') depth++;
    else if (raw[k] === ']') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) return null;
  const arr = JSON.parse(raw.slice(j, end));
  return arr.map(e => ({ t: e.x, nav: e.y })).sort((a, b) => a.t - b.t);
}

// ---------- 指标计算 ----------
function stdev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function metrics(series) {
  const navs = series.map(s => s.nav);
  const rets = [];
  for (let i = 1; i < navs.length; i++) rets.push(navs[i] / navs[i - 1] - 1);
  const vol = stdev(rets) * Math.sqrt(TRADING_DAYS);          // 年化波动
  const last = navs[navs.length - 1];
  const high120 = Math.max(...navs.slice(-120));
  const dd = (last - high120) / high120;                      // 120日回撤
  const at = (n) => navs[Math.max(0, navs.length - 1 - n)];
  const mom60 = last / at(60) - 1;                            // 60日动量
  const mom20 = last / at(20) - 1;
  // 估值分位：近 250 日净值百分位（越低越便宜）
  const win = navs.slice(-250);
  const pct = (last - Math.min(...win)) / (Math.max(...win) - Math.min(...win) + 1e-9);
  return { vol, dd, mom60, mom20, valPct: pct, last };
}

// ---------- 策略引擎 ----------
function engine(M) {
  const byCode = {};
  FUNDS.forEach(f => byCode[f.code] = M[f.code]);

  const w = { ...BASE_WEIGHT };

  // 1) 成长 vs 价值 相对强度（60日）
  const growthMom = (byCode['011612'].mom60 + byCode['110026'].mom60) / 2;
  const valueMom  = byCode['007466'].mom60;
  const rot = growthMom - valueMom;   // >0 成长占优，<0 价值占优

  const tilt = Math.max(-0.15, Math.min(0.15, rot)); // 夹紧
  if (tilt > 0.04) {
    w['011612'] += tilt * 0.40; w['110026'] += tilt * 0.40;
    w['007466'] -= tilt * 0.60; w['110020'] -= tilt * 0.10; w['022434'] -= tilt * 0.10;
  } else if (tilt < -0.04) {
    const a = -tilt;
    w['007466'] += a * 0.50; w['110020'] += a * 0.15; w['022434'] += a * 0.15;
    w['011612'] -= a * 0.40; w['110026'] -= a * 0.40;
  }

  // 2) 估值分位微调（便宜加点、贵减点）
  FUNDS.forEach(f => {
    const p = byCode[f.code].valPct;
    if (p < 0.25) w[f.code] += 0.02;
    else if (p > 0.80) w[f.code] -= 0.02;
  });

  // 3) 地板 + 成长上限，归一化
  FUNDS.forEach(f => { if (w[f.code] < 0.08) w[f.code] = 0.08; });
  let growthSum = w['011612'] + w['110026'];
  if (growthSum > 0.50) {
    const scale = 0.50 / growthSum;
    w['011612'] *= scale; w['110026'] *= scale;
  }
  const sum = FUNDS.reduce((a, f) => a + w[f.code], 0);
  FUNDS.forEach(f => w[f.code] = w[f.code] / sum);

  // 4) 现金比例（随市场，10%~30%）
  const volAll = FUNDS.reduce((a, f) => a + byCode[f.code].vol, 0) / FUNDS.length;
  const ddAll  = FUNDS.reduce((a, f) => a + byCode[f.code].dd, 0) / FUNDS.length;
  let cash = 0.15;
  if (volAll > 0.25) cash += 0.10;
  else if (volAll > 0.20) cash += 0.05;
  else if (volAll < 0.15) cash -= 0.05;
  if (ddAll < -0.20) cash -= 0.05;          // 深度回撤 → 准备部署
  else if (ddAll > -0.05 && volAll < 0.22) cash += 0.03; // 近高位且平稳 → 留点
  cash = Math.max(0.10, Math.min(0.30, cash));

  // 5) 阈值（高波动放宽，少折腾）
  const hi = volAll > 0.22;
  const drift = hi ? 0.08 : 0.05;
  const tp = hi ? [0.25, 0.45] : [0.20, 0.35];
  const wideDD = hi ? [0.10, 0.18, 0.28] : [0.08, 0.15, 0.25];
  const growthDD = hi ? [0.12, 0.22, 0.32] : [0.10, 0.20, 0.30];

  const notes = [];
  notes.push(`全市场年化波动 ${(volAll * 100).toFixed(1)}% → 现金目标 ${(cash * 100).toFixed(0)}%`);
  notes.push(`成长/价值60日相对强度 ${((rot) * 100).toFixed(1)}% → ${rot > 0.04 ? '略偏成长' : rot < -0.04 ? '略偏价值' : '均衡'}`);
  notes.push(`组合120日回撤 ${(ddAll * 100).toFixed(1)}% → ${ddAll < -0.20 ? '低位可逐步部署' : '常态'}`);

  return {
    version: 'auto-' + new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
    posture: 'balanced',
    source: '理财财市场自适应引擎（每日自动）',
    cashWeight: +cash.toFixed(3),
    driftThreshold: drift,
    growthTakeProfit: tp,
    wideDrawdown: wideDD,
    growthDrawdown: growthDD,
    dipBudgetRatio: 0.30,
    historyDays: 90,
    refreshMs: 5 * 60 * 1000,
    funds: FUNDS.map(f => ({
      code: f.code, name: f.name, weight: +w[f.code].toFixed(4), cat: f.cat,
    })),
    indicators: {
      volAll: +volAll.toFixed(3), ddAll: +ddAll.toFixed(3),
      growthVsValue: +rot.toFixed(3),
      perFund: FUNDS.map(f => ({
        code: f.code, name: f.name,
        vol: +byCode[f.code].vol.toFixed(3),
        dd: +byCode[f.code].dd.toFixed(3),
        mom60: +byCode[f.code].mom60.toFixed(3),
        valPct: +byCode[f.code].valPct.toFixed(2),
      })),
    },
    notes,
  };
}

// ---------- 主流程 ----------
(async () => {
  try {
    const M = {};
    for (const f of FUNDS) {
      const raw = await fetchNav(f.code);
      const series = parseNav(raw);
      if (!series || series.length < 30) throw new Error(`基金 ${f.code} 数据不足`);
      M[f.code] = metrics(series);
      console.log(`  ${f.name}(${f.code}) vol=${(M[f.code].vol*100).toFixed(1)}% dd=${(M[f.code].dd*100).toFixed(1)}% mom60=${(M[f.code].mom60*100).toFixed(1)}% valPct=${(M[f.code].valPct*100).toFixed(0)}%`);
    }
    const strat = engine(M);
    const weightSum = strat.funds.reduce((a, f) => a + f.weight, 0);
    console.log(`\n引擎输出：现金=${(strat.cashWeight*100).toFixed(0)}% 基金合计=${(weightSum*100).toFixed(0)}% 偏离阈值=±${(strat.driftThreshold*100).toFixed(0)}%`);
    strat.funds.forEach(f => console.log(`  ${f.name} ${(f.weight*100).toFixed(1)}%`));

    const header = `// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。\n// 最后更新：${strat.updatedAt}\n`;
    const body = `window.STRATEGY = ${JSON.stringify(strat, null, 2)};\n`;
    const fs = await import('node:fs/promises');
    await fs.writeFile('strategy.js', header + body, 'utf8');
    console.log('\n✅ 已写入 strategy.js');
  } catch (e) {
    console.error('❌ 引擎失败，保留上次策略：', e.message);
    process.exit(0); // 不改文件，避免写坏
  }
})();
