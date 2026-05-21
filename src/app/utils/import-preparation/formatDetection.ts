import { isMJCF } from '@/core/parsers/mjcf';
import { looksLikeMJCFSourceDocument } from '@/core/parsers/mjcf/mjcfXml';
import { isSDF } from '@/core/parsers/sdf/sdfParser';
import { isUSDA } from '@/core/parsers/usd';
import { isXacro } from '@/core/parsers/xacro';

export const detectImportFormat = (
  content: string,
  filename: string,
): 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null => {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.xacro') || lowerName.endsWith('.urdf.xacro')) return 'xacro';
  if (lowerName.endsWith('.urdf')) return 'urdf';
  if (lowerName.endsWith('.sdf')) return 'sdf';
  if (
    lowerName.endsWith('.usda') ||
    lowerName.endsWith('.usdc') ||
    lowerName.endsWith('.usdz') ||
    lowerName.endsWith('.usd')
  ) {
    return 'usd';
  }

  if (lowerName.endsWith('.xml')) {
    if (isMJCF(content) || looksLikeMJCFSourceDocument(content)) return 'mjcf';
    if (isSDF(content)) return 'sdf';
    if (isXacro(content)) return 'xacro';
    if (content.includes('<robot')) return 'urdf';
  }

  if (isUSDA(content)) return 'usd';
  if (isMJCF(content) || looksLikeMJCFSourceDocument(content)) return 'mjcf';
  if (isSDF(content)) return 'sdf';
  if (isXacro(content)) return 'xacro';
  if (content.includes('<robot')) return 'urdf';

  return null;
};
