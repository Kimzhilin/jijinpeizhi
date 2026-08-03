// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。
// 最后更新：2026-08-03T20:19:19.703Z
window.STRATEGY = {
  "version": "auto-2026-08-03",
  "updatedAt": "2026-08-03T20:19:19.703Z",
  "posture": "balanced",
  "source": "理财财市场自适应引擎（每日自动）",
  "cashWeight": 0.2,
  "driftThreshold": 0.08,
  "growthTakeProfit": [
    0.25,
    0.45
  ],
  "wideDrawdown": [
    0.1,
    0.18,
    0.28
  ],
  "growthDrawdown": [
    0.12,
    0.22,
    0.32
  ],
  "dipBudgetRatio": 0.3,
  "historyDays": 90,
  "refreshMs": 300000,
  "funds": [
    {
      "code": "110020",
      "name": "易方达沪深300ETF联接A",
      "weight": 0.1959,
      "cat": "broad"
    },
    {
      "code": "022434",
      "name": "南方中证A500ETF联接A",
      "weight": 0.1776,
      "cat": "broad"
    },
    {
      "code": "007466",
      "name": "华泰柏瑞中证红利低波ETF联接A",
      "weight": 0.2909,
      "cat": "value"
    },
    {
      "code": "011612",
      "name": "华夏科创50ETF联接A",
      "weight": 0.1286,
      "cat": "growth"
    },
    {
      "code": "110026",
      "name": "易方达创业板ETF联接A",
      "weight": 0.1195,
      "cat": "growth"
    },
    {
      "code": "000217",
      "name": "华安黄金ETF联接C",
      "weight": 0.0875,
      "cat": "gold"
    }
  ],
  "indicators": {
    "volAll": 0.221,
    "ddAll": -0.147,
    "growthVsValue": -0.098,
    "perFund": [
      {
        "code": "110020",
        "name": "易方达沪深300ETF联接A",
        "vol": 0.198,
        "dd": -0.089,
        "mom60": -0.051,
        "valPct": 0.56
      },
      {
        "code": "022434",
        "name": "南方中证A500ETF联接A",
        "vol": 0.176,
        "dd": -0.116,
        "mom60": -0.082,
        "valPct": 0.53
      },
      {
        "code": "007466",
        "name": "华泰柏瑞中证红利低波ETF联接A",
        "vol": 0.152,
        "dd": -0.016,
        "mom60": 0.015,
        "valPct": 0.66
      },
      {
        "code": "011612",
        "name": "华夏科创50ETF联接A",
        "vol": 0.294,
        "dd": -0.282,
        "mom60": -0.046,
        "valPct": 0.46
      },
      {
        "code": "110026",
        "name": "易方达创业板ETF联接A",
        "vol": 0.286,
        "dd": -0.23,
        "mom60": -0.12,
        "valPct": 0.5
      },
      {
        "code": "000217",
        "name": "华安黄金ETF联接C",
        "vol": 0.142,
        "dd": -0.265,
        "mom60": -0.147,
        "valPct": 0.23
      }
    ]
  },
  "notes": [
    "全市场年化波动 22.1% → 现金目标 20%",
    "成长/价值60日相对强度 -9.8% → 略偏价值",
    "组合120日回撤 -14.7% → 常态",
    "已纳入黄金(000217)避险资产，固定占权益池约 8.75%（总盘约 7%），仅做偏离再平衡"
  ]
};
