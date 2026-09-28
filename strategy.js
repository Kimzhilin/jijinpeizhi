// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。
// 最后更新：2026-09-28T21:01:06.957Z
window.STRATEGY = {
  "version": "auto-2026-09-28",
  "updatedAt": "2026-09-28T21:01:06.957Z",
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
      "weight": 0.2088,
      "cat": "broad"
    },
    {
      "code": "022434",
      "name": "南方中证A500ETF联接A",
      "weight": 0.1915,
      "cat": "broad"
    },
    {
      "code": "007466",
      "name": "华泰柏瑞中证红利低波ETF联接A",
      "weight": 0.297,
      "cat": "value"
    },
    {
      "code": "011612",
      "name": "华夏科创50ETF联接A",
      "weight": 0.1033,
      "cat": "growth"
    },
    {
      "code": "110026",
      "name": "易方达创业板ETF联接A",
      "weight": 0.1119,
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
    "ddAll": -0.169,
    "growthVsValue": -0.269,
    "perFund": [
      {
        "code": "110020",
        "name": "易方达沪深300ETF联接A",
        "vol": 0.197,
        "dd": -0.124,
        "mom60": -0.089,
        "valPct": 0.02
      },
      {
        "code": "022434",
        "name": "南方中证A500ETF联接A",
        "vol": 0.175,
        "dd": -0.147,
        "mom60": -0.113,
        "valPct": 0.09
      },
      {
        "code": "007466",
        "name": "华泰柏瑞中证红利低波ETF联接A",
        "vol": 0.151,
        "dd": -0.029,
        "mom60": 0.068,
        "valPct": 0.5
      },
      {
        "code": "011612",
        "name": "华夏科创50ETF联接A",
        "vol": 0.296,
        "dd": -0.279,
        "mom60": -0.198,
        "valPct": 0.33
      },
      {
        "code": "110026",
        "name": "易方达创业板ETF联接A",
        "vol": 0.287,
        "dd": -0.266,
        "mom60": -0.206,
        "valPct": 0.18
      },
      {
        "code": "000217",
        "name": "华安黄金ETF联接C",
        "vol": 0.143,
        "dd": -0.154,
        "mom60": -0.013,
        "valPct": 0.16
      }
    ]
  },
  "notes": [
    "全市场年化波动 22.1% → 现金目标 20%",
    "成长/价值60日相对强度 -26.9% → 略偏价值",
    "组合120日回撤 -16.9% → 常态",
    "已纳入黄金(000217)避险资产，固定占权益池约 8.75%（总盘约 7%），仅做偏离再平衡"
  ]
};
