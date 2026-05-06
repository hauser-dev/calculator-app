import { calculatePergolaYield, type CalculatePergolaYieldOptions, type PergolaYieldProgress } from './yieldEngine.ts'

type YieldWorkerRequest = Omit<CalculatePergolaYieldOptions, 'onProgress'>

type YieldWorkerMessage =
  | { type: 'progress'; progress: PergolaYieldProgress }
  | { type: 'result'; result: ReturnType<typeof calculatePergolaYield> }
  | { type: 'error'; message: string }

const postYieldMessage = (message: YieldWorkerMessage) => {
  self.postMessage(message)
}

self.onmessage = (event: MessageEvent<YieldWorkerRequest>) => {
  try {
    const result = calculatePergolaYield({
      ...event.data,
      onProgress: (progress) => postYieldMessage({ type: 'progress', progress }),
    })
    postYieldMessage({ type: 'result', result })
  } catch (error) {
    postYieldMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unable to calculate yield.',
    })
  }
}
