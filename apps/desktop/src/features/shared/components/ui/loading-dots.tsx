interface LoadingDotsProps {
  className?: string
  variant?: "loading" | "attention"
}

// Snake pattern order: positions in grid for animation sequence
// 1 → 2 → 3
//         ↓
// 6 ← 5 ← 4
// ↓
// 7 → 8 → 9
const snakeOrder = [0, 1, 2, 5, 4, 3, 6, 7, 8]

// Square pattern for attention variant (no center dot):
// ● ● ●
// ● . ●
// ● ● ●
// Visible dots: 0, 1, 2, 3, 5, 6, 7, 8 (indices)
const squareDots = [0, 1, 2, 3, 5, 6, 7, 8]

export function LoadingDots({ className, variant = "loading" }: LoadingDotsProps) {
  const isAttention = variant === "attention"

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 2px)",
        gridTemplateRows: "repeat(3, 2px)",
        gap: "2px",
        width: "10px",
        height: "10px",
      }}
    >
      {Array.from({ length: 9 }).map((_, index) => {
        const animationOrder = snakeOrder.indexOf(index)
        const isVisible = isAttention ? squareDots.includes(index) : true
        return (
          <div
            key={index}
            style={{
              width: "2px",
              height: "2px",
              borderRadius: "50%",
              backgroundColor: isAttention ? "rgb(251 191 36)" : "currentColor",
              opacity: isVisible ? undefined : 0,
              animation: isVisible
                ? isAttention
                  ? "dot-attention 600ms ease-in-out infinite"
                  : "dot-pulse 900ms ease-in-out infinite"
                : "none",
              animationDelay: isAttention ? "0ms" : `${animationOrder * 100}ms`,
            }}
          />
        )
      })}
    </div>
  )
}
