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
  historyDays: 90,             // 近3月高点窗口
  refreshMs: 5 * 60 * 1000,    // 交易时段每5分钟自动刷新
  funds: [
    { code: '110020', name: '易方达沪深300ETF联接A',        weight: 0.15, cat: 'broad' },
    { code: '022434', name: '南方中证A500ETF联接A',       weight: 0.13, cat: 'broad' },
    { code: '007466', name: '华泰柏瑞中证红利低波ETF联接A',  weight: 0.25, cat: 'value' },
    { code: '011612', name: '华夏科创50ETF联接A',           weight: 0.12, cat: 'growth' },
    { code: '110026', name: '易方达创业板ETF联接A',         weight: 0.10, cat: 'growth' },
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
    lastRefresh: 0,
    riskPosture: 'balanced', // 风险偏好：conservative / balanced / aggressive
    filled: { dd: {}, tp: {} }, // 已执行的分档记忆：dd[code]=[bool×3], tp[code]=[bool×2]
    lastNavUpdate: 0,        // 最近一次成功拉取净值的时间戳（毫秒）
    dataMode: 'live',        // live=联网最新 / cache=离线缓存
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
        resolve({ nav, prevNav, dailyChange, date, high });
      } catch (e) { resolve(null); }
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
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
  state.lastRefresh = Date.now();
  state.lastNavUpdate = Date.now();
  saveState();
  const anyData = CONFIG.funds.some(f => state.navCache[f.code] && state.navCache[f.code].nav != null);
  const online = navigator.onLine;
  if (anyData) {
    state.dataMode = 'live';
    $('refreshStatus').textContent = '实时净值 · ' + new Date().toLocaleTimeString('zh-CN') + ' 联网刷新';
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
    const cat = f.cat === 'broad' ? '宽基' : f.cat === 'value' ? '红利低波' : '成长';
    html += `<tr><td>${f.name}</td><td>${f.code}</td><td>${(f.weight*100).toFixed(0)}%</td><td>¥${fmt(amt)}</td><td>${cat}</td></tr>`;
  });
  html += `<tr style="font-weight:700"><td>现金机动</td><td>—</td><td>${(CONFIG.cashWeight*100).toFixed(0)}%</td><td>¥${fmt(state.amount*CONFIG.cashWeight)}</td><td>待命</td></tr>`;
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ---------- 渲染：持仓 / 行情 ----------
function renderHoldings() {
  const body = $('holdingsBody');
  body.innerHTML = '';
  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    const c = state.navCache[f.code];
    const navTxt = s.nav != null ? s.nav.toFixed(4) : '—';
    const dc = c && c.dailyChange != null ? c.dailyChange : null;
    const dcCls = dc == null ? 'flat' : dc > 0.0001 ? 'up' : dc < -0.0001 ? 'down' : 'flat';
    const dcTxt = dc == null ? '—' : fmtPct(dc);
    const pnlCls = s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : 'flat';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f.name}</td>
      <td>${f.code}</td>
      <td>¥${fmt(s.cost)}</td>
      <td>${navTxt}</td>
      <td class="${dcCls}">${dcTxt}</td>
      <td>¥${fmt(s.value)}</td>
      <td class="${pnlCls}">${s.pnl >= 0 ? '+' : '-'}¥${fmt(Math.abs(s.pnl))}</td>
      <td class="${pnlCls}">${fmtPct(s.pnlPct)}</td>`;
    body.appendChild(tr);
  });
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
  } else { // sell
    if (pos.shares <= 0) { alert('该基金无持仓'); return; }
    const sharesSold = amount / nav;
    if (sharesSold > pos.shares + 1e-9) { alert('卖出份额超过持仓'); return; }
    const costReduce = pos.cost * (sharesSold / pos.shares);
    state.positions[code] = { shares: pos.shares - sharesSold, cost: pos.cost - costReduce };
  }

  state.tx.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), code, type, date, amount, nav });

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

  // 单日波动检测
  let maxDaily = 0;
  CONFIG.funds.forEach(f => {
    const c = state.navCache[f.code];
    if (c && c.dailyChange != null) maxDaily = Math.max(maxDaily, Math.abs(c.dailyChange));
  });

  CONFIG.funds.forEach(f => {
    const s = fundStats(f.code);
    const targetWeight = f.weight;
    const currentWeight = s.value / asset;
    const diff = currentWeight - targetWeight;

    // 1) 偏离再平衡（现金已超软顶时暂停减持，优先把现金部署回市场）
    if (diff > CONFIG.driftThreshold && cashRatio <= CONFIG.cashCap) {
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

    // 3) 回撤分档加仓（需近3月高点；已执行则消失；价格回升突破该档自动重置）
    const high = state.navCache[f.code] && state.navCache[f.code].high;
    if (high && s.nav) {
      const dd = (s.nav - high) / high; // 负值=回撤
      const steps = f.cat === 'growth' ? CONFIG.growthDrawdown : CONFIG.wideDrawdown;
      const fd = state.filled.dd[f.code] = state.filled.dd[f.code] || steps.map(() => false);
      steps.forEach((lvl, i) => {
        const triggered = dd <= -lvl;
        if (!triggered) { fd[i] = false; return; }  // 价格回升到该档之上 → 重置
        if (fd[i]) return;                           // 已执行 → 跳过
        const budget = deployed * f.weight * CONFIG.dipBudgetRatio;
        const tranche = budget / steps.length;
        const buyAmt = Math.min(tranche, t.cash);
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

  // 4.5) 现金软顶回补：占比超 cashCap 时，按目标权重把多余现金买回基金，防牛市现金无限堆积
  if (cashRatio > CONFIG.cashCap) {
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

  // 4) 现金纪律（目标随市场浮动，以 cashWeight ±5pp 为区间）
  if (cashRatio < CONFIG.cashWeight - 0.05) {
    list.unshift({ type: 'info', title: '现金低于目标', body: `现金占比 ${(cashRatio*100).toFixed(1)}%，低于目标 ${(CONFIG.cashWeight*100).toFixed(0)}% 约 5 个百分点，按纪律暂停所有加仓，优先保留弹药，等待再平衡或止盈释放现金。`, reason: '现金纪律（目标随市场浮动）' });
  } else if (cashRatio > CONFIG.cashWeight + 0.05 && cashRatio <= CONFIG.cashCap) {
    list.unshift({ type: 'info', title: '现金高于目标', body: `当前现金占比 ${(cashRatio*100).toFixed(1)}%，高于目标 ${(CONFIG.cashWeight*100).toFixed(0)}% 约 5 个百分点，偏高，建议择机建仓以防踏空（优先补齐偏离目标的基金）。`, reason: '现金纪律（目标随市场浮动）' });
  }

  if (list.length === 0) {
    list.push({ type: 'info', title: '暂无调仓信号', body: '各基金权重在阈值内，且未见止盈/低吸触发。保持持有，下个季度末再审视。', reason: '' });
  } else if (maxDaily <= 0.03) {
    list.unshift({ type: 'info', title: '今日波动 ≤3%', body: '按规则今日不主动操作，已生成的信号留作观察，等波动放大或触发线再执行。', reason: '单日波动纪律' });
  }

  return list;
}

function renderAdvice() {
  const list = buildAdvice();
  const wrap = $('adviceList');
  wrap.innerHTML = list.map(a => `
    <div class="advice ${a.type}">
      <div class="a-head"><span class="tag ${a.type}">${a.type === 'buy' ? '买入' : a.type === 'sell' ? '卖出' : '提示'}</span>${a.title}
        ${a.key ? `<button class="a-done" data-key="${a.key}">✓ 我已执行</button>` : ''}
      </div>
      <div class="a-body">${a.body}</div>
      ${a.reason ? `<div class="a-reason">依据：${a.reason}</div>` : ''}
    </div>`).join('');
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
      <td>—</td><td>—</td>
      <td>¥${fmt(t.equity)}</td>
      <td colspan="2">—</td>
    </tr>
    <tr class="foot cash">
      <td colspan="2">现金机动（待命）</td>
      <td colspan="4">¥${fmt(t.cash)}　占总资产 ${cashPct.toFixed(1)}%（目标 ${(CONFIG.cashWeight*100).toFixed(0)}%）</td>
      <td colspan="2">—</td>
    </tr>
    <tr class="foot total">
      <td colspan="2">总资产</td>
      <td colspan="4">¥${fmt(t.asset)}</td>
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
  if (cashRatio < CONFIG.cashWeight - 0.05) { status = '偏低 · 暂停加仓'; cls = 'down'; }
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
  renderHoldings();
  renderHoldingsFoot();
  renderCashPanel();
  renderAdvice();
  renderLog();
  renderMascot();
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
    const parts = btn.dataset.key.split('-'); // tp-CODE-i 或 dd-CODE-i
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
}

function autoFillNav() {
  const code = $('tradeFund').value;
  const nav = currentNav(code);
  if (nav != null) $('tradeNav').value = nav.toFixed(4);
}

document.addEventListener('DOMContentLoaded', init);
