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
  type Placement,
  type SheetInstanceUsage,
  type SheetInventoryRow,
  type SolverResult,
} from '@/lib/terrace_planter/planterSolver'

export type TerracePlanterCustomDetailRow = {
  category?: string
  note?: string
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
  options?: CalculateTerracePlanterOptions | null
}

export type TerracePlanterCalculationRawResult = {
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

export type TerracePlanterCalculationResult = {
  subtotal: number
  visuals: string
  raw: TerracePlanterCalculationRawResult
}

const MAX_PLANTER_DIMENSION_IN = 120
const CUT_PLAN_MAX_DISPLAY_DIMENSION = 500
const CUT_PLAN_MIN_DISPLAY_SCALE = 0.95
const CUT_PLAN_MAX_DISPLAY_SCALE = 4.25
const INCH_TO_MM = 25.4
const categoryList: Category[] = [...CATEGORY_LIST]

const getBreakdownPrice = (row: CostBreakdownPreview) => row.overridePrice ?? row.basePrice

type CutPlanPaletteEntry = {
  background: string
  border: string
  text: string
}

const CUT_PLAN_PANEL_PALETTE: Record<string, CutPlanPaletteEntry> = {
  floor: {
    background: 'rgba(59, 130, 246, 0.25)',
    border: 'rgba(59, 130, 246, 0.85)',
    text: '#0f172a',
  },
  long: {
    background: 'rgba(79, 70, 229, 0.25)',
    border: 'rgba(79, 70, 229, 0.85)',
    text: '#312e81',
  },
  short: {
    background: 'rgba(6, 182, 212, 0.22)',
    border: 'rgba(6, 182, 212, 0.8)',
    text: '#0f172a',
  },
  liner: {
    background: 'rgba(34, 197, 94, 0.28)',
    border: 'rgba(16, 185, 129, 0.95)',
    text: '#064e3b',
  },
  shelf: {
    background: 'rgba(251, 113, 133, 0.35)',
    border: 'rgba(220, 38, 38, 0.9)',
    text: '#7f1d1d',
  },
  other: {
    background: 'rgba(148, 163, 184, 0.25)',
    border: 'rgba(148, 163, 184, 0.85)',
    text: '#0f172a',
  },
}

const CUT_PLAN_LEGEND_GROUPS = [
  { label: 'Floor', group: 'floor' },
  { label: 'Shelf', group: 'shelf' },
  { label: 'Long side', group: 'long' },
  { label: 'Short side', group: 'short' },
  { label: 'Liner', group: 'liner' },
]

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

type CutPlanMeasurementUnit = 'in' | 'mm'

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const formatCurrency = (value: number) => (Number.isFinite(value) ? `$${value.toFixed(2)}` : '$0.00')

const formatPercent = (value: number) => `${value.toFixed(1)}%`

const formatCssPx = (value: number) => `${Number.isFinite(value) ? value.toFixed(2) : '0'}px`

type TerracePlanterCostDetailVisualRow = {
  category: string
  tierUsed: string
  basePrice: number
  overridePrice: number | null
  notes: string
  isMaterial?: boolean
}

const buildVisualSectionHeaderHtml = (title: string, description: string) =>
  [
    '<div style="display:grid;gap:4px;">',
    `<h2 style="margin:0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.25;">${escapeHtml(title)}</h2>`,
    `<p style="margin:0;color:#64748b;font-size:14px;line-height:1.45;">${escapeHtml(description)}</p>`,
    '</div>',
  ].join('')

const buildMetricGridHtml = (metrics: Array<{ label: string; value: string }>) => {
  const parts = ['<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">']
  for (const metric of metrics) {
    parts.push('<div style="border:1px solid #e2e8f0;background:#f8fafc;padding:10px;">')
    parts.push(`<p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;">${escapeHtml(metric.label)}</p>`)
    parts.push(`<p style="margin:4px 0 0;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(metric.value)}</p>`)
    parts.push('</div>')
  }
  parts.push('</div>')
  return parts.join('')
}

const buildTableHtml = (headers: string[], rows: string[][]) => {
  const parts = [
    '<div style="overflow-x:auto;">',
    '<table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;color:#0f172a;font-size:14px;">',
    '<thead><tr>',
  ]

  for (const header of headers) {
    parts.push(`<th style="border-bottom:1px solid #cbd5e1;background:#f8fafc;padding:10px;text-align:left;font-weight:700;">${escapeHtml(header)}</th>`)
  }

  parts.push('</tr></thead><tbody>')

  for (const row of rows) {
    parts.push('<tr>')
    for (const cell of row) {
      parts.push(`<td style="border-top:1px solid #e2e8f0;padding:10px;vertical-align:top;">${escapeHtml(cell)}</td>`)
    }
    parts.push('</tr>')
  }

  parts.push('</tbody></table></div>')
  return parts.join('')
}

const buildCostDetailRows = (
  raw: TerracePlanterCalculationRawResult,
  planterInput: PlanterInput,
  customDetailRows: TerracePlanterCustomDetailRow[],
): TerracePlanterCostDetailVisualRow[] => {
  const breakdownLookup = raw.breakdowns.reduce<Record<string, CostBreakdownPreview>>((acc, row) => {
    acc[row.category] = row
    return acc
  }, {})
  const cheapestSheet = raw.sheetSummaries.reduce<TerracePlanterSheetSummary | null>((current, next) => {
    if (!current) return next
    if (next.costPerSqft !== current.costPerSqft) {
      return next.costPerSqft < current.costPerSqft ? next : current
    }
    return next.name.localeCompare(current.name) < 0 ? next : current
  }, null)
  const sheetNames = raw.sheetSummaries.map((entry) => entry.name).join(', ')
  const rows: TerracePlanterCostDetailVisualRow[] = [
    {
      category: 'Material',
      tierUsed: cheapestSheet ? cheapestSheet.name : 'Awaiting calculation',
      basePrice: raw.totalMaterialCost,
      overridePrice: null,
      notes: `Material tier driven by ${cheapestSheet?.name ?? 'inventory'}${sheetNames ? ` (${sheetNames})` : ''}.`,
      isMaterial: true,
    },
  ]

  for (const category of categoryList) {
    const breakdown = breakdownLookup[category]
    const isDisabled =
      (category === 'Weight Plate' && !planterInput.weightPlateEnabled) ||
      (category === 'Liner' && !planterInput.linerEnabled) ||
      (category === 'Shelf' && !planterInput.shelfEnabled)
    const disabledName = category === 'Weight Plate' ? 'Weight plate' : category
    const tierUsed = isDisabled ? 'Disabled' : breakdown?.tierUsed ?? '-'
    const basePrice = isDisabled ? 0 : breakdown?.basePrice ?? 0
    const overridePrice = isDisabled ? null : breakdown?.overridePrice ?? null
    const notes = isDisabled
      ? `${disabledName} feature disabled.`
      : breakdown?.tierUsed === 'Not Selected'
        ? `${category} is not selected yet.`
        : category === 'Liner'
          ? 'Liner labor tier applied.'
          : category === 'Shelf'
            ? 'Shelf tier applied.'
            : category === 'Weight Plate'
              ? 'Weight plate tier applied.'
              : `${breakdown?.tierUsed ?? '-'} tier applied.`

    rows.push({
      category,
      tierUsed,
      basePrice,
      overridePrice,
      notes,
    })
  }

  customDetailRows.forEach((row, index) => {
    rows.push({
      category: row.category?.trim() || `Custom category ${index + 1}`,
      tierUsed: 'Custom',
      basePrice: 0,
      overridePrice: Number.isFinite(row.price) ? Math.max(0, row.price ?? 0) : null,
      notes: row.note ?? '',
    })
  })

  return rows
}

const toDisplayDimension = (valueInInches: number, unit: CutPlanMeasurementUnit) =>
  unit === 'mm' ? valueInInches * INCH_TO_MM : valueInInches

const formatPanelLengthWidthDimensions = (width: number, height: number, unit: CutPlanMeasurementUnit) =>
  `${toDisplayDimension(width, unit).toFixed(1)} ${unit} x ${toDisplayDimension(height, unit).toFixed(1)} ${unit}`

const formatDisplaySheetDimensions = (width: number, height: number, unit: CutPlanMeasurementUnit) =>
  `${toDisplayDimension(width, unit).toFixed(2)} ${unit} x ${toDisplayDimension(height, unit).toFixed(2)} ${unit}`

const computeSheetScale = (sheet: SheetInstanceUsage) => {
  const maxDimension = Math.max(sheet.width, sheet.height, 1)
  const suggestedScale = CUT_PLAN_MAX_DISPLAY_DIMENSION / maxDimension
  return Math.max(CUT_PLAN_MIN_DISPLAY_SCALE, Math.min(CUT_PLAN_MAX_DISPLAY_SCALE, suggestedScale))
}

const getPanelGroup = (placement: Placement) => {
  if (placement.isLiner || placement.panelType === 'liner' || placement.panelId.includes('liner')) {
    return 'liner'
  }
  if (placement.panelType === 'shelf' || placement.panelId.includes('shelf')) {
    return 'shelf'
  }
  if (
    placement.panelType === 'floor' ||
    placement.panelId.includes('floor') ||
    placement.panelId.includes('bottom')
  ) {
    return 'floor'
  }
  if (placement.panelId.includes('long')) {
    return 'long'
  }
  if (placement.panelId.includes('short')) {
    return 'short'
  }
  return 'other'
}

const getPlacementStyle = (placement: Placement): CutPlanPaletteEntry => {
  const group = getPanelGroup(placement)
  return CUT_PLAN_PANEL_PALETTE[group] ?? CUT_PLAN_PANEL_PALETTE.other
}

const buildTerracePlanterCostCompositionHtml = (raw: TerracePlanterCalculationRawResult) => {
  const metrics = [
    { label: 'Material cost', value: formatCurrency(raw.totalMaterialCost) },
    { label: 'Non-material cost', value: formatCurrency(raw.totalNonMaterialCost) },
    { label: 'Sheet count', value: raw.sheetCount.toLocaleString() },
    { label: 'Material yield', value: formatPercent(raw.utilizationPct) },
  ]

  return [
    '<section style="display:grid;gap:14px;border:1px solid #cbd5e1;background:#ffffff;padding:16px;">',
    buildVisualSectionHeaderHtml('Cost composition', 'Material and labor structure with yield visibility.'),
    buildMetricGridHtml(metrics),
    '</section>',
  ].join('')
}

const buildTerracePlanterCostDetailsHtml = (
  raw: TerracePlanterCalculationRawResult,
  planterInput: PlanterInput,
  customDetailRows: TerracePlanterCustomDetailRow[],
) => {
  const detailRows = buildCostDetailRows(raw, planterInput, customDetailRows)
  const rows = detailRows.map((row) => [
    row.category,
    row.tierUsed,
    formatCurrency(row.basePrice),
    row.isMaterial ? 'Not applicable' : row.overridePrice === null ? '-' : formatCurrency(row.overridePrice),
    row.notes,
  ])

  return [
    '<section style="display:grid;gap:14px;border:1px solid #cbd5e1;background:#ffffff;padding:16px;">',
    buildVisualSectionHeaderHtml(
      'Cost details',
      'Material and fabrication tiers are shown alongside liner/add-on costs. Tier selections follow the calculated volume.',
    ),
    `<div style="padding-bottom:72px;">${buildTableHtml(['Category', 'Tier used', 'Base price', 'Override price', 'Notes'], rows)}</div>`,
    '<div style="clear:both;margin-top:14px;border:1px solid #cbd5e1;background:#f8fafc;padding:16px;">',
    '<p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">Total cost</p>',
    `<p style="margin:4px 0 0;color:#0f172a;font-size:18px;font-weight:700;">${escapeHtml(formatCurrency(raw.totalFabricationCost))}</p>`,
    '</div>',
    '</section>',
  ].join('')
}

const buildTerracePlanterSheetBreakdownHtml = (sheetSummaries: TerracePlanterSheetSummary[]) => {
  const rows = sheetSummaries.map((sheet) => [
    sheet.name,
    sheet.quantityUsed.toLocaleString(),
    formatCurrency(sheet.costPerSqft),
    formatCurrency(sheet.costPerSheet),
    formatCurrency(sheet.totalMaterialCost),
    formatPercent(sheet.utilizationPct),
    formatCurrency(sheet.unusedMaterialCost),
  ])

  return [
    '<section style="display:grid;gap:14px;border:1px solid #cbd5e1;background:#ffffff;padding:16px;">',
    buildVisualSectionHeaderHtml(
      'Sheet breakdown',
      "Each sheet type's utilization, unused material, and per-sheet cost encourage deterministic reuse and transparency.",
    ),
    sheetSummaries.length === 0
      ? '<p style="margin:0;color:#64748b;font-size:14px;">Run Calculate to collect sheet usage data.</p>'
      : buildTableHtml(
          [
            'Sheet type',
            'Quantity used',
            'Cost / sqft',
            'Cost / sheet',
            'Total material cost',
            'Utilization %',
            'Unused material cost',
          ],
          rows,
        ),
    '</section>',
  ].join('')
}

const buildTerracePlanterCutPlanHtml = (
  sheetUsages: SheetInstanceUsage[],
  measurementUnit: CutPlanMeasurementUnit = 'in',
) => {
  const parts = [
    '<div style="display:grid;gap:18px;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif;">',
    '<div style="display:grid;gap:4px;">',
    '<h2 style="margin:0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.25;">Cut plan</h2>',
    '<p style="margin:0;color:#64748b;font-size:14px;line-height:1.45;">Each sheet card shows how panels stack and ties the layout back to the lowest material cost.</p>',
    '</div>',
  ]

  if (!sheetUsages.length) {
    parts.push('<p style="margin:0;color:#64748b;font-size:14px;">Run Calculate to see the cut plan for the chosen inventory.</p>')
    parts.push('</div>')
    return parts.join('')
  }

  for (const sheet of sheetUsages) {
    const scale = computeSheetScale(sheet)
    const displayWidth = sheet.width * scale
    const displayHeight = sheet.height * scale
    const sheetAreaSqft = (sheet.width * sheet.height) / 144
    const usedSqft = sheet.areaUsedSqft
    const utilizationPct = sheetAreaSqft ? (usedSqft / sheetAreaSqft) * 100 : 0
    const sheetCost = sheetAreaSqft * sheet.costPerSqft
    const sortedPlacements = [...sheet.placements].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y
      return a.x - b.x
    })

    parts.push('<section style="display:grid;gap:16px;border:1px solid #cbd5e1;background:#f8fafc;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,0.05);">')
    parts.push('<div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px;">')
    parts.push('<div style="display:grid;flex:1 1 340px;min-width:240px;gap:12px;">')
    parts.push('<div style="display:grid;gap:10px;">')
    parts.push('<div>')
    parts.push('<p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.24em;text-transform:uppercase;">Sheet type</p>')
    parts.push(`<p style="margin:4px 0 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.25;">${escapeHtml(sheet.name)}</p>`)
    parts.push(`<p style="margin:2px 0 0;color:#64748b;font-size:12px;">Instance ${escapeHtml(sheet.id)}</p>`)
    parts.push('</div>')
    parts.push(`<p style="margin:0;color:#64748b;font-size:14px;">${sortedPlacements.length} panels - ${escapeHtml(formatDisplaySheetDimensions(sheet.width, sheet.height, measurementUnit))}</p>`)
    parts.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;color:#64748b;font-size:14px;">')

    const metrics = [
      { label: 'Cost / sqft', value: formatCurrency(sheet.costPerSqft) },
      { label: 'Cost / sheet', value: formatCurrency(sheetCost) },
      { label: 'Area used', value: `${usedSqft.toFixed(2)} sq ft` },
      { label: 'Utilization', value: formatPercent(utilizationPct) },
    ]

    for (const metric of metrics) {
      parts.push('<div>')
      parts.push(`<p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;">${escapeHtml(metric.label)}</p>`)
      parts.push(`<p style="margin:4px 0 0;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(metric.value)}</p>`)
      parts.push('</div>')
    }

    parts.push('</div>')
    parts.push('</div>')
    parts.push('<div style="display:grid;gap:10px;color:#64748b;font-size:14px;">')

    for (const placement of sortedPlacements) {
      const placementStyle = getPlacementStyle(placement)
      parts.push('<div style="display:inline-flex;width:max-content;max-width:100%;align-items:center;border:1px solid #cbd5e1;background:#ffffff;padding:6px 10px;">')
      parts.push(`<span style="display:inline-block;width:24px;height:8px;border:1px solid ${placementStyle.border};background:${placementStyle.background};margin-right:8px;"></span>`)
      parts.push(`<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;color:#0f172a;font-weight:700;">${escapeHtml(placement.name)}`)
      if (placement.panelType === 'shelf') {
        parts.push('<span style="color:#64748b;font-size:11px;font-weight:500;">(shelf)</span>')
      }
      parts.push(`<span style="color:#64748b;font-size:13px;font-weight:500;">${escapeHtml(formatPanelLengthWidthDimensions(placement.width, placement.height, measurementUnit))}</span>`)
      parts.push('</span></div>')
    }

    parts.push('</div>')
    parts.push('</div>')
    parts.push('<div style="flex:0 1 auto;max-width:100%;overflow:auto;">')
    parts.push(`<div style="position:relative;box-sizing:border-box;overflow:hidden;border:1px solid #cbd5e1;background:#ffffff;box-shadow:inset 0 1px 3px rgba(15,23,42,0.08);width:${formatCssPx(displayWidth)};height:${formatCssPx(displayHeight)};min-width:280px;min-height:280px;">`)

    for (const placement of sortedPlacements) {
      const placementStyle = getPlacementStyle(placement)
      const panelDisplayWidth = placement.width * scale
      const panelDisplayHeight = placement.height * scale
      const minPanelSide = Math.min(panelDisplayWidth, panelDisplayHeight)
      const panelFontSize = Math.max(7, Math.min(11, minPanelSide * 0.14))
      const showDimensions = minPanelSide >= 34
      parts.push(`<div style="position:absolute;left:${formatCssPx(placement.x * scale)};top:${formatCssPx(placement.y * scale)};box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;border:1px solid ${placementStyle.border};background:${placementStyle.background};color:${placementStyle.text};width:${formatCssPx(panelDisplayWidth)};height:${formatCssPx(panelDisplayHeight)};padding:6px 6px 4px;font-size:${formatCssPx(panelFontSize)};font-weight:500;line-height:1;">`)
      parts.push(`<span style="overflow-wrap:anywhere;font-weight:700;">${escapeHtml(placement.name)}</span>`)
      if (showDimensions) {
        parts.push(`<span style="overflow-wrap:anywhere;">${escapeHtml(formatPanelLengthWidthDimensions(placement.width, placement.height, measurementUnit))}</span>`)
      }
      parts.push('</div>')
    }

    if (!sortedPlacements.length) {
      parts.push('<p style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;color:#64748b;font-size:12px;">No placements recorded.</p>')
    }

    parts.push('</div></div></div></section>')
  }

  parts.push('<div style="display:flex;flex-wrap:wrap;gap:12px;color:#64748b;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;">')
  for (const entry of CUT_PLAN_LEGEND_GROUPS) {
    const palette = CUT_PLAN_PANEL_PALETTE[entry.group] ?? CUT_PLAN_PANEL_PALETTE.other
    parts.push('<div style="display:flex;align-items:center;gap:8px;">')
    parts.push(`<span style="display:inline-block;width:28px;height:8px;border:1px solid ${palette.border};background:${palette.background};"></span>`)
    parts.push(`<span>${escapeHtml(entry.label)}</span>`)
    parts.push('</div>')
  }
  parts.push('</div></div>')

  return parts.join('')
}

const buildTerracePlanterVisualsHtml = (
  raw: TerracePlanterCalculationRawResult,
  planterInput: PlanterInput,
  customDetailRows: TerracePlanterCustomDetailRow[],
) =>
  [
    '<div style="display:grid;gap:18px;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif;">',
    buildTerracePlanterCostCompositionHtml(raw),
    buildTerracePlanterCostDetailsHtml(raw, planterInput, customDetailRows),
    buildTerracePlanterSheetBreakdownHtml(raw.sheetSummaries),
    buildTerracePlanterCutPlanHtml(raw.solverResult.sheetUsages),
    '</div>',
  ].join('')

export const calculateTerracePlanter = (
  request: CalculateTerracePlanterRequest,
): TerracePlanterCalculationResult => {
  const { planterInput, options: requestOptions } = request
  const options = requestOptions ?? {}
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

  const raw: TerracePlanterCalculationRawResult = {
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

  return {
    subtotal: totalFabricationCost,
    visuals: buildTerracePlanterVisualsHtml(raw, planterInput, options.customDetailRows ?? []),
    raw,
  }
}
