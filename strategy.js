// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。
// 最后更新：2026-11-13T21:08:13.177Z
window.STRATEGY = {
  "version": "auto-2026-11-13",
  "updatedAt": "2026-11-13T21:08:13.177Z",
  "posture": "balanced",
  "source": "理财财市场自适应引擎（每日自动）",
  "cashWeight": 0.15,
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
      "weight": 0.2049,
      "cat": "broad"
    },
    {
      "code": "022434",
      "name": "南方中证A500ETF联接A",
      "weight": 0.188,
      "cat": "broad"
    },
    {
      "code": "007466",
      "name": "华泰柏瑞中证红利低波ETF联接A",
      "weight": 0.2915,
      "cat": "value"
    },
    {
      "code": "011612",
      "name": "华夏科创50ETF联接A",
      "weight": 0.1183,
      "cat": "growth"
    },
    {
      "code": "110026",
      "name": "易方达创业板ETF联接A",
      "weight": 0.1098,
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
    "volAll": 0.223,
    "ddAll": -0.247,
    "growthVsValue": -0.334,
    "perFund": [
      {
        "code": "110020",
        "name": "易方达沪深300ETF联接A",
        "vol": 0.197,
        "dd": -0.183,
        "mom60": -0.126,
        "valPct": 0.03
      },
      {
        "code": "022434",
        "name": "南方中证A500ETF联接A",
        "vol": 0.176,
        "dd": -0.221,
        "mom60": -0.15,
        "valPct": 0.03
      },
      {
        "code": "007466",
        "name": "华泰柏瑞中证红利低波ETF联接A",
        "vol": 0.151,
        "dd": -0.004,
        "mom60": 0.06,
        "valPct": 0.78
      },
      {
        "code": "011612",
        "name": "华夏科创50ETF联接A",
        "vol": 0.301,
        "dd": -0.4,
        "mom60": -0.24,
        "valPct": 0.13
      },
      {
        "code": "110026",
        "name": "易方达创业板ETF联接A",
        "vol": 0.288,
        "dd": -0.424,
        "mom60": -0.307,
        "valPct": 0.02
      },
      {
        "code": "000217",
        "name": "华安黄金ETF联接C",
        "vol": 0.144,
        "dd": -0.167,
        "mom60": -0.12,
        "valPct": 0
      }
    ]
  },
  "notes": [
    "全市场年化波动 22.3% → 现金目标 15%",
    "成长/价值60日相对强度 -33.4% → 略偏价值",
    "组合120日回撤 -24.7% → 低位可逐步部署",
    "已纳入黄金(000217)避险资产，固定占权益池约 8.75%（总盘约 7%），仅做偏离再平衡"
  ]
};
