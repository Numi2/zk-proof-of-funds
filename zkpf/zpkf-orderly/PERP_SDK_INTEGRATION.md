# Orderly Perp SDK Integration

## Overview

This document describes the high-quality integration of the `@orderly.network/perp` SDK into the Orderly DEX application. The integration provides comprehensive calculation formulas for futures trading, including account metrics, position analytics, risk management, and maximum tradable quantities.

## Features Implemented

### 📊 Account Calculations
- **IMR (Initial Margin Requirement)** - Minimum margin required to open positions
- **Available Balance** - Balance available for opening new positions
- **Current Leverage** - Real-time leverage being used
- **Free Collateral** - Collateral not tied up in positions
- **Total Collateral** - Sum of all collateral assets
- **Total Initial Margin with Orders** - Margin requirements including open orders
- **Total Margin Ratio** - Ratio of collateral to maintenance margin
- **Total Unrealized ROI** - Return on investment across all positions
- **Total Value** - Total account equity including unrealized PnL

### 📈 Position Calculations
- **MMR (Maintenance Margin Requirement)** - Minimum margin to maintain positions
- **Liquidation Price** - Price at which position will be liquidated
- **Maintenance Margin** - Minimum margin needed to keep position open
- **Total Notional** - Position size multiplied by mark price
- **Unrealized PnL** - Profit/loss if position closed at current price
- **Unrealized ROI** - Return on investment as percentage
- **Unsettlement PnL** - PnL that has not yet been settled
- **Total Unrealized PnL** - Sum across all positions
- **Total Unsettlement PnL** - Sum of unsettled PnL

### 🎯 Trading Utilities
- **Max Quantity Calculation** - Maximum tradable quantity based on available balance and leverage
- **Risk Assessment** - Real-time risk level evaluation (Safe/Moderate/High/Critical)
- **Distance to Liquidation** - Percentage distance from liquidation price

## Architecture

### 1. Core Utilities (`src/utils/perp-calculations.ts`)

Pure TypeScript functions wrapping the Orderly Perp SDK:

```typescript
import { calculateAccountMetrics, calculatePositionMetrics } from '@/utils/perp-calculations';

// Calculate all account metrics at once
const metrics = calculateAccountMetrics(accountInfo, positions, orders);

// Calculate metrics for a specific position
const positionMetrics = calculatePositionMetrics(position, accountInfo);
```

**Key Functions:**
- `calculateAccountMetrics()` - Comprehensive account calculations
- `calculatePositionMetrics()` - Detailed position analytics
- `calculateMaxQty()` - Maximum tradable quantity
- `calculateLiqPrice()` - Liquidation price calculation
- Formatting utilities: `formatUSD()`, `formatPercentage()`, `formatLeverage()`

### 2. React Hooks (`src/hooks/usePerpCalculations.ts`)

High-level React hooks that integrate with Orderly SDK data:

```typescript
import { useAccountMetrics, usePositionMetrics, useMaxQty } from '@/hooks/usePerpCalculations';

// Get comprehensive account metrics
const { metrics, accountInfo, isLoading } = useAccountMetrics();

// Get metrics for a specific position
const { metrics, position, isLoading } = usePositionMetrics('PERP_BTC_USDC');

// Get maximum tradable quantity
const { maxQty, canTrade, isLoading } = useMaxQty('PERP_ETH_USDC', OrderSide.BUY);
```

**Available Hooks:**
- `useAccountMetrics()` - Complete account metrics
- `useAccountMetric()` - Single account metric
- `useMaxQty()` - Maximum tradable quantity
- `useAccountRisk()` - Account risk assessment
- `useAccountLeverage()` - Leverage information
- `useCollateralInfo()` - Collateral details
- `usePositionsMetrics()` - All positions metrics
- `usePositionMetrics()` - Single position metrics
- `usePositionRisk()` - Position liquidation risk
- `usePositionPnL()` - Position PnL information
- `useTotalPnL()` - Total PnL across all positions
- `usePositionMargin()` - Position margin requirements
- `useTradingOverview()` - Comprehensive trading dashboard data
- `useSymbolTradingInfo()` - Symbol-specific trading information

### 3. UI Components (`src/components/perp/`)

Beautiful, responsive React components built with Orderly UI library:

#### `AccountMetricsCard`
Displays comprehensive account metrics with visual indicators.

```typescript
import { AccountMetricsCard } from '@/components/perp';

<AccountMetricsCard />
```

**Features:**
- Total value and available balance
- Leverage utilization with progress bar
- Margin ratio with risk coloring
- Initial margin requirements
- Real-time risk assessment badge

#### `PositionMetricsCard`
Shows detailed position metrics and risk information.

```typescript
import { PositionMetricsCard } from '@/components/perp';

<PositionMetricsCard symbol="PERP_BTC_USDC" compact={false} />
```

**Features:**
- Unrealized PnL and ROI
- Liquidation price and distance
- Risk level visualization
- Maintenance margin details
- Visual risk progress bars

#### `TradingOverviewCard`
Comprehensive dashboard combining account, positions, and risk metrics.

```typescript
import { TradingOverviewCard } from '@/components/perp';

<TradingOverviewCard />
```

**Features:**
- Account balance summary
- Positions count and PnL
- Risk level assessment
- Positions at risk counter
- Warning alerts for high risk

#### `MaxQtyDisplay` & `DualMaxQtyDisplay`
Shows maximum tradable quantities with optional action buttons.

```typescript
import { MaxQtyDisplay, DualMaxQtyDisplay } from '@/components/perp';

<MaxQtyDisplay 
  symbol="PERP_ETH_USDC" 
  side={OrderSide.BUY} 
  compact={true}
  onMaxClick={(qty) => console.log('Max qty:', qty)}
/>

<DualMaxQtyDisplay 
  symbol="PERP_ETH_USDC"
  onMaxBuyClick={(qty) => setQuantity(qty)}
  onMaxSellClick={(qty) => setQuantity(qty)}
/>
```

#### `RiskIndicator` & `RiskGauge`
Visual risk indicators for accounts and positions.

```typescript
import { RiskIndicator, RiskGauge } from '@/components/perp';

// Account risk
<RiskIndicator variant="badge" showLabel={true} />

// Position risk
<RiskIndicator symbol="PERP_BTC_USDC" variant="full" />

// Risk gauge with progress bar
<RiskGauge symbol="PERP_ETH_USDC" />
```

**Variants:**
- `badge` - Compact colored badge
- `compact` - Small dot with label
- `full` - Complete risk card with details

#### `EnhancedTradingPage`
Wrapper around Orderly's TradingPage with integrated perp metrics.

```typescript
import { EnhancedTradingPage } from '@/components/perp';

<EnhancedTradingPage
  symbol={symbol}
  onSymbolChange={onSymbolChange}
  tradingViewConfig={config.tradingViewConfig}
  sharePnLConfig={config.sharePnLConfig}
  showPositionMetrics={true}
  showMaxQty={true}
  showRiskIndicator={true}
/>
```

## Integration Points

### Portfolio Overview (`src/pages/portfolio/page.tsx`)
```typescript
<TradingOverviewCard />
<OverviewModule.OverviewPage />
```

### Positions Page (`src/pages/portfolio/positions/page.tsx`)
```typescript
<AccountMetricsCard />
<PositionsModule.PositionsPage {...props} />
```

### Assets Page (`src/pages/portfolio/assets/page.tsx`)
```typescript
<AccountMetricsCard />
<AssetsModule.AssetsPage />
```

### Trading Page (`src/pages/perp/page.tsx`)
```typescript
<EnhancedTradingPage
  symbol={symbol}
  showPositionMetrics={true}
  showMaxQty={true}
  showRiskIndicator={true}
  {...tradingPageProps}
/>
```

## Risk Management

### Risk Levels

The system categorizes risk into four levels:

1. **Safe** (Green) - Margin ratio ≥ 2.0x or Distance to liquidation ≥ 20%
2. **Moderate** (Yellow) - Margin ratio 1.5x-2.0x or Distance 10-20%
3. **High** (Orange) - Margin ratio 1.1x-1.5x or Distance 5-10%
4. **Critical** (Red) - Margin ratio < 1.1x or Distance < 5%

### Risk Indicators

Visual indicators appear throughout the UI:
- Color-coded badges (green/yellow/orange/red)
- Progress bars showing risk levels
- Warning alerts for high-risk situations
- Real-time updates as positions change

## Data Flow

```
Orderly SDK Hooks (useAccount, usePositionStream, useOrderStream)
                    ↓
        Perp Calculation Functions
                    ↓
        Custom React Hooks (usePerpCalculations)
                    ↓
        UI Components (Cards, Indicators, Displays)
                    ↓
        Page Integration (Portfolio, Trading, Positions)
```

## Performance Optimizations

1. **Memoization** - All calculations are memoized using `useMemo`
2. **Batch Updates** - Multiple metrics calculated together for efficiency
3. **Conditional Rendering** - Components only render when data is available
4. **Loading States** - Skeleton loaders prevent layout shifts
5. **Error Handling** - Graceful fallbacks for calculation errors

## Styling

Components use:
- **Orderly UI Library** - Box, Flex, Text, Tooltip components
- **Tailwind CSS** - Utility classes for styling
- **Color System** - Consistent risk-based color scheme
- **Responsive Design** - Mobile-first, grid-based layouts
- **Dark Theme** - Built-in dark mode support

## Usage Examples

### Simple Account Balance Display
```typescript
import { useAccountMetric } from '@/hooks/usePerpCalculations';
import { formatUSD } from '@/utils/perp-calculations';

const { value: availableBalance } = useAccountMetric('availableBalance');
console.log(formatUSD(availableBalance));
```

### Position Risk Check
```typescript
import { usePositionRisk } from '@/hooks/usePerpCalculations';

const { liqPrice, distanceToLiq, isAtRisk, riskLevel } = 
  usePositionRisk('PERP_BTC_USDC');

if (isAtRisk) {
  console.warn(`Position at ${riskLevel} risk - ${distanceToLiq}% from liquidation`);
}
```

### Max Quantity for Order Entry
```typescript
import { useMaxQty } from '@/hooks/usePerpCalculations';

const { maxQty, canTrade } = useMaxQty(symbol, OrderSide.BUY);

if (canTrade) {
  // Allow order up to maxQty
  setMaxOrderSize(maxQty);
}
```

### Complete Trading Dashboard
```typescript
import { useTradingOverview } from '@/hooks/usePerpCalculations';

const { account, positions, risk } = useTradingOverview();

// Display comprehensive trading metrics
console.log('Account Value:', account.totalValue);
console.log('Open Positions:', positions.count);
console.log('Risk Level:', risk.accountRiskLevel);
```

## Testing

To test the implementation:

```bash
cd /Users/home/zk-proof-of-funds/zkpf/zpkf-orderly

# Install dependencies (already done)
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Manual Testing Checklist

- [ ] Portfolio overview shows TradingOverviewCard
- [ ] Positions page displays AccountMetricsCard
- [ ] Assets page shows account metrics
- [ ] Trading page has enhanced metrics
- [ ] Risk indicators update in real-time
- [ ] Max quantity calculations work correctly
- [ ] Liquidation prices display accurately
- [ ] PnL calculations match Orderly's values
- [ ] Loading states render properly
- [ ] Responsive design works on mobile
- [ ] Dark theme applies correctly
- [ ] Tooltips provide helpful information

## Dependencies

```json
{
  "@orderly.network/perp": "^2.x.x",
  "@orderly.network/hooks": "^2.x.x",
  "@orderly.network/types": "^2.x.x",
  "@orderly.network/ui": "^2.x.x",
  "@orderly.network/portfolio": "^2.x.x",
  "@orderly.network/trading": "^2.x.x"
}
```

## Future Enhancements

Potential improvements for future iterations:

1. **Historical Analytics** - Track metrics over time
2. **Alerts System** - Push notifications for risk levels
3. **Custom Risk Thresholds** - User-configurable risk parameters
4. **Advanced Charting** - Visualize PnL and leverage trends
5. **Multi-Asset View** - Compare metrics across symbols
6. **Export Functionality** - Download metrics as CSV/JSON
7. **Performance Metrics** - Win rate, Sharpe ratio, etc.
8. **Simulation Mode** - Test strategies with calculated risks

## Support

For issues or questions:
- Check Orderly SDK documentation: https://docs.orderly.network
- Review the Perp SDK reference: https://docs.orderly.network/sdks/perp
- Inspect browser console for calculation errors
- Verify account is connected and has data

## License

This integration follows the same license as the parent project.

