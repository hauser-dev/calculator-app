import type { PergolaInput } from './pergolaEngine.ts'
import type { AngleRow, ConnectorRow, EndCapRow, FlatbarRow, TubeRow } from './pergolaData.ts'

export type YieldPricingSectionKey = 'tubing' | 'connectorBlocks' | 'endCaps' | 'angleIron' | 'flatbar' | 'additional'

export type YieldPricingRow = {
  item: string
  quantity: string
  unitCost: string
}

export type YieldPricingSections = Record<YieldPricingSectionKey, YieldPricingRow[]>

export type YieldPieceCounts = {
  verticalColumns: number | null
  beamsLength: number | null
  beamsDepth: number | null
  roofPurlins: number | null
  sidePurlinsLength: number | null
  sidePurlinsDepth: number | null
  standardBlocks: number | null
  feet: number | null
  endCaps: number | null
  canopies: number | null
}

export type YieldCutPlanLine = {
  stockCount: number
  stockLengthFt: number
  cutsFt: number[]
  wasteFt: number
  kerfCount: number
  kerfFt: number
}

export type YieldCutPlanSection = {
  title: string
  lines: YieldCutPlanLine[]
}

export type PergolaYieldProgress = {
  percent: number
  label: string
}

export type CalculatePergolaYieldOptions = {
  input: PergolaInput
  beamSize: '4x4' | '6x6'
  pieceCounts: YieldPieceCounts
  columnBeamThickness: string
  roofPurlinThickness: string
  privacyPanelPurlinThickness: string
  tubingRows: TubeRow[]
  connectorRows: ConnectorRow[]
  endCapRows: EndCapRow[]
  angleRows: AngleRow[]
  flatbarRows: FlatbarRow[]
  onProgress?: (progress: PergolaYieldProgress) => void
}

export type PergolaYieldResult = {
  pricingSections: YieldPricingSections
  cutPlans: YieldCutPlanSection[]
  warnings: string[]
}

type StockBin = {
  stockLength: number
  remaining: number
  cuts: number[]
}

type OptimizeResult = {
  counts: number[]
  plan: StockBin[] | null
}

const WASTE_INF = 1e30
const KERF_LOSS_FT = (1 / 8) / 12
const LENGTH_EPSILON = 1e-9

const emptyPricingRow = (): YieldPricingRow => ({
  item: '',
  quantity: '',
  unitCost: '',
})

const normalize = (value: string) => value.trim().toUpperCase()

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const parseFiniteNumber = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const formatNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

const formatCount = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(Math.max(Math.trunc(value), 0)) : ''

const safeCount = (value: number | null | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback

const getComputedPerSupply = (
  costPerFt: number | null | undefined,
  supplyFt: number | null | undefined,
  perSupply: number | null | undefined,
): number | null => {
  if (typeof perSupply === 'number' && Number.isFinite(perSupply)) return perSupply
  if (typeof costPerFt === 'number' && Number.isFinite(costPerFt) && typeof supplyFt === 'number' && Number.isFinite(supplyFt)) {
    return costPerFt * supplyFt
  }
  return null
}

const beamDimensionFt = (beamSize: string): number => {
  if (beamSize.includes('6')) return 6 / 12
  if (beamSize.includes('4')) return 4 / 12
  return 0
}

const matchingTubeRows = (rows: TubeRow[], size: string, thickness: number | null) => {
  const normalizedSize = normalize(size)
  if (!normalizedSize || thickness == null) return []

  return rows.filter(
    (row) =>
      normalize(row.size) === normalizedSize &&
      typeof row.gauge === 'number' &&
      Math.abs(row.gauge - thickness) < 0.0001 &&
      typeof row.supplyFt === 'number' &&
      Number.isFinite(row.supplyFt) &&
      row.supplyFt > 0,
  )
}

const findConnectorRow = (rows: ConnectorRow[], beamSize: string) =>
  rows.find((row) => normalize(String(row.size ?? '')) === normalize(beamSize))

const findEndCapRow = (rows: EndCapRow[], beamSize: string) =>
  rows.find((row) => normalize(String(row.size ?? '')) === normalize(beamSize))

const clonePlan = (plan: StockBin[]): StockBin[] =>
  plan.map((bin) => ({
    stockLength: bin.stockLength,
    remaining: bin.remaining,
    cuts: [...bin.cuts],
  }))

const sortBinsDescending = (bins: StockBin[]) => {
  bins.sort((left, right) => right.remaining - left.remaining)
}

const packRecursiveWithPlan = (
  pieces: number[],
  pieceIndex: number,
  bins: StockBin[],
  memo: Map<string, number>,
  best: { waste: number; feasible: boolean; plan: StockBin[] | null },
) => {
  const key = `${pieceIndex}|${bins.map((bin) => bin.remaining.toFixed(4)).join(',')}`
  const previous = memo.get(key)
  if (previous !== undefined && previous <= best.waste) return
  memo.set(key, best.waste)

  if (pieceIndex === 0) sortBinsDescending(bins)

  const sumRemaining = bins.reduce((sum, bin) => sum + bin.remaining, 0)
  if (sumRemaining >= best.waste) return
  if (best.waste === 0) return

  if (pieceIndex >= pieces.length) {
    best.feasible = true
    if (sumRemaining < best.waste) {
      best.waste = sumRemaining
      best.plan = clonePlan(bins)
    }
    return
  }

  const pieceLength = pieces[pieceIndex]
  let triedValue = -1

  for (const bin of bins) {
    const isExactRemaining = Math.abs(bin.remaining - pieceLength) <= LENGTH_EPSILON
    const consumedLength = isExactRemaining ? pieceLength : pieceLength + KERF_LOSS_FT
    if (bin.remaining + LENGTH_EPSILON < consumedLength) continue
    if (triedValue >= 0 && Math.abs(bin.remaining - triedValue) < 0.0000001) continue

    triedValue = bin.remaining
    const previousRemaining = bin.remaining
    bin.remaining = Math.abs(previousRemaining - consumedLength) <= LENGTH_EPSILON
      ? 0
      : previousRemaining - consumedLength
    bin.cuts.push(pieceLength)

    packRecursiveWithPlan(pieces, pieceIndex + 1, bins, memo, best)

    bin.cuts.pop()
    bin.remaining = previousRemaining

    if (best.waste === 0) break
  }
}

const testScenario = (pieces: number[], avail: number[], candidateCounts: number[]) => {
  const counts = avail.map((_, index) => Math.max(Math.trunc(candidateCounts[index] ?? 0), 0))
  const totalStock = counts.reduce((sum, count) => sum + count, 0)

  if (totalStock === 0) {
    return { waste: WASTE_INF, beams: 0, counts, plan: [] as StockBin[] }
  }

  const bins: StockBin[] = []
  for (let i = 0; i < avail.length; i += 1) {
    for (let j = 0; j < counts[i]; j += 1) {
      bins.push({ stockLength: avail[i], remaining: avail[i], cuts: [] })
    }
  }
  sortBinsDescending(bins)

  const best = { waste: WASTE_INF, beams: totalStock, feasible: false, plan: null as StockBin[] | null }
  packRecursiveWithPlan(pieces, 0, bins, new Map<string, number>(), best)

  if (!best.feasible || !best.plan) {
    return { waste: WASTE_INF, beams: totalStock, counts, plan: [] as StockBin[] }
  }

  return {
    waste: best.waste,
    beams: totalStock,
    counts,
    plan: best.plan,
  }
}

const optimizeBeamsSmart = (
  lengthReq: number,
  depthReq: number,
  heightReq: number,
  numLength: number,
  numDepth: number,
  numHeight: number,
  avail: number[],
): OptimizeResult => {
  const counts = avail.map(() => 0)
  const totalPieces = numLength + numDepth + numHeight

  if (!avail.length || totalPieces === 0) {
    return { counts, plan: null }
  }

  const pieces: number[] = []
  const addPieces = (length: number, count: number) => {
    for (let i = 0; i < count; i += 1) pieces.push(length)
  }

  addPieces(lengthReq, numLength)
  addPieces(depthReq, numDepth)
  addPieces(heightReq, numHeight)
  pieces.sort((left, right) => right - left)

  let bestWaste = WASTE_INF
  let bestBeams = 999999
  let bestCounts = counts
  let bestPlan: StockBin[] | null = null

  const test = (candidateCounts: number[]) => {
    const result = testScenario(pieces, avail, candidateCounts)
    if (result.waste >= 1e29) return
    if (result.waste < bestWaste || (Math.abs(result.waste - bestWaste) < 0.0000001 && result.beams < bestBeams)) {
      bestWaste = result.waste
      bestBeams = result.beams
      bestCounts = result.counts
      bestPlan = result.plan
    }
  }

  const maxIter = Math.max(totalPieces * 2, 1)

  if (avail.length === 1) {
    for (let a = 0; a <= maxIter; a += 1) {
      test([a])
      if (bestWaste === 0) break
    }
  } else if (avail.length === 2) {
    let done = false
    for (let a = 0; a <= totalPieces && !done; a += 1) {
      for (let b = 0; b <= totalPieces; b += 1) {
        if (a + b > totalPieces) continue
        test([a, b])
        if (bestWaste === 0) {
          done = true
          break
        }
      }
    }
  } else if (avail.length === 3) {
    let done = false
    for (let a = 0; a <= maxIter && !done; a += 1) {
      for (let b = 0; b <= maxIter && !done; b += 1) {
        for (let c = 0; c <= maxIter; c += 1) {
          test([a, b, c])
          if (bestWaste === 0) {
            done = true
            break
          }
        }
      }
    }
  } else {
    const candidate = new Array(avail.length).fill(0)
    const visit = (index: number, remaining: number) => {
      if (index >= candidate.length) {
        test(candidate)
        return
      }
      for (let count = 0; count <= remaining; count += 1) {
        candidate[index] = count
        visit(index + 1, remaining - count)
        if (bestWaste === 0) return
      }
    }
    visit(0, totalPieces)
  }

  return { counts: bestCounts, plan: bestPlan }
}

const appendTubingRows = (target: YieldPricingRow[], rows: TubeRow[], counts: number[]) => {
  rows.forEach((row, index) => {
    const quantity = Math.max(Math.trunc(counts[index] ?? 0), 0)
    if (quantity === 0) return
    const item = row.label
    const unitCost = formatNumber(getComputedPerSupply(row.costPerFt, row.supplyFt, row.perSupply))
    const existing = target.find((entry) => normalize(entry.item) === normalize(item))

    if (existing) {
      const existingQuantity = parseFiniteNumber(existing.quantity) ?? 0
      existing.quantity = formatCount(existingQuantity + quantity)
      if (!existing.unitCost && unitCost) existing.unitCost = unitCost
      return
    }

    target.push({
      item,
      quantity: formatCount(quantity),
      unitCost,
    })
  })
}

const toCutPlanSection = (title: string, plan: StockBin[] | null): YieldCutPlanSection | null => {
  if (!plan || !plan.length) return null
  const groupedLines = new Map<string, YieldCutPlanLine>()

  for (const bin of plan) {
    const stockLengthFt = round2(bin.stockLength)
    const cutsFt = bin.cuts.map(round2).sort((left, right) => right - left)
    const wasteFt = round2(Math.max(bin.remaining, 0))
    const usedKerfFt = Math.max(bin.stockLength - bin.cuts.reduce((sum, cut) => sum + cut, 0) - Math.max(bin.remaining, 0), 0)
    const kerfCount = Math.round(usedKerfFt / KERF_LOSS_FT)
    const key = `${stockLengthFt}|${cutsFt.join('|')}|${kerfCount}|${wasteFt}`
    const existing = groupedLines.get(key)

    if (existing) {
      existing.stockCount += 1
      continue
    }

    groupedLines.set(key, {
      stockCount: 1,
      stockLengthFt,
      cutsFt,
      wasteFt,
      kerfCount,
      kerfFt: KERF_LOSS_FT,
    })
  }

  return {
    title,
    lines: Array.from(groupedLines.values()).sort((left, right) => {
      if (right.stockLengthFt !== left.stockLengthFt) return right.stockLengthFt - left.stockLengthFt
      if (right.stockCount !== left.stockCount) return right.stockCount - left.stockCount
      return right.cutsFt.length - left.cutsFt.length
    }),
  }
}

const collectCuts = (plan: StockBin[] | null): number[] =>
  plan ? plan.flatMap((bin) => bin.cuts) : []

const countPaintPieces = (pieces: number[]) => {
  const counts = { small: 0, medium: 0, large: 0 }

  for (const piece of pieces) {
    if (piece < 9.5) counts.small += 1
    else if (piece < 18) counts.medium += 1
    else counts.large += 1
  }

  return counts
}

const calculateHoursQuantity = (dimensions: PergolaInput['dimensions']) => {
  const values = [dimensions.lengthFt, dimensions.depthFt, dimensions.heightFt]
  if (values.some((value) => value >= 18)) return 80
  if (values.some((value) => value >= 9.5)) return 50
  return 30
}

export const calculatePergolaYield = ({
  input,
  beamSize,
  pieceCounts,
  columnBeamThickness,
  roofPurlinThickness,
  privacyPanelPurlinThickness,
  tubingRows,
  connectorRows,
  endCapRows,
  onProgress,
}: CalculatePergolaYieldOptions): PergolaYieldResult => {
  const reportProgress = (percent: number, label: string) => onProgress?.({ percent, label })
  const warnings: string[] = []
  const tubing: YieldPricingRow[] = []
  const cutPlans: YieldCutPlanSection[] = []
  const beamPieces: number[] = []
  const purlinPieces: number[] = []
  const b30 = safeCount(pieceCounts.verticalColumns, 4)
  const b31 = safeCount(pieceCounts.beamsLength)
  const b32 = safeCount(pieceCounts.beamsDepth)
  const b33 = safeCount(pieceCounts.roofPurlins)
  const b34 = safeCount(pieceCounts.sidePurlinsLength)
  const b35 = safeCount(pieceCounts.sidePurlinsDepth)
  const b36 = safeCount(pieceCounts.standardBlocks)
  const b37 = safeCount(pieceCounts.feet)
  const b38 = safeCount(pieceCounts.endCaps)
  const b39 = safeCount(pieceCounts.canopies)
  const beamThick = parseFiniteNumber(columnBeamThickness)
  const roofThick = parseFiniteNumber(roofPurlinThickness)
  const privacyThick = parseFiniteNumber(privacyPanelPurlinThickness)
  const bDim = beamDimensionFt(beamSize)

  const processSidePurlins = () => {
    if (b34 === 0 && b35 === 0) {
      reportProgress(100, 'Privacy panel purlins skipped.')
      return
    }

    reportProgress(70, 'Calculating privacy panel purlin plan...')

    const sideSize = input.privacy.customSize.trim() || input.privacy.size
    const sideRows = matchingTubeRows(tubingRows, sideSize, privacyThick)
    if (!sideRows.length) {
      warnings.push(`No privacy panel purlin tubing matched ${sideSize} at ${privacyPanelPurlinThickness}.`)
      reportProgress(100, 'Privacy panel purlins skipped.')
      return
    }

    let reqLen = 0
    let reqDep = 0
    let reqHei = 0
    let numLen = 0
    let numDep = 0
    let numHei = 0

    if (normalize(input.privacy.alignment).includes('HEIGHT')) {
      reqHei = input.dimensions.heightFt - (input.privacy.groundClearanceIn + input.privacy.topClearanceIn) / 12 - 2 * bDim
      numHei = b34 + b35
    } else if (normalize(input.privacy.alignment).includes('TOP')) {
      const halfB30 = Math.trunc(b30 / 2)
      reqLen = halfB30 > 1 ? (input.dimensions.lengthFt - halfB30 * bDim) / (halfB30 - 1) : 0
      reqDep = input.dimensions.depthFt - 2 * bDim
      numLen = b34
      numDep = b35
    }

    const result = optimizeBeamsSmart(reqLen, reqDep, reqHei, numLen, numDep, numHei, sideRows.map((row) => row.supplyFt as number))
    appendTubingRows(tubing, sideRows, result.counts)
    const section = toCutPlanSection('Privacy Panel Plan', result.plan)
    if (section) cutPlans.push(section)
    purlinPieces.push(...collectCuts(result.plan))
    reportProgress(100, 'Privacy panel purlin plan complete.')
  }

  const processRoofPurlins = () => {
    reportProgress(40, 'Calculating roof purlin plan...')
    const roofSize = input.roof.customSize.trim() || input.roof.size
    const roofRows = matchingTubeRows(tubingRows, roofSize, roofThick)
    if (!roofRows.length) {
      warnings.push(`No roof purlin tubing matched ${roofSize} at ${roofPurlinThickness}.`)
      reportProgress(100, 'Roof purlins skipped.')
      return
    }

    let pLen = 0
    if (normalize(input.roof.alignment).includes('LENGTH')) {
      const halfB30 = Math.trunc(b30 / 2)
      pLen = halfB30 > 1 ? (input.dimensions.lengthFt - halfB30 * bDim) / (halfB30 - 1) : 0
    } else if (normalize(input.roof.alignment).includes('DEPTH')) {
      pLen = input.dimensions.depthFt - 2 * bDim
    }

    const result = optimizeBeamsSmart(pLen, 0, 0, b33, 0, 0, roofRows.map((row) => row.supplyFt as number))
    appendTubingRows(tubing, roofRows, result.counts)
    const section = toCutPlanSection('Roof Purlin Plan', result.plan)
    if (section) cutPlans.push(section)
    purlinPieces.push(...collectCuts(result.plan))
    reportProgress(70, 'Roof purlin plan complete.')

    processSidePurlins()
  }

  reportProgress(5, 'Starting yield calculation...')

  if (beamThick == null) {
    warnings.push('Column & Beam Thickness is required before calculating yield.')
    reportProgress(100, 'Yield calculation stopped.')
  } else {
    const beamRows = matchingTubeRows(tubingRows, beamSize, beamThick)
    if (!beamRows.length) {
      warnings.push(`No column/beam tubing matched ${beamSize} at ${columnBeamThickness}.`)
      reportProgress(100, 'Columns and beams skipped.')
    } else {
      reportProgress(10, 'Calculating columns and beams plan...')
      const halfB30 = Math.trunc(b30 / 2)
      const lengthReq = halfB30 > 1 ? (input.dimensions.lengthFt - halfB30 * bDim) / (halfB30 - 1) : 0
      const depthReq = input.dimensions.depthFt - 2 * bDim
      const heightReq = input.dimensions.heightFt
      const result = optimizeBeamsSmart(lengthReq, depthReq, heightReq, b31, b32, b30, beamRows.map((row) => row.supplyFt as number))

      appendTubingRows(tubing, beamRows, result.counts)
      const section = toCutPlanSection('Columns & Beams Plan', result.plan)
      if (section) cutPlans.push(section)
      beamPieces.push(...collectCuts(result.plan))
      reportProgress(40, 'Columns and beams plan complete.')
      processRoofPurlins()
    }
  }

  const connector = findConnectorRow(connectorRows, beamSize)
  const endCap = findEndCapRow(endCapRows, beamSize)
  if (!connector) warnings.push(`No connector block matched ${beamSize}.`)
  if (!endCap) warnings.push(`No end cap matched ${beamSize}.`)

  const beamPaint = countPaintPieces(beamPieces)
  const purlinPaint = countPaintPieces(purlinPieces)
  const smallPaint = beamPaint.small + Math.trunc(purlinPaint.small / 4)
  const mediumPaint = beamPaint.medium + Math.trunc(purlinPaint.medium / 4)
  const largePaint = beamPaint.large + Math.trunc(purlinPaint.large / 4)
  const hoursQuantity = calculateHoursQuantity(input.dimensions)
  const additionalRows: YieldPricingRow[] = [
    ...(b39 > 0 ? [{ item: 'Canopies', quantity: formatCount(b39), unitCost: '20' }] : []),
    ...(b37 > 0 ? [{ item: 'Feet', quantity: formatCount(b37), unitCost: '15' }] : []),
    { item: 'Hardware', quantity: '1', unitCost: '' },
    ...(smallPaint > 0 ? [{ item: 'Paint (<9.5)', quantity: formatCount(smallPaint), unitCost: '100' }] : []),
    ...(mediumPaint > 0 ? [{ item: 'Paint (9.5 <x<18)', quantity: formatCount(mediumPaint), unitCost: '200' }] : []),
    ...(largePaint > 0 ? [{ item: 'Paint (>18)', quantity: formatCount(largePaint), unitCost: '300' }] : []),
    { item: 'Electrical', quantity: '', unitCost: '100' },
    { item: 'Engineering Stamp', quantity: '1', unitCost: '1000' },
    { item: 'Hours', quantity: formatCount(hoursQuantity), unitCost: '50' },
  ]

  return {
    pricingSections: {
      tubing: tubing.length ? tubing : [emptyPricingRow()],
      connectorBlocks: connector
        ? [{
            item: connector.label,
            quantity: formatCount(b36),
            unitCost: formatNumber(connector.costEach),
          }]
        : [emptyPricingRow()],
      endCaps: endCap
        ? [{
            item: endCap.label,
            quantity: formatCount(b38),
            unitCost: formatNumber(endCap.costEach),
          }]
        : [emptyPricingRow()],
      angleIron: [emptyPricingRow()],
      flatbar: [emptyPricingRow()],
      additional: additionalRows,
    },
    cutPlans,
    warnings,
  }
}
