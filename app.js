/* ============================================================
   偏股基金平衡配置 · 调仓助手
   纯静态 / 本地存储 / 东方财富公开接口
   ============================================================ */

// ---------- 配置：内置默认（fallback）。实际参数优先由 strategy.js（理财财维护）覆盖 ----------
let CONFIG = { // 内置兜底默认（与 strategy.js v2 对齐；页面加载后会被 strategy.js 覆盖）
  cashWeight: 0.25,            // 现金机动比例（基线目标，引擎每日动态调整）
  cashCap: 0.30,               // 现金软顶：占比超此值自动生成「回补到目标」买入建议，防牛市现金无限堆积
  driftThreshold: 0.06,        // 偏离目标 ±6% 触发再平衡
  growthTakeProfit: [0.20, 0.35], // 成长 +20% / +35% 分批止盈
  wideDrawdown:  [0.08, 0.15, 0.25], // 宽基/红利 回撤分档加仓
  growthDrawdown:[0.10, 0.20, 0.30], // 成长 回撤分档加仓
  dipBudgetRatio: 0.30,        // 深跌时最多额外部署 = 目标金额*30%
  hpMinStreak: 3,              // 高抛：连涨至少天数
  hpValHigh: 0.55,             // 高抛：估值分位高于此值视为"偏高"
  hpGain: { broad: 0.15, value: 0.15, gold: 0.18, growth: 0.25 }, // 高抛：各品类累计盈利触发线
  hpSellFraction: 1/3,         // 高抛：单次抛出比例（非清仓，仅赚差价）
  minCashRatio: 0.10,          // 最低现金比例（硬地板）：低吸/建仓绝不超过此线（目标 25% − 15pp）
  spreadGain: 0.10,            // 短期做差价触发：低吸批次涨幅达此值（10%）
  spreadMinDays: 3,            // 短期做差价：最短持有天数（避免当日翻转）
  spreadMaxDays: 21,           // 短期做差价：最长持有窗口（超过视为非短期，转由长线高抛处理）
  historyDays: 90,             // 近3月高点窗口
  refreshMs: 5 * 60 * 1000,    // 交易时段每5分钟自动刷新
  funds: [
    { code: '110020', name: '易方达沪深300ETF联接A',        weight: 0.15, cat: 'broad',  etf: { market: 1, code: '510300' } }, // 沪深300ETF(沪)
    { code: '022434', name: '南方中证A500ETF联接A',       weight: 0.13, cat: 'broad',  etf: { market: 0, code: '159338' } }, // 中证A500ETF(深)
    { code: '007466', name: '华泰柏瑞中证红利低波ETF联接A',  weight: 0.25, cat: 'value',  etf: { market: 1, code: '512890' } }, // 红利低波ETF(沪)
    { code: '011612', name: '华夏科创50ETF联接A',           weight: 0.12, cat: 'growth', etf: { market: 1, code: '588000' } }, // 科创50ETF(沪)
    { code: '110026', name: '易方达创业板ETF联接A',         weight: 0.10, cat: 'growth', etf: { market: 0, code: '159915' } }, // 创业板ETF(深)
    { code: '000217', name: '华安黄金ETF联接C',            weight: 0.08, cat: 'gold',   etf: { market: 1, code: '518880' } }, // 黄金ETF(沪)
  ],
};

// 离线兜底：断网且 strategy.js 加载失败时，用最近一次缓存的策略（由 GitHub Actions 每日提交）
const STRAT_KEY = 'fundAllocatorStrategy_v1';
try {
  const snap = localStorage.getItem(STRAT_KEY);
  if (!window.STRATEGY && snap) window.STRATEGY = JSON.parse(snap);
} catch (e) {}

// 外置策略（理财财结合当下行情维护，见 strategy.js）。页面加载即套用，实现「我跟进、你刷新即得」。
if (window.STRATEGY) {
  const S = window.STRATEGY;
  CONFIG = Object.assign({}, CONFIG, {
    cashWeight: S.cashWeight != null ? S.cashWeight : CONFIG.cashWeight,
    driftThreshold: S.driftThreshold != null ? S.driftThreshold : CONFIG.driftThreshold,
    growthTakeProfit: S.growthTakeProfit || CONFIG.growthTakeProfit,
    wideDrawdown: S.wideDrawdown || CONFIG.wideDrawdown,
    growthDrawdown: S.growthDrawdown || CONFIG.growthDrawdown,
    dipBudgetRatio: S.dipBudgetRatio != null ? S.dipBudgetRatio : CONFIG.dipBudgetRatio,
    hpMinStreak: S.hpMinStreak != null ? S.hpMinStreak : CONFIG.hpMinStreak,
    hpValHigh: S.hpValHigh != null ? S.hpValHigh : CONFIG.hpValHigh,
    hpGain: S.hpGain || CONFIG.hpGain,
    hpSellFraction: S.hpSellFraction != null ? S.hpSellFraction : CONFIG.hpSellFraction,
    funds: S.funds || CONFIG.funds,
  });
  // 联网加载成功后缓存一份，供离线使用
  try { localStorage.setItem(STRAT_KEY, JSON.stringify(window.STRATEGY)); } catch (e) {}
}

// 平衡基线（引擎产出，未叠加风险偏好）。风险偏好在 init() 里叠加。
let BASE_CONFIG = JSON.parse(JSON.stringify(CONFIG));

// 风险偏好叠加：在引擎基线之上做底仓姿态微调（用户本地设置，不写进策略文件）
function tiltConfig(base, posture) {
  const c = JSON.parse(JSON.stringify(base));
  if (posture === 'conservative') {
    c.cashWeight = Math.min(0.40, c.cashWeight + 0.10);
    c.funds.forEach(f => { if (f.cat === 'growth') f.weight *= 0.7; });
  } else if (posture === 'aggressive') {
    c.cashWeight = Math.max(0.05, c.cashWeight - 0.08);
    c.funds.forEach(f => { if (f.cat === 'growth') f.weight *= 1.25; });
  }
  const sum = c.funds.reduce((a, f) => a + f.weight, 0);
  c.funds.forEach(f => f.weight = f.weight / sum);
  return c;
}

function applyPosture() {
  CONFIG = tiltConfig(BASE_CONFIG, state.riskPosture || 'balanced');
  fillTradeFundOptions();
  renderAll();
}

// 最低现金比例（硬地板）：优先取用户配置，否则用引擎默认
function cashFloorRatio() {
  return state.minCashRatio != null ? state.minCashRatio : CONFIG.minCashRatio;
}

// ---------- 国家队三态（手动标记，防御叠加） ----------
// 国家队（汇金/证金等）动作季报滞后 1–2 月、无公开实时接口，故不自动抓取，由用户据公开信息手动标记。
// buy=托底信号敢加仓；silence=维持原节奏；retreat=防御（下调建仓系数、收紧现金软顶、暂停低吸、优先高抛）。
function ntInfo() {
  const s = state.nationalTeam || 'silence';
  if (s === 'buy')     return { mult: 1.15, pauseDip: false, retreat: false, label: '🟢 国家队买入中' };
  if (s === 'retreat') return { mult: 0.75, pauseDip: true,  retreat: true,  label: '🔴 国家队疑似撤退' };
  return { mult: 1, pauseDip: false, retreat: false, label: '⚪ 国家队静默' };
}

const STORE_KEY = 'fundAllocatorState_v1';

// ---------- 状态 ----------
let state = loadState();

function defaultState() {
  return {
    amount: 0,
    cash: 0,
    positions: {},          // code -> { shares, cost }
    tx: [],                 // { id, code, type, date, amount, nav }
    navCache: {},           // code -> { nav, prevNav, dailyChange, date, high, fetchedDate }
    etfCache: {},           // code -> { chgPct, price, name, ts } 盘中预估：按对应场内ETF实时涨跌近似
    lastRefresh: 0,
    riskPosture: 'balanced', // 风险偏好：conservative / balanced / aggressive
    nationalTeam: 'silence',  // 国家队状态：silence 静默 / buy 买入中 / retreat 疑似撤退（手动标记，防御叠加）
    activeView: 'holdings',   // 当前视图：holdings / advice / config
    filled: { dd: {}, tp: {}, hp: {}, spread: {} }, // 已执行记忆：dd/tp/hp 分档；spread[lotId]=true 短期差价已执行
    lots: [],                // 买入批次追踪：{id, code, amount, nav, shares, date, closed}（用于短期做差价）
    minCashRatio: null,      // 最低现金比例（覆盖引擎默认）；null=用 CONFIG.minCashRatio(0.10)
    spreadGain: null,        // 短期做差价涨幅阈值（覆盖引擎默认）；null=用 CONFIG.spreadGain(0.10)
    lastNavUpdate: 0,        // 最近一次成功拉取净值的时间戳（毫秒）
    dataMode: 'live',        // live=联网最新 / cache=离线缓存
    dca: { batches: 3, intervalDays: 14, startDate: null, executed: [] }, // 分批建仓计划：分几批 / 每批间隔 / 首批日期 / 已执行批次
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// ---------- 策略（理财财每日自动维护，动态跟进） ----------
function getStrategyMeta() {
  if (state.strategyMeta) {
    return {
      version: state.strategyMeta.version,
      updated: state.strategyMeta.updated,
      source: state.strategyMeta.source,
      indicators: state.strategyMeta.indicators || null,
      notes: state.strategyMeta.notes || null,
    };
  }
  const S = window.STRATEGY;
  if (S) return {
    version: S.version,
    updated: S.updatedAt || S.updated,
    source: S.source,
    indicators: S.indicators || null,
    notes: S.notes || null,
  };
  return null;
}

// 套用一份策略对象（来自 strategy.js 或用户粘贴的 JSON）
function applyStrategy(obj) {
  if (!obj || typeof obj !== 'object') { alert('策略内容无效'); return; }
  if (obj.cashWeight != null) CONFIG.cashWeight = obj.cashWeight;
  if (obj.driftThreshold != null) CONFIG.driftThreshold = obj.driftThreshold;
  if (Array.isArray(obj.growthTakeProfit)) CONFIG.growthTakeProfit = obj.growthTakeProfit;
  if (Array.isArray(obj.wideDrawdown)) CONFIG.wideDrawdown = obj.wideDrawdown;
  if (Array.isArray(obj.growthDrawdown)) CONFIG.growthDrawdown = obj.growthDrawdown;
  if (obj.dipBudgetRatio != null) CONFIG.dipBudgetRatio = obj.dipBudgetRatio;
  if (Array.isArray(obj.funds) && obj.funds.length) CONFIG.funds = obj.funds;
  state.strategyMeta = {
    version: obj.version || (state.strategyMeta && state.strategyMeta.version) || '自定义',
    updated: obj.updated || obj.updatedAt || new Date().toISOString().slice(0, 10),
    market: obj.market || (state.strategyMeta && state.strategyMeta.market) || '',
    source: obj.source || '用户粘贴导入',
    indicators: obj.indicators || null,
    notes: obj.notes || null,
  };
  BASE_CONFIG = JSON.parse(JSON.stringify(CONFIG)); // 让风险偏好叠加在粘贴版之上
  saveState();
  try { localStorage.setItem(STRAT_KEY, JSON.stringify(obj)); } catch (e) {} // 粘贴版也缓存，供离线
  applyPosture();
}

// ---------- 工具 ----------
const fmt = (n) => (n == null || isNaN(n)) ? '—'
  : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const fmtPct = (n) => (n == null || isNaN(n)) ? '—'
  : (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
const $ = (id) => document.getElementById(id);

function fundByCode(code) { return CONFIG.funds.find(f => f.code === code); }

// ---------- 派生计算 ----------
function getPosition(code) {
  return state.positions[code] || { shares: 0, cost: 0 };
}

function currentNav(code) {
  const c = state.navCache[code];
  if (c && c.estimate != null) return c.estimate;
  if (c && c.nav != null) return c.nav;
  return null;
}

function fundStats(code) {
  const f = fundByCode(code);
  const pos = getPosition(code);
  const nav = currentNav(code);
  const shares = pos.shares || 0;
  const cost = pos.cost || 0;
  const value = nav != null ? shares * nav : cost; // 无净值时按成本占位
  const pnl = value - cost;
  const pnlPct = cost > 0 ? pnl / cost : 0;
  return { f, shares, cost, nav, value, pnl, pnlPct };
}

function totals() {
  let equity = 0, costAll = 0;
  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    equity += s.value;
    costAll += s.cost;
  });
  const cash = Math.max(0, (state.amount || 0) - costAll); // 派生：总投入 − 已投成本基准
  const asset = equity + cash;
  const pnl = asset - (state.amount || 0);
  const pnlPct = state.amount > 0 ? pnl / state.amount : 0;
  return { equity, cash, asset, costAll, pnl, pnlPct };
}

// 连涨天数：基于近期每日涨跌幅序列（most-recent-first）起始的连续正数个数
function upStreak(code) {
  const c = state.navCache[code];
  if (!c || !Array.isArray(c.recentChg)) return 0;
  let n = 0;
  for (let i = 0; i < c.recentChg.length; i++) {
    if (c.recentChg[i] > 0) n++; else break;
  }
  return n;
}

// 轮动目标：找当前低配且估值更便宜的基金（高抛后回笼现金的去向）
function rotationTarget(excludeCode) {
  const t = totals();
  const asset = t.asset || state.amount;
  const perFund = (CONFIG.indicators && CONFIG.indicators.perFund) || [];
  let best = null, bestScore = -Infinity;
  CONFIG.funds.forEach(f => {
    if (f.code === excludeCode) return;
    const s = fundStats(f.code);
    const curW = s.value / asset;
    const under = f.weight - curW;                       // >0 表示当前低配
    const ind = perFund.find(p => p.code === f.code) || {};
    const val = ind.valPct != null ? ind.valPct : 0.5;  // 估值分位越低越便宜
    const score = under * 2 - val;                      // 越缺 + 越便宜 → 越优先
    if (score > bestScore) { bestScore = score; best = f; }
  });
  return best;
}

// ---------- 实时净值（东方财富 pingzhongdata 历史净值，每日更新） ----------
// 说明：联接基金净值每日收盘后更新一次，盘中无可靠免费估算接口，
// 故以「最新官方净值 + 当日涨跌 + 近3月高点」为数据源，满足每日更新与盈亏跟踪。

// 单只基金：拉取历史净值，计算 最新净值 / 前一日净值 / 当日涨跌 / 近3月高点
function fetchFundData(code) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?t=${Date.now()}`;
    s.onload = () => {
      try {
        const arr = window.Data_netWorthTrend; // 形如 [{x:时间戳ms, y:净值}, ...]
        window.Data_netWorthTrend = undefined; // 清空，避免被下一只覆盖干扰
        if (!Array.isArray(arr) || arr.length < 2) { resolve(null); return; }
        const last = arr[arr.length - 1];
        const prev = arr[arr.length - 2];
        const nav = Number(last.y);
        const prevNav = Number(prev.y);
        const dailyChange = prevNav ? (nav - prevNav) / prevNav : null;
        const date = new Date(last.x).toISOString().slice(0, 10);
        const cut = Date.now() - CONFIG.historyDays * 86400000;
        let high = -Infinity;
        arr.forEach(e => { if (e.x >= cut && e.y > high) high = e.y; });
        if (high === -Infinity) high = null;
        // 近期每日涨跌幅序列（用于"连涨天数"计算，最多保留近 12 日）
        const recentChg = [];
        for (let i = arr.length - 1; i >= 1 && recentChg.length < 12; i--) {
          const a = arr[i].y, b = arr[i - 1].y;
          recentChg.push(b ? (a - b) / b : 0);
        }
        resolve({ nav, prevNav, dailyChange, date, high, recentChg });
      } catch (e) { resolve(null); }
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

// ---------- 盘中预估：用对应场内 ETF 实时涨跌，近似联接基金下一交易日净值变动 ----------
// 场外联接基金T日15:00前下单按T日净值，而当日净值要收盘后才出；用同指数场内ETF的盘中实时涨跌，
// 可在交易时段内近似"现在下单、收盘成交"时的方向与时点幅度，缩小未知价成交的落差。
function isTradingNow() {
  const now = new Date();
  const wd = now.getDay();
  if (wd === 0 || wd === 6) return false;
  const h = now.getHours(), m = now.getMinutes();
  const am = (h === 9 && m >= 30) || h === 10 || h === 11;
  const pm = (h >= 13 && h < 15);
  return am || pm;
}

// 距 15:00 收盘剩余分钟数（向上取整，至少 0）
function minutesToClose(now) {
  now = now || new Date();
  const close = new Date(now);
  close.setHours(15, 0, 0, 0);
  return Math.max(0, Math.round((close - now) / 60000));
}

// 是否处于「收盘前紧急窗口」：交易时段内且距收盘 ≤15 分钟
function isUrgentWindow() {
  return isTradingNow() && minutesToClose() > 0 && minutesToClose() <= 15;
}

// 是否"收盘前录入"：交易日且 15:00 前（含午休）。此时当日净值未出，应按昨日净值口径记录，
// 待当日净值出炉后由 finalizePreClosePositions() 自动用真实净值重算收益。
function isBeforeClose() {
  const n = new Date();
  const wd = n.getDay();
  if (wd === 0 || wd === 6) return false;
  return n.getHours() < 15;
}

// 极简 JSONP（东方财富 push2 行情接口支持 cb 回调）
let _jpSeq = 0;
function jsonp(url) {
  return new Promise((resolve) => {
    const cbName = '__jp' + (++_jpSeq) + Date.now();
    const s = document.createElement('script');
    s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'cb=' + cbName + '&_=' + Date.now();
    let done = false;
    const finish = (val) => {
      if (done) return; done = true;
      try { delete window[cbName]; } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
      resolve(val);
    };
    window[cbName] = (data) => finish(data);
    s.onerror = () => finish(null);
    setTimeout(() => finish(null), 7000); // 超时保护，避免卡死
    document.head.appendChild(s);
  });
}

async function fetchEtfEstimates() {
  state.etfCache = state.etfCache || {};
  const tasks = CONFIG.funds.filter(f => f.etf).map(async (f) => {
    const secid = (f.etf.market || 1) + '.' + f.etf.code;
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f170&fltt=2&invt=2&ut=fa5fd1943c7b386f172d6893dbfba21b`;
    const d = await jsonp(url);
    if (d && d.data) {
      const chg = Number(d.data.f170);          // f170 = 涨跌幅(%)，fltt=2 下为数字，如 1.23 表示 +1.23%
      const price = Number(d.data.f43);          // 最新价
      if (!isNaN(chg)) {
        state.etfCache[f.code] = {
          chgPct: chg / 100,
          price: isNaN(price) ? null : price,
          name: d.data.f58 || '',
          ts: Date.now(),
        };
      }
    }
  });
  await Promise.all(tasks);
}

async function refreshMarket() {
  $('refreshStatus').textContent = '刷新中…';
  const today = new Date().toISOString().slice(0, 10);
  for (const f of CONFIG.funds) {
    const cached = state.navCache[f.code];
    if (cached && cached.fetchedDate === today) continue; // 当天已拉取，复用缓存
    const d = await fetchFundData(f.code);
    if (d) state.navCache[f.code] = Object.assign({}, d, { fetchedDate: today });
  }
  finalizePreClosePositions(); // 当日净值出炉后，自动重算收盘前录入持仓的真实收益
  state.lastRefresh = Date.now();
  state.lastNavUpdate = Date.now();
  // 盘中预估：拉取对应场内 ETF 实时涨跌（已熔断式容错，失败不影响主流程）
  try { await fetchEtfEstimates(); } catch (e) {}
  saveState();
  const anyData = CONFIG.funds.some(f => state.navCache[f.code] && state.navCache[f.code].nav != null);
  const anyEtf = CONFIG.funds.some(f => state.etfCache[f.code] && state.etfCache[f.code].chgPct != null);
  const online = navigator.onLine;
  if (anyData) {
    state.dataMode = 'live';
    let txt = '实时净值 · ' + new Date().toLocaleTimeString('zh-CN') + ' 联网刷新';
    if (anyEtf) txt += isTradingNow() ? ' ｜ 盘中预估已更新' : ' ｜ 今日收盘预估已更新';
    $('refreshStatus').textContent = txt;
  } else {
    state.dataMode = 'cache';
    const last = state.lastNavUpdate ? '（最近 ' + new Date(state.lastNavUpdate).toLocaleDateString('zh-CN') + '）' : '';
    $('refreshStatus').textContent = (online ? '接口暂不可用' : '离线') + ' · 显示缓存净值' + last;
  }
  renderAll();
}

// ---------- 渲染：总览 ----------
function renderSummary() {
  const t = totals();
  $('s-total').textContent = '¥' + fmt(state.amount);
  $('s-equity').textContent = '¥' + fmt(t.equity);
  $('s-cash').textContent = '¥' + fmt(t.cash);
  $('s-asset').textContent = '¥' + fmt(t.asset);
  const pnlEl = $('s-pnl'); const pctEl = $('s-pnl-pct');
  pnlEl.textContent = (t.pnl >= 0 ? '+¥' : '-¥') + fmt(Math.abs(t.pnl));
  pctEl.textContent = fmtPct(t.pnlPct);
  pnlEl.className = 'value ' + (t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'flat');
  pctEl.className = 'value ' + (t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'flat');
}

// ---------- 渲染：目标配置 ----------
function renderTargets() {
  const wrap = $('targetTableWrap');
  if (!state.amount) { wrap.innerHTML = '<p class="hint">请输入可投金额并点击「生成目标配置」。</p>'; return; }
  const deployed = state.amount * (1 - CONFIG.cashWeight);
  let html = '<table><thead><tr><th>基金</th><th>代码</th><th>目标比例</th><th>目标金额</th><th>类型</th></tr></thead><tbody>';
  CONFIG.funds.forEach(f => {
    const amt = deployed * f.weight;
    const cat = f.cat === 'broad' ? '宽基' : f.cat === 'value' ? '红利低波' : f.cat === 'growth' ? '成长' : '黄金';
    html += `<tr><td>${f.name}</td><td>${f.code}</td><td>${(f.weight*100).toFixed(0)}%</td><td>¥${fmt(amt)}</td><td>${cat}</td></tr>`;
  });
  html += `<tr style="font-weight:700"><td>现金机动</td><td>—</td><td>${(CONFIG.cashWeight*100).toFixed(0)}%</td><td>¥${fmt(state.amount*CONFIG.cashWeight)}</td><td>待命</td></tr>`;
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ---------- 智能建仓引擎：按"市场便宜度"决定现在该建多少 ----------
function computeDeployPlan() {
  const t = totals();
  const targetEquity = (state.amount || 0) * (1 - CONFIG.cashWeight);   // 目标权益仓位
  const pending = Math.max(0, targetEquity - t.equity);                  // 还没建的部分
  const ind = (CONFIG.indicators && CONFIG.indicators.perFund) ? CONFIG.indicators.perFund : [];
  const byCode = {}; ind.forEach(p => { byCode[p.code] = p; });

  // 按目标权重加权：估值分位 + 近3月回撤（指标缺失时按中性处理）
  let valPct = 0, dd = 0, wSum = 0, missing = false;
  CONFIG.funds.forEach(f => {
    const w = f.weight; wSum += w;
    const p = byCode[f.code];
    if (!p) { missing = true; return; }
    valPct += (p.valPct != null ? p.valPct : 0.5) * w;
    dd += (p.dd != null ? p.dd : 0) * w;
  });
  if (wSum > 0) { valPct /= wSum; dd /= wSum; }

  const scoreVal = (1 - valPct) * 100;                        // 估值越低分越高
  const scoreDd = Math.min(100, Math.max(0, -dd * 400));      // 回撤越大分越高（-25% → 100）
  const cheap = 0.6 * scoreVal + 0.4 * scoreDd;               // 便宜度 0-100

  const batches = (state.dca && state.dca.batches) ? state.dca.batches : 3;
  const baseRatio = 1 / batches;                              // 常规节奏：分 N 批
  const nt = ntInfo();                                        // 国家队三态：买入中→加快、撤退→放慢
  let mult, label;
  if (cheap >= 70)      { mult = 1.5; label = '明显便宜 · 加快部署'; }
  else if (cheap >= 50) { mult = 1.0; label = '中性偏便宜 · 常规节奏'; }
  else if (cheap >= 30) { mult = 0.7; label = '中性偏贵 · 放慢节奏'; }
  else                  { mult = 0.5; label = '偏贵 · 小步试探'; }
  const ratio = Math.max(0.10, Math.min(0.60, baseRatio * mult * nt.mult));

  // 可动用现金：需保留最低现金比例（硬地板，可调，默认 10%）
  const cashFloor = (t.asset || 0) * cashFloorRatio();
  const cashAvail = Math.max(0, t.cash - cashFloor);
  const amount = Math.min(pending * ratio, cashAvail);

  const alloc = CONFIG.funds.map(f => ({ f, amt: amount * f.weight }));
  return { targetEquity, pending, cheap, valPct, dd, ratio, mult, label, amount, alloc, cashAvail, equity: t.equity, missing, nt };
}

// ---------- 渲染：智能建仓建议 + 记录实际持仓 ----------
function renderDCA() {
  const planWrap = $('dcaPlan');         // 智能建仓建议 → 配置页
  const recWrap = $('recordHoldingWrap'); // 记录实际持仓 → 持仓页
  if (!planWrap && !recWrap) return;
  if (!state.dca) state.dca = { batches: 3, intervalDays: 14, startDate: null, executed: [] };
  const dca = state.dca;
  const fundOpts = CONFIG.funds.map(f => `<option value="${f.code}">${f.name} (${f.code})</option>`).join('');

  // —— 智能建仓建议（按市场便宜度动态给出"现在建多少"） ——
  let planHtml;
  if (state.amount > 0) {
    const dp = computeDeployPlan();
    const pctDone = dp.targetEquity > 0 ? Math.min(100, (dp.equity / dp.targetEquity) * 100) : 0;
    const tempCls = dp.cheap >= 70 ? 't-cold' : dp.cheap >= 50 ? 't-mild' : dp.cheap >= 30 ? 't-warm' : 't-hot';
    const allocRows = dp.alloc.map(a => `
      <div class="dca-fund"><span>${a.f.name}</span><b>¥${fmt(a.amt)}</b></div>`).join('');
    const cashKeep = state.amount * CONFIG.cashWeight;
    const bodyHtml = dp.amount > 1 ? `
        <div class="dca-now">
          <div class="dca-now-head">现在建议建仓 <b>¥${fmt(dp.amount)}</b>
            <span class="dca-now-sub">剩余待部署的 ${Math.round(dp.ratio * 100)}%（常规每批 ${Math.round(100 / dca.batches)}%，本次 ×${dp.mult}）</span>
          </div>
          <div class="dca-funds">${allocRows}</div>
        </div>
        <p class="hint">买入后到下方「📝 记录实际持仓」登记，待部署金额会自动扣减，下次建议随之调整。下次节奏：约 ${dca.intervalDays} 天后，或组合再跌约 5% 可提前加一档。</p>`
      : `<p class="hint strong">${dp.pending <= 1 ? '已建满：权益已达目标仓位，无需再建仓，后续交给「③ 调仓建议」维护即可。' : '暂不建议建仓：可动用现金已到最低现金比例（需保留约 ' + Math.round(cashFloorRatio() * 100) + '% 现金），或剩余待部署过小。'}</p>`;
    planHtml = `
      <div class="dca-head">
        <h3>📊 智能建仓建议</h3>
        <div class="dca-nt ${dp.nt.retreat ? 'nt-red' : dp.nt.mult > 1 ? 'nt-green' : 'nt-gray'}">${dp.nt.label} · 建仓系数 ×${dp.nt.mult}</div>
        <div class="dca-ctrl">
          <label>常规节奏 <select id="dcaBatches">
            <option value="2"${dca.batches === 2 ? ' selected' : ''}>2 批</option>
            <option value="3"${dca.batches === 3 ? ' selected' : ''}>3 批</option>
            <option value="4"${dca.batches === 4 ? ' selected' : ''}>4 批</option>
          </select></label>
          <label>参考间隔 <select id="dcaInterval">
            <option value="7"${dca.intervalDays === 7 ? ' selected' : ''}>7 天</option>
            <option value="14"${dca.intervalDays === 14 ? ' selected' : ''}>14 天</option>
            <option value="21"${dca.intervalDays === 21 ? ' selected' : ''}>21 天</option>
            <option value="30"${dca.intervalDays === 30 ? ' selected' : ''}>30 天</option>
          </select></label>
        </div>
        <p class="hint">目标权益 <b>¥${fmt(dp.targetEquity)}</b>（可投金额的 ${Math.round((1 - CONFIG.cashWeight) * 100)}%）· 已部署 <b>¥${fmt(dp.equity)}</b> · 剩余待部署 <b>¥${fmt(dp.pending)}</b>；现金目标 ¥${fmt(cashKeep)}（${Math.round(CONFIG.cashWeight * 100)}%）全程保留。</p>
        <div class="dca-progress"><div class="dca-progress-fill" style="width:${pctDone.toFixed(1)}%"></div></div>
        <div class="dca-temp ${tempCls}">
          <span class="dca-temp-label">市场便宜度</span>
          <span class="dca-temp-val"><b>${Math.round(dp.cheap)}</b> / 100 · ${dp.label}</span>
        </div>
        <p class="hint">组合估值分位 <b>${(dp.valPct * 100).toFixed(0)}%</b> · 近3月回撤 <b>${(dp.dd * 100).toFixed(1)}%</b>（按目标权重加权，取自每日自动更新的策略指标）。${dp.missing ? ' <b>注：部分基金缺指标，已按中性处理。</b>' : ''}</p>
        ${bodyHtml}
      </div>`;
  } else {
    planHtml = `
      <div class="dca-empty">
        <h3>📊 智能建仓建议</h3>
        <p class="hint">在「① 配置」设定可投金额后，这里会按<b>市场便宜度</b>动态给出「现在该建多少、各基金分多少」——估值越低、回撤越大，建得越快。无论是否用建议，都能直接在下方「记录实际持仓」登记你已买的基金。</p>
      </div>`;
  }

  // —— 记录实际持仓（核心：选基金 + 持有金额 + 持有收益） ——
  const recorded = CONFIG.funds.filter(f => {
    const p = state.positions[f.code];
    return p && p.shares > 0;
  });
  let listHtml = '<p class="hint">还没有登记持仓。选一只基金，填你<b>当下账户里的真实持有金额与累计收益</b>即可。</p>';
  if (recorded.length) {
    listHtml = recorded.map(f => {
      const p = state.positions[f.code];
      const s = fundStats(f.code);
      const pnlCls = s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : 'flat';
      const recProfit = p.recordedProfit || 0;
      const recProfitTxt = (recProfit >= 0 ? '盈 ' : '亏 −') + '¥' + fmt(Math.abs(recProfit));
      return `
        <div class="hold-row">
          <span class="hold-name">${f.name}</span>
          <span class="hold-meta">录入 ¥${fmt(p.recordedAmount || 0)}<br><span class="hold-sub">${recProfitTxt} · ${p.recordedAt || '—'}</span></span>
          <span class="hold-now">现市值<br><b>¥${fmt(s.value)}</b></span>
          <span class="hold-pnl ${pnlCls}">${s.pnl >= 0 ? '+' : '−'}¥${fmt(Math.abs(s.pnl))}<br><span class="hold-sub">${fmtPct(s.pnlPct)}</span></span>
          <button class="hold-remove" data-code="${f.code}">删除</button>
        </div>`;
    }).join('');
  }

  if (planWrap) planWrap.innerHTML = planHtml;
  if (recWrap) recWrap.innerHTML = `
    <div class="dca-record">
      <h3>📝 记录实际持仓</h3>
      <p class="hint">滞后录入也没关系：填<b>当下该基金账户的真实持有金额 + 累计收益</b>（赚填正数、亏填负数加 −）。工具按当天净值反推份额与成本基准，之后<b>每天自动按最新净值更新市值和收益</b>。每支基金记一条（再次保存即覆盖更新）。</p>
      <p class="hint ${isBeforeClose() ? 'warn' : ''}" id="holdTimeHint">${isBeforeClose()
        ? '⏰ <b>收盘前录入</b>：今日净值尚未出炉，请按<b>昨日收盘市值</b>口径填写持有金额与收益；今日收盘后工具会用真实净值自动重算，无需你再改。'
        : '📌 已收盘或休市：直接填<b>今日/最近交易日</b>的真实市值与收益即可，工具按该净值记录。'}</p>
      <div class="hold-form">
        <select id="holdFund">${fundOpts}</select>
        <input type="number" id="holdAmount" placeholder="持有金额(元)" />
        <input type="number" id="holdProfit" placeholder="持有收益(正/负)" />
        <input type="number" id="holdNav" placeholder="净值(留空用最新)" step="0.0001" />
        <button id="holdSaveBtn" class="btn btn-primary">保存</button>
      </div>
      <div class="hold-list">${listHtml}</div>
    </div>`;
}

// ---------- 记录实际持仓（简化登记：持有金额 + 持有收益） ----------
function recordHolding() {
  const code = $('holdFund').value;
  const amount = parseFloat($('holdAmount').value);
  const profit = parseFloat($('holdProfit').value);
  if (!amount || amount <= 0) { alert('请输入有效持有金额'); return; }
  if (isNaN(profit)) { alert('请输入持有收益：正数 = 盈利，负数 = 亏损（记得加 − 号），无收益填 0。'); return; }
  let nav = currentNav(code);
  const navInput = parseFloat($('holdNav').value);
  if ((nav == null || isNaN(nav)) && !isNaN(navInput) && navInput > 0) nav = navInput;
  if (nav == null || isNaN(nav) || nav <= 0) {
    alert('尚未拉取该基金净值，请先点「🔄 刷新行情」，或在「净值」框手动填写后保存。'); return;
  }
  const shares = amount / nav;          // 反推份额：录入日净值 × 份额 = 持有金额
  const cost = amount - profit;         // 反推成本基准：持有金额 − 累计收益 = 投入本金
  const isRe = !!(state.positions[code] && state.positions[code].shares > 0); // 是否覆盖式重新登记
  const preClose = isBeforeClose();     // 收盘前录入：当日净值未出，用昨日净值口径，收盘后自动重算
  const navDate = (state.navCache[code] && state.navCache[code].date) || '';
  state.positions[code] = Object.assign(state.positions[code] || {}, {
    shares, cost,
    recordedAt: new Date().toISOString().slice(0, 10),
    navAtRecord: nav,
    navAtRecordDate: navDate,
    recordedAmount: amount,
    recordedProfit: profit,
    preClose,
  });
  if (isRe) resetFundMemory(code, false); // 成本基准变了 → 旧的"已执行"分档标记已失效（交易记录保留）
  saveState();
  $('holdAmount').value = '';
  $('holdProfit').value = '';
  $('holdNav').value = '';
  renderAll();
}

// 收盘前录入的持仓：当日净值出炉后，用真实净值重算"录入市值 / 收益"口径，
// 使②区显示的收益不再停留在昨日估算（份额锚定昨日净值 × 今日净值 = 今日真实市值）。
function finalizePreClosePositions() {
  let changed = false;
  CONFIG.funds.forEach(f => {
    const p = state.positions[f.code];
    if (!p || !p.preClose) return;
    const navC = state.navCache[f.code];
    if (!navC || navC.nav == null || !navC.date) return;
    if (!(navC.date > (p.navAtRecordDate || ''))) return; // 还没有比录入日更新的净值
    const navD = navC.nav;
    const trueValue = (p.shares || 0) * navD;
    const truePnl = trueValue - (p.cost || 0);
    p.recordedAmount = trueValue;
    p.recordedProfit = truePnl;
    p.navAtRecord = navD;
    p.navAtRecordDate = navC.date;
    p.recordedAt = navC.date;
    p.preClose = false;
    changed = true;
  });
  if (changed) { saveState(); renderAll(); }
}

// 清除某只基金的执行记忆残留：止盈 / 低吸分档"已执行"标记，可选一并清交易记录
function resetFundMemory(code, clearTx) {
  if (state.filled && state.filled.dd) delete state.filled.dd[code];
  if (state.filled && state.filled.tp) delete state.filled.tp[code];
  if (state.filled && state.filled.hp) delete state.filled.hp[code];
  if (clearTx && Array.isArray(state.tx)) state.tx = state.tx.filter(t => t.code !== code);
}

function removeHolding(code) {
  const f = fundByCode(code);
  const name = f ? f.name : code;
  const pos = state.positions[code];
  const p = (pos && pos.recordedProfit) || 0;
  const amtTxt = pos && pos.recordedAmount
    ? ('\n当前登记：持有 ¥' + fmt(pos.recordedAmount) + '，累计' + (p >= 0 ? '盈 ¥' : '亏 −¥') + fmt(Math.abs(p)))
    : '';
  if (!confirm(
    '确定撤销「' + name + '」的登记？' + amtTxt + '\n\n' +
    '删除后该基金恢复为「从未登记」：\n' +
    '· 持仓份额 / 成本 / 盈亏 清零\n' +
    '· 现金自动回补（现金 = 总投入 − 已投成本）\n' +
    '· 止盈 / 低吸分档记录清空，建议可重新触发\n' +
    '· ④ 交易记录里该基金的条目一并清除\n' +
    '· 目标比例与可投金额不受影响（来自策略面板，不随持仓变化）\n\n' +
    '（仅清除本工具的记账登记，不影响你在平台里的实际持仓）'
  )) return;
  delete state.positions[code];
  resetFundMemory(code, true);
  if (state.filled) state.filled.cap = {}; // 现金结构变了，复位现金回补标记
  saveState();
  renderAll();
}

// ---------- 渲染：持仓 / 行情 ----------
function renderHoldings() {
  const body = $('holdingsBody');
  body.innerHTML = '';
  let wSum = 0, wChg = 0; // 组合加权预估（按市值）
  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    const c = state.navCache[f.code];
    const navTxt = s.nav != null ? s.nav.toFixed(4) : '—';
    const dc = c && c.dailyChange != null ? c.dailyChange : null;
    const dcCls = dc == null ? 'flat' : dc > 0.0001 ? 'up' : dc < -0.0001 ? 'down' : 'flat';
    const dcTxt = dc == null ? '—' : fmtPct(dc);
    // 今日预估：基于对应场内 ETF 实时涨跌
    const etf = state.etfCache[f.code];
    const ec = etf && etf.chgPct != null ? etf.chgPct : null;
    const ecCls = ec == null ? 'flat' : ec > 0.0001 ? 'up' : ec < -0.0001 ? 'down' : 'flat';
    const ecTxt = ec == null ? '—' : fmtPct(ec);
    if (ec != null && s.value > 0) { wSum += s.value; wChg += s.value * ec; }
    const pnlCls = s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : 'flat';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f.name}</td>
      <td>${f.code}</td>
      <td>¥${fmt(s.cost)}</td>
      <td>${navTxt}</td>
      <td class="${dcCls}">${dcTxt}</td>
      <td class="est ${ecCls}">${ecTxt}</td>
      <td>¥${fmt(s.value)}</td>
      <td class="${pnlCls}">${s.pnl >= 0 ? '+' : '-'}¥${fmt(Math.abs(s.pnl))}</td>
      <td class="${pnlCls}">${fmtPct(s.pnlPct)}</td>`;
    body.appendChild(tr);
  });
  _lastPortChg = (wSum > 0 ? wChg / wSum : null);
  renderEtfEstimateBar(_lastPortChg);
}

// 组合盘中预估横幅
let _lastPortChg = null; // 缓存最近一次组合预估，供心跳刷新倒计时
function renderEtfEstimateBar(portChg) {
  const el = $('etfEstimateBar');
  if (!el) return;
  const codes = CONFIG.funds.filter(f => state.etfCache[f.code] && state.etfCache[f.code].chgPct != null);
  if (codes.length === 0) {
    el.innerHTML = '<span class="etf-empty">📡 今日预估：尚未拉取场内ETF行情，点「🔄 刷新行情」获取（交易时段内为实时，收盘后为今日实际涨跌）。</span>';
    renderUrgentBanner();
    return;
  }
  const trading = isTradingNow();
  const cls = portChg == null ? 'flat' : portChg > 0.0001 ? 'up' : portChg < -0.0001 ? 'down' : 'flat';
  const t = totals();
  const estDelta = (portChg != null ? t.equity * portChg : 0);
  const perFund = codes.map(f => {
    const e = state.etfCache[f.code];
    const c = e.chgPct > 0.0001 ? 'up' : e.chgPct < -0.0001 ? 'down' : 'flat';
    return `<span class="etf-chip ${c}">${f.name.replace('ETF联接A','').replace('ETF联接C','').replace('ETF联接','')} ${fmtPct(e.chgPct)}</span>`;
  }).join('');
  const ts = codes.map(f => state.etfCache[f.code].ts).sort((a, b) => b - a)[0];
  const tsTxt = ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const urgent = isUrgentWindow();
  el.classList.toggle('etf-urgent', urgent);
  el.innerHTML = `
    <span class="etf-label">${trading ? '📡 盘中预估' : '📡 收盘预估'}（按对应场内ETF实时涨跌近似）</span>
    <span class="etf-port ${cls}">组合约 ${fmtPct(portChg)}</span>
    <span class="etf-delta ${cls}">${estDelta >= 0 ? '+' : '-'}¥${fmt(Math.abs(estDelta))}</span>
    <span class="etf-chips">${perFund}</span>
    <span class="etf-time">更新 ${tsTxt}</span>
    <span class="etf-tip">估计你<b>${trading ? '现在下单' : '下一交易日开盘前下单'}</b>的成交净值较昨收约变动这么多（未知价成交，仅供参考）</span>`;
  renderUrgentBanner();
}

// 收盘前紧急横幅：14:45–15:00 期间提示距收盘剩余时间，避免错过当日净值成交
function renderUrgentBanner() {
  const b = $('closeUrgentBanner');
  if (!b) return;
  if (isUrgentWindow()) {
    const m = minutesToClose();
    b.hidden = false;
    b.innerHTML = `⏰ <b>距 15:00 收盘仅剩 ${m} 分钟</b>｜场外基金 <b>15:00 前</b>下单按<b>今日净值</b>成交，未操作将顺延至 <b>T+1 日净值</b>。想今天建仓 / 止盈 / 低吸的，请现在打开基金 APP 完成买入卖出。`;
  } else {
    b.hidden = true;
  }
}

function fillTradeFundOptions() {
  const sel = $('tradeFund');
  sel.innerHTML = CONFIG.funds.map(f => `<option value="${f.code}">${f.name} (${f.code})</option>`).join('');
}

// ---------- 交易登记 ----------
function recordTrade() {
  const code = $('tradeFund').value;
  const type = $('tradeType').value;
  const amount = parseFloat($('tradeAmount').value);
  let nav = parseFloat($('tradeNav').value);
  const date = $('tradeDate').value || new Date().toISOString().slice(0, 10);

  if (!amount || amount <= 0) { alert('请输入有效金额'); return; }
  if (nav == null || isNaN(nav) || nav <= 0) {
    nav = currentNav(code);
    if (nav == null) { alert('无净值且未手动填写，请填写净值'); return; }
  }

  const pos = getPosition(code);
  const totalCost = CONFIG.funds.reduce((a, f) => a + ((state.positions[f.code] && state.positions[f.code].cost) || 0), 0);
  if (type === 'buy') {
    const available = state.amount - totalCost;
    if (amount > available + 1e-6) { alert('可用资金不足，剩余可投 ¥' + fmt(available)); return; }
    const shares = amount / nav;
    state.positions[code] = { shares: pos.shares + shares, cost: pos.cost + amount };
    // 登记为一个「买入批次」，供短期做差价追踪（涨达阈值即建议卖出该批次赚差价）
    state.lots = state.lots || [];
    state.lots.push({ id: 'L' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), code, amount, nav, shares, date, closed: false });
  } else { // sell — 按份额卖出
    if (pos.shares <= 0) { alert('该基金无持仓'); return; }
    const sharesSold = amount; // 卖出时 amount 代表"份额"
    if (!(sharesSold > 0)) { alert('请输入有效份额'); return; }
    if (sharesSold > pos.shares + 1e-9) { alert('卖出份额超过持仓（当前 ' + fmt(pos.shares) + ' 份）'); return; }
    const costReduce = pos.cost * (sharesSold / pos.shares);
    state.positions[code] = { shares: pos.shares - sharesSold, cost: pos.cost - costReduce };
    // FIFO 扣减对应买入批次的份额（短期做差价追踪用）
    let remaining = sharesSold;
    if (state.lots) {
      for (const lot of state.lots) {
        if (remaining <= 1e-9) break;
        if (lot.code !== code || lot.closed || lot.shares <= 0) continue;
        const take = Math.min(lot.shares, remaining);
        lot.shares -= take;
        remaining -= take;
        if (lot.shares <= 1e-9) { lot.shares = 0; lot.closed = true; }
      }
    }
  }

  // tx 记录：买入 amount=投入金额、shares=购入份额；卖出 amount=回笼金额(份额×净值)、shares=卖出份额
  const txAmount = type === 'sell' ? sharesSold * nav : amount;
  const txShares = type === 'sell' ? sharesSold : (amount / nav);
  state.tx.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), code, type, date, amount: txAmount, nav, shares: txShares });

  // 标记已执行：买入 → 当前触发的低吸档；卖出 → 当前触发的止盈档（避免建议反复出现）
  const f = fundByCode(code);
  if (f) {
    const s = fundStats(code);
    if (type === 'buy' && state.navCache[code] && state.navCache[code].high && s.nav) {
      const dd = (s.nav - state.navCache[code].high) / state.navCache[code].high;
      const steps = f.cat === 'growth' ? CONFIG.growthDrawdown : CONFIG.wideDrawdown;
      const arr = state.filled.dd[code] = state.filled.dd[code] || steps.map(() => false);
      steps.forEach((lvl, i) => { if (dd <= -lvl) arr[i] = true; });
    } else if (type === 'sell' && f.cat === 'growth' && s.cost > 0) {
      const arr = state.filled.tp[code] = state.filled.tp[code] || CONFIG.growthTakeProfit.map(() => false);
      CONFIG.growthTakeProfit.forEach((lvl, i) => { if (s.pnlPct >= lvl) arr[i] = true; });
    }
  }

  saveState();
  $('tradeAmount').value = '';
  $('tradeNav').value = '';
  renderAll();
}

// ---------- 调仓建议引擎 ----------
function buildAdvice() {
  const list = [];
  const t = totals();
  if (state.amount <= 0) {
    return [{ type: 'info', title: '尚未设定金额', body: '请先在「① 配置」输入可投金额并生成目标配置。', reason: '' }];
  }
  const asset = t.asset > 0 ? t.asset : state.amount;
  const cashRatio = t.cash / asset;
  const deployed = state.amount * (1 - CONFIG.cashWeight);

  // 国家队三态：买入中→原节奏；静默→原节奏；疑似撤退→防御（下调建仓系数已在 computeDeployPlan 处理、此处收紧现金软顶 + 暂停低吸 + 顶部横幅）
  const nt = ntInfo();
  const cap = nt.retreat ? CONFIG.cashCap * 0.7 : CONFIG.cashCap; // 撤退期把现金软顶从 30% 收紧到 21%，现金更快回补
  if (nt.retreat) {
    list.unshift({
      type: 'info', title: '🇨🇳 国家队疑似撤退 · 防御模式',
      body: '你已标记「国家队疑似撤退」。本工具<b>不</b>建议清仓离场（指数长期向上 + 个人投基金免资本利得税，底部清仓 = 浮亏变实亏且丢低位筹码），但会<b>收紧姿态</b>：建仓系数下调、现金软顶收紧（回补更快）、<b>暂停低吸</b>、并优先高抛锁定收益。耐心等托底信号回归。',
      reason: '国家队三态 · 防御叠加',
    });
  }

  // 注：不再用「单日已实现涨跌」当操作门禁。场外基金按下一交易日收盘净值（未知价）成交，
  // 当日收盘涨跌属于历史值，用它约束未来操作存在时间错位。改用近期年化波动判断执行节奏（见末尾「波动纪律」）。

  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    const targetWeight = f.weight;
    const currentWeight = s.value / asset;
    const diff = currentWeight - targetWeight;

    // 1) 偏离再平衡（现金已超软顶时暂停减持，优先把现金部署回市场）
    if (diff > CONFIG.driftThreshold && cashRatio <= cap) {
      const sellAmt = diff * asset;
      list.push({
        type: 'sell', title: `再平衡：减持 ${f.name}`,
        body: `当前权重 ${(currentWeight*100).toFixed(1)}% 高于目标 ${(targetWeight*100).toFixed(0)}%，建议卖出约 <b>¥${fmt(sellAmt)}</b>，回笼现金。`,
        reason: `偏离 +${(diff*100).toFixed(1)}%（阈值 ±${(CONFIG.driftThreshold*100).toFixed(0)}%）`,
      });
    } else if (diff < -CONFIG.driftThreshold && s.cost > 0) {
      const buyAmt = Math.min(-diff * asset, t.cash);
      if (buyAmt > 1) {
        list.push({
          type: 'buy', title: `再平衡：增持 ${f.name}`,
          body: `当前权重 ${(currentWeight*100).toFixed(1)}% 低于目标 ${(targetWeight*100).toFixed(0)}%，建议从现金买入约 <b>¥${fmt(buyAmt)}</b>。`,
          reason: `偏离 ${(diff*100).toFixed(1)}%（阈值 ±${(CONFIG.driftThreshold*100).toFixed(0)}%），现金可用 ¥${fmt(t.cash)}`,
        });
      }
    }

    // 2) 成长止盈（分档，已执行则消失；盈利回吐到线下自动重置）
    if (f.cat === 'growth' && s.cost > 0) {
      const tp = state.filled.tp[f.code] = state.filled.tp[f.code] || CONFIG.growthTakeProfit.map(() => false);
      CONFIG.growthTakeProfit.forEach((lvl, i) => {
        const triggered = s.pnlPct >= lvl;
        if (!triggered) { tp[i] = false; return; }   // 回吐到线下方 → 重置，未来可再触发
        if (tp[i]) return;                            // 已执行 → 跳过，不再提示
        const sellAmt = s.value * (1/3);
        list.push({
          type: 'sell', key: `tp-${f.code}-${i}`,
          title: `止盈：分批减持 ${f.name}（第${i+1}档）`,
          body: `累计盈利 ${(s.pnlPct*100).toFixed(1)}% 已达 +${(lvl*100).toFixed(0)}% 触发线，建议卖出约 1/3 持仓（<b>¥${fmt(sellAmt)}</b>）入现金。`,
          reason: `成长止盈纪律：+20% / +35% 分两档`,
        });
      });
    }

    // 2.5) 高抛赚差价：连涨 + 已有盈利 + 估值偏高 → 部分抛出（非清仓）→ 轮动补更便宜/低配基金
    {
      const gainTh = (CONFIG.hpGain && CONFIG.hpGain[f.cat] != null) ? CONFIG.hpGain[f.cat] : 0.15;
      const streak = upStreak(f.code);
      const ind = (CONFIG.indicators && CONFIG.indicators.perFund || []).find(p => p.code === f.code) || {};
      const valPct = ind.valPct != null ? ind.valPct : 0.5;
      const hp = state.filled.hp = state.filled.hp || {};
      const hpArr = hp[f.code] = hp[f.code] || [false];
      // 触发条件消失 → 复位，允许未来再次触发（与成长止盈的回吐重置同理）
      if (s.pnlPct < gainTh * 0.5 || valPct < CONFIG.hpValHigh * 0.7 || streak === 0) hpArr[0] = false;
      if (s.cost > 0 && s.pnl > 0 && streak >= CONFIG.hpMinStreak && s.pnlPct >= gainTh && valPct >= CONFIG.hpValHigh && !hpArr[0]) {
        const alreadySell = list.some(x => x.type === 'sell' && x.title.indexOf(f.name) >= 0); // 避免与成长止盈同基金同日重复
        if (!alreadySell) {
          const sellAmt = s.value * CONFIG.hpSellFraction;
          const tgt = rotationTarget(f.code);
          const tgtName = tgt ? tgt.name : '更低配/低估的基金';
          hpArr[0] = true;
          list.push({
            type: 'sell', key: `hp-${f.code}-0`, sub: '高抛赚差价',
            title: `高抛：部分减持 ${f.name}`,
            body: `连续上涨 <b>${streak} 天</b>、累计盈利 <b>${fmtPct(s.pnlPct)}</b>、估值分位 <b>${(valPct*100).toFixed(0)}%</b> 偏高，建议卖出约 <b>1/3 持仓（¥${fmt(sellAmt)}）</b>锁定收益，回笼现金轮动补入${tgt ? `更低估/低配的 <b>${tgtName}</b>` : '更低配/低估的基金'}。<br><b>注：高抛非清仓，仅赚差价</b>，剩余 2/3 继续持有。`,
            reason: `高抛赚差价：连涨${streak}天 + 盈利${(s.pnlPct*100).toFixed(0)}% + 估值分位${(valPct*100).toFixed(0)}%偏高`,
          });
        }
      }
    }

    // 3) 回撤分档加仓（需近3月高点；已执行则消失；价格回升突破该档自动重置）。国家队疑似撤退时暂停低吸。
    const high = state.navCache[f.code] && state.navCache[f.code].high;
    if (!nt.pauseDip && high && s.nav && f.cat !== 'gold') {  // 黄金为避险资产，不做回撤分档加仓，仅靠偏离再平衡
      const dd = (s.nav - high) / high; // 负值=回撤
      const steps = f.cat === 'growth' ? CONFIG.growthDrawdown : CONFIG.wideDrawdown;
      const fd = state.filled.dd[f.code] = state.filled.dd[f.code] || steps.map(() => false);
      steps.forEach((lvl, i) => {
        const triggered = dd <= -lvl;
        if (!triggered) { fd[i] = false; return; }  // 价格回升到该档之上 → 重置
        if (fd[i]) return;                           // 已执行 → 跳过
        const budget = deployed * f.weight * CONFIG.dipBudgetRatio;
        const tranche = budget / steps.length;
        const buyAmt = Math.min(tranche, Math.max(0, t.cash - (t.asset || 0) * cashFloorRatio())); // 与智能建仓同守最低现金比例地板
        if (buyAmt > 1) {
          list.push({
            type: 'buy', key: `dd-${f.code}-${i}`,
            title: `低吸：加仓 ${f.name}（第${i+1}档）`,
            body: `自近3月高点回撤 ${(dd*100).toFixed(1)}% 已达 -${(lvl*100).toFixed(0)}% 触发线，建议从现金加仓约 <b>¥${fmt(buyAmt)}</b>。`,
            reason: `回撤分档加仓（宽基 -8/-15/-25，成长 -10/-20/-30）`,
          });
        }
      });
    }
  });

  // 3.5) 短期做差价：低吸/买入批次在短期(3~21天)内涨达阈值(默认10%)→卖出该批次赚差价（非清仓）
  const spreadGain = state.spreadGain != null ? state.spreadGain : CONFIG.spreadGain;
  (state.lots || []).forEach(lot => {
    if (lot.closed) return;
    const f = fundByCode(lot.code);
    if (!f) return;
    const nav = currentNav(lot.code);
    if (nav == null) return;
    const gain = (nav - lot.nav) / lot.nav;
    const days = Math.max(0, Math.floor((Date.now() - new Date(lot.date).getTime()) / 86400000));
    if (gain >= spreadGain && days >= CONFIG.spreadMinDays && days <= CONFIG.spreadMaxDays) {
      const filledSpread = state.filled.spread = state.filled.spread || {};
      if (filledSpread[lot.id]) return; // 已执行 → 跳过
      const sellShares = lot.shares;
      const sellAmt = sellShares * nav;
      const profit = sellAmt - lot.amount;
      const tgt = rotationTarget(lot.code);
      const tgtName = tgt ? tgt.name.replace('ETF联接A', '').replace('ETF联接', '') : '';
      list.push({
        type: 'sell', key: `spread-${lot.id}`, sub: '短期差价',
        title: `短期差价：卖出 ${f.name} 低吸批次`,
        body: `低吸批次（${lot.date}，投入 ¥${fmt(lot.amount)}）持有 <b>${days} 天</b>已涨 <b>${fmtPct(gain)}</b>，达短期做差价触发线（≥${fmtPct(spreadGain)}），建议<b>卖出该批次</b>约 <b>¥${fmt(sellAmt)}</b>，落袋收益约 <b>¥${fmt(profit)}</b>。${tgt ? `回笼现金轮动补入更低估/低配的 <b>${tgtName}</b>。` : ''}<br><b>注：仅卖这批次，非清仓</b>，其余持仓继续持有。`,
        reason: `短期做差价：低吸批次 ${days} 天 +${fmtPct(gain)}（阈值≥${fmtPct(spreadGain)}、持有 ${CONFIG.spreadMinDays}~${CONFIG.spreadMaxDays} 天）`,
      });
    }
  });

  // 5) 亏损持仓评估：结合真实建仓成本，对「仍亏损」的基金给出是否割肉的理性裁决。
  //    核心原则：指数基金长期向上 + 中国个人投基金免资本利得税 → 绝大多数情况「持有不割肉」；
  //    亏着的基金往往已是组合低配项，再平衡/低吸逻辑本就会把它买回；仅深亏+信号偏空时给「回本减仓计划」。
  const perFundMap = {};
  (CONFIG.indicators && CONFIG.indicators.perFund || []).forEach(p => perFundMap[p.code] = p);
  const lossCards = [];
  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    if (s.cost <= 0 || s.pnl >= 0) return;            // 无成本或已盈利 → 不评估
    const ind = perFundMap[f.code] || {};
    const valPct = ind.valPct != null ? ind.valPct : 0.5;
    const mom = ind.mom60 != null ? ind.mom60 : 0;
    const lossPct = -s.pnlPct;                          // 亏损深度（正数）
    const recoverPct = s.value > 0 ? (-s.pnl) / s.value : 0; // 回本还需涨幅
    const etf = state.etfCache[f.code];
    const recovering = (etf && etf.chgPct != null && etf.chgPct > 0) || mom > -0.03; // 近期有反弹迹象
    const signalBearish = valPct > 0.70 && mom < 0;    // 估值偏贵且动能为负 → 信号偏空

    let ruling, detail;
    if (f.cat === 'growth') {
      if (lossPct > 0.25 || signalBearish) {
        ruling = '持有不割 · 设回本减仓计划';
        detail = `成长类波动大、深套后不宜底部清仓。建议<b>继续持有</b>，不现在割肉；待反弹至成本线附近（约需再涨 <b>+${(recoverPct*100).toFixed(0)}%</b> 回本）时，减持 1/3~1/2 换入更稳的红利低波或黄金，降低单一成长暴露。`;
      } else if (lossPct > 0.10) {
        ruling = '持有 · 可低位摊薄';
        detail = `亏损 ${(lossPct*100).toFixed(1)}%，成长回撤后常回归。建议<b>持有</b>；若现金充裕且未触现金纪律下限，可在低位小幅补仓摊薄成本，缩短回本时间。`;
      } else {
        ruling = '持有即可';
        detail = `浅亏 ${(lossPct*100).toFixed(1)}%，成长波动大、回撤后多能回归，<b>无需割肉</b>。`;
      }
    } else {
      // broad / value / gold：低波长期向上，几乎一律持有不割
      if (lossPct > 0.25) {
        ruling = '持有 · 深套不割';
        detail = `亏损 ${(lossPct*100).toFixed(1)}% 已深度套牢，但此类资产长期回归概率高，<b>持有不割</b>；现金充裕时可分档补仓拉低成本。`;
      } else if (lossPct > 0.10) {
        ruling = '持有 · 可低位摊薄';
        detail = `亏损 ${(lossPct*100).toFixed(1)}%，宽基/红利/黄金长期向上，<b>持有不割</b>；现金允许可在低位小幅补仓。`;
      } else {
        ruling = '持有即可';
        detail = `浅亏 ${(lossPct*100).toFixed(1)}%，<b>无需割肉</b>，长期持有待回本。`;
      }
    }
    const recoverTxt = `距回本还差约 <b>+${(recoverPct*100).toFixed(1)}%</b>`;
    const recoverNote = recovering
      ? `近月已现反弹迹象，${recoverTxt}，切忌在回本前割肉把反弹红利丢掉；回本后按③纪律再平衡。`
      : `当前仍偏弱，${recoverTxt}，继续持有等待。`;

    lossCards.push({
      type: 'loss',
      title: `亏损评估：${f.name}`,
      body: `当前<span class="down">亏损 ¥${fmt(Math.abs(s.pnl))}（${fmtPct(s.pnlPct)}）</span>。裁决：<b>${ruling}</b>。${detail} ${recoverNote}`,
      reason: `结合真实建仓成本（投入 ¥${fmt(s.cost)}、现市值 ¥${fmt(s.value)}）；指数基金长期向上+个人免资本利得税 → 底部割肉=浮亏变实亏且丢低位筹码`,
    });
  });
  if (lossCards.length) [...lossCards].reverse().forEach(c => list.unshift(c));

  // 4.5) 现金软顶回补：占比超 cap 时，按目标权重把多余现金买回基金，防牛市现金无限堆积（撤退期 cap 已收紧）
  if (cashRatio > cap) {
    const excess = t.cash - (state.amount || 0) * CONFIG.cashWeight; // 回补到目标现金
    const fc = state.filled.cap = state.filled.cap || {};
    if (excess > 1) {
      CONFIG.funds.forEach(f => {
        if (fc[f.code]) return; // 已执行 → 跳过
        const buyAmt = excess * f.weight;
        if (buyAmt > 1) {
          list.push({
            type: 'buy', key: `cap-${f.code}-0`,
            title: `现金回补：加仓 ${f.name}`,
            body: `现金占比 ${(cashRatio*100).toFixed(1)}% 已超软顶 ${(CONFIG.cashCap*100).toFixed(0)}%，建议按目标权重加仓约 <b>¥${fmt(buyAmt)}</b>，把现金拉回目标 ${(CONFIG.cashWeight*100).toFixed(0)}%。`,
            reason: '现金软顶回补（防止牛市现金无限堆积）',
          });
        }
      });
    }
  } else {
    state.filled.cap = {}; // 现金回到软顶内，复位回补标记
  }

  // 4) 现金纪律（目标随市场浮动；最低现金比例为硬地板）
  if (cashRatio < cashFloorRatio()) {
    list.unshift({ type: 'info', title: '现金低于最低比例', body: `现金占比 ${(cashRatio*100).toFixed(1)}%，已触最低现金比例 ${(cashFloorRatio()*100).toFixed(0)}%，按纪律暂停所有加仓，优先保留弹药，等待再平衡或止盈释放现金。`, reason: '现金纪律（最低现金比例地板）' });
  } else if (cashRatio > CONFIG.cashWeight + 0.05 && cashRatio <= CONFIG.cashCap) {
    list.unshift({ type: 'info', title: '现金高于目标', body: `当前现金占比 ${(cashRatio*100).toFixed(1)}%，高于目标 ${(CONFIG.cashWeight*100).toFixed(0)}% 约 5 个百分点，偏高，建议择机建仓以防踏空（优先补齐偏离目标的基金）。`, reason: '现金纪律（目标随市场浮动）' });
  }

  if (list.length === 0) {
    list.push({ type: 'info', title: '暂无调仓信号', body: '各基金权重在阈值内，且未见止盈/低吸触发。保持持有，下个季度末再审视。', reason: '' });
  }

  // 波动纪律：用「近期年化波动」决定执行节奏（对未来成交日更有参考性），不做一刀切的操作开关
  const volAll = (CONFIG.indicators && CONFIG.indicators.volAll) || 0.20;
  if (volAll > 0.28) {
    list.unshift({
      type: 'info', title: `市场高波动 · 建议分批（年化 ${(volAll * 100).toFixed(0)}%）`,
      body: '近期波动明显高于常态，一次性成交容易买在短期高点。建议把本次操作拆成 2–3 笔、间隔 3–5 个交易日执行。',
      reason: '波动纪律：基于近期年化波动',
    });
  } else if (volAll < 0.15) {
    list.unshift({
      type: 'info', title: `市场平稳 · 可正常执行（年化 ${(volAll * 100).toFixed(0)}%）`,
      body: '近期波动处于低位，信号按常规执行即可，无需刻意拆分。',
      reason: '波动纪律：基于近期年化波动',
    });
  }

  return list;
}

function renderAdvice() {
  const list = buildAdvice();
  const wrap = $('adviceList');
  // 执行落差提示：场外基金按下一交易日收盘净值（未知价）成交，必须明确告知价格基准日
  let navDate = '';
  CONFIG.funds.forEach(f => {
    const c = state.navCache[f.code];
    if (c && c.date && c.date > navDate) navDate = c.date;
  });
  const parts = navDate ? navDate.split('-') : null;
  const baseTxt = parts ? `${+parts[1]} 月 ${+parts[2]} 日` : '最近收盘';
  const banner = `
    <div class="advice info exec-note">
      <div class="a-head"><span class="tag info">执行提示</span>信号基于 <b>${baseTxt}</b> 收盘净值 · 按<b>下一交易日 15:00 前</b>的申赎、以<b>当日收盘净值</b>成交</div>
      <div class="a-body">场外基金是「未知价成交」：你现在看到的所有价格都是<b>已收盘的历史净值</b>，真正成交用的是你下单那天的收盘价（下单时不可知）。因此下方金额是<b>目标金额</b>，实际成交份额会随当日涨跌浮动——这正是「高波动时分批」的意义。</div>
      <div class="a-reason">依据：开放式基金申赎规则（T 日 15:00 前按 T 日净值，之后按 T+1 日净值）。想在交易时段内缩小这个落差？看「② 持仓」顶部的「📡 盘中预估」——用对应场内 ETF 的实时涨跌近似你<b>现在下单</b>的成交方向与时点幅度，下单前瞄一眼就知道今天大致是涨是跌。</div>
    </div>`;
  wrap.innerHTML = banner + list.map(a => `
    <div class="advice ${a.type}">
      <div class="a-head"><span class="tag ${a.type}">${a.type === 'buy' ? '买入' : a.type === 'sell' ? '卖出' : a.type === 'loss' ? '亏损评估' : '提示'}</span>${a.sub ? `<span class="tag sub">${a.sub}</span>` : ''}${a.title}
        ${a.key ? `<button class="a-done" data-key="${a.key}">✓ 我已执行</button>` : ''}
      </div>
      <div class="a-body">${a.body}</div>
      ${a.reason ? `<div class="a-reason">依据：${a.reason}</div>` : ''}
    </div>`).join('');
}

// ---------- 买入批次追踪（短期做差价用） ----------
function renderLots() {
  const wrap = $('lotsWrap');
  if (!wrap) return;
  const lots = (state.lots || []).filter(l => !l.closed);
  if (lots.length === 0) {
    wrap.innerHTML = '<p class="hint lots-empty">📦 暂无进行中的买入批次（低吸/买入后会自动追踪，涨达阈值即提醒做差价）。</p>';
    return;
  }
  let rows = '';
  lots.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(lot => {
    const f = fundByCode(lot.code);
    const nav = currentNav(lot.code);
    const gain = (nav != null && lot.nav > 0) ? (nav - lot.nav) / lot.nav : null;
    const days = Math.max(0, Math.floor((Date.now() - new Date(lot.date).getTime()) / 86400000));
    const cls = gain == null ? 'flat' : gain > 0.0001 ? 'up' : gain < -0.0001 ? 'down' : 'flat';
    const gainTxt = gain == null ? '—' : fmtPct(gain);
    const prog = Math.min(100, Math.max(0, (gain != null ? gain : 0) * 100)); // 简易进度（10%≈100%）
    rows += `<tr>
      <td>${lot.date}</td>
      <td>${f ? f.name.replace('ETF联接A','').replace('ETF联接','') : lot.code}</td>
      <td>¥${fmt(lot.amount)}</td>
      <td class="${cls}">${gainTxt}</td>
      <td>${days} 天</td>
      <td><div class="lot-bar"><i style="width:${prog}%"></i></div></td>
    </tr>`;
  });
  wrap.innerHTML = `
    <h3>📦 买入批次追踪（短期做差价）</h3>
    <p class="hint">每笔买入自动登记为一个批次，持有 3~21 天且涨幅达阈值（默认 +10%）即弹出「短期差价」卖出建议。下方显示进行中批次的浮盈与持有天数。</p>
    <div class="table-wrap">
      <table><thead><tr><th>日期</th><th>基金</th><th>投入</th><th>浮盈</th><th>持有</th><th>进度</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

// ---------- 交易记录 ----------
function renderLog() {
  const body = $('logBody');
  const tx = [...state.tx].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (tx.length === 0) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">暂无记录</td></tr>'; return; }
  body.innerHTML = tx.map(r => {
    const f = fundByCode(r.code);
    const cls = r.type === 'buy' ? 'up' : 'down';
    const txt = r.type === 'buy' ? '买入' : '卖出';
    return `<tr><td>${r.date}</td><td>${f ? f.name : r.code}</td><td class="${cls}">${txt}</td><td>¥${fmt(r.amount)}</td><td>${r.nav != null ? r.nav.toFixed(4) : '—'}</td></tr>`;
  }).join('');
}

// ---------- 渲染：持仓表合计行（含现金） ----------
function renderHoldingsFoot() {
  const t = totals();
  const cashPct = t.asset > 0 ? (t.cash / t.asset * 100) : 0;
  const pnlCls = t.pnl >= 0 ? 'up' : 'down';
  $('holdingsFoot').innerHTML = `
    <tr class="foot">
      <td colspan="2">权益合计</td>
      <td>¥${fmt(t.costAll)}</td>
      <td>—</td><td>—</td><td>—</td>
      <td>¥${fmt(t.equity)}</td>
      <td colspan="2">—</td>
    </tr>
    <tr class="foot cash">
      <td colspan="2">现金机动（待命）</td>
      <td colspan="5">¥${fmt(t.cash)}　占总资产 ${cashPct.toFixed(1)}%（目标 ${(CONFIG.cashWeight*100).toFixed(0)}%）</td>
      <td colspan="2">—</td>
    </tr>
    <tr class="foot total">
      <td colspan="2">总资产</td>
      <td colspan="5">¥${fmt(t.asset)}</td>
      <td class="${pnlCls}" colspan="2">${t.pnl >= 0 ? '+' : '-'}¥${fmt(Math.abs(t.pnl))}</td>
    </tr>`;
}

// ---------- 渲染：现金状态面板（在持仓/行情区直接可见） ----------
function renderCashPanel() {
  const t = totals();
  const targetCash = (state.amount || 0) * CONFIG.cashWeight;
  const gap = t.cash - targetCash;
  const cashRatio = t.asset > 0 ? t.cash / t.asset : 0;
  let status, cls;
  if (cashRatio < cashFloorRatio()) { status = '偏低 · 暂停加仓'; cls = 'down'; }
  else if (cashRatio > CONFIG.cashWeight + 0.05) { status = '偏高 · 择机建仓'; cls = 'up'; }
  else { status = '正常'; cls = 'flat'; }
  $('cashPanel').innerHTML = `
    <h3>现金机动状态</h3>
    <div class="cash-grid">
      <div class="cash-stat"><span>当前现金（待命）</span><b>¥${fmt(t.cash)}</b></div>
      <div class="cash-stat"><span>目标现金（${(CONFIG.cashWeight*100).toFixed(0)}%×总投入）</span><b>¥${fmt(targetCash)}</b></div>
      <div class="cash-stat"><span>与目标偏差</span><b class="${gap >= 0 ? 'up' : 'down'}">${gap >= 0 ? '+' : ''}¥${fmt(gap)}</b></div>
      <div class="cash-stat"><span>剩余可投（=当前现金）</span><b>¥${fmt(t.cash)}</b></div>
      <div class="cash-stat"><span>现金占比</span><b class="${cls}">${(cashRatio * 100).toFixed(1)}%</b></div>
      <div class="cash-stat"><span>状态</span><b class="${cls}">${status}</b></div>
    </div>
    <p class="hint">说明：现金 = 总投入 − 已投成本（自动派生）。你买入基金时从这里划账、卖出时回笼到这里；达标后约停在 ${(CONFIG.cashWeight*100).toFixed(0)}%。想加钱点「① 配置」里的「追加」。</p>`;
}

// ---------- 渲染：策略面板（理财财动态维护） ----------
function renderStrategyPanel() {
  const el = $('strategyMeta');
  if (!el) return;
  const m = getStrategyMeta();
  if (!m) { el.innerHTML = '<p class="hint">未加载策略信息（使用内置默认配置）。</p>'; return; }
  const w = CONFIG.funds.map(f => {
    const short = f.name.replace('ETF联接A', '').replace('ETF联接', '');
    return `${short} ${(f.weight * 100).toFixed(0)}%`;
  }).join(' · ');
  const ind = m.indicators;
  let indHtml = '';
  if (ind) {
    indHtml = `
      <div class="strat-ind">
        <div class="ind-row"><span>全市场年化波动</span><b>${(ind.volAll * 100).toFixed(1)}%</b></div>
        <div class="ind-row"><span>组合120日回撤</span><b>${(ind.ddAll * 100).toFixed(1)}%</b></div>
        <div class="ind-row"><span>成长/价值60日强度</span><b>${fmtPct(ind.growthVsValue)}</b></div>
      </div>
      <div class="strat-ind-funds">
        ${ind.perFund.map(f => `<span class="chip">${f.name} 波动${(f.vol*100).toFixed(0)}% 回撤${(f.dd*100).toFixed(0)}% 估值分位${(f.valPct*100).toFixed(0)}%</span>`).join('')}
      </div>`;
  }
  const notesHtml = (m.notes && m.notes.length) ? `<div class="strat-notes">${m.notes.map(n => `· ${n}`).join('<br>')}</div>` : '';
  const postureLabel = { conservative: '稳健', balanced: '平衡', aggressive: '进取' }[state.riskPosture || 'balanced'];
  el.innerHTML = `
    <div class="strat-head">
      <span class="strat-ver">${m.version || '—'}</span>
      <span class="strat-badge">🔄 每日自动更新</span>
      <span class="strat-date">${m.updated ? m.updated.slice(0, 16).replace('T', ' ') : '—'}</span>
    </div>
    <div class="strat-src">${m.source || ''}　|　你的风险偏好：<b>${postureLabel}</b></div>
    <div class="strat-weights">当前权重：${w} ｜ 现金 ${(CONFIG.cashWeight * 100).toFixed(0)}% ｜ 偏离阈值 ±${(CONFIG.driftThreshold * 100).toFixed(0)}%</div>
    ${indHtml}
    ${notesHtml}`;
}

// ---------- 总渲染 ----------
function renderMascot() {
  const el = $('mascotMsg');
  if (!el) return;
  const t = totals();
  let msg;
  if (state.amount <= 0) {
    msg = '嗨，我是理财猫～把金额填上，咱们慢慢建仓 🐱';
  } else if (t.pnl > 0) {
    msg = `今天账户红扑扑的，理财猫给你点个赞 👍 小赚 <b>¥${fmt(t.pnl)}</b>～记住别贪，按纪律来就好。`;
  } else if (t.pnl < 0) {
    msg = `今天绿了一点点，别慌～都是长期里的小浪花 🌿 按策略补、按纪律拿，理财猫陪你。`;
  } else {
    msg = '当前不赚不亏，稳稳的～保持节奏，咱们慢慢来 🐱';
  }
  el.innerHTML = msg;
}

function renderAll() {
  renderStrategyPanel();
  renderSummary();
  renderTargets();
  renderDCA();
  renderHoldings();
  renderHoldingsFoot();
  renderCashPanel();
  renderAdvice();
  renderLog();
  renderLots();
  renderMascot();
  renderSignals();
  applyView();
}

// ---------- 视图切换（三页分离：持仓与行情 / 调仓建议 / 配置） ----------
let activeView = (state.activeView && ['holdings', 'advice', 'config'].includes(state.activeView)) ? state.activeView : 'holdings';
function applyView() {
  ['holdings', 'advice', 'config'].forEach(v => {
    const el = $('view-' + v);
    if (el) el.classList.toggle('active', v === activeView);
  });
  document.querySelectorAll('.bottomnav button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === activeView);
  });
  if (activeView === 'holdings') renderEtfEstimateBar(_lastPortChg); // 切到持仓页时刷新盘中预估
}
function switchView(v) {
  if (!['holdings', 'advice', 'config'].includes(v)) return;
  activeView = v;
  if (state) { state.activeView = v; saveState(); }
  applyView();
  window.scrollTo(0, 0);   // 翻页总是从顶部开始
  const tb = $('toTopBtn'); // 新页面从顶部起，隐藏回到顶部按钮
  if (tb) tb.classList.remove('show');
}
// 国家队提示文案（配置页）
function renderSignals() {
  const tip = $('ntTip');
  if (tip) {
    const map = {
      buy: '托底信号明确：敢在便宜时加仓、低吸更积极。',
      silence: '无明显动作：按市场便宜度原节奏走。',
      retreat: '谨慎追高：优先高抛、暂停低吸、现金软顶收紧。',
    };
    tip.textContent = map[state.nationalTeam || 'silence'];
  }
}

// ---------- 事件绑定 ----------
function init() {
  fillTradeFundOptions();
  $('tradeDate').value = new Date().toISOString().slice(0, 10);

  $('genConfigBtn').addEventListener('click', () => {
    const amt = parseFloat($('amountInput').value);
    if (!amt || amt <= 0) { alert('请输入有效金额'); return; }
    if (state.amount > 0 && Math.abs(amt - state.amount) > 1) {
      if (!confirm(`当前已设定初投金额 ¥${fmt(state.amount)}，确定改为 ¥${fmt(amt)}？\n（已登记的持仓与盈亏不受影响，仅调整目标与现金基准）`)) return;
    }
    state.amount = amt;
    // 初始化分批建仓计划：设定金额即出计划；金额变更保留已执行标记
    if (!state.dca) {
      state.dca = { batches: 3, intervalDays: 14, startDate: new Date().toISOString().slice(0, 10), executed: [] };
    } else if (!state.dca.startDate) {
      state.dca.startDate = new Date().toISOString().slice(0, 10);
      state.dca.executed = [];
    }
    // 现金为派生值（总投入 − 已投成本基准），无需手动设定；建仓后自然趋近 20% 目标
    saveState();
    renderAll();
  });

  $('addInvestBtn').addEventListener('click', () => {
    const add = parseFloat($('addAmountInput').value);
    if (!add || add <= 0) { alert('请输入有效的追加金额'); return; }
    if (state.amount <= 0) { alert('请先在「设定初投金额」里填好初投金额'); return; }
    state.amount += add; // 新钱进入现金池，目标配置同步上调，不影响已登记持仓
    saveState();
    $('addAmountInput').value = '';
    renderAll();
  });

  $('refreshBtn').addEventListener('click', refreshMarket);
  $('tradeSubmit').addEventListener('click', recordTrade);

  // 调仓建议「我已执行」→ 标记该分档为已执行，建议即消失（价格回到线下方会自动重置）
  $('adviceList').addEventListener('click', (e) => {
    const btn = e.target.closest('.a-done');
    if (!btn) return;
    const key = btn.dataset.key;
    if (key.indexOf('spread-') === 0) { // 短期做差价：标记该批次已执行并关闭
      const lotId = key.slice('spread-'.length);
      const filledSpread = state.filled.spread = state.filled.spread || {};
      filledSpread[lotId] = true;
      const lot = (state.lots || []).find(l => l.id === lotId);
      if (lot) lot.closed = true;
      saveState();
      renderAll();
      return;
    }
    const parts = key.split('-'); // tp-CODE-i 或 dd-CODE-i
    const type = parts[0], code = parts[1], idx = +parts[2];
    const arr = state.filled[type][code] = state.filled[type][code] || [];
    arr[idx] = true;
    saveState();
    renderAll();
  });

  // 策略面板：恢复理财财默认 / 粘贴 JSON 套用
  $('applyDefaultBtn').addEventListener('click', () => {
    const S = window.STRATEGY;
    const custom = !!(state.strategyMeta && state.strategyMeta.source && state.strategyMeta.source.indexOf('粘贴') >= 0);
    if (!S) { alert('未检测到 strategy.js，已保持内置默认配置（兜底，未改动）。'); return; }
    // 恢复为引擎基线（平衡），并清空风险偏好叠加、重置为平衡
    state.riskPosture = 'balanced';
    BASE_CONFIG = JSON.parse(JSON.stringify(S));
    CONFIG = tiltConfig(BASE_CONFIG, 'balanced');
    state.strategyMeta = null;
    saveState();
    if ($('postureSel')) $('postureSel').value = 'balanced';
    fillTradeFundOptions();
    renderAll();
    alert(custom ? ('已恢复理财财默认策略（' + S.version + '），风险偏好重置为平衡。')
                 : ('当前已是理财财默认策略（' + S.version + '），风险偏好已重置为平衡。'));
  });
  $('importStrategyBtn').addEventListener('click', () => {
    const txt = $('strategyInput').value.trim();
    if (!txt) { alert('请粘贴策略 JSON'); return; }
    try {
      const obj = JSON.parse(txt);
      applyStrategy(obj);
      alert('已套用粘贴的策略：' + (obj.version || '自定义'));
      $('strategyInput').value = '';
    } catch (e) { alert('JSON 解析失败：' + e.message); }
  });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('确定清空全部数据？（金额、持仓、交易记录）')) {
      state = defaultState();
      saveState();
      $('amountInput').value = '';
      renderAll();
    }
  });

  // 风险偏好（底仓姿态）：在引擎自动基线之上叠加，本地生效
  const postureSel = $('postureSel');
  if (postureSel) {
    postureSel.value = state.riskPosture || 'balanced';
    applyPosture();
    postureSel.addEventListener('change', () => {
      state.riskPosture = postureSel.value;
      saveState();
      applyPosture();
    });
  }

  // 🇨🇳 国家队状态（手动标记，防御叠加）
  const ntSel = $('ntSel');
  if (ntSel) {
    ntSel.value = state.nationalTeam || 'silence';
    ntSel.addEventListener('change', () => {
      state.nationalTeam = ntSel.value;
      saveState();
      renderAll();
    });
  }

  // 💰 最低现金比例（硬地板，可调）
  const minCashSel = $('minCashSel');
  if (minCashSel) {
    minCashSel.value = String(state.minCashRatio != null ? state.minCashRatio : CONFIG.minCashRatio);
    minCashSel.addEventListener('change', () => {
      state.minCashRatio = parseFloat(minCashSel.value);
      saveState();
      renderAll();
    });
  }
  // 🔁 短期做差价涨幅阈值
  const spreadSel = $('spreadSel');
  if (spreadSel) {
    spreadSel.value = String(state.spreadGain != null ? state.spreadGain : CONFIG.spreadGain);
    spreadSel.addEventListener('change', () => {
      state.spreadGain = parseFloat(spreadSel.value);
      saveState();
      renderAll();
    });
  }

  // 底部导航：三页切换
  document.querySelectorAll('.bottomnav button').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  // 回到顶部浮动按钮：滚动超过阈值浮现，点击平滑回顶（所有页面通用，页面级固定）
  const toTopBtn = $('toTopBtn');
  if (toTopBtn) {
    const onScroll = () => {
      if (window.scrollY > 240) toTopBtn.classList.add('show');
      else toTopBtn.classList.remove('show');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    toTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    onScroll();
  }

  // 分批建仓 / 记录实际持仓 交互（事件委托到 #views 容器，innerHTML 重建后仍有效）
  const dcaWrap = $('views');
  if (dcaWrap) {
    dcaWrap.addEventListener('click', (e) => {
      if (e.target.closest('#dcaRegenBtn')) {
        if (!state.dca) state.dca = { batches: 3, intervalDays: 14, startDate: null, executed: [] };
        state.dca.startDate = new Date().toISOString().slice(0, 10);
        state.dca.executed = [];
        saveState(); renderAll(); return;
      }
      if (e.target.closest('#holdSaveBtn')) { recordHolding(); return; }
      const rm = e.target.closest('.hold-remove');
      if (rm) { removeHolding(rm.dataset.code); return; }
    });
    dcaWrap.addEventListener('change', (e) => {
      if (e.target.id === 'dcaBatches') { state.dca.batches = +e.target.value; saveState(); renderAll(); }
      else if (e.target.id === 'dcaInterval') { state.dca.intervalDays = +e.target.value; saveState(); renderAll(); }
    });
  }

  // 买入/卖出时净值自动带入估算值
  $('tradeFund').addEventListener('change', autoFillNav);
  $('tradeType').addEventListener('change', autoFillNav);

  renderAll();
  // 注册 Service Worker：缓存网页外壳，断网也能打开看（离线参考）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // 打开即拉一次行情
  refreshMarket();

  // 交易时段每5分钟自动刷新
  setInterval(() => {
    const h = new Date().getHours(), m = new Date().getMinutes();
    const trading = (h === 9 && m >= 30) || h === 10 || h === 11 || (h >= 13 && h < 15);
    if (trading) refreshMarket();
  }, CONFIG.refreshMs);

  // 收盘前紧急窗口心跳：每60秒刷新倒计时横幅（仅重渲染，不重新拉取行情）
  setInterval(() => {
    if (isUrgentWindow()) renderEtfEstimateBar(_lastPortChg);
  }, 60 * 1000);
}

function autoFillNav() {
  const code = $('tradeFund').value;
  const nav = currentNav(code);
  if (nav != null) $('tradeNav').value = nav.toFixed(4);
}

document.addEventListener('DOMContentLoaded', init);
