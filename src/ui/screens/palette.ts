// Contract colours (Gantt blocks, map arcs, contract chips). Index = Contract.color (0–7).
// B5 mirrors these as --k0…--k7 in styles/acmi/screens.css; B4 reads this list for SVG strokes.

export const CONTRACT_COLORS = ['#4f8cff', '#2bb3a3', '#e0a33a', '#c46ad6', '#5fbf5a', '#e2685f', '#7a86d9', '#c9b458'] as const;

export const contractColor = (i: number): string => CONTRACT_COLORS[((i % 8) + 8) % 8];
