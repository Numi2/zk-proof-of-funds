# Perp Calculations V4 API Migration - Summary

## Issues Found

The perp calculation utilities had several issues:

1. **Wrong SDK version**: Code was written for v3 API but package uses v4.8.6
2. **Wrong hook API**: Hooks were using `{data, isLoading}` pattern but Orderly hooks use different return types
3. **Missing AccountInfo fields**: Code tried to access fields like `totalCollateral`, `availableBalance` on `AccountInfo` but these don't exist

## Root Cause

The Orderly SDK v2.8.3 (hooks) provides most calculated values through `usePositionStream()` aggregated data:
- `totalCollateral: Decimal`
- `totalValue: Decimal | null`
- `totalUnrealizedROI: number`

The `AccountInfo` type only contains account settings (max_leverage, fee rates, etc.), not real-time calculated values.

## Solution Approach

Instead of recalculating everything from scratch with the perp SDK, we should:

1. **Use aggregated data from hooks** - `usePositionStream()` provides most metrics
2. **Simplify calculations** - Only calculate what's not already provided
3. **Fix hook return types** - Use actual Orderly hook signatures

## Current Status

- ❌ Build failing with TypeScript errors
- ⚠️ Need simplified implementation that uses actual available data

## Next Steps

1. Create simplified calculation utilities that work with aggregated data
2. Update hooks to pass aggregated data through
3. Ensure components receive the metrics they need
4. Test the functionality

## Files Modified

- `/src/utils/perp-calculations.ts` - Updated (but still has errors)
- `/src/hooks/usePerpCalculations.ts` - Updated to use correct hook APIs
- `/src/utils/perp-calculations-fixed.ts` - Deleted (consolidated)


