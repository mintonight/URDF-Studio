import { Box, FileText, LayoutGrid, RefreshCw, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getInspectionCategoryIcon(categoryId: string): LucideIcon {
  if (categoryId === 'spec') return FileText;
  if (categoryId === 'physical') return Box;
  if (categoryId === 'frames') return RefreshCw;
  if (categoryId === 'assembly') return LayoutGrid;
  if (categoryId === 'simulation') return Sparkles;
  if (categoryId === 'hardware') return Sparkles;
  if (categoryId === 'naming') return FileText;
  return Sparkles;
}
