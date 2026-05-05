import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Menubar, MenubarMenu, MenubarTrigger } from '@/components/ui/menubar'
import {
  calculatePergola,
  syncPergolaPrivacyCoverageGap,
  syncPergolaRoofCoverageGap,
  type PergolaInput,
  type PergolaType,
  type PrivacyCoverageGapSource,
  type RoofCoverageGapSource,
} from '@/lib/pergola/pergolaEngine'
import { calculatePergolaYield, type YieldCutPlanSection, type YieldPricingRow } from '@/lib/pergola/yieldEngine'
import {
  tubingRows,
  connectorRows,
  endCapRows,
  angleRows,
  flatbarRows,
  type TubeRow,
  type ConnectorRow,
  type EndCapRow,
  type AngleRow,
  type FlatbarRow,
} from '@/lib/pergola/pergolaData'
import { cn } from '@/lib/utils'
import { parseCsv, serializeCsv } from '@/lib/csv'

const toFeet = (value: number, unit: 'ft' | 'in') => (unit === 'ft' ? value : value / 12)

const toNullableNumber = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}


const formatPerSupply = (costPerFt: number | null | undefined, supplyFt: number | null | undefined): string => {
  if (typeof costPerFt !== 'number' || typeof supplyFt !== 'number') return ''
  return (costPerFt * supplyFt).toFixed(2)
}

const makeDefaultInput = (): PergolaInput => {
  const input: PergolaInput = {
    dimensions: { lengthFt: 12, depthFt: 10, heightFt: 9 },
    type: 'Pergola',
    electrical: 'No',
    roof: {
      material: 'Aluminum',
      orientation: 'Horizontal',
      size: '2x4',
      customSize: '',
      alignment: 'Parallel to length',
      coveragePct: 80,
      gapIn: 4,
    },
    privacy: {
      material: 'Aluminum',
      orientation: 'Vertical',
      size: '2x4',
      customSize: '',
      alignment: 'Parallel to top',
      panelCountLength: 2,
      panelCountDepth: 2,
      groundClearanceIn: 4,
      topClearanceIn: 4,
      coveragePct: 70,
      gapIn: 3,
    },
  }

  return syncPergolaPrivacyCoverageGap(syncPergolaRoofCoverageGap(input, 'coverage'), 'coverage')
}



const getPrivacyPanelDefaults = () => ({
  material: 'Aluminum' as const,
  orientation: 'Horizontal' as const,
  size: '2x4',
  customSize: '',
  alignment: 'Parallel to top' as const,
  panelCountLength: 0,
  panelCountDepth: 0,
  groundClearanceIn: 0,
  topClearanceIn: 0,
  coveragePct: 0,
  gapIn: 0,
})

const PIECE_ROWS = [
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
] as const

type PieceCountKey = (typeof PIECE_ROWS)[number]['key']
type PieceCounts = ReturnType<typeof calculatePergola>['pieceCounts']
type PieceSizes = Record<PieceCountKey, string>
type PergolaResultsSectionKey = 'overview' | 'breakdown' | 'cutPlans' | 'costDetails'
type PergolaSettingsSectionKey =
  | 'columnBeamThickness'
  | 'tubingSource'
  | 'connectorsSource'
  | 'endCapsSource'
  | 'angleSource'
  | 'flatbarSource'
type PricingSectionKey = 'tubing' | 'connectorBlocks' | 'endCaps' | 'angleIron' | 'flatbar' | 'additional'
type PricingLineRow = {
  item: string
  quantity: string
  unitCost: string
}

const parsePieceCountEdit = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined
}

const formatPieceCountValue = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

const PRICING_SECTIONS: { key: PricingSectionKey; label: string }[] = [
  { key: 'tubing', label: 'Tubing' },
  { key: 'connectorBlocks', label: 'Connector Blocks' },
  { key: 'endCaps', label: 'End Caps' },
  { key: 'angleIron', label: 'Angle Iron' },
  { key: 'flatbar', label: 'Flatbar' },
  { key: 'additional', label: 'Additional' },
]


const ADDITIONAL_SECTION_ITEMS = [
  'Canopies',
  'Feet',
  'Hardware',
  'Paint (<9.5)',
  'Paint (9.5 <x<18)',
  'Paint (>18)',
  'Electrical',
  'Engineering Stamp',
  'Hours',
] as const

const createPricingRow = (): PricingLineRow => ({
  item: '',
  quantity: '',
  unitCost: '',
})

const createPricingSections = (): Record<PricingSectionKey, PricingLineRow[]> => ({
  tubing: [createPricingRow()],
  connectorBlocks: [createPricingRow()],
  endCaps: [createPricingRow()],
  angleIron: [createPricingRow()],
  flatbar: [createPricingRow()],
  additional: [createPricingRow()],
})

const parseNumberInput = (raw: string): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatCsvNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

const parseNullableNumberCell = (raw: string) => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const createEmptyTubeRow = (): TubeRow => ({ label: '', partNumber: '', size: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })
const createEmptyConnectorRow = (): ConnectorRow => ({ label: '', partNumber: '', totalDepth: null, costEach: null, size: null })
const createEmptyEndCapRow = (): EndCapRow => ({ label: '', partNumber: '', totalDepth: null, costEach: null, size: null })
const createEmptyAngleRow = (): AngleRow => ({ label: '', partNumber: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })
const createEmptyFlatbarRow = (): FlatbarRow => ({ label: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

const getComputedPerSupply = (costPerFt: number | null | undefined, supplyFt: number | null | undefined, perSupply: number | null | undefined): number | null => {
  if (typeof perSupply === 'number' && Number.isFinite(perSupply)) return perSupply
  if (typeof costPerFt === 'number' && Number.isFinite(costPerFt) && typeof supplyFt === 'number' && Number.isFinite(supplyFt)) {
    return costPerFt * supplyFt
  }
  return null
}

const normalizeLabel = (value: string) => value.trim().toLowerCase()
const normalizeTubingSize = (value: string) => value.trim().toLowerCase().replace(/["'\s]/g, '')

const getTubingGaugeForSize = (rows: TubeRow[], size: string): string => {
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

const ADDITIONAL_ITEM_DEFAULT_UNIT_COST: Record<string, number | null> = {
  canopies: 20,
  feet: 15,
  hardware: null,
  'paint (<9.5)': 100,
  'paint (9.5 <x<18)': 200,
  'paint (>18)': 300,
  electrical: 100,
  'engineering stamp': null,
  hours: 50,
}

const DEFAULT_COLUMN_BEAM_THICKNESS_4X4 = '0.125, 0.25'
const DEFAULT_COLUMN_BEAM_THICKNESS_6X6 = '0.25'

const parseThicknessOptions = (raw: string): string[] => {
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  const normalized = tokens
    .map((token) => {
      const parsed = Number(token)
      return Number.isFinite(parsed) ? parsed.toString() : null
    })
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(normalized))
}

const PergolaCalculator = () => {
  const [unit, setUnit] = useState<'ft' | 'in'>('ft')
  const roofSyncSourceRef = useRef<RoofCoverageGapSource>('coverage')
  const privacySyncSourceRef = useRef<PrivacyCoverageGapSource>('coverage')
  const [input, setInput] = useState<PergolaInput>(makeDefaultInput)
  const [privacyPanelsEnabled, setPrivacyPanelsEnabled] = useState(true)
  const [columnBeamThickness, setColumnBeamThickness] = useState('')
  const [columnBeamThickness4x4Input, setColumnBeamThickness4x4Input] = useState(DEFAULT_COLUMN_BEAM_THICKNESS_4X4)
  const [columnBeamThickness6x6Input, setColumnBeamThickness6x6Input] = useState(DEFAULT_COLUMN_BEAM_THICKNESS_6X6)
  const [roofPurlinThickness, setRoofPurlinThickness] = useState('0.12')
  const [privacyPanelPurlinThickness, setPrivacyPanelPurlinThickness] = useState('0.12')
  const [pricingSections, setPricingSections] = useState<Record<PricingSectionKey, PricingLineRow[]>>(() => createPricingSections())
  const [yieldPlanSections, setYieldPlanSections] = useState<YieldCutPlanSection[]>([])
  const [yieldMessage, setYieldMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [bufferInput, setBufferInput] = useState('')
  const [sellMarginInput, setSellMarginInput] = useState('50')
  const [isPrintMode, setIsPrintMode] = useState(false)
  const [activeTab, setActiveTab] = useState<'input' | 'results' | 'settings'>('input')
  const [resultsSectionState, setResultsSectionState] = useState<Record<PergolaResultsSectionKey, boolean>>({
    overview: true,
    breakdown: true,
    cutPlans: true,
    costDetails: true,
  })
  const [pieceQtyEdits, setPieceQtyEdits] = useState<Partial<Record<PieceCountKey, string>>>({})
  const [tubingRowsState, setTubingRowsState] = useState<TubeRow[]>(() => tubingRows.map((row) => ({ ...row })))
  const [connectorRowsState, setConnectorRowsState] = useState<ConnectorRow[]>(() => connectorRows.map((row) => ({ ...row })))
  const [endCapRowsState, setEndCapRowsState] = useState<EndCapRow[]>(() => endCapRows.map((row) => ({ ...row })))
  const [angleRowsState, setAngleRowsState] = useState<AngleRow[]>(() => angleRows.map((row) => ({ ...row })))
  const [flatbarRowsState, setFlatbarRowsState] = useState<FlatbarRow[]>(() => flatbarRows.map((row) => ({ ...row })))
  const [settingsBanner, setSettingsBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const settingsImportInputRef = useRef<HTMLInputElement | null>(null)
  const [settingsSectionState, setSettingsSectionState] = useState<Record<PergolaSettingsSectionKey, boolean>>({
    columnBeamThickness: true,
    tubingSource: true,
    connectorsSource: true,
    endCapsSource: true,
    angleSource: true,
    flatbarSource: true,
  })

  const effectiveInput = useMemo<PergolaInput>(() => {
    if (privacyPanelsEnabled) return input
    const privacyDefaults = getPrivacyPanelDefaults()
    return {
      ...input,
      privacy: {
        ...input.privacy,
        ...privacyDefaults,
      },
    }
  }, [input, privacyPanelsEnabled])

  const verticalColumnsOverride = useMemo(
    () => parsePieceCountEdit(pieceQtyEdits.verticalColumns),
    [pieceQtyEdits.verticalColumns],
  )

  const result = useMemo(
    () =>
      calculatePergola(effectiveInput, {
        roofSyncSource: roofSyncSourceRef.current,
        privacySyncSource: privacySyncSourceRef.current,
        verticalColumns: verticalColumnsOverride,
      }),
    [effectiveInput, verticalColumnsOverride],
  )
  const isOverviewOpen = isPrintMode || resultsSectionState.overview
  const isBreakdownOpen = isPrintMode || resultsSectionState.breakdown
  const isCutPlansOpen = isPrintMode || resultsSectionState.cutPlans
  const isCostDetailsOpen = isPrintMode || resultsSectionState.costDetails

  const setAllResultsSections = (isOpen: boolean) => {
    setResultsSectionState({
      overview: isOpen,
      breakdown: isOpen,
      cutPlans: isOpen,
      costDetails: isOpen,
    })
  }

  const toggleSettingsSection = (section: PergolaSettingsSectionKey) => {
    setSettingsSectionState((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  const toggleResultsSection = (section: PergolaResultsSectionKey) => {
    setResultsSectionState((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  const handleExportPdf = () => {
    setAllResultsSections(true)
    setIsPrintMode(true)
  }

  useEffect(() => {
    if (!isPrintMode) return

    const cleanup = () => {
      setIsPrintMode(false)
      document.body.classList.remove('results-print-mode')
      window.removeEventListener('afterprint', cleanup)
    }

    document.body.classList.add('results-print-mode')
    window.addEventListener('afterprint', cleanup)

    const printTimer = window.setTimeout(() => {
      window.print()
    }, 0)

    return () => {
      window.clearTimeout(printTimer)
      cleanup()
    }
  }, [isPrintMode])

  const columnBeamThickness4x4Options = useMemo(
    () => parseThicknessOptions(columnBeamThickness4x4Input),
    [columnBeamThickness4x4Input],
  )
  const columnBeamThickness6x6Options = useMemo(
    () => parseThicknessOptions(columnBeamThickness6x6Input),
    [columnBeamThickness6x6Input],
  )

  const availableColumnBeamThicknessOptions = useMemo(
    () =>
      input.type === 'Grand Pergola'
        ? (columnBeamThickness6x6Options.length ? columnBeamThickness6x6Options : ['0.25'])
        : (columnBeamThickness4x4Options.length ? columnBeamThickness4x4Options : ['0.125', '0.25']),
    [columnBeamThickness4x4Options, columnBeamThickness6x6Options, input.type],
  )
  const selectedColumnBeamThickness = availableColumnBeamThicknessOptions.includes(columnBeamThickness)
    ? columnBeamThickness
    : ''
  const isColumnBeamThicknessMissing = selectedColumnBeamThickness === ''

  useEffect(() => {
    if (columnBeamThickness && !availableColumnBeamThicknessOptions.includes(columnBeamThickness)) {
      setColumnBeamThickness('')
    }
  }, [availableColumnBeamThicknessOptions, columnBeamThickness])

  const roofPurlinGaugeThickness = useMemo(
    () => getTubingGaugeForSize(tubingRowsState, input.roof.customSize.trim() || input.roof.size),
    [input.roof.customSize, input.roof.size, tubingRowsState],
  )
  const privacyPanelPurlinGaugeThickness = useMemo(
    () =>
      privacyPanelsEnabled
        ? getTubingGaugeForSize(tubingRowsState, input.privacy.customSize.trim() || input.privacy.size)
        : '',
    [input.privacy.customSize, input.privacy.size, privacyPanelsEnabled, tubingRowsState],
  )

  useEffect(() => {
    setRoofPurlinThickness(roofPurlinGaugeThickness)
  }, [roofPurlinGaugeThickness])

  useEffect(() => {
    setPrivacyPanelPurlinThickness(privacyPanelPurlinGaugeThickness)
  }, [privacyPanelPurlinGaugeThickness])

  const sectionTotals = useMemo<Record<PricingSectionKey, number>>(
    () =>
      PRICING_SECTIONS.reduce(
        (acc, section) => {
          const total = pricingSections[section.key].reduce((sum, row) => {
            const quantity = parseNumberInput(row.quantity)
            const unitCost = parseNumberInput(row.unitCost)
            return sum + quantity * unitCost
          }, 0)
          acc[section.key] = total
          return acc
        },
        {
          tubing: 0,
          connectorBlocks: 0,
          endCaps: 0,
          angleIron: 0,
          flatbar: 0,
          additional: 0,
        },
      ),
    [pricingSections],
  )

  const pricingSubTotal = useMemo(
    () => PRICING_SECTIONS.reduce((sum, section) => sum + sectionTotals[section.key], 0),
    [sectionTotals],
  )
  const bufferAmount = parseNumberInput(bufferInput)
  const totalCost = pricingSubTotal + bufferAmount
  const marginFraction = parseNumberInput(sellMarginInput) / 100
  const sellPrice = marginFraction >= 1 ? null : totalCost / (1 - Math.max(marginFraction, 0))

  const sectionItemOptions = useMemo<Record<PricingSectionKey, string[]>>(() => {
    const normalizeOptions = (values: string[]) =>
      Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

    return {
      tubing: normalizeOptions(tubingRowsState.map((row) => row.label)),
      connectorBlocks: normalizeOptions(connectorRowsState.map((row) => row.label)),
      endCaps: normalizeOptions(endCapRowsState.map((row) => row.label)),
      angleIron: normalizeOptions(angleRowsState.map((row) => row.label)),
      flatbar: normalizeOptions(flatbarRowsState.map((row) => row.label)),
      additional: [...ADDITIONAL_SECTION_ITEMS],
    }
  }, [tubingRowsState, connectorRowsState, endCapRowsState, angleRowsState, flatbarRowsState])
  const effectivePieceCounts = useMemo<PieceCounts>(() => {
    const base = result.pieceCounts
    const next = { ...base } as Record<PieceCountKey, number | null>

    for (const row of PIECE_ROWS) {
      const raw = pieceQtyEdits[row.key]
      if (raw === undefined) continue
      const trimmed = raw.trim()
      if (trimmed === '') {
        next[row.key] = null
        continue
      }
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        next[row.key] = parsed
      }
    }

    return next as PieceCounts
  }, [pieceQtyEdits, result.pieceCounts])

  const pieceSizes = useMemo<PieceSizes>(() => {
    const typeSize = input.type === 'Grand Pergola' ? '6x6' : '4x4'
    const roofSize = input.roof.customSize.trim() || input.roof.size || '-'
    const privacySize = privacyPanelsEnabled ? (input.privacy.customSize.trim() || input.privacy.size || '-') : '-'

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
  }, [input.type, input.privacy.customSize, input.privacy.size, input.roof.customSize, input.roof.size, privacyPanelsEnabled])

  const resetAll = () => {
    roofSyncSourceRef.current = 'coverage'
    privacySyncSourceRef.current = 'coverage'
    setInput(makeDefaultInput())
    setPrivacyPanelsEnabled(true)
    setColumnBeamThickness('')
    setColumnBeamThickness4x4Input(DEFAULT_COLUMN_BEAM_THICKNESS_4X4)
    setColumnBeamThickness6x6Input(DEFAULT_COLUMN_BEAM_THICKNESS_6X6)
    setRoofPurlinThickness('0.12')
    setPrivacyPanelPurlinThickness('0.12')
    setPricingSections(createPricingSections())
    setYieldPlanSections([])
    setYieldMessage(null)
    setBufferInput('')
    setSellMarginInput('50')
    setAllResultsSections(true)
    setPieceQtyEdits({})
    setTubingRowsState(tubingRows.map((row) => ({ ...row })))
    setConnectorRowsState(connectorRows.map((row) => ({ ...row })))
    setEndCapRowsState(endCapRows.map((row) => ({ ...row })))
    setAngleRowsState(angleRows.map((row) => ({ ...row })))
    setFlatbarRowsState(flatbarRows.map((row) => ({ ...row })))
    setSettingsBanner(null)
  }

  const setDimension = (key: keyof PergolaInput['dimensions'], raw: string) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    setInput((prev) => ({
      ...prev,
      dimensions: {
        ...prev.dimensions,
        [key]: toFeet(parsed, unit),
      },
    }))
  }

  const updateRoofInput = (updates: Partial<PergolaInput['roof']>, source = roofSyncSourceRef.current) => {
    setInput((prev) => syncPergolaRoofCoverageGap({ ...prev, roof: { ...prev.roof, ...updates } }, source))
  }

  const updateRoofCoverage = (coveragePct: number) => {
    roofSyncSourceRef.current = 'coverage'
    updateRoofInput({ coveragePct }, 'coverage')
  }

  const updateRoofGap = (gapIn: number) => {
    roofSyncSourceRef.current = 'gap'
    updateRoofInput({ gapIn }, 'gap')
  }

  const updatePrivacyInput = (updates: Partial<PergolaInput['privacy']>, source = privacySyncSourceRef.current) => {
    setInput((prev) => syncPergolaPrivacyCoverageGap({ ...prev, privacy: { ...prev.privacy, ...updates } }, source))
  }

  const updatePrivacyCoverage = (coveragePct: number) => {
    privacySyncSourceRef.current = 'coverage'
    updatePrivacyInput({ coveragePct }, 'coverage')
  }

  const updatePrivacyGap = (gapIn: number) => {
    privacySyncSourceRef.current = 'gap'
    updatePrivacyInput({ gapIn }, 'gap')
  }

  const updatePieceQtyEdit = (key: PieceCountKey, value: string) => {
    setPieceQtyEdits((prev) => {
      if (key === 'verticalColumns') return { verticalColumns: value }
      return {
        ...prev,
        [key]: value,
      }
    })
  }

  const dimensionDisplay = (valueFt: number) =>
    unit === 'ft' ? valueFt.toString() : (valueFt * 12).toFixed(2)

  const typeDimensions = input.type === 'Grand Pergola' ? '6x6' : '4x4'

  const updateTubingRow = (rowIndex: number, field: keyof TubeRow, value: string) => {
    setTubingRowsState((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row
        if (field === 'gauge' || field === 'costPerFt' || field === 'supplyFt') {
          return { ...row, [field]: toNullableNumber(value) }
        }
        return { ...row, [field]: value }
      }),
    )
  }

  const updateConnectorRow = (rowIndex: number, field: keyof ConnectorRow, value: string) => {
    setConnectorRowsState((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row
        if (field === 'costEach') return { ...row, [field]: toNullableNumber(value) }
        if (field === 'totalDepth' || field === 'size') return { ...row, [field]: value || null }
        return { ...row, [field]: value }
      }),
    )
  }

  const updateEndCapRow = (rowIndex: number, field: keyof EndCapRow, value: string) => {
    setEndCapRowsState((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row
        if (field === 'costEach') return { ...row, [field]: toNullableNumber(value) }
        if (field === 'totalDepth' || field === 'size') return { ...row, [field]: value || null }
        return { ...row, [field]: value }
      }),
    )
  }

  const updateAngleRow = (rowIndex: number, field: keyof AngleRow, value: string) => {
    setAngleRowsState((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row
        if (field === 'gauge' || field === 'costPerFt' || field === 'supplyFt') {
          return { ...row, [field]: toNullableNumber(value) }
        }
        return { ...row, [field]: value }
      }),
    )
  }

  const updateFlatbarRow = (rowIndex: number, field: keyof FlatbarRow, value: string) => {
    setFlatbarRowsState((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row
        if (field === 'gauge' || field === 'costPerFt' || field === 'supplyFt') {
          return { ...row, [field]: toNullableNumber(value) }
        }
        return { ...row, [field]: value }
      }),
    )
  }

  const updatePricingRow = (section: PricingSectionKey, rowIndex: number, field: keyof PricingLineRow, value: string) => {
    setPricingSections((prev) => ({
      ...prev,
      [section]: prev[section].map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)),
    }))
  }

  const getAutoUnitCost = (section: PricingSectionKey, itemLabel: string): string | null => {
    const normalized = normalizeLabel(itemLabel)
    if (!normalized) return null

    if (section === 'tubing') {
      const match = tubingRowsState.find((row) => normalizeLabel(row.label) == normalized)
      const value = match ? getComputedPerSupply(match.costPerFt, match.supplyFt, match.perSupply) : null
      return typeof value === 'number' ? String(value) : null
    }

    if (section == 'angleIron') {
      const match = angleRowsState.find((row) => normalizeLabel(row.label) == normalized)
      const value = match ? getComputedPerSupply(match.costPerFt, match.supplyFt, match.perSupply) : null
      return typeof value === 'number' ? String(value) : null
    }

    if (section == 'flatbar') {
      const match = flatbarRowsState.find((row) => normalizeLabel(row.label) == normalized)
      const value = match ? getComputedPerSupply(match.costPerFt, match.supplyFt, match.perSupply) : null
      return typeof value === 'number' ? String(value) : null
    }

    if (section == 'connectorBlocks') {
      const match = connectorRowsState.find((row) => normalizeLabel(row.label) == normalized)
      return match && typeof match.costEach === 'number' && Number.isFinite(match.costEach) ? String(match.costEach) : null
    }

    if (section == 'endCaps') {
      const match = endCapRowsState.find((row) => normalizeLabel(row.label) == normalized)
      return match && typeof match.costEach === 'number' && Number.isFinite(match.costEach) ? String(match.costEach) : null
    }

    if (section == 'additional') {
      const defaultValue = ADDITIONAL_ITEM_DEFAULT_UNIT_COST[normalized]
      return typeof defaultValue === 'number' && Number.isFinite(defaultValue) ? String(defaultValue) : null
    }

    return null
  }

  const updatePricingItem = (section: PricingSectionKey, rowIndex: number, itemLabel: string) => {
    const autoUnitCost = getAutoUnitCost(section, itemLabel)

    setPricingSections((prev) => ({
      ...prev,
      [section]: prev[section].map((row, index) => {
        if (index !== rowIndex) return row
        return {
          ...row,
          item: itemLabel,
          unitCost: autoUnitCost ?? row.unitCost,
        }
      }),
    }))
  }

  const addPricingRowBelow = (section: PricingSectionKey, rowIndex: number) => {
    setPricingSections((prev) => {
      const rows = prev[section]
      const nextRows = [...rows]
      nextRows.splice(rowIndex + 1, 0, createPricingRow())
      return {
        ...prev,
        [section]: nextRows,
      }
    })
  }

  const deletePricingRow = (section: PricingSectionKey, rowIndex: number) => {
    setPricingSections((prev) => {
      const nextRows = prev[section].filter((_, index) => index !== rowIndex)
      return {
        ...prev,
        [section]: nextRows.length ? nextRows : [createPricingRow()],
      }
    })
  }

  const normalizeGeneratedPricingRows = (rows: YieldPricingRow[]): PricingLineRow[] =>
    rows.length ? rows.map((row) => ({ ...row })) : [createPricingRow()]

  const hasPricingRowValue = (row: PricingLineRow) =>
    Boolean(row.item.trim() || row.quantity.trim() || row.unitCost.trim())

  const refreshManualPricingRows = (section: PricingSectionKey, rows: PricingLineRow[]) => {
    const source = rows.length ? rows : [createPricingRow()]
    return source.map((row) => {
      if (!row.item.trim()) return row
      return {
        ...row,
        unitCost: getAutoUnitCost(section, row.item) ?? row.unitCost,
      }
    })
  }

  const mergeAdditionalPricingRows = (generatedRows: YieldPricingRow[], currentRows: PricingLineRow[]) => {
    const generated = normalizeGeneratedPricingRows(generatedRows)
    const generatedItems = new Set(generated.map((row) => normalizeLabel(row.item)).filter(Boolean))
    const manualRows = currentRows.filter((row) => hasPricingRowValue(row) && !generatedItems.has(normalizeLabel(row.item)))
    return [...generated, ...manualRows]
  }

  const handleCalculateYield = () => {
    if (!selectedColumnBeamThickness) {
      setYieldMessage({ type: 'error', message: 'Column & Beam Thickness is required.' })
      return
    }

    const yieldResult = calculatePergolaYield({
      input: effectiveInput,
      beamSize: result.beamSize,
      pieceCounts: effectivePieceCounts,
      columnBeamThickness: selectedColumnBeamThickness,
      roofPurlinThickness,
      privacyPanelPurlinThickness,
      tubingRows: tubingRowsState,
      connectorRows: connectorRowsState,
      endCapRows: endCapRowsState,
      angleRows: angleRowsState,
      flatbarRows: flatbarRowsState,
    })

    setPricingSections((prev) => ({
      ...prev,
      tubing: normalizeGeneratedPricingRows(yieldResult.pricingSections.tubing),
      connectorBlocks: normalizeGeneratedPricingRows(yieldResult.pricingSections.connectorBlocks),
      endCaps: normalizeGeneratedPricingRows(yieldResult.pricingSections.endCaps),
      angleIron: refreshManualPricingRows('angleIron', prev.angleIron),
      flatbar: refreshManualPricingRows('flatbar', prev.flatbar),
      additional: mergeAdditionalPricingRows(yieldResult.pricingSections.additional, prev.additional),
    }))
    setYieldPlanSections(yieldResult.cutPlans)
    setResultsSectionState((prev) => ({
      ...prev,
      cutPlans: true,
      costDetails: true,
    }))
    setYieldMessage(
      yieldResult.warnings.length
        ? { type: 'error', message: yieldResult.warnings.join(' ') }
        : { type: 'success', message: 'Yield calculated.' },
    )
  }
  const handleExportSettingsCsv = () => {
    const rows: string[][] = [
      ['section', 'table', 'col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7'],
      ['meta', 'version', '1', '', '', '', '', '', ''],
      ['setting', 'columnBeamThickness4x4', columnBeamThickness4x4Input, '', '', '', '', '', ''],
      ['setting', 'columnBeamThickness6x6', columnBeamThickness6x6Input, '', '', '', '', '', ''],
      ['header', 'tubing', 'label', 'part number', 'size', 'gauge', 'cost/ft', 'supply ft', 'per supply'],
    ]

    tubingRowsState.forEach((row) => {
      rows.push([
        'row',
        'tubing',
        row.label,
        row.partNumber,
        row.size,
        formatCsvNumber(row.gauge),
        formatCsvNumber(row.costPerFt),
        formatCsvNumber(row.supplyFt),
        formatCsvNumber(row.perSupply),
      ])
    })

    rows.push(['header', 'connectors', 'label', 'part number', 'total depth', 'cost each', 'size', '', ''])
    connectorRowsState.forEach((row) => {
      rows.push([
        'row',
        'connectors',
        row.label,
        row.partNumber,
        row.totalDepth ?? '',
        formatCsvNumber(row.costEach),
        row.size ?? '',
        '',
        '',
      ])
    })

    rows.push(['header', 'endcaps', 'label', 'part number', 'total depth', 'cost each', 'size', '', ''])
    endCapRowsState.forEach((row) => {
      rows.push([
        'row',
        'endcaps',
        row.label,
        row.partNumber,
        row.totalDepth ?? '',
        formatCsvNumber(row.costEach),
        row.size ?? '',
        '',
        '',
      ])
    })

    rows.push(['header', 'angle', 'label', 'part number', 'gauge', 'cost/ft', 'supply ft', 'per supply', ''])
    angleRowsState.forEach((row) => {
      rows.push([
        'row',
        'angle',
        row.label,
        row.partNumber,
        formatCsvNumber(row.gauge),
        formatCsvNumber(row.costPerFt),
        formatCsvNumber(row.supplyFt),
        formatCsvNumber(row.perSupply),
        '',
      ])
    })

    rows.push(['header', 'flatbar', 'label', 'gauge', 'cost/ft', 'supply ft', 'per supply', '', ''])
    flatbarRowsState.forEach((row) => {
      rows.push([
        'row',
        'flatbar',
        row.label,
        formatCsvNumber(row.gauge),
        formatCsvNumber(row.costPerFt),
        formatCsvNumber(row.supplyFt),
        formatCsvNumber(row.perSupply),
        '',
        '',
      ])
    })

    const csv = serializeCsv(rows)
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    anchor.href = url
    anchor.download = `pergola-settings-${timestamp}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    setSettingsBanner({ type: 'success', message: 'Settings CSV exported.' })
  }

  const handleImportSettingsCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (parsed.error) {
        setSettingsBanner({ type: 'error', message: parsed.error })
        return
      }

      const importedTubing: TubeRow[] = []
      const importedConnectors: ConnectorRow[] = []
      const importedEndCaps: EndCapRow[] = []
      const importedAngles: AngleRow[] = []
      const importedFlatbar: FlatbarRow[] = []
      let importedColumnBeamThickness4x4 = columnBeamThickness4x4Input
      let importedColumnBeamThickness6x6 = columnBeamThickness6x6Input
      let hasThicknessSettings = false

      for (const rawRow of parsed.rows) {
        if (!rawRow.length) continue
        const row = rawRow.map((cell) => cell.trim())
        if (row.every((cell) => cell === '')) continue

        const section = row[0]?.toLowerCase()
        if (section === 'section' || section === 'meta' || section === 'header') continue

        if (section === 'setting') {
          const key = row[1] ?? ''
          const value = row[2] ?? ''
          if (key === 'columnBeamThickness4x4') {
            importedColumnBeamThickness4x4 = value
            hasThicknessSettings = true
            continue
          }
          if (key === 'columnBeamThickness6x6') {
            importedColumnBeamThickness6x6 = value
            hasThicknessSettings = true
            continue
          }
          continue
        }

        if (section !== 'row') continue

        const table = row[1]?.toLowerCase()
        if (!table) continue

        if (table === 'tubing') {
          const gauge = parseNullableNumberCell(row[5] ?? '')
          const costPerFt = parseNullableNumberCell(row[6] ?? '')
          const supplyFt = parseNullableNumberCell(row[7] ?? '')
          const perSupply = parseNullableNumberCell(row[8] ?? '')
          if ([gauge, costPerFt, supplyFt, perSupply].some((value) => Number.isNaN(value))) {
            setSettingsBanner({ type: 'error', message: 'Tubing rows contain invalid numeric values.' })
            return
          }
          importedTubing.push({
            label: row[2] ?? '',
            partNumber: row[3] ?? '',
            size: row[4] ?? '',
            gauge,
            costPerFt,
            supplyFt,
            perSupply,
          })
          continue
        }

        if (table === 'connectors') {
          const costEach = parseNullableNumberCell(row[5] ?? '')
          if (Number.isNaN(costEach)) {
            setSettingsBanner({ type: 'error', message: 'Connector rows contain invalid numeric values.' })
            return
          }
          importedConnectors.push({
            label: row[2] ?? '',
            partNumber: row[3] ?? '',
            totalDepth: (row[4] ?? '') || null,
            costEach,
            size: (row[6] ?? '') || null,
          })
          continue
        }

        if (table === 'endcaps') {
          const costEach = parseNullableNumberCell(row[5] ?? '')
          if (Number.isNaN(costEach)) {
            setSettingsBanner({ type: 'error', message: 'End cap rows contain invalid numeric values.' })
            return
          }
          importedEndCaps.push({
            label: row[2] ?? '',
            partNumber: row[3] ?? '',
            totalDepth: (row[4] ?? '') || null,
            costEach,
            size: (row[6] ?? '') || null,
          })
          continue
        }

        if (table === 'angle') {
          const gauge = parseNullableNumberCell(row[4] ?? '')
          const costPerFt = parseNullableNumberCell(row[5] ?? '')
          const supplyFt = parseNullableNumberCell(row[6] ?? '')
          const perSupply = parseNullableNumberCell(row[7] ?? '')
          if ([gauge, costPerFt, supplyFt, perSupply].some((value) => Number.isNaN(value))) {
            setSettingsBanner({ type: 'error', message: 'Angle rows contain invalid numeric values.' })
            return
          }
          importedAngles.push({
            label: row[2] ?? '',
            partNumber: row[3] ?? '',
            gauge,
            costPerFt,
            supplyFt,
            perSupply,
          })
          continue
        }

        if (table === 'flatbar') {
          const gauge = parseNullableNumberCell(row[3] ?? '')
          const costPerFt = parseNullableNumberCell(row[4] ?? '')
          const supplyFt = parseNullableNumberCell(row[5] ?? '')
          const perSupply = parseNullableNumberCell(row[6] ?? '')
          if ([gauge, costPerFt, supplyFt, perSupply].some((value) => Number.isNaN(value))) {
            setSettingsBanner({ type: 'error', message: 'Flatbar rows contain invalid numeric values.' })
            return
          }
          importedFlatbar.push({
            label: row[2] ?? '',
            gauge,
            costPerFt,
            supplyFt,
            perSupply,
          })
          continue
        }

        setSettingsBanner({ type: 'error', message: `Unknown settings table "${row[1] ?? ''}".` })
        return
      }

      const importedCount =
        importedTubing.length +
        importedConnectors.length +
        importedEndCaps.length +
        importedAngles.length +
        importedFlatbar.length

      if (importedCount === 0 && !hasThicknessSettings) {
        setSettingsBanner({ type: 'error', message: 'No recognized settings rows were found in the CSV.' })
        return
      }

      if (hasThicknessSettings) {
        setColumnBeamThickness4x4Input(importedColumnBeamThickness4x4)
        setColumnBeamThickness6x6Input(importedColumnBeamThickness6x6)
      }
      if (importedCount > 0) {
        setTubingRowsState(importedTubing.length ? importedTubing : [createEmptyTubeRow()])
        setConnectorRowsState(importedConnectors.length ? importedConnectors : [createEmptyConnectorRow()])
        setEndCapRowsState(importedEndCaps.length ? importedEndCaps : [createEmptyEndCapRow()])
        setAngleRowsState(importedAngles.length ? importedAngles : [createEmptyAngleRow()])
        setFlatbarRowsState(importedFlatbar.length ? importedFlatbar : [createEmptyFlatbarRow()])
      }
      setSettingsBanner({ type: 'success', message: 'Settings imported from CSV and applied.' })
    } catch {
      setSettingsBanner({ type: 'error', message: 'Unable to read the selected CSV file.' })
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'input' | 'results' | 'settings')} className="space-y-6">
          <div className="space-y-3 bg-background py-3">
            <header className="space-y-2">
              <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Fabrication cost engine</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-3xl font-semibold text-foreground">Pergola</h1>
                <div className="flex items-center gap-2">
                  <Label htmlFor="measurementUnit-global">Units</Label>
                  <Select
                    value={unit}
                    onValueChange={(value: string) => setUnit(value as 'ft' | 'in')}
                  >
                    <SelectTrigger id="measurementUnit-global" className="w-[120px] bg-background">
                      <SelectValue placeholder="Units" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ft">ft</SelectItem>
                      <SelectItem value="in">in</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </header>

            <Menubar className="grid h-auto w-full grid-cols-3 rounded-full p-1">
              <MenubarMenu>
                <MenubarTrigger
                  onClick={() => setActiveTab('input')}
                  className={cn(
                    'w-full cursor-pointer justify-center rounded-full text-foreground',
                    activeTab === 'input' && 'border border-border bg-background shadow-sm',
                  )}
                >
                  Input
                </MenubarTrigger>
              </MenubarMenu>
              <MenubarMenu>
                <MenubarTrigger
                  onClick={() => setActiveTab('results')}
                  className={cn(
                    'w-full cursor-pointer justify-center rounded-full text-foreground',
                    activeTab === 'results' && 'border border-border bg-background shadow-sm',
                  )}
                >
                  Results
                </MenubarTrigger>
              </MenubarMenu>
              <MenubarMenu>
                <MenubarTrigger
                  onClick={() => setActiveTab('settings')}
                  className={cn(
                    'w-full cursor-pointer justify-center rounded-full text-foreground',
                    activeTab === 'settings' && 'border border-border bg-background shadow-sm',
                  )}
                >
                  Settings
                </MenubarTrigger>
              </MenubarMenu>
            </Menubar>
          </div>

          <TabsContent value="input" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card className="space-y-4">
                    <CardHeader>
                      <CardTitle>Dimensions</CardTitle>
                      <CardDescription>Enter pergola dimensions in the selected unit.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Length ({unit})</Label>
                        <Input value={dimensionDisplay(input.dimensions.lengthFt)} onChange={(e) => setDimension('lengthFt', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Depth ({unit})</Label>
                        <Input value={dimensionDisplay(input.dimensions.depthFt)} onChange={(e) => setDimension('depthFt', e.target.value)} />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Height ({unit})</Label>
                        <Input value={dimensionDisplay(input.dimensions.heightFt)} onChange={(e) => setDimension('heightFt', e.target.value)} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="space-y-4">
                    <CardHeader>
                      <CardTitle>Features</CardTitle>
                      <CardDescription>Configure core pergola options.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <Select value={input.type} onValueChange={(value) => setInput((prev) => ({ ...prev, type: value as PergolaType }))}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Pergola">Pergola</SelectItem>
                              <SelectItem value="Grand Pergola">Grand Pergola</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex h-10 items-center gap-3">
                          <Checkbox
                            id="electrical"
                            checked={input.electrical === 'Yes'}
                            onCheckedChange={(value: boolean | 'indeterminate') =>
                              setInput((prev) => ({ ...prev, electrical: value === true ? 'Yes' : 'No' }))
                            }
                          />
                          <Label htmlFor="electrical" className="text-sm text-foreground">
                            Electrical
                          </Label>
                        </div>
                        <div className="space-y-2">
                          <Label>Dimensions</Label>
                          <Input readOnly value={typeDimensions} />
                        </div>
                        <div className="flex h-10 items-center gap-3">
                          <Checkbox
                            id="privacyPanels"
                            checked={privacyPanelsEnabled}
                            onCheckedChange={(value: boolean | 'indeterminate') => {
                              const enabled = value === true
                              setPrivacyPanelsEnabled(enabled)

                              if (!enabled) {
                                const privacyDefaults = getPrivacyPanelDefaults()
                                setInput((prev) => ({
                                  ...prev,
                                  privacy: {
                                    ...prev.privacy,
                                    ...privacyDefaults,
                                  },
                                }))
                                setPieceQtyEdits((prev) => {
                                  const hasSideEdits =
                                    prev.sidePurlinsLength !== undefined || prev.sidePurlinsDepth !== undefined
                                  if (!hasSideEdits) return prev
                                  const next = { ...prev }
                                  delete next.sidePurlinsLength
                                  delete next.sidePurlinsDepth
                                  return next
                                })
                              }
                            }}
                          />
                          <Label htmlFor="privacyPanels" className="text-sm text-foreground">
                            Privacy panels
                          </Label>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Roof Purlins</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      <Field label="Material" value={input.roof.material} onChange={(v) => updateRoofInput({ material: v as PergolaInput['roof']['material'] })} options={['Aluminum', 'Alumiwood', 'Cedar']} />
                      <Field label="Orientation" value={input.roof.orientation} onChange={(v) => updateRoofInput({ orientation: v as PergolaInput['roof']['orientation'] })} options={['Horizontal', 'Vertical']} />
                      <Field label="Size" value={input.roof.size} onChange={(v) => updateRoofInput({ size: v })} options={result.availableRoofSizes} />
                      <div className="space-y-2">
                        <Label>Custom Size (AxB)</Label>
                        <Input value={input.roof.customSize} onChange={(e) => updateRoofInput({ customSize: e.target.value })} placeholder="optional" />
                      </div>
                      <Field label="Alignment" value={input.roof.alignment} onChange={(v) => updateRoofInput({ alignment: v as PergolaInput['roof']['alignment'] })} options={['Parallel to length', 'Parallel to depth']} />
                      <NumberField label="Coverage (%)" value={input.roof.coveragePct} onChange={updateRoofCoverage} />
                      <NumberField label="Gap (in)" value={input.roof.gapIn} onChange={updateRoofGap} />
                    </CardContent>
                  </Card>

                  <Card className={privacyPanelsEnabled ? "" : "opacity-70"}>
                    <CardHeader>
                      <CardTitle className="text-base">Privacy Panel Purlins</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      <Field label="Material" value={input.privacy.material} onChange={(v) => updatePrivacyInput({ material: v as PergolaInput["privacy"]["material"] })} options={['Aluminum', 'Alumiwood', 'Cedar']} disabled={!privacyPanelsEnabled} />
                      <Field label="Orientation" value={input.privacy.orientation} onChange={(v) => updatePrivacyInput({ orientation: v as PergolaInput["privacy"]["orientation"] })} options={['Horizontal', 'Vertical']} disabled={!privacyPanelsEnabled} />
                      <Field label="Size" value={input.privacy.size} onChange={(v) => updatePrivacyInput({ size: v })} options={result.availablePrivacySizes} disabled={!privacyPanelsEnabled} />
                      <div className="space-y-2">
                        <Label>Custom Size (AxB)</Label>
                        <Input value={input.privacy.customSize} onChange={(e) => updatePrivacyInput({ customSize: e.target.value })} placeholder="optional" disabled={!privacyPanelsEnabled} />
                      </div>
                      <Field label="Alignment" value={input.privacy.alignment} onChange={(v) => updatePrivacyInput({ alignment: v as PergolaInput["privacy"]["alignment"] })} options={['Parallel to top', 'Parallel to height']} disabled={!privacyPanelsEnabled} />
                      <NumberField label="# Panels on length" value={input.privacy.panelCountLength} onChange={(v) => updatePrivacyInput({ panelCountLength: v })} disabled={!privacyPanelsEnabled} />
                      <NumberField label="# Panels on depth" value={input.privacy.panelCountDepth} onChange={(v) => updatePrivacyInput({ panelCountDepth: v })} disabled={!privacyPanelsEnabled} />
                      <NumberField label="Ground clearance (in)" value={input.privacy.groundClearanceIn} onChange={(v) => updatePrivacyInput({ groundClearanceIn: v })} disabled={!privacyPanelsEnabled} />
                      <NumberField label="Top clearance (in)" value={input.privacy.topClearanceIn} onChange={(v) => updatePrivacyInput({ topClearanceIn: v })} disabled={!privacyPanelsEnabled} />
                      <NumberField label="Coverage (%)" value={input.privacy.coveragePct} onChange={updatePrivacyCoverage} disabled={!privacyPanelsEnabled} />
                      <NumberField label="Gap (in)" value={input.privacy.gapIn} onChange={updatePrivacyGap} disabled={!privacyPanelsEnabled} />
                    </CardContent>
                    </Card>
                    
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Piece Breakdown</CardTitle>
                    <CardDescription>Qty column is editable from Inputs.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Part Name</TableHead>
                          <TableHead className="w-[12%]">Qty</TableHead>
                          <TableHead>Size</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {PIECE_ROWS.map((row) => {
                          const currentValue = pieceQtyEdits[row.key] ?? formatPieceCountValue(result.pieceCounts[row.key])

                          return (
                            <TableRow key={row.key}>
                              <TableCell>{row.label}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={currentValue}
                                  onChange={(event) => updatePieceQtyEdit(row.key, event.target.value)}
                                />
                              </TableCell>
                              <TableCell>
                                <Input readOnly value={pieceSizes[row.key]} />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button type="button" onClick={() => setActiveTab('results')}>View results</Button>
                </div>
              </TabsContent>

              <TabsContent value="results" className="space-y-6">
                <div id="results-export-root" className="flex flex-col gap-6">
                  <div className="results-print-hide flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAllResultsSections(true)}>
                      Expand all sections
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setAllResultsSections(false)}>
                      Collapse all sections
                    </Button>
                    <Button variant="outline" size="sm" className="ml-auto" onClick={handleExportPdf}>
                      Export PDF
                    </Button>
                  </div>

                <section id="results-overview" className="results-print-keep scroll-mt-24 order-1 space-y-4">
                  <div className="results-print-only results-print-quote-header text-center">
                    <p className="text-2xl font-semibold text-foreground">Pergola Quote</p>
                  </div>
                  <Card className="results-strip-card results-group-card gap-3">
                    <CardHeader
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleResultsSection('overview')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleResultsSection('overview')
                        }
                      }}
                      className="flex cursor-pointer flex-row items-center justify-between gap-3"
                    >
                      <div>
                        <CardTitle>Pergola Overview</CardTitle>
                        <CardDescription>Key output metrics and configuration summary.</CardDescription>
                      </div>
                      <Button
                        className="results-print-hide"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleResultsSection('overview')
                        }}
                      >
                        {isOverviewOpen ? 'Collapse' : 'Expand'}
                      </Button>
                    </CardHeader>
                    {isOverviewOpen && <CardContent className="space-y-4">
                      <div className="results-grid-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="result-metric result-metric-neutral rounded-xl p-2.5">
                          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">Suggested type</p>
                          <p className="text-sm text-foreground">{result.suggestedType}</p>
                        </div>
                        <div className="result-metric result-metric-neutral rounded-xl p-2.5">
                          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">Beam size</p>
                          <p className="text-sm text-foreground">{result.beamSize}</p>
                        </div>
                        <div className="result-metric result-metric-neutral rounded-xl p-2.5">
                          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">Roof # required</p>
                          <p className="text-sm text-foreground">{effectivePieceCounts.roofPurlins ?? '-'}</p>
                        </div>
                        <div className="result-metric result-metric-neutral rounded-xl p-2.5">
                          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">Side # required (L / D)</p>
                          <p className="text-sm text-foreground">{`${effectivePieceCounts.sidePurlinsLength ?? '-'} / ${effectivePieceCounts.sidePurlinsDepth ?? '-'}`}</p>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Column & Beam Thickness</Label>
                          <Select
                            value={selectedColumnBeamThickness}
                            onValueChange={(value) => {
                              setColumnBeamThickness(value)
                              setYieldMessage(null)
                            }}
                          >
                            <SelectTrigger
                              className={cn('w-full', isColumnBeamThicknessMissing && 'border-destructive')}
                              aria-required="true"
                              aria-invalid={isColumnBeamThicknessMissing}
                            >
                              <SelectValue placeholder="Select thickness" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableColumnBeamThicknessOptions.map((thickness) => (
                                <SelectItem key={thickness} value={thickness}>{thickness}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isColumnBeamThicknessMissing && (
                            <p className="text-xs text-destructive">Column & Beam Thickness is required.</p>
                          )}
                          {selectedColumnBeamThickness && (
                            <Button type="button" size="sm" onClick={handleCalculateYield}>
                              Calculate Yield
                            </Button>
                          )}
                          {yieldMessage && (
                            <p className={cn('text-xs', yieldMessage.type === 'success' ? 'text-emerald-600' : 'text-destructive')}>
                              {yieldMessage.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>Roof Purlin Thickness</Label>
                          <Input type="number" step="0.001" value={roofPurlinThickness} onChange={(event) => setRoofPurlinThickness(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Privacy Panel Purlin Thickness</Label>
                          <Input
                            type="number"
                            step="0.001"
                            value={privacyPanelPurlinThickness}
                            onChange={(event) => setPrivacyPanelPurlinThickness(event.target.value)}
                          />
                        </div>
                      </div>
                      {result.errors.map((error) => (
                        <p key={error} className="text-sm text-destructive">{error}</p>
                      ))}
                    </CardContent>}
                  </Card>
                </section>

                <section id="results-breakdown" className="results-print-keep scroll-mt-24 order-2">
                  <Card className="results-group-card gap-3">
                    <CardHeader
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleResultsSection('breakdown')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleResultsSection('breakdown')
                        }
                      }}
                      className="flex cursor-pointer flex-row items-center justify-between gap-3"
                    >
                      <div>
                        <CardTitle>Piece Breakdown</CardTitle>
                        <CardDescription>Resolved quantities and selected profile sizes.</CardDescription>
                      </div>
                      <Button
                        className="results-print-hide"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleResultsSection('breakdown')
                        }}
                      >
                        {isBreakdownOpen ? 'Collapse' : 'Expand'}
                      </Button>
                    </CardHeader>
                    {isBreakdownOpen && <CardContent>
                      <Table className="table-fixed border border-border">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Part Name</TableHead>
                            <TableHead>Qty</TableHead>
                            <TableHead>Size</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {PIECE_ROWS.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell>{row.label}</TableCell>
                              <TableCell>{effectivePieceCounts[row.key] ?? '-'}</TableCell>
                              <TableCell>{pieceSizes[row.key]}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>}
                  </Card>
                </section>

                <section id="results-cut-plans" className="results-print-keep scroll-mt-24 order-3">
                  <Card className="results-group-card gap-3">
                    <CardHeader
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleResultsSection('cutPlans')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleResultsSection('cutPlans')
                        }
                      }}
                      className="flex cursor-pointer flex-row items-center justify-between gap-3"
                    >
                      <div>
                        <CardTitle>Cutting Plans</CardTitle>
                        <CardDescription>Stock cuts generated from Calculate Yield.</CardDescription>
                      </div>
                      <Button
                        className="results-print-hide"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleResultsSection('cutPlans')
                        }}
                      >
                        {isCutPlansOpen ? 'Collapse' : 'Expand'}
                      </Button>
                    </CardHeader>
                    {isCutPlansOpen && <CardContent className="space-y-4">
                      {yieldPlanSections.length ? (
                        yieldPlanSections.map((section) => (
                          <div key={section.title} className="space-y-3">
                            <h3 className="text-sm font-semibold">{section.title}</h3>
                            <Table className="border border-border">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[16%]">Stock</TableHead>
                                  <TableHead className="w-[18%]">Supply Ft</TableHead>
                                  <TableHead>Cuts Ft</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {section.lines.map((line) => (
                                  <TableRow key={`${section.title}-${line.stockNumber}`}>
                                    <TableCell>{line.stockNumber}</TableCell>
                                    <TableCell>{line.stockLengthFt}</TableCell>
                                    <TableCell>{`{${line.cutsFt.join(', ')}}`}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No cutting plans calculated.</p>
                      )}
                    </CardContent>}
                  </Card>
                </section>

                <section id="results-cost-details" className="results-print-keep scroll-mt-24 order-4">
                  <Card className="results-group-card gap-3">
                    <CardHeader
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleResultsSection('costDetails')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleResultsSection('costDetails')
                        }
                      }}
                      className="flex cursor-pointer flex-row items-center justify-between gap-3"
                    >
                      <div>
                        <CardTitle>Cost Details</CardTitle>
                        <CardDescription>Line-by-line materials and additional cost entries.</CardDescription>
                      </div>
                      <Button
                        className="results-print-hide"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleResultsSection('costDetails')
                        }}
                      >
                        {isCostDetailsOpen ? 'Collapse' : 'Expand'}
                      </Button>
                    </CardHeader>
                    {isCostDetailsOpen && <CardContent className="space-y-6">
                      {PRICING_SECTIONS.map((section) => (
                        <div key={section.key} className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">{section.label}</h3>
                          </div>
                          <Table className="border border-border">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[46%]">Item</TableHead>
                                <TableHead>Qty</TableHead>
                                <TableHead className="w-[14%]">Unit Cost</TableHead>
                                <TableHead className="w-[14%]">Total Cost</TableHead>
                                <TableHead className="w-[14%] results-print-hide" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {pricingSections[section.key].map((row, rowIndex) => {
                                const rowTotal = parseNumberInput(row.quantity) * parseNumberInput(row.unitCost)

                                return (
                                  <TableRow key={`${section.key}-${rowIndex}`}>
                                    <TableCell className="w-[46%]">
                                      <Select
                                        value={row.item || undefined}
                                        onValueChange={(value) => updatePricingItem(section.key, rowIndex, value === '__empty__' ? '' : value)}
                                      >
                                        <SelectTrigger className="w-full">
                                          <SelectValue placeholder="Select item" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__empty__"><span className="opacity-0">Blank</span></SelectItem>
                                          {(() => {
                                            const options = sectionItemOptions[section.key]
                                            const withCurrent = row.item && !options.includes(row.item) ? [row.item, ...options] : options
                                            return withCurrent.map((option) => (
                                              <SelectItem key={option} value={option}>{option}</SelectItem>
                                            ))
                                          })()}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="w-[12%]">
                                      <Input
                                        type="number"
                                        step="any"
                                        value={row.quantity}
                                        onChange={(event) => updatePricingRow(section.key, rowIndex, 'quantity', event.target.value)}
                                      />
                                    </TableCell>
                                    <TableCell className="w-[14%]">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={row.unitCost}
                                        onChange={(event) => updatePricingRow(section.key, rowIndex, 'unitCost', event.target.value)}
                                      />
                                    </TableCell>
                                    <TableCell className="w-[14%]">
                                      <Input readOnly value={formatCurrency(rowTotal)} />
                                    </TableCell>
                                    <TableCell className="results-print-hide">
                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="text-xl font-bold text-emerald-600 hover:text-emerald-700"
                                          onClick={() => addPricingRowBelow(section.key, rowIndex)}
                                        >
                                          +
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="text-xl font-bold text-red-600 hover:text-red-700"
                                          onClick={() => deletePricingRow(section.key, rowIndex)}
                                        >
                                          -
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                              <TableRow>
                                <TableCell className="font-semibold">Section Total</TableCell>
                                <TableCell />
                                <TableCell />
                                <TableCell className="font-semibold">{formatCurrency(sectionTotals[section.key])}</TableCell>
                                <TableCell />
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      ))}

                      <div className="results-summary-block mt-4 rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="results-grid-2 grid gap-6 md:grid-cols-2">
                          <div className="space-y-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Subtotal</p>
                              <p className="text-lg font-semibold text-foreground">{formatCurrency(pricingSubTotal)}</p>
                            </div>
                            <div className="space-y-1">
                              <Label>Buffer</Label>
                              <Input type="number" step="0.01" value={bufferInput} onChange={(event) => setBufferInput(event.target.value)} />
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Adjusted cost</p>
                              <p className="text-lg font-semibold text-foreground">{formatCurrency(totalCost)}</p>
                            </div>
                          </div>
                          <div className="results-summary-right-col space-y-4 md:pt-14">
                            <div className="space-y-1">
                              <Label>Target Margin (%)</Label>
                              <Input type="number" step="0.01" value={sellMarginInput} onChange={(event) => setSellMarginInput(event.target.value)} />
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Sell price</p>
                              <p className="text-lg font-semibold text-foreground">{sellPrice == null ? '-' : formatCurrency(sellPrice)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>}
                  </Card>
                </section>
                </div>
              </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            {settingsBanner && (
              <Card
                className={cn(
                  'border-dashed',
                  settingsBanner.type === 'success'
                    ? 'border-emerald-500/60 bg-emerald-500/5 text-foreground'
                    : 'border-destructive/50 bg-destructive/10 text-destructive',
                )}
              >
                <CardContent className="flex items-start justify-between gap-4 pt-6">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      {settingsBanner.type === 'success' ? 'Success' : 'Failure'}
                    </p>
                    <p
                      className={cn(
                        'text-sm font-medium',
                        settingsBanner.type === 'success' ? 'text-foreground' : 'text-destructive',
                      )}
                    >
                      {settingsBanner.message}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSettingsBanner(null)}>
                    Dismiss
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={settingsImportInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,text/csv"
                  onChange={handleImportSettingsCsv}
                />
                <Button size="sm" variant="outline" onClick={() => settingsImportInputRef.current?.click()}>
                  Import CSV
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportSettingsCsv}>
                  Export CSV
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={resetAll}>
                  Reset all pergola inputs
                </Button>
              </div>
            </div>            <Card>
              <CardHeader
                role="button"
                tabIndex={0}
                onClick={() => toggleSettingsSection('columnBeamThickness')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleSettingsSection('columnBeamThickness')
                  }
                }}
                className="flex cursor-pointer flex-row items-center justify-between gap-3"
              >
                <div>
                  <CardTitle>Column & Beam Thickness Settings</CardTitle>
                  <CardDescription>
                    Configure allowed thickness values as comma-separated lists.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleSettingsSection('columnBeamThickness')
                  }}
                >
                  {settingsSectionState.columnBeamThickness ? 'Collapse' : 'Expand'}
                </Button>
              </CardHeader>
              {settingsSectionState.columnBeamThickness && <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>4x4 options</Label>
                  <Input
                    value={columnBeamThickness4x4Input}
                    onChange={(event) => setColumnBeamThickness4x4Input(event.target.value)}
                    placeholder="0.125, 0.25"
                  />
                </div>
                <div className="space-y-2">
                  <Label>6x6 options</Label>
                  <Input
                    value={columnBeamThickness6x6Input}
                    onChange={(event) => setColumnBeamThickness6x6Input(event.target.value)}
                    placeholder="0.25"
                  />
                </div>
              </CardContent>}
            </Card>

            <EditableSourceTableCard
              title="Tubing Source Table"
              isOpen={settingsSectionState.tubingSource}
              onToggle={() => toggleSettingsSection('tubingSource')}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'partNumber', label: 'Part Number' },
                { key: 'size', label: 'Size' },
                { key: 'gauge', label: 'Gauge', type: 'number' },
                { key: 'costPerFt', label: 'Cost/Ft', type: 'number' },
                { key: 'supplyFt', label: 'Supply Ft', type: 'number' },
                { key: 'perSupply', label: 'Per Supply', type: 'number' },
              ]}
              rows={tubingRowsState}
              onChange={(rowIndex, key, value) => updateTubingRow(rowIndex, key as keyof TubeRow, value)}
              onAddBelow={(rowIndex) =>
                setTubingRowsState((prev) => {
                  const next = [...prev]
                  next.splice(rowIndex + 1, 0, { label: '', partNumber: '', size: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })
                  return next
                })
              }
              onDelete={(rowIndex) =>
                setTubingRowsState((prev) => {
                  const next = prev.filter((_, index) => index !== rowIndex)
                  return next.length ? next : [{ label: '', partNumber: '', size: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null }]
                })
              }
            />

            <EditableSourceTableCard
              title="Connectors Source Table"
              isOpen={settingsSectionState.connectorsSource}
              onToggle={() => toggleSettingsSection('connectorsSource')}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'partNumber', label: 'Part Number' },
                { key: 'totalDepth', label: 'Total Depth' },
                { key: 'costEach', label: 'Cost Each', type: 'number' },
                { key: 'size', label: 'Size' },
              ]}
              rows={connectorRowsState}
              onChange={(rowIndex, key, value) => updateConnectorRow(rowIndex, key as keyof ConnectorRow, value)}
              onAddBelow={(rowIndex) =>
                setConnectorRowsState((prev) => {
                  const next = [...prev]
                  next.splice(rowIndex + 1, 0, { label: '', partNumber: '', totalDepth: null, costEach: null, size: null })
                  return next
                })
              }
              onDelete={(rowIndex) =>
                setConnectorRowsState((prev) => {
                  const next = prev.filter((_, index) => index !== rowIndex)
                  return next.length ? next : [{ label: '', partNumber: '', totalDepth: null, costEach: null, size: null }]
                })
              }
            />

            <EditableSourceTableCard
              title="End Caps Source Table"
              isOpen={settingsSectionState.endCapsSource}
              onToggle={() => toggleSettingsSection('endCapsSource')}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'partNumber', label: 'Part Number' },
                { key: 'totalDepth', label: 'Total Depth' },
                { key: 'costEach', label: 'Cost Each', type: 'number' },
                { key: 'size', label: 'Size' },
              ]}
              rows={endCapRowsState}
              onChange={(rowIndex, key, value) => updateEndCapRow(rowIndex, key as keyof EndCapRow, value)}
              onAddBelow={(rowIndex) =>
                setEndCapRowsState((prev) => {
                  const next = [...prev]
                  next.splice(rowIndex + 1, 0, { label: '', partNumber: '', totalDepth: null, costEach: null, size: null })
                  return next
                })
              }
              onDelete={(rowIndex) =>
                setEndCapRowsState((prev) => {
                  const next = prev.filter((_, index) => index !== rowIndex)
                  return next.length ? next : [{ label: '', partNumber: '', totalDepth: null, costEach: null, size: null }]
                })
              }
            />

            <EditableSourceTableCard
              title="Angle Source Table"
              isOpen={settingsSectionState.angleSource}
              onToggle={() => toggleSettingsSection('angleSource')}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'partNumber', label: 'Part Number' },
                { key: 'gauge', label: 'Gauge', type: 'number' },
                { key: 'costPerFt', label: 'Cost/Ft', type: 'number' },
                { key: 'supplyFt', label: 'Supply Ft', type: 'number' },
                { key: 'perSupply', label: 'Per Supply', type: 'number' },
              ]}
              rows={angleRowsState}
              onChange={(rowIndex, key, value) => updateAngleRow(rowIndex, key as keyof AngleRow, value)}
              onAddBelow={(rowIndex) =>
                setAngleRowsState((prev) => {
                  const next = [...prev]
                  next.splice(rowIndex + 1, 0, { label: '', partNumber: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })
                  return next
                })
              }
              onDelete={(rowIndex) =>
                setAngleRowsState((prev) => {
                  const next = prev.filter((_, index) => index !== rowIndex)
                  return next.length ? next : [{ label: '', partNumber: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null }]
                })
              }
            />

            <EditableSourceTableCard
              title="Flatbar Source Table"
              isOpen={settingsSectionState.flatbarSource}
              onToggle={() => toggleSettingsSection('flatbarSource')}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'gauge', label: 'Gauge', type: 'number' },
                { key: 'costPerFt', label: 'Cost/Ft', type: 'number' },
                { key: 'supplyFt', label: 'Supply Ft', type: 'number' },
                { key: 'perSupply', label: 'Per Supply', type: 'number' },
              ]}
              rows={flatbarRowsState}
              onChange={(rowIndex, key, value) => updateFlatbarRow(rowIndex, key as keyof FlatbarRow, value)}
              onAddBelow={(rowIndex) =>
                setFlatbarRowsState((prev) => {
                  const next = [...prev]
                  next.splice(rowIndex + 1, 0, { label: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null })
                  return next
                })
              }
              onDelete={(rowIndex) =>
                setFlatbarRowsState((prev) => {
                  const next = prev.filter((_, index) => index !== rowIndex)
                  return next.length ? next : [{ label: '', gauge: null, costPerFt: null, supplyFt: null, perSupply: null }]
                })
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

type FieldProps = {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
}

const Field = ({ label, value, options, onChange, disabled }: FieldProps) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" disabled={disabled}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)

type NumberFieldProps = {
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

const NumberField = ({ label, value, onChange, disabled }: NumberFieldProps) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    <Input
      type="number"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const parsed = Number(e.target.value)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  </div>
)


type EditableCellValue = string | number | null

type EditableColumn<T extends Record<string, EditableCellValue>> = {
  key: keyof T
  label: string
  type?: 'text' | 'number'
}

type EditableSourceTableCardProps<T extends Record<string, EditableCellValue>> = {
  title: string
  description?: string
  isOpen?: boolean
  onToggle?: () => void
  columns: EditableColumn<T>[]
  rows: T[]
  onChange: (rowIndex: number, key: keyof T, value: string) => void
  onAddBelow: (rowIndex: number) => void
  onDelete: (rowIndex: number) => void
}

const EditableSourceTableCard = <T extends Record<string, EditableCellValue>>({
  title,
  description,
  isOpen = true,
  onToggle,
  columns,
  rows,
  onChange,
  onAddBelow,
  onDelete,
}: EditableSourceTableCardProps<T>) => (
  <Card>
    <CardHeader
      className={onToggle ? 'flex cursor-pointer flex-row items-center justify-between gap-3' : undefined}
      role={onToggle ? 'button' : undefined}
      tabIndex={onToggle ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={
        onToggle
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
    >
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </div>
      {onToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          {isOpen ? 'Collapse' : 'Expand'}
        </Button>
      ) : null}
    </CardHeader>
    {isOpen && <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={String(column.key)}>{column.label}</TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((column) => {
                const rawValue = row[column.key] ?? ''
                const isPerSupplyColumn = String(column.key) === 'perSupply'
                const computedPerSupply =
                  isPerSupplyColumn && 'costPerFt' in row && 'supplyFt' in row
                    ? formatPerSupply(
                        (row as Record<string, number | null>).costPerFt,
                        (row as Record<string, number | null>).supplyFt,
                      )
                    : ''
                const displayValue = isPerSupplyColumn
                  ? computedPerSupply
                  : typeof rawValue === 'number'
                    ? String(rawValue)
                    : String(rawValue)

                return (
                  <TableCell key={String(column.key)}>
                    <Input
                      type={column.type === 'number' ? 'number' : 'text'}
                      step={column.type === 'number' ? (isPerSupplyColumn ? '0.01' : 'any') : undefined}
                      value={displayValue}
                      readOnly={isPerSupplyColumn}
                      onChange={(event) => {
                        if (isPerSupplyColumn) return
                        onChange(rowIndex, column.key, event.target.value)
                      }}
                    />
                  </TableCell>
                )
              })}
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xl font-bold text-emerald-600 hover:text-emerald-700"
                    onClick={() => onAddBelow(rowIndex)}
                  >
                    +
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xl font-bold text-red-600 hover:text-red-700"
                    onClick={() => onDelete(rowIndex)}
                  >
                    -
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>}
  </Card>
)

export default PergolaCalculator
