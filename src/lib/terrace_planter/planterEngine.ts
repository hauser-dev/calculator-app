import type { CostBreakdownPreview, CostThreshold, PlanterInput } from '@/types'
import {
  CATEGORY_LIST,
  DEFAULT_THRESHOLDS,
  type Category,
} from '@/lib/terrace_planter/planterDefaults'
import {
  DEFAULT_SHEET_INVENTORY,
  buildFabricationDimensions,
  runPlanterSolver,
  type FabricationDimensions,
  type SheetInventoryRow,
  type SolverResult,
} from '@/lib/terrace_planter/planterSolver'

export type TerracePlanterCustomDetailRow = {
  price: number | null
}

export type TerracePlanterSheetSummary = {
  rowId: string
  name: string
  quantityUsed: number
  costPerSqft: number
  totalAreaAvailable: number
  totalAreaUsed: number
  costPerSheet: number
  utilizationPct: number
  unusedMaterialCost: number
  totalMaterialCost: number
}

export type CalculateTerracePlanterOptions = {
  thresholds?: Partial<Record<Category, CostThreshold>>
  sheetInventory?: SheetInventoryRow[]
  customDetailRows?: TerracePlanterCustomDetailRow[]
  userSalePriceInput?: number | string | null
  saleBufferInput?: number | string | null
  saleDiscountInput?: number | string | null
}

export type CalculateTerracePlanterRequest = {
  planterInput: PlanterInput
  options?: CalculateTerracePlanterOptions
}

export type TerracePlanterCalculationResult = {
  fabricationDims: FabricationDimensions
  volume: number
  breakdowns: CostBreakdownPreview[]
  solverResult: SolverResult
  sheetSummaries: TerracePlanterSheetSummary[]
  totalSheetAreaAvailable: number
  totalMaterialArea: number
  utilizationPct: number
  sheetCount: number
  totalMaterialCost: number
  breakdownTotal: number
  customBreakdownTotal: number
  totalNonMaterialCost: number
  totalFabricationCost: number
  targetMarginFraction: number
  suggestedSalePrice: number
  hasUserSalePrice: boolean
  userSalePrice: number
  userSaleMarginPct: number
  userSalePriceDelta: number
  bufferAmount: number
  discountAmount: number
  hasSaleAdjustmentsInput: boolean
  finalTotal: number
  actualMarginPct: number
}

const MAX_PLANTER_DIMENSION_IN = 120
const categoryList: Category[] = [...CATEGORY_LIST]

const getBreakdownPrice = (row: CostBreakdownPreview) => row.overridePrice ?? row.basePrice

const cloneThresholds = (source?: Partial<Record<Category, CostThreshold>>) =>
  categoryList.reduce<Record<Category, CostThreshold>>((acc, category) => {
    const template = source?.[category] ?? DEFAULT_THRESHOLDS[category]
    acc[category] = { ...template, category }
    return acc
  }, {} as Record<Category, CostThreshold>)

const determineTier = (volume: number, threshold: CostThreshold) => {
  if (volume <= threshold.lowThreshold) {
    return { tier: 'Low' as const, price: threshold.lowPrice }
  }
  if (volume <= threshold.mediumThreshold) {
    return { tier: 'Medium' as const, price: threshold.mediumPrice }
  }
  return { tier: 'High' as const, price: threshold.highPrice }
}

const validatePlanterInput = (input: PlanterInput) => {
  if (!Number.isFinite(input.length)) return 'Length must be a valid number.'
  if (input.length <= 0) return 'Length must be greater than zero.'
  if (input.length > MAX_PLANTER_DIMENSION_IN) return `Length must be ${MAX_PLANTER_DIMENSION_IN}" or less.`
  if (!Number.isFinite(input.width)) return 'Width must be a valid number.'
  if (input.width <= 0) return 'Width must be greater than zero.'
  if (input.width > MAX_PLANTER_DIMENSION_IN) return `Width must be ${MAX_PLANTER_DIMENSION_IN}" or less.`
  if (!Number.isFinite(input.height)) return 'Height must be a valid number.'
  if (input.height <= 0) return 'Height must be greater than zero.'
  if (input.height > MAX_PLANTER_DIMENSION_IN) return `Height must be ${MAX_PLANTER_DIMENSION_IN}" or less.`
  if (!Number.isFinite(input.lip)) return 'Lip must be a valid number.'
  if (input.lip < 0) return 'Lip must be zero or greater.'
  if (!Number.isFinite(input.marginPct)) return 'Margin % must be a valid number.'
  if (input.marginPct < 0) return 'Margin % must be zero or greater.'
  if (!Number.isFinite(input.thickness)) return 'Thickness must be a valid number.'
  if (input.thickness <= 0) return 'Thickness must be greater than zero.'
  if (input.linerEnabled && !Number.isFinite(input.linerDepth)) return 'Liner depth must be a valid number.'
  if (input.linerEnabled && input.linerDepth < 0) return 'Liner depth must be zero or greater.'
  if (input.linerEnabled && !Number.isFinite(input.linerThickness)) return 'Liner thickness must be a valid number.'
  if (input.linerEnabled && input.linerThickness <= 0) return 'Liner thickness must be greater than zero.'
  return null
}

const validateThresholds = (thresholds: Record<Category, CostThreshold>) => {
  const hasInvalidThreshold = categoryList.some((category) => {
    const entry = thresholds[category]
    return (
      !Number.isFinite(entry.lowThreshold) ||
      !Number.isFinite(entry.mediumThreshold) ||
      !Number.isFinite(entry.lowPrice) ||
      !Number.isFinite(entry.mediumPrice) ||
      !Number.isFinite(entry.highPrice) ||
      entry.lowThreshold >= entry.mediumThreshold
    )
  })

  return hasInvalidThreshold ? 'Resolve invalid threshold settings before calculating.' : null
}

const buildBreakdownResults = (
  volume: number,
  planterInput: PlanterInput,
  thresholds: Record<Category, CostThreshold>,
): CostBreakdownPreview[] =>
  categoryList.map((category) => {
    if (category === 'Weight Plate' && !planterInput.weightPlateEnabled) {
      return { category, tierUsed: 'Not Selected', basePrice: 0, overridePrice: null }
    }
    if (category === 'Liner' && !planterInput.linerEnabled) {
      return { category, tierUsed: 'Not Selected', basePrice: 0, overridePrice: null }
    }
    if (category === 'Shelf' && !planterInput.shelfEnabled) {
      return { category, tierUsed: 'Not Selected', basePrice: 0, overridePrice: null }
    }

    const threshold = thresholds[category]
    const { tier, price } = determineTier(volume, threshold)
    return { category, tierUsed: tier, basePrice: price, overridePrice: null }
  })

const formatDimension = (valueInInches: number, fractionDigits = 2) =>
  `${valueInInches.toFixed(fractionDigits)} in`

const validateSheetInventory = (
  planterInput: PlanterInput,
  fabricationDims: FabricationDimensions,
  sheetInventory: SheetInventoryRow[],
) => {
  const matchingThicknessInventory = sheetInventory.filter(
    (row) => Math.abs(row.thickness - planterInput.thickness) < 0.0001,
  )
  const availableSheetEdges = matchingThicknessInventory
    .filter((row) => !row.limitQuantity || row.quantity > 0)
    .flatMap((row) => [row.width, row.height])
    .filter((value) => Number.isFinite(value) && value > 0)

  if (availableSheetEdges.length === 0) {
    throw new Error(
      `No usable sheet inventory is available for thickness ${formatDimension(
        planterInput.thickness,
        3,
      )}. Add at least one matching sheet with a positive size.`,
    )
  }

  const maxSheetEdge = Math.max(...availableSheetEdges)
  const oversizedDimensions = [
    { label: 'Length', value: fabricationDims.length },
    { label: 'Width', value: fabricationDims.width },
    { label: 'Height', value: fabricationDims.height },
  ].filter((dimension) => dimension.value > maxSheetEdge)

  if (oversizedDimensions.length > 0) {
    const oversizedLabel = oversizedDimensions
      .map((dimension) => `${dimension.label} ${formatDimension(dimension.value)}`)
      .join(', ')

    throw new Error(
      `Input exceeds sheet inventory limits: ${oversizedLabel}. Max available sheet edge is ${formatDimension(
        maxSheetEdge,
      )}.`,
    )
  }

  return matchingThicknessInventory
}

const buildSheetSummaries = (solverResult: SolverResult): TerracePlanterSheetSummary[] => {
  const buckets = new Map<
    string,
    {
      rowId: string
      name: string
      costPerSqft: number
      quantityUsed: number
      totalAreaAvailable: number
      totalAreaUsed: number
    }
  >()

  for (const usage of solverResult.sheetUsages) {
    const areaAvailable = (usage.width * usage.height) / 144
    const entry = buckets.get(usage.rowId)
    if (entry) {
      entry.quantityUsed += 1
      entry.totalAreaAvailable += areaAvailable
      entry.totalAreaUsed += usage.areaUsedSqft
      continue
    }
    buckets.set(usage.rowId, {
      rowId: usage.rowId,
      name: usage.name,
      costPerSqft: usage.costPerSqft,
      quantityUsed: 1,
      totalAreaAvailable: areaAvailable,
      totalAreaUsed: usage.areaUsedSqft,
    })
  }

  return [...buckets.values()]
    .sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name)
      return a.rowId.localeCompare(b.rowId)
    })
    .map((entry) => {
      const areaPerSheet = entry.quantityUsed ? entry.totalAreaAvailable / entry.quantityUsed : 0
      const costPerSheet = areaPerSheet * entry.costPerSqft
      return {
        rowId: entry.rowId,
        name: entry.name,
        quantityUsed: entry.quantityUsed,
        costPerSqft: entry.costPerSqft,
        totalAreaAvailable: entry.totalAreaAvailable,
        totalAreaUsed: entry.totalAreaUsed,
        costPerSheet,
        utilizationPct: entry.totalAreaAvailable ? (entry.totalAreaUsed / entry.totalAreaAvailable) * 100 : 0,
        unusedMaterialCost: Math.max(0, entry.totalAreaAvailable - entry.totalAreaUsed) * entry.costPerSqft,
        totalMaterialCost: costPerSheet * entry.quantityUsed,
      }
    })
}

const normalizeNumberInput = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)

export const calculateTerracePlanter = (
  request: CalculateTerracePlanterRequest,
): TerracePlanterCalculationResult => {
  const { planterInput, options = {} } = request
  const validationMessage = validatePlanterInput(planterInput)
  if (validationMessage) {
    throw new Error(validationMessage)
  }

  const thresholds = cloneThresholds(options.thresholds)
  const thresholdValidationMessage = validateThresholds(thresholds)
  if (thresholdValidationMessage) {
    throw new Error(thresholdValidationMessage)
  }

  const fabricationDims = buildFabricationDimensions(planterInput)
  const matchingThicknessInventory = validateSheetInventory(
    planterInput,
    fabricationDims,
    options.sheetInventory ?? DEFAULT_SHEET_INVENTORY,
  )
  const volume = fabricationDims.length * fabricationDims.width * fabricationDims.height
  const breakdowns = buildBreakdownResults(volume, planterInput, thresholds)
  const solverResult = runPlanterSolver({
    planterInput,
    fabricationDims,
    breakdowns,
    options: {
      inventory: matchingThicknessInventory,
    },
  })
  const sheetSummaries = buildSheetSummaries(solverResult)
  const totalMaterialCost = sheetSummaries.reduce((total, sheet) => total + sheet.totalMaterialCost, 0)
  const totalSheetAreaAvailable = sheetSummaries.reduce((total, sheet) => total + sheet.totalAreaAvailable, 0)
  const totalMaterialArea = solverResult.materialAreaSqft
  const utilizationPct = totalSheetAreaAvailable > 0 ? (totalMaterialArea / totalSheetAreaAvailable) * 100 : 0
  const sheetCount = sheetSummaries.reduce((total, sheet) => total + sheet.quantityUsed, 0)
  const breakdownTotal = breakdowns.reduce((total, row) => {
    if (row.category === 'Liner' && !planterInput.linerEnabled) return total
    if (row.category === 'Shelf' && !planterInput.shelfEnabled) return total
    return total + getBreakdownPrice(row)
  }, 0)
  const customBreakdownTotal = (options.customDetailRows ?? []).reduce((total, row) => {
    return total + (Number.isFinite(row.price) ? Math.max(0, row.price ?? 0) : 0)
  }, 0)
  const totalFabricationCost = totalMaterialCost + breakdownTotal + customBreakdownTotal
  const totalNonMaterialCost = breakdownTotal + customBreakdownTotal
  const targetMarginFraction = Math.min(Math.max(planterInput.marginPct / 100, 0), 0.99)
  const suggestedSalePrice =
    totalFabricationCost > 0 ? totalFabricationCost / (1 - targetMarginFraction) : totalFabricationCost
  const userSalePriceInput = normalizeNumberInput(options.userSalePriceInput)
  const parsedUserSalePrice = Number(userSalePriceInput)
  const hasUserSalePrice = Number.isFinite(parsedUserSalePrice) && parsedUserSalePrice > 0
  const userSalePrice = hasUserSalePrice ? parsedUserSalePrice : 0
  const userSaleMarginPct =
    hasUserSalePrice && userSalePrice > 0 ? ((userSalePrice - totalFabricationCost) / userSalePrice) * 100 : 0
  const userSalePriceDelta = hasUserSalePrice ? userSalePrice - suggestedSalePrice : 0
  const saleBufferInput = normalizeNumberInput(options.saleBufferInput)
  const parsedSaleBuffer = Number(saleBufferInput)
  const bufferAmount = Number.isFinite(parsedSaleBuffer) && parsedSaleBuffer > 0 ? parsedSaleBuffer : 0
  const saleDiscountInput = normalizeNumberInput(options.saleDiscountInput)
  const parsedSaleDiscount = Number(saleDiscountInput)
  const discountAmount = Number.isFinite(parsedSaleDiscount) && parsedSaleDiscount > 0 ? parsedSaleDiscount : 0
  const hasSaleAdjustmentsInput = saleBufferInput.trim() !== '' || saleDiscountInput.trim() !== ''
  const finalTotal = Math.max(0, suggestedSalePrice + bufferAmount - discountAmount)
  const actualMarginPct = finalTotal > 0 ? ((finalTotal - totalFabricationCost) / finalTotal) * 100 : 0

  return {
    fabricationDims,
    volume,
    breakdowns,
    solverResult,
    sheetSummaries,
    totalSheetAreaAvailable,
    totalMaterialArea,
    utilizationPct,
    sheetCount,
    totalMaterialCost,
    breakdownTotal,
    customBreakdownTotal,
    totalNonMaterialCost,
    totalFabricationCost,
    targetMarginFraction,
    suggestedSalePrice,
    hasUserSalePrice,
    userSalePrice,
    userSaleMarginPct,
    userSalePriceDelta,
    bufferAmount,
    discountAmount,
    hasSaleAdjustmentsInput,
    finalTotal,
    actualMarginPct,
  }
}
