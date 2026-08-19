// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。
// 最后更新：2026-08-19T15:25:26.382Z
window.STRATEGY = {
  "version": "auto-2026-08-19",
  "updatedAt": "2026-08-19T15:25:26.382Z",
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
      "weight": 0.1989,
      "cat": "broad"
    },
    {
      "code": "022434",
      "name": "南方中证A500ETF联接A",
      "weight": 0.1806,
      "cat": "broad"
    },
    {
      "code": "007466",
      "name": "华泰柏瑞中证红利低波ETF联接A",
      "weight": 0.3009,
      "cat": "value"
    },
    {
      "code": "011612",
      "name": "华夏科创50ETF联接A",
      "weight": 0.1206,
      "cat": "growth"
    },
    {
      "code": "110026",
      "name": "易方达创业板ETF联接A",
      "weight": 0.1115,
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
    "volAll": 0.222,
    "ddAll": -0.129,
    "growthVsValue": -0.119,
    "perFund": [
      {
        "code": "110020",
        "name": "易方达沪深300ETF联接A",
        "vol": 0.198,
        "dd": -0.08,
        "mom60": -0.057,
        "valPct": 0.59
      },
      {
        "code": "022434",
        "name": "南方中证A500ETF联接A",
        "vol": 0.177,
        "dd": -0.1,
        "mom60": -0.077,
        "valPct": 0.58
      },
      {
        "code": "007466",
        "name": "华泰柏瑞中证红利低波ETF联接A",
        "vol": 0.152,
        "dd": -0.041,
        "mom60": 0.006,
        "valPct": 0.49
      },
      {
        "code": "011612",
        "name": "华夏科创50ETF联接A",
        "vol": 0.296,
        "dd": -0.231,
        "mom60": -0.095,
        "valPct": 0.55
      },
      {
        "code": "110026",
        "name": "易方达创业板ETF联接A",
        "vol": 0.287,
        "dd": -0.194,
        "mom60": -0.132,
        "valPct": 0.57
      },
      {
        "code": "000217",
        "name": "华安黄金ETF联接C",
        "vol": 0.143,
        "dd": -0.213,
        "mom60": -0.05,
        "valPct": 0.36
      }
    ]
  },
  "notes": [
    "全市场年化波动 22.2% → 现金目标 20%",
    "成长/价值60日相对强度 -11.9% → 略偏价值",
    "组合120日回撤 -12.9% → 常态",
    "已纳入黄金(000217)避险资产，固定占权益池约 8.75%（总盘约 7%），仅做偏离再平衡"
  ]
};
