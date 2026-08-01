// 本文件由「理财财市场自适应引擎」每日自动生成，请勿手动编辑。
// 最后更新：2026-08-01T02:30:02.472Z
window.STRATEGY = {
  "version": "auto-2026-08-01",
  "updatedAt": "2026-08-01T02:30:02.472Z",
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
      "weight": 0.2118,
      "cat": "broad"
    },
    {
      "code": "022434",
      "name": "南方中证A500ETF联接A",
      "weight": 0.1918,
      "cat": "broad"
    },
    {
      "code": "007466",
      "name": "华泰柏瑞中证红利低波ETF联接A",
      "weight": 0.3094,
      "cat": "value"
    },
    {
      "code": "011612",
      "name": "华夏科创50ETF联接A",
      "weight": 0.1485,
      "cat": "growth"
    },
    {
      "code": "110026",
      "name": "易方达创业板ETF联接A",
      "weight": 0.1385,
      "cat": "growth"
    }
  ],
  "indicators": {
    "volAll": 0.221,
    "ddAll": -0.134,
    "growthVsValue": -0.079,
    "perFund": [
      {
        "code": "110020",
        "name": "易方达沪深300ETF联接A",
        "vol": 0.198,
        "dd": -0.08,
        "mom60": -0.048,
        "valPct": 0.6
      },
      {
        "code": "022434",
        "name": "南方中证A500ETF联接A",
        "vol": 0.176,
        "dd": -0.107,
        "mom60": -0.078,
        "valPct": 0.56
      },
      {
        "code": "007466",
        "name": "华泰柏瑞中证红利低波ETF联接A",
        "vol": 0.152,
        "dd": -0.017,
        "mom60": 0.01,
        "valPct": 0.65
      },
      {
        "code": "011612",
        "name": "华夏科创50ETF联接A",
        "vol": 0.293,
        "dd": -0.246,
        "mom60": -0.02,
        "valPct": 0.53
      },
      {
        "code": "110026",
        "name": "易方达创业板ETF联接A",
        "vol": 0.286,
        "dd": -0.221,
        "mom60": -0.117,
        "valPct": 0.52
      }
    ]
  },
  "notes": [
    "全市场年化波动 22.1% → 现金目标 20%",
    "成长/价值60日相对强度 -7.9% → 略偏价值",
    "组合120日回撤 -13.4% → 常态"
  ]
};
