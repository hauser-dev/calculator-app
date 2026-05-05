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
  stockNumber: number
  stockLengthFt: number
  cutsFt: number[]
}

export type YieldCutPlanSection = {
  title: string
  lines: YieldCutPlanLine[]
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
    if (bin.remaining < pieceLength) continue
    if (triedValue >= 0 && Math.abs(bin.remaining - triedValue) < 0.0000001) continue

    triedValue = bin.remaining
    bin.remaining -= pieceLength
    bin.cuts.push(pieceLength)

    packRecursiveWithPlan(pieces, pieceIndex + 1, bins, memo, best)

    bin.cuts.pop()
    bin.remaining += pieceLength

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
    target.push({
      item: row.label,
      quantity: formatCount(counts[index] ?? 0),
      unitCost: formatNumber(getComputedPerSupply(row.costPerFt, row.supplyFt, row.perSupply)),
    })
  })
}

const toCutPlanSection = (title: string, plan: StockBin[] | null): YieldCutPlanSection | null => {
  if (!plan || !plan.length) return null
  return {
    title,
    lines: plan.map((bin, index) => ({
      stockNumber: index + 1,
      stockLengthFt: round2(bin.stockLength),
      cutsFt: bin.cuts.map(round2),
    })),
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
}: CalculatePergolaYieldOptions): PergolaYieldResult => {
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
    if (b34 === 0 && b35 === 0) return

    const sideSize = input.privacy.customSize.trim() || input.privacy.size
    const sideRows = matchingTubeRows(tubingRows, sideSize, privacyThick)
    if (!sideRows.length) {
      warnings.push(`No privacy panel purlin tubing matched ${sideSize} at ${privacyPanelPurlinThickness}.`)
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
  }

  const processRoofPurlins = () => {
    const roofSize = input.roof.customSize.trim() || input.roof.size
    const roofRows = matchingTubeRows(tubingRows, roofSize, roofThick)
    if (!roofRows.length) {
      warnings.push(`No roof purlin tubing matched ${roofSize} at ${roofPurlinThickness}.`)
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

    processSidePurlins()
  }

  if (beamThick == null) {
    warnings.push('Column & Beam Thickness is required before calculating yield.')
  } else {
    const beamRows = matchingTubeRows(tubingRows, beamSize, beamThick)
    if (!beamRows.length) {
      warnings.push(`No column/beam tubing matched ${beamSize} at ${columnBeamThickness}.`)
    } else {
      const halfB30 = Math.trunc(b30 / 2)
      const lengthReq = halfB30 > 1 ? (input.dimensions.lengthFt - halfB30 * bDim) / (halfB30 - 1) : 0
      const depthReq = input.dimensions.depthFt - 2 * bDim
      const heightReq = input.dimensions.heightFt
      const result = optimizeBeamsSmart(lengthReq, depthReq, heightReq, b31, b32, b30, beamRows.map((row) => row.supplyFt as number))

      appendTubingRows(tubing, beamRows, result.counts)
      const section = toCutPlanSection('Columns & Beams Plan', result.plan)
      if (section) cutPlans.push(section)
      beamPieces.push(...collectCuts(result.plan))
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
      additional: [
        { item: 'Canopies', quantity: formatCount(b39), unitCost: '20' },
        { item: 'Feet', quantity: formatCount(b37), unitCost: '15' },
        { item: 'Hardware', quantity: '', unitCost: '' },
        { item: 'Paint (<9.5)', quantity: formatCount(smallPaint), unitCost: '100' },
        { item: 'Paint (9.5 <x<18)', quantity: formatCount(mediumPaint), unitCost: '200' },
        { item: 'Paint (>18)', quantity: formatCount(largePaint), unitCost: '300' },
        { item: 'Electrical', quantity: '', unitCost: '100' },
        { item: 'Engineering Stamp', quantity: '', unitCost: '' },
        { item: 'Hours', quantity: '', unitCost: '50' },
      ],
    },
    cutPlans,
    warnings,
  }
}
