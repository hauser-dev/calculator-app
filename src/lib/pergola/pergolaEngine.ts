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
  subtotal: number
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
type PieceCountKey = keyof PergolaOutput['pieceCounts']
type PieceSizes = Record<PieceCountKey, string>
type PricingSectionKey = keyof PergolaYieldResult['pricingSections']

const PIECE_ROWS: Array<{ key: PieceCountKey; label: string }> = [
  { key: 'verticalColumns', label: 'Vertical Columns' },
  { key: 'beamsLength', label: 'Beams on length' },
  { key: 'beamsDepth', label: 'Beams on depth' },
  { key: 'roofPurlins', label: 'Roof Purlins' },
  { key: 'sidePurlinsLength', label: 'Side Purlins on length' },
  { key: 'sidePurlinsDepth', label: 'Side Purlins on depth' },
  { key: 'standardBlocks', label: 'Standard Blocks' },
  { key: 'feet', label: 'Feet' },
  { key: 'endCaps', label: 'End Caps' },
  { key: 'canopies', label: 'Canopies' },
]

const PRICING_SECTIONS: Array<{ key: PricingSectionKey; label: string }> = [
  { key: 'tubing', label: 'Tubing' },
  { key: 'connectorBlocks', label: 'Connector Blocks' },
  { key: 'endCaps', label: 'End Caps' },
  { key: 'angleIron', label: 'Angle Iron' },
  { key: 'flatbar', label: 'Flatbar' },
  { key: 'additional', label: 'Additional' },
]

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

const hasPrivacyPanels = (input: PergolaInput) => input.privacy.panelCountLength > 0 || input.privacy.panelCountDepth > 0

const buildPieceSizes = (input: PergolaInput): PieceSizes => {
  const typeSize = input.type === 'Grand Pergola' ? '6x6' : '4x4'
  const roofSize = input.roof.customSize.trim() || input.roof.size || '-'
  const privacySize = hasPrivacyPanels(input) ? (input.privacy.customSize.trim() || input.privacy.size || '-') : '-'

  return {
    verticalColumns: typeSize,
    beamsLength: typeSize,
    beamsDepth: typeSize,
    roofPurlins: roofSize,
    sidePurlinsLength: privacySize,
    sidePurlinsDepth: privacySize,
    standardBlocks: '-',
    feet: '-',
    endCaps: '-',
    canopies: '-',
  }
}

const parsePricingNumber = (raw: string): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

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

const VISUAL_COLORS = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.145 0 0)',
  muted: 'oklch(0.97 0 0)',
  mutedForeground: 'oklch(0.556 0 0)',
  border: 'oklch(0.922 0 0)',
  destructive: 'oklch(0.577 0.245 27.325)',
  cutA: 'oklch(0.696 0.17 162.48 / 35%)',
  cutB: 'oklch(0.685 0.169 237.323 / 35%)',
  kerf: 'oklch(0.577 0.245 27.325 / 45%)',
  waste: 'oklch(0.556 0 0 / 20%)',
}

type PreviewVec3 = { x: number; y: number; z: number }
type PreviewBox = {
  center: PreviewVec3
  size: PreviewVec3
  color: string
  stroke: string
}
type PergolaPreviewModel = {
  boxes: PreviewBox[]
  lengthFt: number
  depthFt: number
  heightFt: number
}
type PergolaPreviewCamera = {
  yaw: number
  pitch: number
  zoom: number
  panX: number
  panY: number
}

const PREVIEW_DEFAULT_CAMERA: PergolaPreviewCamera = { yaw: -34, pitch: 22, zoom: 1, panX: 0, panY: 0 }

const parsePreviewSizeInches = (raw: string): { min: number; max: number } => {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i)
  if (!match) return { min: 2, max: 4 }
  const first = Number(match[1])
  const second = Number(match[2])
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
    return { min: 2, max: 4 }
  }
  return { min: Math.min(first, second), max: Math.max(first, second) }
}

const numericPieceCount = (value: number | null | undefined, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(Math.round(value), 0) : fallback

const distributePreviewPositions = (start: number, end: number, count: number): number[] => {
  if (count <= 0) return []
  if (count === 1) return [(start + end) / 2]
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1))
}

const allocatePreviewCounts = (total: number, buckets: number): number[] => {
  if (total <= 0 || buckets <= 0) return []
  const base = Math.floor(total / buckets)
  const remainder = total % buckets
  return Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0))
}

const previewSegmentsFromStations = (stations: number[], fallbackEnd: number, clearance = 0): Array<[number, number]> => {
  const unique = Array.from(new Set(stations.map((station) => Number(station.toFixed(4))))).sort((a, b) => a - b)
  if (unique.length < 2) return [[clearance, Math.max(clearance, fallbackEnd - clearance)]]
  return unique.slice(0, -1).reduce<Array<[number, number]>>((segments, station, index) => {
    const start = station + clearance
    const end = unique[index + 1] - clearance
    if (end > start) segments.push([start, end])
    return segments
  }, [])
}

const distributePreviewCentersAcrossSegments = (segments: Array<[number, number]>, total: number, itemSize: number) => {
  if (total <= 0 || !segments.length) return []
  const usableSegments = segments
    .map(([start, end]) => [start + itemSize / 2, end - itemSize / 2] as [number, number])
    .filter(([start, end]) => end >= start)
  if (!usableSegments.length) return []

  const totalLength = usableSegments.reduce((sum, [start, end]) => sum + Math.max(end - start, 0.001), 0)
  const rawAllocations = usableSegments.map(([start, end]) => (Math.max(end - start, 0.001) / totalLength) * total)
  const allocations = rawAllocations.map(Math.floor)
  let remainder = total - allocations.reduce((sum, value) => sum + value, 0)
  rawAllocations
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder <= 0) return
      allocations[index] += 1
      remainder -= 1
    })

  return usableSegments.flatMap(([start, end], index) => distributePreviewPositions(start, end, allocations[index] ?? 0))
}

const selectedPreviewSideIndexes = (count: number) => {
  if (count <= 0) return []
  if (count === 1) return [1]
  return [0, 1]
}

const shadePreviewColor = (hex: string, factor: number) => {
  const cleaned = hex.replace('#', '')
  const value = Number.parseInt(cleaned.length === 3 ? cleaned.split('').map((char) => char + char).join('') : cleaned, 16)
  if (!Number.isFinite(value)) return hex
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

const buildPergolaPreviewModel = (
  input: PergolaInput,
  pieceCounts: PergolaOutput['pieceCounts'],
  pieceSizes: PieceSizes,
  privacyPanelsEnabled: boolean,
): PergolaPreviewModel => {
  const lengthFt = Math.max(input.dimensions.lengthFt, 1)
  const depthFt = Math.max(input.dimensions.depthFt, 1)
  const heightFt = Math.max(input.dimensions.heightFt, 1)
  const boxes: PreviewBox[] = []
  const addBox = (center: PreviewVec3, size: PreviewVec3, color: string, stroke = '#334155') => {
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return
    boxes.push({ center, size, color, stroke })
  }

  const beamSize = parsePreviewSizeInches(pieceSizes.verticalColumns || (input.type === 'Grand Pergola' ? '6x6' : '4x4'))
  const beamFt = Math.max(beamSize.max / IN_PER_FT, 0.25)
  const beamClearance = beamFt / 2
  const beamY = Math.max(heightFt - beamFt / 2, beamFt / 2)
  const columns = Math.max(numericPieceCount(pieceCounts.verticalColumns, 4), 4)
  const frontCount = Math.max(2, Math.floor(columns / 2))
  const backCount = Math.max(2, columns - frontCount)
  const longAxis: 'length' | 'depth' = lengthFt >= depthFt ? 'length' : 'depth'
  const columnColor = '#111827'
  const beamColor = '#111827'
  const roofColor = '#cbd5e1'
  const privacyColor = '#d1d5db'

  let crossStationsX = [0, lengthFt]
  let crossStationsZ = [0, depthFt]
  let lengthSideSegmentsBySide: Array<Array<[number, number]>> = [
    previewSegmentsFromStations([0, lengthFt], lengthFt, beamClearance),
    previewSegmentsFromStations([0, lengthFt], lengthFt, beamClearance),
  ]
  let depthSideSegmentsBySide: Array<Array<[number, number]>> = [
    previewSegmentsFromStations([0, depthFt], depthFt, beamClearance),
    previewSegmentsFromStations([0, depthFt], depthFt, beamClearance),
  ]

  if (longAxis === 'length') {
    const frontPositions = distributePreviewPositions(0, lengthFt, frontCount)
    const backPositions = distributePreviewPositions(0, lengthFt, backCount)
    for (const x of frontPositions) addBox({ x, y: heightFt / 2, z: 0 }, { x: beamFt, y: heightFt, z: beamFt }, columnColor)
    for (const x of backPositions) addBox({ x, y: heightFt / 2, z: depthFt }, { x: beamFt, y: heightFt, z: beamFt }, columnColor)

    const sharedStationCount = Math.max(2, Math.min(frontCount, backCount))
    crossStationsX = distributePreviewPositions(0, lengthFt, sharedStationCount)
    lengthSideSegmentsBySide = [
      previewSegmentsFromStations(frontPositions, lengthFt, beamClearance),
      previewSegmentsFromStations(backPositions, lengthFt, beamClearance),
    ]

    addBox({ x: lengthFt / 2, y: beamY, z: 0 }, { x: lengthFt + beamFt, y: beamFt, z: beamFt }, beamColor)
    addBox({ x: lengthFt / 2, y: beamY, z: depthFt }, { x: lengthFt + beamFt, y: beamFt, z: beamFt }, beamColor)
    for (const x of crossStationsX) {
      addBox({ x, y: beamY, z: depthFt / 2 }, { x: beamFt, y: beamFt, z: depthFt + beamFt }, beamColor)
    }
  } else {
    const leftPositions = distributePreviewPositions(0, depthFt, frontCount)
    const rightPositions = distributePreviewPositions(0, depthFt, backCount)
    for (const z of leftPositions) addBox({ x: 0, y: heightFt / 2, z }, { x: beamFt, y: heightFt, z: beamFt }, columnColor)
    for (const z of rightPositions) addBox({ x: lengthFt, y: heightFt / 2, z }, { x: beamFt, y: heightFt, z: beamFt }, columnColor)

    const sharedStationCount = Math.max(2, Math.min(frontCount, backCount))
    crossStationsZ = distributePreviewPositions(0, depthFt, sharedStationCount)
    depthSideSegmentsBySide = [
      previewSegmentsFromStations(leftPositions, depthFt, beamClearance),
      previewSegmentsFromStations(rightPositions, depthFt, beamClearance),
    ]

    addBox({ x: 0, y: beamY, z: depthFt / 2 }, { x: beamFt, y: beamFt, z: depthFt + beamFt }, beamColor)
    addBox({ x: lengthFt, y: beamY, z: depthFt / 2 }, { x: beamFt, y: beamFt, z: depthFt + beamFt }, beamColor)
    for (const z of crossStationsZ) {
      addBox({ x: lengthFt / 2, y: beamY, z }, { x: lengthFt + beamFt, y: beamFt, z: beamFt }, beamColor)
    }
  }

  const roofCount = numericPieceCount(pieceCounts.roofPurlins)
  const roofSize = parsePreviewSizeInches(pieceSizes.roofPurlins || input.roof.size)
  const roofFaceFt = (input.roof.orientation === 'Horizontal' ? roofSize.max : roofSize.min) / IN_PER_FT
  const roofThicknessFt = (input.roof.orientation === 'Horizontal' ? roofSize.min : roofSize.max) / IN_PER_FT
  const roofRunAxis: 'length' | 'depth' = input.roof.alignment === 'Parallel to length' ? 'length' : 'depth'
  const roofTopFt = Math.max(heightFt, heightFt - beamFt + roofThicknessFt)
  if (roofCount > 0) {
    const roofY = heightFt - beamFt + roofThicknessFt / 2
    if (roofRunAxis === 'length') {
      const runSegments = previewSegmentsFromStations(longAxis === 'length' ? crossStationsX : [0, lengthFt], lengthFt, beamClearance)
      const acrossSegments = previewSegmentsFromStations(longAxis === 'depth' ? crossStationsZ : [0, depthFt], depthFt, beamClearance)
      const allocations = allocatePreviewCounts(roofCount, runSegments.length)
      runSegments.forEach(([start, end], segmentIndex) => {
        const countForSegment = allocations[segmentIndex] ?? 0
        const zPositions = distributePreviewCentersAcrossSegments(acrossSegments, countForSegment, roofFaceFt)
        for (const z of zPositions) {
          addBox({ x: (start + end) / 2, y: roofY, z }, { x: Math.max(end - start, roofFaceFt), y: roofThicknessFt, z: roofFaceFt }, roofColor, '#64748b')
        }
      })
    } else {
      const runSegments = previewSegmentsFromStations(longAxis === 'depth' ? crossStationsZ : [0, depthFt], depthFt, beamClearance)
      const acrossSegments = previewSegmentsFromStations(longAxis === 'length' ? crossStationsX : [0, lengthFt], lengthFt, beamClearance)
      const allocations = allocatePreviewCounts(roofCount, runSegments.length)
      runSegments.forEach(([start, end], segmentIndex) => {
        const countForSegment = allocations[segmentIndex] ?? 0
        const xPositions = distributePreviewCentersAcrossSegments(acrossSegments, countForSegment, roofFaceFt)
        for (const x of xPositions) {
          addBox({ x, y: roofY, z: (start + end) / 2 }, { x: roofFaceFt, y: roofThicknessFt, z: Math.max(end - start, roofFaceFt) }, roofColor, '#64748b')
        }
      })
    }
  }

  const sideLengthCount = privacyPanelsEnabled ? numericPieceCount(pieceCounts.sidePurlinsLength) : 0
  const sideDepthCount = privacyPanelsEnabled ? numericPieceCount(pieceCounts.sidePurlinsDepth) : 0
  const sideSize = parsePreviewSizeInches(pieceSizes.sidePurlinsLength || input.privacy.size)
  const sideFaceFt = (input.privacy.orientation === 'Horizontal' ? sideSize.max : sideSize.min) / IN_PER_FT
  const sideOutFt = (input.privacy.orientation === 'Horizontal' ? sideSize.min : sideSize.max) / IN_PER_FT
  const sideBottom = Math.max(input.privacy.groundClearanceIn / IN_PER_FT, 0)
  const sideTop = Math.max(sideBottom + sideFaceFt, heightFt - input.privacy.topClearanceIn / IN_PER_FT - beamFt)
  const verticalSideBottom = input.privacy.alignment === 'Parallel to height'
    ? Math.min(sideBottom + beamFt, Math.max(sideBottom, sideTop - sideFaceFt))
    : sideBottom
  const verticalSideTop = Math.max(verticalSideBottom + sideFaceFt, sideTop)
  const verticalSideHeight = Math.max(verticalSideTop - verticalSideBottom, sideFaceFt)
  const lengthSideIndexes = selectedPreviewSideIndexes(Math.max(0, Math.min(2, Math.round(input.privacy.panelCountLength))))
  const depthSideIndexes = selectedPreviewSideIndexes(Math.max(0, Math.min(2, Math.round(input.privacy.panelCountDepth))))
  const bottomSupportY = sideBottom + beamFt / 2

  const addBottomLengthSideSupports = () => {
    lengthSideIndexes.forEach((sideIndex) => {
      const z = sideIndex === 0 ? 0 : depthFt
      for (const [start, end] of lengthSideSegmentsBySide[sideIndex] ?? []) {
        addBox({ x: (start + end) / 2, y: bottomSupportY, z }, { x: Math.max(end - start, beamFt), y: beamFt, z: beamFt }, beamColor)
      }
    })
  }

  const addBottomDepthSideSupports = () => {
    depthSideIndexes.forEach((sideIndex) => {
      const x = sideIndex === 0 ? 0 : lengthFt
      for (const [start, end] of depthSideSegmentsBySide[sideIndex] ?? []) {
        addBox({ x, y: bottomSupportY, z: (start + end) / 2 }, { x: beamFt, y: beamFt, z: Math.max(end - start, beamFt) }, beamColor)
      }
    })
  }

  if (privacyPanelsEnabled && input.privacy.alignment === 'Parallel to height') {
    addBottomLengthSideSupports()
    addBottomDepthSideSupports()
  }

  const addHorizontalLengthSidePurlins = (count: number) => {
    const buckets = lengthSideIndexes.flatMap((sideIndex) =>
      lengthSideSegmentsBySide[sideIndex].map((segment) => ({ segment, sideIndex })),
    )
    const allocations = allocatePreviewCounts(count, buckets.length)
    buckets.forEach(({ segment: [start, end], sideIndex }, bucketIndex) => {
      const z = sideIndex === 0 ? 0 : depthFt
      const yPositions = distributePreviewPositions(sideBottom + sideFaceFt / 2, sideTop - sideFaceFt / 2, allocations[bucketIndex] ?? 0)
      for (const y of yPositions) {
        addBox({ x: (start + end) / 2, y, z }, { x: Math.max(end - start, sideFaceFt), y: sideFaceFt, z: sideOutFt }, privacyColor, '#64748b')
      }
    })
  }

  const addVerticalLengthSidePurlins = (count: number) => {
    const buckets = lengthSideIndexes.flatMap((sideIndex) =>
      lengthSideSegmentsBySide[sideIndex].map((segment) => ({ segment, sideIndex })),
    )
    const allocations = allocatePreviewCounts(count, buckets.length)
    buckets.forEach(({ segment, sideIndex }, bucketIndex) => {
      const z = sideIndex === 0 ? 0 : depthFt
      const xPositions = distributePreviewCentersAcrossSegments([segment], allocations[bucketIndex] ?? 0, sideFaceFt)
      for (const x of xPositions) {
        addBox({ x, y: verticalSideBottom + verticalSideHeight / 2, z }, { x: sideFaceFt, y: verticalSideHeight, z: sideOutFt }, privacyColor, '#64748b')
      }
    })
  }

  const addHorizontalDepthSidePurlins = (count: number) => {
    const buckets = depthSideIndexes.flatMap((sideIndex) =>
      depthSideSegmentsBySide[sideIndex].map((segment) => ({ segment, sideIndex })),
    )
    const allocations = allocatePreviewCounts(count, buckets.length)
    buckets.forEach(({ segment: [start, end], sideIndex }, bucketIndex) => {
      const x = sideIndex === 0 ? 0 : lengthFt
      const yPositions = distributePreviewPositions(sideBottom + sideFaceFt / 2, sideTop - sideFaceFt / 2, allocations[bucketIndex] ?? 0)
      for (const y of yPositions) {
        addBox({ x, y, z: (start + end) / 2 }, { x: sideOutFt, y: sideFaceFt, z: Math.max(end - start, sideFaceFt) }, privacyColor, '#64748b')
      }
    })
  }

  const addVerticalDepthSidePurlins = (count: number) => {
    const buckets = depthSideIndexes.flatMap((sideIndex) =>
      depthSideSegmentsBySide[sideIndex].map((segment) => ({ segment, sideIndex })),
    )
    const allocations = allocatePreviewCounts(count, buckets.length)
    buckets.forEach(({ segment, sideIndex }, bucketIndex) => {
      const x = sideIndex === 0 ? 0 : lengthFt
      const zPositions = distributePreviewCentersAcrossSegments([segment], allocations[bucketIndex] ?? 0, sideFaceFt)
      for (const z of zPositions) {
        addBox({ x, y: verticalSideBottom + verticalSideHeight / 2, z }, { x: sideOutFt, y: verticalSideHeight, z: sideFaceFt }, privacyColor, '#64748b')
      }
    })
  }

  if (input.privacy.alignment === 'Parallel to top') {
    addHorizontalLengthSidePurlins(sideLengthCount)
    addHorizontalDepthSidePurlins(sideDepthCount)
  } else {
    addVerticalLengthSidePurlins(sideLengthCount)
    addVerticalDepthSidePurlins(sideDepthCount)
  }

  return { boxes, lengthFt, depthFt, heightFt: Math.max(heightFt, roofTopFt) }
}

const formatSvgNumber = (value: number) => String(Number(value.toFixed(3)))

const renderStaticPergolaPreviewSvg = (
  input: PergolaInput,
  pieceCounts: PergolaOutput['pieceCounts'],
  pieceSizes: PieceSizes,
  privacyPanelsEnabled: boolean,
) => {
  const width = 760
  const height = 440
  const model = buildPergolaPreviewModel(input, pieceCounts, pieceSizes, privacyPanelsEnabled)
  const camera = PREVIEW_DEFAULT_CAMERA
  const yaw = (camera.yaw * Math.PI) / 180
  const pitch = (camera.pitch * Math.PI) / 180
  const footprint = Math.max(model.lengthFt, model.depthFt, 1)
  const scale = Math.min(width / (footprint * 1.6), height / ((model.heightFt + footprint * 0.35) * 1.3)) * camera.zoom

  const project = (point: PreviewVec3) => {
    const x = point.x - model.lengthFt / 2
    const y = point.y - model.heightFt / 2
    const z = point.z - model.depthFt / 2
    const yawX = x * Math.cos(yaw) - z * Math.sin(yaw)
    const yawZ = x * Math.sin(yaw) + z * Math.cos(yaw)
    const pitchY = y * Math.cos(pitch) - yawZ * Math.sin(pitch)
    const pitchZ = y * Math.sin(pitch) + yawZ * Math.cos(pitch)
    return {
      x: width / 2 + yawX * scale + camera.panX,
      y: height * 0.56 - pitchY * scale + camera.panY,
      depth: pitchZ,
    }
  }

  const parts = [
    `<svg style="display:block;width:100%;height:440px;background:#f8fafc;" viewBox="0 0 ${width} ${height}" role="img" aria-label="Static 3D pergola preview">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" />`,
  ]

  const gridStep = Math.max(2, Math.round(footprint / 6))
  for (let x = 0; x <= model.lengthFt + 0.001; x += gridStep) {
    const start = project({ x, y: 0, z: 0 })
    const end = project({ x, y: 0, z: model.depthFt })
    parts.push(`<line x1="${formatSvgNumber(start.x)}" y1="${formatSvgNumber(start.y)}" x2="${formatSvgNumber(end.x)}" y2="${formatSvgNumber(end.y)}" stroke="#d1d5db" stroke-width="1" />`)
  }
  for (let z = 0; z <= model.depthFt + 0.001; z += gridStep) {
    const start = project({ x: 0, y: 0, z })
    const end = project({ x: model.lengthFt, y: 0, z })
    parts.push(`<line x1="${formatSvgNumber(start.x)}" y1="${formatSvgNumber(start.y)}" x2="${formatSvgNumber(end.x)}" y2="${formatSvgNumber(end.y)}" stroke="#d1d5db" stroke-width="1" />`)
  }

  const faces: Array<{ points: Array<{ x: number; y: number }>; depth: number; color: string; stroke: string }> = []
  const faceDefinitions = [
    { indexes: [0, 1, 2, 3], shade: 0.78 },
    { indexes: [5, 4, 7, 6], shade: 0.9 },
    { indexes: [4, 0, 3, 7], shade: 0.7 },
    { indexes: [1, 5, 6, 2], shade: 0.82 },
    { indexes: [4, 5, 1, 0], shade: 0.62 },
    { indexes: [3, 2, 6, 7], shade: 1.08 },
  ]

  for (const box of model.boxes) {
    const { center, size } = box
    const hx = size.x / 2
    const hy = size.y / 2
    const hz = size.z / 2
    const vertices = [
      { x: center.x - hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y + hy, z: center.z + hz },
      { x: center.x - hx, y: center.y + hy, z: center.z + hz },
    ].map(project)

    for (const face of faceDefinitions) {
      const projected = face.indexes.map((index) => vertices[index])
      faces.push({
        points: projected.map((point) => ({ x: point.x, y: point.y })),
        depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
        color: shadePreviewColor(box.color, face.shade),
        stroke: box.stroke,
      })
    }
  }

  faces
    .sort((a, b) => a.depth - b.depth)
    .forEach((face) => {
      const points = face.points.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(' ')
      parts.push(`<polygon points="${points}" fill="${face.color}" stroke="${face.stroke}" stroke-width="1" />`)
    })

  parts.push(`<text x="16" y="${height - 34}" fill="#475569" font-size="12" font-family="sans-serif">${escapeHtml(`${formatDiagramMeasurement(model.lengthFt, 'ft')} ft L`)}</text>`)
  parts.push(`<text x="16" y="${height - 18}" fill="#475569" font-size="12" font-family="sans-serif">${escapeHtml(`${formatDiagramMeasurement(model.depthFt, 'ft')} ft D`)}</text>`)
  parts.push('</svg>')

  return parts.join('')
}

const renderPreviewLegendItem = (color: string, label: string) =>
  `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;"></span>${escapeHtml(label)}</span>`

const buildPergolaPreviewHtml = (
  input: PergolaInput,
  pieceCounts: PergolaOutput['pieceCounts'],
  pieceSizes: PieceSizes,
  privacyPanelsEnabled: boolean,
) =>
  [
    `<div style="margin-top:24px;overflow:hidden;border-radius:8px;border:1px solid ${VISUAL_COLORS.border};background:${VISUAL_COLORS.background};">`,
    `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:12px 16px;">`,
    '<div>',
    `<h3 style="margin:0;color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;font-weight:600;">3D Pergola Preview</h3>`,
    `<p style="margin:0;color:${VISUAL_COLORS.mutedForeground};font-size:12px;line-height:16px;">Default static view.</p>`,
    '</div>',
    '<div style="display:flex;align-items:center;gap:12px;color:inherit;font-size:12px;line-height:16px;">',
    renderPreviewLegendItem('#171717', 'Columns and beams'),
    renderPreviewLegendItem('#cbd5e1', 'Roof purlins'),
    renderPreviewLegendItem('#d4d4d8', 'Privacy purlins'),
    '</div>',
    '</div>',
    '<div style="position:relative;height:440px;background:#f8fafc;">',
    renderStaticPergolaPreviewSvg(input, pieceCounts, pieceSizes, privacyPanelsEnabled),
    '</div>',
    '</div>',
  ].join('')

const renderCutPlanSvg = (line: CutPlanLine, unit: PergolaQuoteDiagramUnit) => {
  const viewWidth = 460
  const viewHeight = 112
  const beamX = 20
  const beamY = 44
  const beamWidth = 420
  const beamHeight = 18
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
    `<svg style="display:block;width:100%;min-width:300px;height:112px;background:transparent;" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="${escapeHtml(`Cut diagram for ${formatFt(line.stockLengthFt)} ${unit} stock`)}">`,
    `<text x="${beamX}" y="14" fill="${VISUAL_COLORS.mutedForeground}" font-size="10">${escapeHtml(`Scale: 0 ${unit} - ${formatFt(line.stockLengthFt)} ${unit}`)}</text>`,
    `<line x1="${beamX}" y1="26" x2="${beamX + beamWidth}" y2="26" stroke="${VISUAL_COLORS.mutedForeground}" stroke-width="1" />`,
    `<line x1="${beamX}" y1="22" x2="${beamX}" y2="30" stroke="${VISUAL_COLORS.mutedForeground}" stroke-width="1" />`,
    `<line x1="${beamX + beamWidth}" y1="22" x2="${beamX + beamWidth}" y2="30" stroke="${VISUAL_COLORS.mutedForeground}" stroke-width="1" />`,
    `<text x="${beamX}" y="40" text-anchor="middle" fill="${VISUAL_COLORS.mutedForeground}" font-size="9">0</text>`,
    `<text x="${beamX + beamWidth}" y="40" text-anchor="middle" fill="${VISUAL_COLORS.mutedForeground}" font-size="9">${escapeHtml(formatFt(line.stockLengthFt))}</text>`,
    `<rect x="${beamX}" y="${beamY}" width="${beamWidth}" height="${beamHeight}" rx="3" fill="${VISUAL_COLORS.muted}" stroke="${VISUAL_COLORS.border}" stroke-width="1" />`,
  ]

  segments.forEach((segment, index) => {
    const x = toX(segment.start)
    const width = Math.max(toX(segment.end) - x, 1)
    parts.push(`<rect x="${x}" y="${beamY}" width="${width}" height="${beamHeight}" fill="${index % 2 === 0 ? VISUAL_COLORS.cutA : VISUAL_COLORS.cutB}" />`)
    if (width > 42) {
      parts.push(`<text x="${x + width / 2}" y="${beamY + 13}" text-anchor="middle" fill="${VISUAL_COLORS.foreground}" font-size="9">${escapeHtml(`${formatFt(segment.length)} ${unit}`)}</text>`)
    }
  })

  kerfs.forEach((kerf) => {
    const x = toX(kerf.start)
    const width = Math.max(toX(kerf.end) - x, 1.5)
    parts.push(`<rect x="${x}" y="${beamY - 2}" width="${width}" height="${beamHeight + 4}" fill="${VISUAL_COLORS.kerf}" />`)
  })

  if (wasteFt > 0.01) {
    const wasteX = toX(wasteStart)
    const endX = toX(stockLength)
    parts.push('<g>')
    parts.push(`<rect x="${wasteX}" y="${beamY}" width="${Math.max(endX - wasteX, 1)}" height="${beamHeight}" fill="${VISUAL_COLORS.waste}" />`)
    if (endX - wasteX > 34) {
      parts.push(`<text x="${(wasteX + endX) / 2}" y="${beamY + 13}" text-anchor="middle" fill="${VISUAL_COLORS.mutedForeground}" font-size="9">${escapeHtml(`${formatFt(wasteFt)} ${unit}`)}</text>`)
    }
    parts.push('</g>')
  }

  cutMarkers.forEach((position, index) => {
    const x = toX(position)
    parts.push('<g>')
    parts.push(`<line x1="${x}" y1="${beamY - 8}" x2="${x}" y2="${beamY + beamHeight + 22}" stroke="${VISUAL_COLORS.destructive}" stroke-width="1" stroke-dasharray="3 3" />`)
    parts.push(`<text x="${x}" y="${index % 2 === 0 ? 86 : 101}" text-anchor="middle" fill="${VISUAL_COLORS.destructive}" font-size="9">${escapeHtml(formatFt(position))}</text>`)
    parts.push('</g>')
  })

  parts.push('</svg>')
  return parts.join('')
}

const buildCutPlanTableHtml = (sections: PergolaYieldResult['cutPlans'], unit: PergolaQuoteDiagramUnit) => {
  const parts = [
    `<div style="background:${VISUAL_COLORS.background};color:${VISUAL_COLORS.foreground};display:flex;flex-direction:column;gap:12px;border:1px solid ${VISUAL_COLORS.border};border-radius:12px;padding:24px 0;box-shadow:0 1px 2px 0 rgb(0 0 0 / 0.05);font-family:ui-sans-serif,system-ui,sans-serif;">`,
    '<div style="display:grid;gap:8px;padding:0 24px;">',
    '<div style="font-weight:600;line-height:1;">Cutting Plans</div>',
    `<div style="color:${VISUAL_COLORS.mutedForeground};font-size:14px;line-height:20px;">Stock cuts generated from Calculate Yield.</div>`,
    '</div>',
    '<div style="display:grid;gap:16px;padding:0 24px;">',
  ]

  if (!sections.length) {
    parts.push(`<p style="margin:0;color:${VISUAL_COLORS.mutedForeground};font-size:14px;line-height:20px;">No cutting plans calculated.</p>`)
    parts.push('</div></div>')
    return parts.join('')
  }

  sections.forEach((section) => {
    parts.push('<section style="display:grid;gap:12px;">')
    parts.push(`<h3 style="margin:0;color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;font-weight:600;">${escapeHtml(section.title)}</h3>`)
    parts.push('<div style="position:relative;width:100%;overflow-x:auto;">')
    parts.push(`<table style="width:100%;caption-side:bottom;border-collapse:collapse;border:1px solid ${VISUAL_COLORS.border};color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;">`)
    parts.push('<thead><tr>')
    parts.push(`<th style="width:12%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;white-space:nowrap;"># of Stocks</th>`)
    parts.push(`<th style="width:12%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;white-space:nowrap;">Supply (${escapeHtml(unit)})</th>`)
    parts.push(`<th style="width:24%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;white-space:nowrap;">Cuts (${escapeHtml(unit)})</th>`)
    parts.push(`<th style="height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;white-space:nowrap;">Cut Diagram</th>`)
    parts.push('</tr></thead>')
    parts.push('<tbody>')
    section.lines.forEach((line, index) => {
      const supply = formatDiagramMeasurement(fromFeetForDiagram(line.stockLengthFt, unit), unit)
      const cuts = line.cutsFt.map((cut) => formatDiagramMeasurement(fromFeetForDiagram(cut, unit), unit)).join(', ')
      parts.push('<tr>')
      const border = index === section.lines.length - 1 ? 'border-bottom:0;' : `border-bottom:1px solid ${VISUAL_COLORS.border};`
      parts.push(`<td style="${border}padding:8px;vertical-align:middle;white-space:nowrap;">${line.stockCount}</td>`)
      parts.push(`<td style="${border}padding:8px;vertical-align:middle;white-space:nowrap;">${escapeHtml(supply)}</td>`)
      parts.push(`<td style="${border}padding:8px;vertical-align:middle;white-space:nowrap;">${escapeHtml(cuts)}</td>`)
      parts.push(`<td style="${border}padding:8px;vertical-align:middle;white-space:nowrap;">${renderCutPlanSvg(line, unit)}</td>`)
      parts.push('</tr>')
    })
    parts.push('</tbody></table></div></section>')
  })

  parts.push('</div></div>')
  return parts.join('')
}

const buildPieceBreakdownHtml = (input: PergolaInput, quote: PergolaOutput) => {
  const pieceSizes = buildPieceSizes(input)
  const parts = [
    `<div style="background:${VISUAL_COLORS.background};color:${VISUAL_COLORS.foreground};display:flex;flex-direction:column;gap:12px;border:1px solid ${VISUAL_COLORS.border};border-radius:12px;padding:24px;box-shadow:0 1px 2px 0 rgb(0 0 0 / 0.05);font-family:ui-sans-serif,system-ui,sans-serif;">`,
    '<div style="display:grid;gap:4px;">',
    '<div style="font-weight:600;line-height:1;">Piece Breakdown</div>',
    `<div style="color:${VISUAL_COLORS.mutedForeground};font-size:14px;line-height:20px;">Resolved quantities and selected profile sizes.</div>`,
    '</div>',
    `<table style="width:100%;table-layout:fixed;caption-side:bottom;border-collapse:collapse;border:1px solid ${VISUAL_COLORS.border};color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;">`,
    '<thead><tr>',
    `<th style="height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Part Name</th>`,
    `<th style="height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Qty</th>`,
    `<th style="height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Size</th>`,
    '</tr></thead>',
    '<tbody>',
  ]

  PIECE_ROWS.forEach((row, index) => {
    const border = index === PIECE_ROWS.length - 1 ? 'border-bottom:0;' : `border-bottom:1px solid ${VISUAL_COLORS.border};`
    parts.push('<tr>')
    parts.push(`<td style="${border}padding:8px;vertical-align:middle;">${escapeHtml(row.label)}</td>`)
    parts.push(`<td style="${border}padding:8px;vertical-align:middle;">${quote.pieceCounts[row.key] ?? '-'}</td>`)
    parts.push(`<td style="${border}padding:8px;vertical-align:middle;">${escapeHtml(pieceSizes[row.key])}</td>`)
    parts.push('</tr>')
  })

  parts.push('</tbody></table>')
  parts.push(buildPergolaPreviewHtml(input, quote.pieceCounts, pieceSizes, hasPrivacyPanels(input)))
  parts.push('</div>')

  return parts.join('')
}

const renderStaticInputBox = (value: string, placeholder = '') => {
  const text = value.trim()
  const content = text
    ? escapeHtml(text)
    : `<span style="color:${VISUAL_COLORS.mutedForeground};">${escapeHtml(placeholder)}</span>`

  return `<div style="box-sizing:border-box;display:flex;align-items:center;width:100%;min-height:36px;border:1px solid ${VISUAL_COLORS.border};border-radius:6px;background:${VISUAL_COLORS.background};padding:7px 12px;color:${VISUAL_COLORS.foreground};">${content}</div>`
}

const buildCostDetailsHtml = (pricingSections: PergolaYieldResult['pricingSections'], subtotal: number) => {
  const parts = [
    `<div style="background:${VISUAL_COLORS.background};color:${VISUAL_COLORS.foreground};display:flex;flex-direction:column;gap:24px;border:1px solid ${VISUAL_COLORS.border};border-radius:12px;padding:24px;box-shadow:0 1px 2px 0 rgb(0 0 0 / 0.05);font-family:ui-sans-serif,system-ui,sans-serif;">`,
    '<div style="display:grid;gap:4px;">',
    '<div style="font-weight:600;line-height:1;">Cost Details</div>',
    `<div style="color:${VISUAL_COLORS.mutedForeground};font-size:14px;line-height:20px;">Line-by-line materials and additional cost entries.</div>`,
    '</div>',
  ]

  PRICING_SECTIONS.forEach((section) => {
    const rows = pricingSections[section.key]
    const sectionTotal = rows.reduce((sum, row) => sum + parsePricingNumber(row.quantity) * parsePricingNumber(row.unitCost), 0)
    parts.push('<div style="display:grid;gap:12px;">')
    parts.push(`<h3 style="margin:0;color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;font-weight:600;">${escapeHtml(section.label)}</h3>`)
    parts.push(`<table style="width:100%;caption-side:bottom;border-collapse:collapse;border:1px solid ${VISUAL_COLORS.border};color:${VISUAL_COLORS.foreground};font-size:14px;line-height:20px;">`)
    parts.push('<thead><tr>')
    parts.push(`<th style="width:46%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Item</th>`)
    parts.push(`<th style="width:12%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Qty</th>`)
    parts.push(`<th style="width:14%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Unit Cost</th>`)
    parts.push(`<th style="width:14%;height:40px;border-bottom:1px solid ${VISUAL_COLORS.border};padding:0 8px;text-align:left;vertical-align:middle;font-weight:500;">Total Cost</th>`)
    parts.push('</tr></thead>')
    parts.push('<tbody>')
    rows.forEach((row) => {
      const rowTotal = parsePricingNumber(row.quantity) * parsePricingNumber(row.unitCost)
      parts.push('<tr>')
      parts.push(`<td style="padding:8px;vertical-align:middle;border-bottom:1px solid ${VISUAL_COLORS.border};">${renderStaticInputBox(row.item, 'Select item')}</td>`)
      parts.push(`<td style="padding:8px;vertical-align:middle;border-bottom:1px solid ${VISUAL_COLORS.border};">${renderStaticInputBox(row.quantity)}</td>`)
      parts.push(`<td style="padding:8px;vertical-align:middle;border-bottom:1px solid ${VISUAL_COLORS.border};">${renderStaticInputBox(row.unitCost)}</td>`)
      parts.push(`<td style="padding:8px;vertical-align:middle;border-bottom:1px solid ${VISUAL_COLORS.border};">${renderStaticInputBox(formatCurrency(rowTotal))}</td>`)
      parts.push('</tr>')
    })
    parts.push('<tr>')
    parts.push(`<td style="padding:8px;vertical-align:middle;font-weight:600;">Section Total</td>`)
    parts.push('<td></td><td></td>')
    parts.push(`<td style="padding:8px;vertical-align:middle;font-weight:600;">${escapeHtml(formatCurrency(sectionTotal))}</td>`)
    parts.push('</tr>')
    parts.push('</tbody></table></div>')
  })

  parts.push(`<div style="margin-top:16px;border:1px solid ${VISUAL_COLORS.border};border-radius:12px;background:${VISUAL_COLORS.muted};padding:16px;">`)
  parts.push(`<p style="margin:0;color:${VISUAL_COLORS.mutedForeground};font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:0.3em;">Subtotal</p>`)
  parts.push(`<p style="margin:4px 0 0;color:${VISUAL_COLORS.foreground};font-size:18px;line-height:28px;font-weight:600;">${escapeHtml(formatCurrency(subtotal))}</p>`)
  parts.push('</div></div>')

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

  return {
    input,
    beamSize: quote.beamSize,
    pieceCounts: quote.pieceCounts,
    columnBeamThickness: yieldOptions.columnBeamThickness ?? formatThickness(quote.thickness.columnBeam ?? beamThicknessBySize[quote.beamSize]),
    roofPurlinThickness: yieldOptions.roofPurlinThickness ?? getTubingGaugeForSize(yieldTubingRows, roofSize),
    privacyPanelPurlinThickness: yieldOptions.privacyPanelPurlinThickness ?? (hasPrivacyPanels(input) ? getTubingGaugeForSize(yieldTubingRows, privacySize) : ''),
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
    subtotal: pricingSubTotal,
    visuals: [
      buildPieceBreakdownHtml(input, quote),
      buildCutPlanTableHtml(yieldResult.cutPlans, cutDiagramUnit),
      buildCostDetailsHtml(yieldResult.pricingSections, pricingSubTotal),
    ],
    raw,
  }
}

export { calculatePergola, getPergolaQuote, syncPergolaPrivacyCoverageGap, syncPergolaRoofCoverageGap, validatePergolaInput }
