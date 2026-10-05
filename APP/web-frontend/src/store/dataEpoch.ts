let epoch = 0
export const localDataEpoch = () => epoch
export const invalidateLocalData = () => { epoch++ }
export function requireLocalDataEpoch(expected: number) {
  if (expected !== epoch) throw new Error('本地数据已清理，此次操作已取消')
}
