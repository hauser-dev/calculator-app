import { beamThicknessBySize, connectorRows, endCapRows, settingsSizes, tubingRows } from './pergolaData.ts'
import { DEFAULT_GRAND_THRESHOLD_FT, DEFAULT_PIECES_IN_GROUP, FT_TO_IN, MEDIUM_PIECE_MAX, SMALL_PIECE_MAX } from './quoteConstants.ts'
import { parseDimension } from './quoteParser.ts'
import { round2, safeToNumber, toFeetFromInches, toInchesFromFeet } from './quoteUtils.ts'
import type {
  BeamSize,
  CoverageSource,
  MaterialType,
  QuoteEnginePrivateState,
  QuoteEngineState,
  QuoteFieldChange,
  SideAlignment,
  SideOrientation,
  RoofAlignment,
  RoofOrientation,
} from './quoteSchema.ts'

const THRESHOLD = DEFAULT_GRAND_THRESHOLD_FT
const PIECE_GROUP = DEFAULT_PIECES_IN_GROUP

const clone = <T>(value: T): T => structuredClone(value)
const normalize = (value: string) => value.trim().toLowerCase()

const asInches = (value: { ft: number; in: number }) => round2(safeToNumber(value.ft) * FT_TO_IN + safeToNumber(value.in))
const beamThickness = (size: string) => {
  const parsed = parseDimension(size)
  return parsed.valid ? parsed.max : 0
}

const setPrivateSync = (state: QuoteEngineState, field: QuoteFieldChange): QuoteEnginePrivateState => {
  const next = clone(state.private ?? {}) as QuoteEnginePrivateState
  // Track whether gap or coverage was the last user-edited side so derived
  // values can flow in the expected direction.
  if (field === 'roofPurlins.gapIn') next.lastRoofSync = 'gap'
  if (field === 'roofPurlins.coveragePct') next.lastRoofSync = 'coverage'
  if (field === 'sidePurlins.gapIn') next.lastSideSync = 'gap'
  if (field === 'sidePurlins.coveragePct') next.lastSideSync = 'coverage'
  return next
}

const roofUsableSpan = (state: QuoteEngineState) => {
  const beam = beamThickness(state.beam.size)
  const roofSpanAxis = state.roofPurlins.alignment === 'Parallel to length' ? state.pergola.dimensions.depth : state.pergola.dimensions.length
  return Math.max(round2(safeToNumber(roofSpanAxis.ft) * FT_TO_IN) - 2 * beam, 0)
}

const roofPurlinWidth = (state: QuoteEngineState) => {
  const custom = parseDimension(state.roofPurlins.customSize)
  const parsed = custom.valid ? custom : parseDimension(state.roofPurlins.size)
  if (!parsed.valid) return 0
  return state.roofPurlins.orientation === 'Horizontal' ? parsed.max : parsed.min
}

const sideUsableSpan = (state: QuoteEngineState, axis: 'length' | 'depth') => {
  const width = parseDimension(state.sidePurlins.customSize).valid
    ? parseDimension(state.sidePurlins.customSize)
    : parseDimension(state.sidePurlins.size)
  if (!width.valid) return 0

  const beam = beamThickness(state.beam.size)
  if (state.sidePurlins.alignment === 'Parallel to top') {
    const height = round2(safeToNumber(state.pergola.dimensions.height.ft) * FT_TO_IN)
    return Math.max(height - beam - state.sidePurlins.groundClearanceIn - state.sidePurlins.topClearanceIn, 0)
  }

  const spanAxis = axis === 'length' ? state.pergola.dimensions.length : state.pergola.dimensions.depth
  return Math.max(round2(safeToNumber(spanAxis.ft) * FT_TO_IN) - 2 * beam, 0)
}

const sideSyncUsableSpan = (state: QuoteEngineState) => {
  if (state.sidePurlins.alignment === 'Parallel to top') return sideUsableSpan(state, 'length')
  if (state.sidePurlins.alignment === 'Parallel to height') return sideUsableSpan(state, 'length')
  return sideUsableSpan(state, 'depth')
}

const requiredSidePurlins = (state: QuoteEngineState, axis: 'length' | 'depth') => {
  const span = sideUsableSpan(state, axis)
  const width = sidePurlinWidth(state)
  const enabled = axis === 'length' ? state.sidePurlins.countOnLength : state.sidePurlins.countOnDepth
  if (!enabled || span <= 0 || width <= 0) return 0
  return Math.ceil(span * (Math.max(0, safeToNumber(state.sidePurlins.coveragePct)) / 100) / width)
}

const sidePurlinWidth = (state: QuoteEngineState) => {
  const custom = parseDimension(state.sidePurlins.customSize)
  const parsed = custom.valid ? custom : parseDimension(state.sidePurlins.size)
  if (!parsed.valid) return 0
  return state.sidePurlins.orientation === 'Horizontal' ? parsed.max : parsed.min
}

type PurlinCoverageGapResult = {
  coveragePct: number
  gapIn: number
  purlinsRequired: number
}

const computePurlinCoverageGapValues = (
  widthIn: number,
  usableSpanIn: number,
  coveragePct: number,
  gapIn: number,
  source: CoverageSource,
  clampCoverageFromGap: boolean,
): PurlinCoverageGapResult => {
  const width = safeToNumber(widthIn, 0)
  const usable = safeToNumber(usableSpanIn, 0)

  if (width <= 0 || usable <= 0) {
    return { coveragePct: 0, gapIn: 0, purlinsRequired: 0 }
  }

  if (source === 'gap') {
    const gap = safeToNumber(gapIn, 0)
    const spacing = width + gap

    if (spacing <= 0) {
      return { coveragePct: 0, gapIn: gap, purlinsRequired: 0 }
    }

    const purlinsRequired = Math.ceil(usable / spacing)
    if (purlinsRequired <= 0) {
      return { coveragePct: 0, gapIn: gap, purlinsRequired: 0 }
    }

    return {
      coveragePct: round2(Math.min((purlinsRequired * width / usable) * 100, clampCoverageFromGap ? 100 : Number.POSITIVE_INFINITY)),
      gapIn: gap,
      purlinsRequired,
    }
  }

  const coverage = safeToNumber(coveragePct, 0)
  const coverageRatio = coverage / 100

  if (coverageRatio <= 0) {
    return { coveragePct: round2(coverage), gapIn: 0, purlinsRequired: 0 }
  }

  const purlinsRequired = Math.max(Math.ceil((usable * coverageRatio) / width), 1)
  const spacing = usable / purlinsRequired

  return {
    coveragePct: round2(coverage),
    gapIn: round2(Math.max(spacing - width, 0)),
    purlinsRequired,
  }
}

export type RoofCoverageGapResult = PurlinCoverageGapResult
export type SideCoverageGapResult = PurlinCoverageGapResult

export const computeRoofCoverageGapValues = (
  widthIn: number,
  usableSpanIn: number,
  coveragePct: number,
  gapIn: number,
  source: CoverageSource,
): RoofCoverageGapResult => computePurlinCoverageGapValues(widthIn, usableSpanIn, coveragePct, gapIn, source, false)

export const computeSideCoverageGapValues = (
  widthIn: number,
  usableSpanIn: number,
  coveragePct: number,
  gapIn: number,
  source: CoverageSource,
): SideCoverageGapResult => computePurlinCoverageGapValues(widthIn, usableSpanIn, coveragePct, gapIn, source, true)
const availableRoofSizes = (state: QuoteEngineState) => {
  const beam = beamThickness(state.beam.size)
  const material = normalize(state.roofPurlins.materialType)
  const orientation = normalize(state.roofPurlins.orientation)
  const custom = normalize(state.roofPurlins.customSize)

  const pool =
    material === 'cedar'
      ? [...settingsSizes]
      : settingsSizes.filter((row) =>
          orientation === 'vertical'
            ? row.largeSide <= beam
            : row.smallSide <= beam,
        )

  const filtered = state.beam.size === '6x6' ? pool.filter((row) => row.size !== '1x3') : pool
  const values = filtered.map((row) => row.size)
  const parsedCustom = parseDimension(custom)
  const validCustom = parsedCustom.valid
    ? material === 'cedar'
      ? true
      : orientation === 'vertical'
        ? parsedCustom.max <= beam
        : parsedCustom.min <= beam
    : false

  if (validCustom && !values.includes(custom)) values.push(custom)
  return values
}

const availableSideSizes = (state: QuoteEngineState) => {
  const beam = beamThickness(state.beam.size)
  const material = normalize(state.sidePurlins.materialType)
  const orientation = normalize(state.sidePurlins.orientation)
  const custom = normalize(state.sidePurlins.customSize)

  const pool =
    material === 'cedar'
      ? [...settingsSizes]
      : settingsSizes.filter((row) =>
          orientation === 'horizontal'
            ? Math.min(row.smallSide, row.largeSide) <= beam
            : Math.max(row.smallSide, row.largeSide) <= beam,
        )

  const filtered = state.beam.size === '6x6' ? pool.filter((row) => row.size !== '1x3') : pool
  const values = filtered.map((row) => row.size)
  const parsedCustom = parseDimension(custom)
  const validCustom = parsedCustom.valid
    ? material === 'cedar'
      ? true
      : orientation === 'horizontal'
        ? parsedCustom.min <= beam
        : parsedCustom.max <= beam
    : false

  if (validCustom && !values.includes(custom)) values.push(custom)
  return values
}

const applyAvailability = (state: QuoteEngineState) => {
  const next = clone(state)
  next.availableRoofSizes = availableRoofSizes(next)
  next.availableSideSizes = availableSideSizes(next)

  // If the currently selected size is no longer valid under new constraints,
  // snap to the first available option to keep the state calculable.
  if (next.availableRoofSizes.length && !next.availableRoofSizes.includes(next.roofPurlins.size)) {
    next.roofPurlins.size = next.availableRoofSizes[0] ?? '2x4'
  }

  if (next.availableSideSizes.length && !next.availableSideSizes.includes(next.sidePurlins.size)) {
    next.sidePurlins.size = next.availableSideSizes[0] ?? '2x4'
  }

  return next
}

const applyCustomSizeOverride = (state: QuoteEngineState) => {
  const next = clone(state)

  if (next.roofPurlins.materialType === 'Cedar') {
    next.roofPurlins.customSize = '1.5x5.5'
    next.roofPurlins.size = '1.5x5.5'
  }

  if (next.sidePurlins.materialType === 'Cedar') {
    next.sidePurlins.customSize = '1.5x5.5'
    next.sidePurlins.size = '1.5x5.5'
  }

  return next
}

const applyNoPrivacy = (state: QuoteEngineState) => {
  const next = clone(state)
  next.sidePurlins = {
    ...next.sidePurlins,
    materialType: 'Aluminum',
    orientation: 'Horizontal',
    size: '2x4',
    customSize: '',
    alignment: 'Parallel to top',
    countOnLength: 0,
    countOnDepth: 0,
    groundClearanceIn: 0,
    topClearanceIn: 0,
    coveragePct: 0,
    gapIn: 0,
  }

  next.privacyPanels = {
    countOnLength: 0,
    countOnDepth: 0,
    groundClearanceIn: 0,
    topClearanceIn: 0,
  }

  return next
}

const applySuggestedType = (state: QuoteEngineState) => {
  const next = clone(state)
  const dims = next.pergola.dimensions
  const biggest = Math.max(dims.length.ft, dims.depth.ft, dims.height.ft)
  next.suggestedType = biggest >= THRESHOLD ? 'Grand Pergola' : 'Pergola'
  next.beam.size = next.suggestedType === 'Grand Pergola' ? '6x6' : '4x4'
  return next
}

export const computeCoverageGapRoof = (state: QuoteEngineState): QuoteEngineState => {
  const next = clone(state)
  const span = roofUsableSpan(next)
  const width = roofPurlinWidth(next)
  const synced = computeRoofCoverageGapValues(
    width,
    span,
    next.roofPurlins.coveragePct,
    next.roofPurlins.gapIn,
    next.private?.lastRoofSync ?? 'coverage',
  )

  next.roofPurlinsRequired = synced.purlinsRequired
  next.roofPurlins.coveragePct = synced.coveragePct
  next.roofPurlins.gapIn = synced.gapIn
  return next
}

export const computeCoverageGapSide = (state: QuoteEngineState): QuoteEngineState => {
  const next = clone(state)
  const width = sidePurlinWidth(next)
  const syncSpan = sideSyncUsableSpan(next)
  const synced = computeSideCoverageGapValues(
    width,
    syncSpan,
    next.sidePurlins.coveragePct,
    next.sidePurlins.gapIn,
    next.private?.lastSideSync ?? 'coverage',
  )

  next.sidePurlins.coveragePct = synced.coveragePct
  next.sidePurlins.gapIn = synced.gapIn
  next.sidePurlinsLengthRequired = requiredSidePurlins(next, 'length')
  next.sidePurlinsDepthRequired = requiredSidePurlins(next, 'depth')
  return next
}
export const computePieceBreakdown = (state: QuoteEngineState): QuoteEngineState => {
  const next = clone(state)
  const columns = Math.round(safeToNumber(next.pieces.verticalColumns.qty, 4))
  const extra = Math.max(columns - 4, 0)
  const extraPairs = columns > 4 ? Math.trunc((columns - 4) / 2) : 0
  const factor = Math.trunc(extra / 2) + 1

  const roofReq = safeToNumber(next.roofPurlinsRequired, 0)
  const sideLengthReq = safeToNumber(next.sidePurlinsLengthRequired, 0)
  const sideDepthReq = safeToNumber(next.sidePurlinsDepthRequired, 0)
  const sideLengthPanels = Math.round(safeToNumber(next.sidePurlins.countOnLength, 0))
  const sideDepthPanels = Math.round(safeToNumber(next.sidePurlins.countOnDepth, 0))

  const beamsLength =
    2 +
    (next.sidePurlins.alignment === 'Parallel to height' ? sideLengthPanels * factor : 0) +
    extra

  const beamsDepth =
    next.sidePurlins.alignment === 'Parallel to height'
      ? 2 + sideDepthPanels + extraPairs
      : 2 + extraPairs

  const roofPurlinsQty =
    next.roofPurlins.alignment === 'Parallel to length'
      ? (Math.trunc(columns / 2) - 1) * roofReq
      : next.roofPurlins.alignment === 'Parallel to depth'
        ? roofReq - Math.trunc((columns - 4) / 2)
        : roofReq

  const sideLengthQty =
    next.sidePurlins.alignment === 'Parallel to top'
      ? sideLengthPanels * (Math.trunc(columns / 2) - 1) * sideLengthReq
      : next.sidePurlins.alignment === 'Parallel to height'
        ? sideLengthPanels * (sideLengthReq - Math.trunc((columns - 4) / 2))
        : sideLengthReq

  const sideDepthQty = sideDepthPanels * sideDepthReq

  const standardBlocks = columns <= 4 ? 2 * columns : 8 + (columns - 4) * 3
  const columnAccessories = Math.max(columns, 0)

  next.pieces = {
    verticalColumns: { qty: columnAccessories },
    beamsOnLength: { qty: Math.max(beamsLength, 0) },
    beamsOnDepth: { qty: Math.max(beamsDepth, 0) },
    roofPurlins: { qty: Math.max(roofPurlinsQty, 0) },
    sidePurlinsOnLength: { qty: Math.max(sideLengthQty, 0) },
    sidePurlinsOnDepth: { qty: Math.max(sideDepthQty, 0) },
    standardBlocks: { qty: Math.max(standardBlocks, 0) },
    feet: { qty: columnAccessories },
    endCaps: { qty: columnAccessories },
    canopies: { qty: columnAccessories },
  }

  next.columnBeamThickness = beamThicknessBySize[next.beam.size] ?? null

  const roof = parseDimension(next.roofPurlins.customSize).valid
    ? parseDimension(next.roofPurlins.customSize)
    : parseDimension(next.roofPurlins.size)
  const side = parseDimension(next.sidePurlins.customSize).valid
    ? parseDimension(next.sidePurlins.customSize)
    : parseDimension(next.sidePurlins.size)

  next.roofPurlinThickness = roof.valid ? roof.max : 0
  next.sidePurlinThickness = side.valid ? side.max : 0

  return next
}

const grouped = (count: number) => (count <= 0 ? 0 : Math.ceil(count / PIECE_GROUP) * PIECE_GROUP)

const pieceSummary = (state: QuoteEngineState) => {
  const entries: Array<{ lengthIn: number; qty: number }> = [
    { lengthIn: asInches(state.pergola.dimensions.height), qty: state.pieces.verticalColumns.qty },
    { lengthIn: asInches(state.pergola.dimensions.length), qty: state.pieces.beamsOnLength.qty },
    { lengthIn: asInches(state.pergola.dimensions.depth), qty: state.pieces.beamsOnDepth.qty },
    { lengthIn: roofUsableSpan(state), qty: grouped(state.pieces.roofPurlins.qty) },
    { lengthIn: sideUsableSpan(state, 'length'), qty: grouped(state.pieces.sidePurlinsOnLength.qty) },
    { lengthIn: sideUsableSpan(state, 'depth'), qty: grouped(state.pieces.sidePurlinsOnDepth.qty) },
  ]

  const total = {
    smallPiecesInches: 0,
    mediumPiecesInches: 0,
    largePiecesInches: 0,
  }

  for (const entry of entries) {
    const value = round2(entry.lengthIn * entry.qty)
    if (entry.lengthIn < SMALL_PIECE_MAX) total.smallPiecesInches += value
    else if (entry.lengthIn < MEDIUM_PIECE_MAX) total.mediumPiecesInches += value
    else total.largePiecesInches += value
  }

  return {
    smallPiecesInches: round2(total.smallPiecesInches),
    mediumPiecesInches: round2(total.mediumPiecesInches),
    largePiecesInches: round2(total.largePiecesInches),
  }
}

type BinState = { stockLength: number; remaining: number; cuts: number[] }

type Plan = {
  waste: number
  sticks: number
  bins: BinState[]
}

const mergePlanKey = (plan: BinState[]) =>
  plan
    .slice()
    .sort((a, b) => b.stockLength - a.stockLength)
    .map((bin) => `${round2(bin.stockLength)}:${round2(bin.cuts[0] ?? 0)}:${round2(bin.cuts[bin.cuts.length - 1] ?? 0)}:${bin.cuts.length}`)
    .join('|')

const betterPlan = (left: Plan, right: Plan): Plan => {
  if (left.waste !== right.waste) return left.waste < right.waste ? left : right
  if (left.sticks !== right.sticks) return left.sticks < right.sticks ? left : right
  return mergePlanKey(left.bins) <= mergePlanKey(right.bins) ? left : right
}

export const optimizeStockCuts = (state: QuoteEngineState): QuoteEngineState['stockOptimization'] => {
  const req: number[] = []
  const add = (length: number, qty: number) => {
    if (!length || !qty) return
    for (let i = 0; i < qty; i += 1) req.push(round2(length))
  }

  add(asInches(state.pergola.dimensions.height), state.pieces.verticalColumns.qty)
  add(asInches(state.pergola.dimensions.length), state.pieces.beamsOnLength.qty)
  add(asInches(state.pergola.dimensions.depth), state.pieces.beamsOnDepth.qty)
  add(roofUsableSpan(state), state.pieces.roofPurlins.qty)
  add(sideUsableSpan(state, 'length'), state.pieces.sidePurlinsOnLength.qty)
  add(sideUsableSpan(state, 'depth'), state.pieces.sidePurlinsOnDepth.qty)

  const stocks = Array.from(
    new Set(
      state.pricing.stockItems
        .map((row) => row.supplyFt)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
        .map((value) => round2(value * FT_TO_IN))
      )
  )
    .filter((length) => length > 0)
    .sort((a, b) => b - a)

  if (!req.length) {
    return { stockCounts: {}, cutPlan: [] }
  }

  const availableStock = stocks.length ? stocks : [240, 252, 288]
  const pieces = req.slice().sort((a, b) => b - a)

  const buildGreedyPlan = () => {
    const bins: BinState[] = []

    for (const piece of pieces) {
      let bestBin = -1
      let bestAfter = Number.POSITIVE_INFINITY
      let bestStart = Number.POSITIVE_INFINITY

      for (let i = 0; i < bins.length; i += 1) {
        const bin = bins[i]
        if (bin.remaining < piece) continue
        const after = round2(bin.remaining - piece)
        if (after < bestAfter || (after === bestAfter && round2(bin.remaining) < bestStart)) {
          bestAfter = after
          bestStart = round2(bin.remaining)
          bestBin = i
        }
      }

      if (bestBin >= 0) {
        bins[bestBin].remaining = bestAfter
        bins[bestBin].cuts.push(piece)
        continue
      }

      const fits = availableStock.filter((stock) => stock >= piece)
      if (!fits.length) {
        return null
      }

      let bestStock = fits[0]
      let bestWaste = Number.POSITIVE_INFINITY
      for (const stock of fits) {
        const waste = round2(stock - piece)
        if (waste < bestWaste) {
          bestWaste = waste
          bestStock = stock
        }
      }

      bins.push({ stockLength: bestStock, remaining: bestWaste, cuts: [piece] })
    }

    return {
      waste: round2(bins.reduce((sum, bin) => sum + bin.remaining, 0)),
      sticks: bins.length,
      bins,
    }
  }

  const baseline = buildGreedyPlan()
  if (!baseline) return { stockCounts: {}, cutPlan: [] }

  // Large piece sets use a fast greedy fallback to keep UI interactions snappy.
  if (pieces.length > 18) {
    const counts: Record<string, number> = {}
    for (const bin of baseline.bins) {
      const key = round2(bin.stockLength / FT_TO_IN).toString()
      counts[key] = (counts[key] ?? 0) + 1
    }
    const cutPlan = baseline.bins
      .slice()
      .sort((a, b) => b.stockLength - a.stockLength)
      .map((bin) => bin.cuts.slice().sort((a, b) => b - a).map((cut) => round2(cut / FT_TO_IN)))

    return {
      stockCounts: counts,
      cutPlan,
    }
  }

  const suffixRemaining: number[] = new Array(pieces.length + 1).fill(0)
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    suffixRemaining[i] = suffixRemaining[i + 1] + pieces[i]
  }

  const memo = new Map<string, Plan | null>()
  const encodeState = (idx: number, bins: BinState[]) =>
    `${idx}::${bins
      .slice()
      .sort((a, b) => b.remaining - a.remaining)
      .map((bin) => `${round2(bin.stockLength).toFixed(2)}-${round2(bin.remaining).toFixed(2)}`)
      .join('|')}`

  const lowerWasteBound = (bins: BinState[], idx: number) => {
    const free = bins.reduce((sum, bin) => sum + bin.remaining, 0)
    const remaining = suffixRemaining[idx]
    if (remaining <= free) return 0
    const extra = round2(remaining - free)
    const largestStock = availableStock[0]
    const needed = Math.ceil(extra / largestStock)
    return round2(needed * largestStock - extra)
  }

  const lowerStickBound = (bins: BinState[], idx: number) => {
    const free = bins.reduce((sum, bin) => sum + bin.remaining, 0)
    const remaining = suffixRemaining[idx]
    if (remaining <= free) return bins.length
    const extra = round2(remaining - free)
    return bins.length + Math.ceil(extra / availableStock[0])
  }

  let best: Plan | null = baseline

  const solve = (idx: number, bins: BinState[], currentWaste: number): Plan | null => {
    if (idx >= pieces.length) {
      return {
        waste: round2(currentWaste),
        sticks: bins.length,
        bins: bins.map((bin) => ({ ...bin, cuts: [...bin.cuts] })),
      }
    }

    if (best) {
      if (lowerWasteBound(bins, idx) > best.waste + 1e-9) return null
      if (lowerWasteBound(bins, idx) === best.waste && lowerStickBound(bins, idx) >= best.sticks) return null
    }

    const key = encodeState(idx, bins)
    const memoized = memo.get(key)
    if (memoized) return memoized

    // Branch-and-bound explores "existing bin first" then "new stock" options.
    const piece = pieces[idx]
    const candidates: Array<{ bins: BinState[]; waste: number }> = []

    const existing: { index: number; after: number }[] = []
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i].remaining < piece) continue
      existing.push({ index: i, after: round2(bins[i].remaining - piece) })
    }

    existing.sort((a, b) => {
      if (a.after !== b.after) return a.after - b.after
      const aStart = round2(bins[a.index].stockLength)
      const bStart = round2(bins[b.index].stockLength)
      if (aStart !== bStart) return bStart - aStart
      return a.index - b.index
    })

    const seenExisting = new Set<string>()
    for (const c of existing) {
      const afterKey = `${round2(bins[c.index].stockLength).toFixed(2)}-${c.after.toFixed(2)}`
      if (seenExisting.has(afterKey)) continue
      seenExisting.add(afterKey)

      const nextBins = bins.map((bin) => ({ ...bin, cuts: [...bin.cuts] }))
      nextBins[c.index].remaining = c.after
      nextBins[c.index].cuts.push(piece)
      candidates.push({ bins: nextBins, waste: currentWaste - piece })
    }

    for (let i = 0; i < availableStock.length; i += 1) {
      const stock = availableStock[i]
      if (stock < piece) break
      candidates.push({ bins: [...bins, { stockLength: stock, remaining: round2(stock - piece), cuts: [piece] }], waste: currentWaste + round2(stock - piece) })
    }

    let solution: Plan | null = null
    for (const candidate of candidates) {
      const result = solve(idx + 1, candidate.bins, candidate.waste)
      if (!result) continue
      solution = solution ? betterPlan(solution, result) : result
      if (best) {
        best = betterPlan(best, solution)
      }
    }

    memo.set(key, solution)
    return solution
  }

  const final = solve(0, [], 0)
  const winner = final ?? baseline

  const counts: QuoteEngineState['stockOptimization']['stockCounts'] = {}
  for (const bin of winner.bins) {
    const key = round2(bin.stockLength / FT_TO_IN).toString()
    counts[key] = (counts[key] ?? 0) + 1
  }

  const cutPlan = winner.bins
    .slice()
    .sort((a, b) => b.stockLength - a.stockLength)
    .map((bin) => bin.cuts.slice().sort((a, b) => b - a).map((cut) => round2(cut / FT_TO_IN)))

  return {
    stockCounts: counts,
    cutPlan,
  }
}

const getConnectorCost = (rows: typeof connectorRows, beam: BeamSize) => {
  const match = rows.find((row) => normalize(String(row.size ?? '')) === normalize(beam))
  return match?.costEach ?? null
}

const getEndCapCost = (rows: typeof endCapRows, beam: BeamSize) => {
  const match = rows.find((row) => normalize(String(row.size ?? '')) === normalize(beam))
  return match?.costEach ?? null
}

const buildPricingRows = (state: QuoteEngineState) => {
  const connectorCost = getConnectorCost(connectorRows, state.beam.size)
  const endCapCost = getEndCapCost(endCapRows, state.beam.size)
  const summary = pieceSummary(state)

  const rows = [
    { row: 56, name: 'Connector Blocks', quantity: null, unitCost: null, total: null },
    {
      row: 57,
      name: 'Connector',
      quantity: state.pieces.standardBlocks.qty,
      unitCost: connectorCost,
      total: connectorCost == null ? null : round2(state.pieces.standardBlocks.qty * connectorCost),
    },
    { row: 62, name: 'End Caps', quantity: null, unitCost: null, total: null },
    {
      row: 63,
      name: 'End Cap',
      quantity: state.pieces.endCaps.qty,
      unitCost: endCapCost,
      total: endCapCost == null ? null : round2(state.pieces.endCaps.qty * endCapCost),
    },
    { row: 68, name: 'Angle Iron', quantity: null, unitCost: null, total: 0 },
    { row: 74, name: 'Flatbar', quantity: null, unitCost: null, total: 0 },
    { row: 79, name: 'Additional', quantity: null, unitCost: null, total: 0 },
    { row: 80, name: 'Canopies', quantity: state.pieces.canopies.qty, unitCost: 20, total: round2(state.pieces.canopies.qty * 20) },
    { row: 81, name: 'Feet', quantity: state.pieces.feet.qty, unitCost: 15, total: round2(state.pieces.feet.qty * 15) },
    { row: 82, name: 'Hardware', quantity: null, unitCost: null, total: 0 },
    { row: 83, name: 'Paint (<9.5)', quantity: summary.smallPiecesInches, unitCost: 100, total: round2(summary.smallPiecesInches * 100) },
    { row: 84, name: 'Paint (9.5<x<18)', quantity: summary.mediumPiecesInches, unitCost: 200, total: round2(summary.mediumPiecesInches * 200) },
    { row: 85, name: 'Paint (>18)', quantity: summary.largePiecesInches, unitCost: 300, total: round2(summary.largePiecesInches * 300) },
    { row: 86, name: 'Electrical', quantity: null, unitCost: 100, total: 0 },
    { row: 87, name: 'Engineering Stamp', quantity: null, unitCost: null, total: 0 },
    { row: 88, name: 'Hours', quantity: null, unitCost: 50, total: 0 },
  ]

  const totalCost = rows.reduce((sum, row) => sum + (row.total ?? 0), 0)

  return { rows, totalCost: round2(totalCost) }
}

const validate = (state: QuoteEngineState) => {
  const errors: string[] = []
  const d = state.pergola.dimensions

  if (d.length.ft <= 0 || d.depth.ft <= 0 || d.height.ft <= 0) {
    errors.push('Length, depth, and height must be greater than zero.')
  }

  if (state.roofPurlins.coveragePct < 0 || state.roofPurlins.coveragePct > 100) {
    errors.push('Roof coverage must be between 0 and 100.')
  }

  if (state.sidePurlins.coveragePct < 0 || state.sidePurlins.coveragePct > 100) {
    errors.push('Privacy coverage must be between 0 and 100.')
  }

  return errors
}

const finalize = (state: QuoteEngineState): QuoteEngineState => {
  const next = clone(state)
  next.pieceSizeSummary = pieceSummary(next)
  next.stockOptimization = optimizeStockCuts(next)
  const pricing = buildPricingRows(next)
  next.pricingRows = pricing.rows
  next.totalCost = pricing.totalCost
  next.sell60 = Math.ceil(next.totalCost / (1 - 0.4) / 500) * 500
  next.sell50 = Math.ceil(next.totalCost / (1 - 0.5) / 500) * 500
  next.errors = validate(next)
  return next
}

const applyFieldChange = (state: QuoteEngineState, field: QuoteFieldChange, value: number | string | boolean): QuoteEngineState => {
  const next = clone(state)

  if (field === 'privacyPanelsToggle') {
    return value === true ? next : applyNoPrivacy(next)
  }

  if (field === 'pergola.type') {
    next.pergola.type = value as 'Pergola' | 'Grand Pergola'
    return next
  }

  if (field === 'roofPurlins.materialType') next.roofPurlins.materialType = value as MaterialType
  if (field === 'sidePurlins.materialType') next.sidePurlins.materialType = value as MaterialType
  if (field === 'roofPurlins.orientation') next.roofPurlins.orientation = value as RoofOrientation
  if (field === 'sidePurlins.orientation') next.sidePurlins.orientation = value as SideOrientation
  if (field === 'roofPurlins.alignment') next.roofPurlins.alignment = value as RoofAlignment
  if (field === 'sidePurlins.alignment') next.sidePurlins.alignment = value as SideAlignment

  if (field === 'roofPurlins.size') next.roofPurlins.size = String(value)
  if (field === 'sidePurlins.size') next.sidePurlins.size = String(value)
  if (field === 'roofPurlins.customSize') next.roofPurlins.customSize = String(value)
  if (field === 'sidePurlins.customSize') next.sidePurlins.customSize = String(value)

  if (field === 'roofPurlins.coveragePct') next.roofPurlins.coveragePct = safeToNumber(value, 0)
  if (field === 'roofPurlins.gapIn') next.roofPurlins.gapIn = safeToNumber(value, 0)
  if (field === 'sidePurlins.coveragePct') next.sidePurlins.coveragePct = safeToNumber(value, 0)
  if (field === 'sidePurlins.gapIn') next.sidePurlins.gapIn = safeToNumber(value, 0)

  if (field === 'sidePurlins.countOnLength') {
    next.sidePurlins.countOnLength = Math.max(0, Math.round(safeToNumber(value, 0)))
    next.privacyPanels.countOnLength = next.sidePurlins.countOnLength
  }

  if (field === 'sidePurlins.countOnDepth') {
    next.sidePurlins.countOnDepth = Math.max(0, Math.round(safeToNumber(value, 0)))
    next.privacyPanels.countOnDepth = next.sidePurlins.countOnDepth
  }

  if (field === 'sidePurlins.groundClearanceIn') {
    next.sidePurlins.groundClearanceIn = safeToNumber(value, 0)
    next.privacyPanels.groundClearanceIn = next.sidePurlins.groundClearanceIn
  }

  if (field === 'sidePurlins.topClearanceIn') {
    next.sidePurlins.topClearanceIn = safeToNumber(value, 0)
    next.privacyPanels.topClearanceIn = next.sidePurlins.topClearanceIn
  }

  return next
}

const runPipeline = (state: QuoteEngineState) => {
  // Canonical update pipeline so every field change recomputes consistently.
  let next = applySuggestedType(state)
  next = applyCustomSizeOverride(next)
  next = applyAvailability(next)
  next = computeCoverageGapRoof(next)
  next = computeCoverageGapSide(next)
  next = computePieceBreakdown(next)
  next = finalize(next)
  return next
}

export const syncFeetInches = (state: QuoteEngineState, changedField: QuoteFieldChange, value: number): QuoteEngineState => {
  const next = clone(state)

  if (!['pergola.length.ft', 'pergola.length.in', 'pergola.depth.ft', 'pergola.depth.in', 'pergola.height.ft', 'pergola.height.in'].includes(changedField)) {
    return next
  }

  const safeValue = safeToNumber(value, 0)

  if (changedField === 'pergola.length.ft') {
    next.pergola.dimensions.length.ft = safeValue
    next.pergola.dimensions.length.in = toInchesFromFeet(safeValue)
  }

  if (changedField === 'pergola.length.in') {
    next.pergola.dimensions.length.in = safeValue
    next.pergola.dimensions.length.ft = toFeetFromInches(safeValue)
  }

  if (changedField === 'pergola.depth.ft') {
    next.pergola.dimensions.depth.ft = safeValue
    next.pergola.dimensions.depth.in = toInchesFromFeet(safeValue)
  }

  if (changedField === 'pergola.depth.in') {
    next.pergola.dimensions.depth.in = safeValue
    next.pergola.dimensions.depth.ft = toFeetFromInches(safeValue)
  }

  if (changedField === 'pergola.height.ft') {
    next.pergola.dimensions.height.ft = safeValue
    next.pergola.dimensions.height.in = toInchesFromFeet(safeValue)
  }

  if (changedField === 'pergola.height.in') {
    next.pergola.dimensions.height.in = safeValue
    next.pergola.dimensions.height.ft = toFeetFromInches(safeValue)
  }

  return next
}

export const applyQuoteChange = (state: QuoteEngineState, field: QuoteFieldChange, value: number | string | boolean): QuoteEngineState => {
  let next = clone(state)

  if (!next.private) {
    next.private = { lastRoofSync: 'coverage', lastSideSync: 'coverage' }
  }

  next.private = setPrivateSync(next, field)

  if (
    ['pergola.length.ft', 'pergola.length.in', 'pergola.depth.ft', 'pergola.depth.in', 'pergola.height.ft', 'pergola.height.in'].includes(
      field,
    )
  ) {
    // Dimension pairs are kept synchronized in both feet and inches views.
    next = syncFeetInches(next, field, safeToNumber(value, 0))
  } else {
    next = applyFieldChange(next, field, value)
  }

  return runPipeline(next)
}

export const createInitialQuoteState = (): QuoteEngineState => {
  const initial: QuoteEngineState = {
    pergola: {
      dimensions: {
        length: { ft: 12, in: 0 },
        depth: { ft: 10, in: 0 },
        height: { ft: 9, in: 0 },
      },
      type: 'Pergola',
    },
    beam: { size: '4x4' },
    roofPurlins: {
      materialType: 'Aluminum',
      orientation: 'Horizontal',
      size: '2x4',
      customSize: '',
      alignment: 'Parallel to length',
      coveragePct: 80,
      gapIn: 4,
    },
    sidePurlins: {
      materialType: 'Aluminum',
      orientation: 'Horizontal',
      size: '2x4',
      customSize: '',
      alignment: 'Parallel to top',
      countOnLength: 2,
      countOnDepth: 2,
      groundClearanceIn: 4,
      topClearanceIn: 4,
      coveragePct: 70,
      gapIn: 3,
    },
    privacyPanels: {
      countOnLength: 2,
      countOnDepth: 2,
      groundClearanceIn: 4,
      topClearanceIn: 4,
    },
    pieces: {
      verticalColumns: { qty: 4 },
      beamsOnLength: { qty: 2 },
      beamsOnDepth: { qty: 2 },
      roofPurlins: { qty: 0 },
      sidePurlinsOnLength: { qty: 0 },
      sidePurlinsOnDepth: { qty: 0 },
      standardBlocks: { qty: 8 },
      feet: { qty: 4 },
      endCaps: { qty: 4 },
      canopies: { qty: 4 },
    },
    pricing: {
      stockItems: tubingRows.map((row) => ({
        label: row.label,
        unitCost: row.costPerFt,
        supplyFt: row.supplyFt ?? null,
        partNumber: row.partNumber,
        size: row.size,
        gauge: row.gauge,
      })),
      connectors: connectorRows.map((row) => ({
        label: row.label,
        unitCost: row.costEach,
        supplyFt: null,
        partNumber: row.partNumber,
        size: row.size ?? '',
        gauge: null,
      })),
      endCaps: endCapRows.map((row) => ({
        label: row.label,
        unitCost: row.costEach,
        supplyFt: null,
        partNumber: row.partNumber,
        size: row.size ?? '',
        gauge: null,
      })),
      angleIron: [],
      flatbar: [],
    },
    suggestedType: 'Pergola',
    availableRoofSizes: [],
    availableSideSizes: [],
    roofPurlinsRequired: null,
    sidePurlinsLengthRequired: null,
    sidePurlinsDepthRequired: null,
    columnBeamThickness: null,
    roofPurlinThickness: 0.12,
    sidePurlinThickness: 0.12,
    pieceSizeSummary: {
      smallPiecesInches: 0,
      mediumPiecesInches: 0,
      largePiecesInches: 0,
    },
    stockOptimization: {
      stockCounts: {},
      cutPlan: [],
    },
    pricingRows: [],
    totalCost: 0,
    sell60: 0,
    sell50: 0,
    errors: [],
    private: {
      lastRoofSync: 'coverage',
      lastSideSync: 'coverage',
    },
  }

  return runPipeline(initial)
}

export const applySyncFeetInchesOnly = syncFeetInches





