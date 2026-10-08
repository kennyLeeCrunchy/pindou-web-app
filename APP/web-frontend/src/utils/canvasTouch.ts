/** x/y are CSS pixels relative to the canvas, including its axes. */
export interface CanvasPoint { x: number; y: number }

/** Browser client coordinates use a fresh rect, so page scrolling cannot offset a tap. */
export function canvasPointFromClient(point: { clientX: number; clientY: number }, rect: { left: number; top: number }): CanvasPoint {
  return { x: point.clientX - rect.left, y: point.clientY - rect.top }
}

export interface CanvasViewport {
  rowStart: number
  columnStart: number
  columns: number
  width: number
  height: number
  axisPad: number
}

/** Inverse of drawCells' CSS-space translation and square-cell layout. */
export function canvasCellAt(point: CanvasPoint, view: CanvasViewport): { row: number; column: number } | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || view.width <= 0 || view.columns <= 0) return
  const x = point.x - view.axisPad
  const y = point.y - view.axisPad
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return
  const cellSize = view.width / view.columns
  return { row: view.rowStart + Math.floor(y / cellSize), column: view.columnStart + Math.floor(x / cellSize) }
}
