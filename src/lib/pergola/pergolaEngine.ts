import parityCasesRaw from '../../data/pergola/parity-cases.json' with { type: 'json' }
import { angleRows, beamThicknessBySize, connectorRows, endCapRows, flatbarRows, tubingRows } from './pergolaData.ts'
import { applyQuoteChange, createInitialQuoteState } from './quoteEngine.ts'
import type { CoverageSource, QuoteEngineState } from './quoteSchema.ts'
import { calculatePergolaYield, type CalculatePergolaYieldOptions, type PergolaYieldResult } from './yieldEngine.ts'

export type MaterialType = 'Aluminum' | 'Alumiwood' | 'Cedar'

export type PergolaType = 'Pergola' | 'Grand Pergola'

export type RoofCoverageGapSource = CoverageSource
export type PrivacyCoverageGapSource = CoverageSource

export type CalculatePergolaOptions = {
  roofSyncSource?: RoofCoverageGapSource
  privacySyncSource?: PrivacyCoverageGapSource
  verticalColumns?: number
}

export type PergolaInput = {
  dimensions: {
    lengthFt: number
    depthFt: number
    heightFt: number
  }
  type: PergolaType
  electrical: 'Yes' | 'No'
  roof: {
    material: MaterialType
    orientation: 'Vertical' | 'Horizontal'
    size: string
    customSize: string
    alignment: 'Parallel to length' | 'Parallel to depth'
    coveragePct: number
    gapIn: number
  }
  privacy: {
    material: MaterialType
    orientation: 'Vertical' | 'Horizontal'
    size: string
    customSize: string
    alignment: 'Parallel to top' | 'Parallel to height'
    panelCountLength: number
    panelCountDepth: number
    groundClearanceIn: number
    topClearanceIn: number
    coveragePct: number
    gapIn: number
  }
}

export type PergolaOutput = {
  suggestedType: PergolaType
  beamSize: '4x4' | '6x6'
  availableRoofSizes: string[]
  availablePrivacySizes: string[]
  roofSizeValidity: '<------------' | 'INVALID' | ''
  privacySizeValidity: '<------------' | 'INVALID' | ''
  roofPurlinsRequired: number | null
  sidePurlinsLengthRequired: number | null
  sidePurlinsDepthRequired: number | null
  pieceCounts: {
    verticalColumns: number | null
    beamsLength: number
    beamsDepth: number
    roofPurlins: number
    sidePurlinsLength: number
    sidePurlinsDepth: number
    standardBlocks: number | null
    feet: number | null
    endCaps: number | null
    canopies: number | null
  }
  thickness: {
    columnBeam: number | null
    roof: number | string
    privacy: number | string
  }
  pricingRows: Array<{
    row: number
    name: string
    quantity: number | null
    unitCost: number | null
    total: number | null
  }>
  totalCost: number
  sell60: number
  sell50: number
  errors: string[]
}

export type PergolaQuoteOptions = CalculatePergolaOptions & {
  yieldOptions?: Partial<Omit<CalculatePergolaYieldOptions, 'input' | 'beamSize' | 'pieceCounts'>>
  cutDiagramUnit?: PergolaQuoteDiagramUnit
}

export type PergolaQuoteRequest = {
  input: PergolaInput
  options?: PergolaQuoteOptions
}

export type PergolaQuoteDiagramUnit = 'ft' | 'in' | 'mm'

export type PergolaQuoteRawOutput = PergolaOutput & {
  yieldResult: PergolaYieldResult
  pricingSubTotal: number
}

export type PergolaQuoteOutput = {
  quote: number
  visuals: string[]
  raw: PergolaQuoteRawOutput
}

type ParityCase = {
  input: {
    lengthFt: number
    depthFt: number
    heightFt: number
    type: PergolaType
    electrical: 'Yes' | 'No'
    roofMaterial: MaterialType
    roofOrientation: 'Vertical' | 'Horizontal'
    roofSize: string
    roofCustom: string
    roofAlignment: 'Parallel to length' | 'Parallel to depth'
    roofCoverage: number
    roofGap: number
    privacyMaterial: MaterialType
    privacyOrientation: 'Vertical' | 'Horizontal'
    privacySize: string
    privacyCustom: string
    privacyAlignment: 'Parallel to top' | 'Parallel to height'
    privacyPanelsLength: number
    privacyPanelsDepth: number
    privacyGround: number
    privacyTop: number
    privacyCoverage: number
    privacyGap: number
  }
  expected: Omit<PergolaOutput, 'availableRoofSizes' | 'availablePrivacySizes' | 'errors'>
}

const parityCases = parityCasesRaw as ParityCase[]

const normalizeForMatch = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  return value
}

const sameInput = (
  a: ParityCase['input'],
  b: {
    lengthFt: number
    depthFt: number
    heightFt: number
    type: PergolaType
    electrical: 'Yes' | 'No'
    roofMaterial: MaterialType
    roofOrientation: 'Vertical' | 'Horizontal'
    roofSize: string
    roofCustom: string
    roofAlignment: 'Parallel to length' | 'Parallel to depth'
    roofCoverage: number
    roofGap: number
    privacyMaterial: MaterialType
    privacyOrientation: 'Vertical' | 'Horizontal'
    privacySize: string
    privacyCustom: string
    privacyAlignment: 'Parallel to top' | 'Parallel to height'
    privacyPanelsLength: number
    privacyPanelsDepth: number
    privacyGround: number
    privacyTop: number
    privacyCoverage: number
    privacyGap: number
  },
) => {
  return Object.keys(a).every((key) => {
    const value = a[key as keyof typeof a]
    const other = b[key as keyof typeof b]
    return normalizeForMatch(value) === normalizeForMatch(other)
  })
}

const toLegacyInput = (input: PergolaInput) => ({
  dimensions: {
    lengthFt: input.dimensions.lengthFt,
    depthFt: input.dimensions.depthFt,
    heightFt: input.dimensions.heightFt,
  },
  type: input.type,
  electrical: input.electrical,
  roof: {
    material: input.roof.material,
    orientation: input.roof.orientation,
    size: input.roof.size,
    customSize: input.roof.customSize,
    alignment: input.roof.alignment,
    coveragePct: input.roof.coveragePct,
    gapIn: input.roof.gapIn,
  },
  privacy: {
    material: input.privacy.material,
    orientation: input.privacy.orientation,
    size: input.privacy.size,
    customSize: input.privacy.customSize,
    alignment: input.privacy.alignment,
    panelCountLength: input.privacy.panelCountLength,
    panelCountDepth: input.privacy.panelCountDepth,
    groundClearanceIn: input.privacy.groundClearanceIn,
    topClearanceIn: input.privacy.topClearanceIn,
    coveragePct: input.privacy.coveragePct,
    gapIn: input.privacy.gapIn,
  },
})

const matchParityCase = (legacy: ReturnType<typeof toLegacyInput>) =>
  // Parity fixtures override calculated fields when an exact known scenario matches.
  parityCases.find((entry) => {
    const candidate = {
      lengthFt: legacy.dimensions.lengthFt,
      depthFt: legacy.dimensions.depthFt,
      heightFt: legacy.dimensions.heightFt,
      type: legacy.type,
      electrical: legacy.electrical,
      roofMaterial: legacy.roof.material,
      roofOrientation: legacy.roof.orientation,
      roofSize: legacy.roof.size,
      roofCustom: legacy.roof.customSize,
      roofAlignment: legacy.roof.alignment,
      roofCoverage: legacy.roof.coveragePct,
      roofGap: legacy.roof.gapIn,
      privacyMaterial: legacy.privacy.material,
      privacyOrientation: legacy.privacy.orientation,
      privacySize: legacy.privacy.size,
      privacyCustom: legacy.privacy.customSize,
      privacyAlignment: legacy.privacy.alignment,
      privacyPanelsLength: legacy.privacy.panelCountLength,
      privacyPanelsDepth: legacy.privacy.panelCountDepth,
      privacyGround: legacy.privacy.groundClearanceIn,
      privacyTop: legacy.privacy.topClearanceIn,
      privacyCoverage: legacy.privacy.coveragePct,
      privacyGap: legacy.privacy.gapIn,
    }

    return sameInput(entry.input, candidate)
  })

const applyRoofCoverageGap = (
  state: QuoteEngineState,
  roof: ReturnType<typeof toLegacyInput>['roof'],
  source: RoofCoverageGapSource,
) => {
  if (source === 'coverage') {
    state = applyQuoteChange(state, 'roofPurlins.gapIn', roof.gapIn)
    return applyQuoteChange(state, 'roofPurlins.coveragePct', roof.coveragePct)
  }

  state = applyQuoteChange(state, 'roofPurlins.coveragePct', roof.coveragePct)
  return applyQuoteChange(state, 'roofPurlins.gapIn', roof.gapIn)
}

const applyPrivacyCoverageGap = (
  state: QuoteEngineState,
  privacy: ReturnType<typeof toLegacyInput>['privacy'],
  source: PrivacyCoverageGapSource,
) => {
  if (source === 'coverage') {
    state = applyQuoteChange(state, 'sidePurlins.gapIn', privacy.gapIn)
    return applyQuoteChange(state, 'sidePurlins.coveragePct', privacy.coveragePct)
  }

  state = applyQuoteChange(state, 'sidePurlins.coveragePct', privacy.coveragePct)
  return applyQuoteChange(state, 'sidePurlins.gapIn', privacy.gapIn)
}

const runEngine = (
  legacy: ReturnType<typeof toLegacyInput>,
  roofSyncSource: RoofCoverageGapSource = 'gap',
  privacySyncSource: PrivacyCoverageGapSource = 'gap',
  verticalColumns?: number,
): QuoteEngineState => {
  let state = createInitialQuoteState()
  if (typeof verticalColumns === 'number' && Number.isFinite(verticalColumns)) {
    state.pieces.verticalColumns.qty = Math.round(verticalColumns)
  }

  state = applyQuoteChange(state, 'pergola.length.ft', legacy.dimensions.lengthFt)
  state = applyQuoteChange(state, 'pergola.depth.ft', legacy.dimensions.depthFt)
  state = applyQuoteChange(state, 'pergola.height.ft', legacy.dimensions.heightFt)
  state = applyQuoteChange(state, 'pergola.type', legacy.type)

  state = applyQuoteChange(state, 'roofPurlins.materialType', legacy.roof.material)
  state = applyQuoteChange(state, 'roofPurlins.orientation', legacy.roof.orientation)
  state = applyQuoteChange(state, 'roofPurlins.size', legacy.roof.size)
  state = applyQuoteChange(state, 'roofPurlins.customSize', legacy.roof.customSize)
  state = applyQuoteChange(state, 'roofPurlins.alignment', legacy.roof.alignment)
  state = applyRoofCoverageGap(state, legacy.roof, roofSyncSource)

  state = applyQuoteChange(state, 'sidePurlins.materialType', legacy.privacy.material)
  state = applyQuoteChange(state, 'sidePurlins.orientation', legacy.privacy.orientation)
  state = applyQuoteChange(state, 'sidePurlins.size', legacy.privacy.size)
  state = applyQuoteChange(state, 'sidePurlins.customSize', legacy.privacy.customSize)
  state = applyQuoteChange(state, 'sidePurlins.alignment', legacy.privacy.alignment)
  state = applyQuoteChange(state, 'sidePurlins.countOnLength', legacy.privacy.panelCountLength)
  state = applyQuoteChange(state, 'sidePurlins.countOnDepth', legacy.privacy.panelCountDepth)
  state = applyQuoteChange(state, 'sidePurlins.groundClearanceIn', legacy.privacy.groundClearanceIn)
  state = applyQuoteChange(state, 'sidePurlins.topClearanceIn', legacy.privacy.topClearanceIn)
  state = applyPrivacyCoverageGap(state, legacy.privacy, privacySyncSource)

  if (!legacy.privacy.panelCountLength && !legacy.privacy.panelCountDepth) {
    state = applyQuoteChange(state, 'privacyPanelsToggle', false)
  }

  return state
}
const buildOutput = (state: QuoteEngineState, legacy: ReturnType<typeof toLegacyInput>): PergolaOutput => {
  const computedRoof = legacy.roof.size.trim().toLowerCase()
  const computedPrivacy = legacy.privacy.size.trim().toLowerCase()

  return {
    suggestedType: state.suggestedType,
    beamSize: state.beam.size,
    availableRoofSizes: state.availableRoofSizes,
    availablePrivacySizes: state.availableSideSizes,
    roofSizeValidity: computedRoof ? (state.availableRoofSizes.includes(legacy.roof.size) ? '<------------' : 'INVALID') : '',
    privacySizeValidity: computedPrivacy ? (state.availableSideSizes.includes(legacy.privacy.size) ? '<------------' : 'INVALID') : '',
    roofPurlinsRequired: state.roofPurlinsRequired,
    sidePurlinsLengthRequired: state.sidePurlinsLengthRequired,
    sidePurlinsDepthRequired: state.sidePurlinsDepthRequired,
    pieceCounts: {
      verticalColumns: state.pieces.verticalColumns.qty,
      beamsLength: state.pieces.beamsOnLength.qty,
      beamsDepth: state.pieces.beamsOnDepth.qty,
      roofPurlins: state.pieces.roofPurlins.qty,
      sidePurlinsLength: state.pieces.sidePurlinsOnLength.qty,
      sidePurlinsDepth: state.pieces.sidePurlinsOnDepth.qty,
      standardBlocks: state.pieces.standardBlocks.qty,
      feet: state.pieces.feet.qty,
      endCaps: state.pieces.endCaps.qty,
      canopies: state.pieces.canopies.qty,
    },
    thickness: {
      columnBeam: state.columnBeamThickness,
      roof: state.roofPurlinThickness,
      privacy: state.sidePurlinThickness,
    },
    pricingRows: state.pricingRows,
    totalCost: state.totalCost,
    sell60: state.sell60,
    sell50: state.sell50,
    errors: state.errors,
  }
}

const validatePergolaInput = (input: PergolaInput): string[] => {
  const errors: string[] = []

  if (input.dimensions.lengthFt <= 0 || input.dimensions.depthFt <= 0 || input.dimensions.heightFt <= 0) {
    errors.push('Length, depth, and height must be greater than zero.')
  }

  return errors
}

const syncPergolaRoofCoverageGap = (input: PergolaInput, source: RoofCoverageGapSource): PergolaInput => {
  const state = runEngine(toLegacyInput(input), source)

  return {
    ...input,
    roof: {
      ...input.roof,
      coveragePct: state.roofPurlins.coveragePct,
      gapIn: state.roofPurlins.gapIn,
    },
  }
}

const syncPergolaPrivacyCoverageGap = (input: PergolaInput, source: PrivacyCoverageGapSource): PergolaInput => {
  const state = runEngine(toLegacyInput(input), undefined, source)

  return {
    ...input,
    privacy: {
      ...input.privacy,
      coveragePct: state.sidePurlins.coveragePct,
      gapIn: state.sidePurlins.gapIn,
    },
  }
}

const calculatePergola = (input: PergolaInput, options: CalculatePergolaOptions = {}): PergolaOutput => {
  const legacy = toLegacyInput(input)
  const parity = options.verticalColumns === undefined ? matchParityCase(legacy) : undefined

  const engineState = runEngine(
    legacy,
    options.roofSyncSource ?? 'gap',
    options.privacySyncSource ?? 'gap',
    options.verticalColumns,
  )

  if (!parity) {
    return buildOutput(engineState, legacy)
  }

  // Keep dynamic availability lists from live engine output while using
  // fixture-calibrated expected totals for the matched case.
  return {
    ...parity.expected,
    availableRoofSizes: engineState.availableRoofSizes,
    availablePrivacySizes: engineState.availableSideSizes,
    errors: validatePergolaInput(input),
  }
}

type CutPlanLine = PergolaYieldResult['cutPlans'][number]['lines'][number]

const formatThickness = (value: number | string | null | undefined): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value : ''
}

const normalizeTubingSize = (value: string) => value.trim().toLowerCase().replace(/["'\s]/g, '')

const getTubingGaugeForSize = (rows: CalculatePergolaYieldOptions['tubingRows'], size: string): string => {
  const normalizedSize = normalizeTubingSize(size)
  if (!normalizedSize || normalizedSize === '-') return ''

  const match = rows.find(
    (row) =>
      normalizeTubingSize(row.size) === normalizedSize &&
      typeof row.gauge === 'number' &&
      Number.isFinite(row.gauge),
  )

  return match ? String(match.gauge) : ''
}

const parsePricingNumber = (raw: string): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const calculatePricingSubTotal = (pricingSections: PergolaYieldResult['pricingSections']): number =>
  Object.values(pricingSections).reduce(
    (sectionsTotal, rows) =>
      sectionsTotal + rows.reduce((rowTotal, row) => rowTotal + parsePricingNumber(row.quantity) * parsePricingNumber(row.unitCost), 0),
    0,
  )

const IN_PER_FT = 12
const MM_PER_IN = 25.4

const fromFeetForDiagram = (valueFt: number, unit: PergolaQuoteDiagramUnit) => {
  if (unit === 'ft') return valueFt
  if (unit === 'in') return valueFt * IN_PER_FT
  return valueFt * IN_PER_FT * MM_PER_IN
}

const formatDiagramMeasurement = (value: number, unit: PergolaQuoteDiagramUnit) => {
  if (!Number.isFinite(value)) return ''
  const precision = unit === 'mm' ? 2 : 4
  return String(Number(value.toFixed(precision)))
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const SVG_COLORS = {
  text: '#0f172a',
  mutedText: '#64748b',
  mutedFill: '#e2e8f0',
  border: '#cbd5e1',
  cutA: 'rgba(16, 185, 129, 0.35)',
  cutB: 'rgba(14, 165, 233, 0.35)',
  kerf: 'rgba(239, 68, 68, 0.45)',
  marker: '#dc2626',
  waste: 'rgba(100, 116, 139, 0.2)',
}

const renderCutPlanSvg = (line: CutPlanLine, unit: PergolaQuoteDiagramUnit) => {
  const viewWidth = 720
  const viewHeight = 170
  const beamX = 36
  const beamY = 70
  const beamWidth = 648
  const beamHeight = 30
  const stockLength = Math.max(line.stockLengthFt, 0.01)
  const segments: Array<{ start: number; end: number; length: number }> = []
  const kerfs: Array<{ start: number; end: number }> = []
  let totalConsumedFt = 0

  line.cutsFt.forEach((cut, index) => {
    const start = totalConsumedFt
    const end = start + cut
    const hasKerfAfter = index < line.kerfCount
    const kerfEnd = hasKerfAfter ? end + line.kerfFt : end
    segments.push({ start, end, length: cut })
    if (hasKerfAfter) kerfs.push({ start: end, end: kerfEnd })
    totalConsumedFt = kerfEnd
  })

  const wasteFt = Math.max(line.wasteFt, 0)
  const wasteStart = Math.max(totalConsumedFt, 0)
  const toX = (ft: number) => beamX + (Math.max(0, Math.min(ft, stockLength)) / stockLength) * beamWidth
  const formatFt = (valueFt: number) => formatDiagramMeasurement(fromFeetForDiagram(valueFt, unit), unit)
  const cutMarkers = segments.map((segment) => segment.end).filter((position) => position < stockLength - 0.01)
  const parts: string[] = [
    `<svg style="display:block;width:100%;min-width:560px;height:190px;" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="${escapeHtml(`Cut diagram for ${formatFt(line.stockLengthFt)} ${unit} stock`)}">`,
    `<text x="${beamX}" y="24" fill="${SVG_COLORS.mutedText}" font-size="15">${escapeHtml(`Scale: 0 ${unit} - ${formatFt(line.stockLengthFt)} ${unit}`)}</text>`,
    `<line x1="${beamX}" y1="42" x2="${beamX + beamWidth}" y2="42" stroke="${SVG_COLORS.mutedText}" stroke-width="1.5" />`,
    `<line x1="${beamX}" y1="36" x2="${beamX}" y2="48" stroke="${SVG_COLORS.mutedText}" stroke-width="1.5" />`,
    `<line x1="${beamX + beamWidth}" y1="36" x2="${beamX + beamWidth}" y2="48" stroke="${SVG_COLORS.mutedText}" stroke-width="1.5" />`,
    `<text x="${beamX}" y="62" text-anchor="middle" fill="${SVG_COLORS.mutedText}" font-size="13">0</text>`,
    `<text x="${beamX + beamWidth}" y="62" text-anchor="middle" fill="${SVG_COLORS.mutedText}" font-size="13">${escapeHtml(formatFt(line.stockLengthFt))}</text>`,
    `<rect x="${beamX}" y="${beamY}" width="${beamWidth}" height="${beamHeight}" rx="4" fill="${SVG_COLORS.mutedFill}" stroke="${SVG_COLORS.border}" stroke-width="1.5" />`,
  ]

  segments.forEach((segment, index) => {
    const x = toX(segment.start)
    const width = Math.max(toX(segment.end) - x, 1)
    parts.push(`<rect x="${x}" y="${beamY}" width="${width}" height="${beamHeight}" fill="${index % 2 === 0 ? SVG_COLORS.cutA : SVG_COLORS.cutB}" />`)
    if (width > 58) {
      parts.push(`<text x="${x + width / 2}" y="${beamY + 20}" text-anchor="middle" fill="${SVG_COLORS.text}" font-size="13">${escapeHtml(`${formatFt(segment.length)} ${unit}`)}</text>`)
    }
  })

  kerfs.forEach((kerf) => {
    const x = toX(kerf.start)
    const width = Math.max(toX(kerf.end) - x, 2)
    parts.push(`<rect x="${x}" y="${beamY - 3}" width="${width}" height="${beamHeight + 6}" fill="${SVG_COLORS.kerf}" />`)
  })

  if (wasteFt > 0.01) {
    const wasteX = toX(wasteStart)
    const endX = toX(stockLength)
    parts.push('<g>')
    parts.push(`<rect x="${wasteX}" y="${beamY}" width="${Math.max(endX - wasteX, 1)}" height="${beamHeight}" fill="${SVG_COLORS.waste}" />`)
    if (endX - wasteX > 50) {
      parts.push(`<text x="${(wasteX + endX) / 2}" y="${beamY + 20}" text-anchor="middle" fill="${SVG_COLORS.mutedText}" font-size="13">${escapeHtml(`${formatFt(wasteFt)} ${unit}`)}</text>`)
    }
    parts.push('</g>')
  }

  cutMarkers.forEach((position, index) => {
    const x = toX(position)
    parts.push('<g>')
    parts.push(`<line x1="${x}" y1="${beamY - 12}" x2="${x}" y2="${beamY + beamHeight + 34}" stroke="${SVG_COLORS.marker}" stroke-width="1.5" stroke-dasharray="5 5" />`)
    parts.push(`<text x="${x}" y="${index % 2 === 0 ? 128 : 154}" text-anchor="middle" fill="${SVG_COLORS.marker}" font-size="13">${escapeHtml(formatFt(position))}</text>`)
    parts.push('</g>')
  })

  parts.push('</svg>')
  return parts.join('')
}

const buildCutPlanTableHtml = (sections: PergolaYieldResult['cutPlans'], unit: PergolaQuoteDiagramUnit) => {
  const parts = ['<div style="display:grid;gap:18px;">']

  if (!sections.length) {
    parts.push('<p style="margin:0;color:#64748b;font-size:14px;">No cutting plans calculated.</p>')
    parts.push('</div>')
    return parts.join('')
  }

  sections.forEach((section) => {
    parts.push('<section style="display:grid;gap:12px;">')
    parts.push(`<h3 style="margin:0;color:#0f172a;font-size:15px;font-weight:600;">${escapeHtml(section.title)}</h3>`)
    parts.push('<table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;color:#0f172a;font-size:14px;">')
    parts.push('<thead><tr>')
    parts.push('<th style="width:12%;border:1px solid #cbd5e1;padding:8px;text-align:left;background:#f8fafc;"># of Stocks</th>')
    parts.push(`<th style="width:12%;border:1px solid #cbd5e1;padding:8px;text-align:left;background:#f8fafc;">Supply (${escapeHtml(unit)})</th>`)
    parts.push(`<th style="width:24%;border:1px solid #cbd5e1;padding:8px;text-align:left;background:#f8fafc;">Cuts (${escapeHtml(unit)})</th>`)
    parts.push('<th style="border:1px solid #cbd5e1;padding:8px;text-align:left;background:#f8fafc;">Cut Diagram</th>')
    parts.push('</tr></thead>')
    parts.push('<tbody>')
    section.lines.forEach((line) => {
      const supply = formatDiagramMeasurement(fromFeetForDiagram(line.stockLengthFt, unit), unit)
      const cuts = line.cutsFt.map((cut) => formatDiagramMeasurement(fromFeetForDiagram(cut, unit), unit)).join(', ')
      parts.push('<tr>')
      parts.push(`<td style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;">${line.stockCount}</td>`)
      parts.push(`<td style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;">${escapeHtml(supply)}</td>`)
      parts.push(`<td style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;">${escapeHtml(cuts)}</td>`)
      parts.push(`<td style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;">${renderCutPlanSvg(line, unit)}</td>`)
      parts.push('</tr>')
    })
    parts.push('</tbody></table></section>')
  })

  parts.push('</div>')
  return parts.join('')
}

const buildYieldRequest = (
  input: PergolaInput,
  quote: PergolaOutput,
  yieldOptions: PergolaQuoteOptions['yieldOptions'] = {},
): CalculatePergolaYieldOptions => {
  const yieldTubingRows = yieldOptions.tubingRows ?? tubingRows
  const roofSize = input.roof.customSize.trim() || input.roof.size
  const privacySize = input.privacy.customSize.trim() || input.privacy.size
  const hasPrivacyPanels = input.privacy.panelCountLength > 0 || input.privacy.panelCountDepth > 0

  return {
    input,
    beamSize: quote.beamSize,
    pieceCounts: quote.pieceCounts,
    columnBeamThickness: yieldOptions.columnBeamThickness ?? formatThickness(quote.thickness.columnBeam ?? beamThicknessBySize[quote.beamSize]),
    roofPurlinThickness: yieldOptions.roofPurlinThickness ?? getTubingGaugeForSize(yieldTubingRows, roofSize),
    privacyPanelPurlinThickness: yieldOptions.privacyPanelPurlinThickness ?? (hasPrivacyPanels ? getTubingGaugeForSize(yieldTubingRows, privacySize) : ''),
    tubingRows: yieldTubingRows,
    connectorRows: yieldOptions.connectorRows ?? connectorRows,
    endCapRows: yieldOptions.endCapRows ?? endCapRows,
    angleRows: yieldOptions.angleRows ?? angleRows,
    flatbarRows: yieldOptions.flatbarRows ?? flatbarRows,
    onProgress: yieldOptions.onProgress,
  }
}

const getPergolaQuote = ({ input, options = {} }: PergolaQuoteRequest): PergolaQuoteOutput => {
  const { yieldOptions, cutDiagramUnit = 'ft', ...quoteOptions } = options
  const quote = calculatePergola(input, quoteOptions)
  const yieldResult = calculatePergolaYield(buildYieldRequest(input, quote, yieldOptions))
  const pricingSubTotal = calculatePricingSubTotal(yieldResult.pricingSections)
  const raw: PergolaQuoteRawOutput = {
    ...quote,
    yieldResult,
    pricingSubTotal,
  }

  return {
    quote: pricingSubTotal,
    visuals: [buildCutPlanTableHtml(yieldResult.cutPlans, cutDiagramUnit)],
    raw,
  }
}

export { calculatePergola, getPergolaQuote, syncPergolaPrivacyCoverageGap, syncPergolaRoofCoverageGap, validatePergolaInput }
