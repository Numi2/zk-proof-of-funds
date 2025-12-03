export enum PathEnum {
  Root = "/dex",
  Perp = "/dex/perp",

  Portfolio = "/dex/portfolio",
  Positions = "/dex/portfolio/positions",
  Orders = "/dex/portfolio/orders",
  FeeTier = "/dex/portfolio/fee",
  ApiKey = "/dex/portfolio/api-key",
  Setting = "/dex/portfolio/setting",
  History = "/dex/portfolio/history",

  Markets = "/dex/markets",
  Leaderboard = "/dex/leaderboard",
  Login = "/dex/login",

  Rewards = "/dex/rewards",
  RewardsTrading = "/dex/rewards/trading",
  RewardsAffiliate = "/dex/rewards/affiliate",
  Analytics = "/dex/portfolio/analytics",
}

export const PageTitleMap = {
  [PathEnum.Portfolio]: "Portfolio",
  [PathEnum.FeeTier]: "Fee tier",
  [PathEnum.ApiKey]: "API keys",
  [PathEnum.Orders]: "Orders",
  [PathEnum.Positions]: "Positions",
  [PathEnum.Setting]: "Settings",
  [PathEnum.History]: "History",
  [PathEnum.Markets]: "Markets",
  [PathEnum.Leaderboard]: "Leaderboard",
  [PathEnum.Login]: "Login",
  [PathEnum.RewardsTrading]: "Trading Rewards",
  [PathEnum.RewardsAffiliate]: "Affiliate program",
};

