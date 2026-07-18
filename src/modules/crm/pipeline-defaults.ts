export const DEFAULT_PIPELINE_NAME = "Ventas";

export const DEFAULT_STAGES = [
  { name: "Nuevo", position: 0, color: "#6b7280", isWon: false, isLost: false },
  { name: "Contactado", position: 1, color: "#3b82f6", isWon: false, isLost: false },
  { name: "Negociación", position: 2, color: "#f59e0b", isWon: false, isLost: false },
  { name: "Ganado", position: 3, color: "#22c55e", isWon: true, isLost: false },
  { name: "Perdido", position: 4, color: "#ef4444", isWon: false, isLost: true },
] as const;
