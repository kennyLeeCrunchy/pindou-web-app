import type { Work } from '../shared/types'

export function editCell(work: Work, row: number, column: number, color: string | null): Work {
  const cells = [...work.cells]
  cells[row] = [...cells[row]]
  cells[row][column] = color
  return { ...work, cells }
}
