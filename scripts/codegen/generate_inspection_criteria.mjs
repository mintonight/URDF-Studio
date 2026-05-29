import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const checkMode = process.argv.includes('--check');
const englishSourcePath = path.join(
  repoRoot,
  'src/features/ai-assistant/config/urdf_inspect_standard_en.md',
);
const chineseSourcePath = path.join(
  repoRoot,
  'src/features/ai-assistant/config/urdf_inspect_stantard_zh.md',
);
const outputPath = path.join(repoRoot, 'src/shared/data/inspectionCriteria.generated.ts');

const LANGUAGE_MARKERS = {
  en: {
    categoryId: 'Category ID:',
    categoryWeight: 'Category Weight:',
    itemId: 'Item ID:',
    criteria: 'Criteria:',
    scoringReference: 'Scoring Reference:',
  },
  zh: {
    categoryId: '章节ID:',
    categoryWeight: '章节权重:',
    itemId: '项目ID:',
    criteria: '判定标准:',
    scoringReference: '得分参考:',
  },
};

const normalizeHeading = (value) => value.replace(/\s*\([^()]*\)\s*$/, '').trim();

const normalizeText = (lines) =>
  lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const isCategoryHeading = (line) => /^\d+\.\s+/.test(line);
const isItemHeading = (line) => /^\d+\.\d+\s+/.test(line);

const parsePrefixedValue = (line, prefix, context) => {
  if (!line.startsWith(prefix)) {
    throw new Error(`${context} must start with "${prefix}" but received "${line}"`);
  }

  return line.slice(prefix.length).trim();
};

const parseCriteriaMarkdown = (source, language) => {
  const markers = LANGUAGE_MARKERS[language];
  const lines = source.split(/\r?\n/);
  const categories = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || isItemHeading(line) || !isCategoryHeading(line)) {
      index += 1;
      continue;
    }

    const categoryName = normalizeHeading(line.replace(/^\d+\.\s+/, ''));
    index += 1;

    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }

    const categoryId = parsePrefixedValue(
      lines[index]?.trim() ?? '',
      markers.categoryId,
      `${language} category id for "${categoryName}"`,
    );
    index += 1;

    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }

    const categoryWeight = Number.parseFloat(
      parsePrefixedValue(
        lines[index]?.trim() ?? '',
        markers.categoryWeight,
        `${language} category weight for "${categoryName}"`,
      ),
    );
    if (!Number.isFinite(categoryWeight)) {
      throw new Error(`Invalid weight for category "${categoryId}" in ${language} markdown`);
    }
    index += 1;

    const items = [];

    while (index < lines.length) {
      const currentLine = lines[index].trim();
      if (!currentLine) {
        index += 1;
        continue;
      }

      if (isCategoryHeading(currentLine) && !isItemHeading(currentLine)) {
        break;
      }

      if (!isItemHeading(currentLine)) {
        throw new Error(
          `Unexpected content while parsing category "${categoryId}" in ${language} markdown: "${currentLine}"`,
        );
      }

      const itemName = normalizeHeading(currentLine.replace(/^\d+\.\d+\s+/, ''));
      index += 1;

      while (index < lines.length && !lines[index].trim()) {
        index += 1;
      }

      const itemId = parsePrefixedValue(
        lines[index]?.trim() ?? '',
        markers.itemId,
        `${language} item id for "${itemName}"`,
      );
      index += 1;

      while (index < lines.length && !lines[index].trim()) {
        index += 1;
      }

      const criteriaLabel = lines[index]?.trim() ?? '';
      if (!criteriaLabel.startsWith(markers.criteria)) {
        throw new Error(
          `${language} item "${itemId}" must declare "${markers.criteria}" before its description`,
        );
      }

      const criteriaLines = [];
      const inlineCriteria = criteriaLabel.slice(markers.criteria.length).trim();
      if (inlineCriteria) {
        criteriaLines.push(inlineCriteria);
      }
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index].trim();
        if (!nextLine) {
          index += 1;
          continue;
        }

        if (
          nextLine.startsWith(markers.scoringReference) ||
          isItemHeading(nextLine) ||
          (isCategoryHeading(nextLine) && !isItemHeading(nextLine))
        ) {
          break;
        }

        criteriaLines.push(nextLine);
        index += 1;
      }

      let scoringReference = '';
      const scoringLine = lines[index]?.trim() ?? '';
      if (scoringLine.startsWith(markers.scoringReference)) {
        scoringReference = parsePrefixedValue(
          scoringLine,
          markers.scoringReference,
          `${language} scoring reference for "${itemId}"`,
        );
        index += 1;

        while (index < lines.length) {
          const nextLine = lines[index].trim();
          if (!nextLine) {
            index += 1;
            continue;
          }

          if (
            isItemHeading(nextLine) ||
            (isCategoryHeading(nextLine) && !isItemHeading(nextLine))
          ) {
            break;
          }

          scoringReference = normalizeText([scoringReference, nextLine]);
          index += 1;
        }
      }

      items.push({
        id: itemId,
        name: itemName,
        description: normalizeText(criteriaLines),
        scoringReference: scoringReference || undefined,
        maxScore: 10,
      });
    }

    categories.push({
      id: categoryId,
      name: categoryName,
      weight: categoryWeight,
      items,
    });
  }

  return categories;
};

const assertSameStructure = (englishCategories, chineseCategories) => {
  if (englishCategories.length !== chineseCategories.length) {
    throw new Error(
      'English and Chinese inspection markdown files must define the same category count',
    );
  }

  englishCategories.forEach((englishCategory, categoryIndex) => {
    const chineseCategory = chineseCategories[categoryIndex];
    if (englishCategory.id !== chineseCategory.id) {
      throw new Error(
        `Category mismatch at index ${categoryIndex}: "${englishCategory.id}" vs "${chineseCategory.id}"`,
      );
    }

    if (englishCategory.weight !== chineseCategory.weight) {
      throw new Error(`Weight mismatch for category "${englishCategory.id}"`);
    }

    if (englishCategory.items.length !== chineseCategory.items.length) {
      throw new Error(`Item count mismatch for category "${englishCategory.id}"`);
    }

    englishCategory.items.forEach((englishItem, itemIndex) => {
      const chineseItem = chineseCategory.items[itemIndex];
      if (englishItem.id !== chineseItem.id) {
        throw new Error(
          `Item mismatch in category "${englishCategory.id}" at index ${itemIndex}: "${englishItem.id}" vs "${chineseItem.id}"`,
        );
      }
    });
  });
};

const englishSource = fs.readFileSync(englishSourcePath, 'utf8');
const chineseSource = fs.readFileSync(chineseSourcePath, 'utf8');

const englishCategories = parseCriteriaMarkdown(englishSource, 'en');
const chineseCategories = parseCriteriaMarkdown(chineseSource, 'zh');

assertSameStructure(englishCategories, chineseCategories);

const generatedCriteria = englishCategories.map((englishCategory, categoryIndex) => {
  const chineseCategory = chineseCategories[categoryIndex];
  return {
    id: englishCategory.id,
    name: englishCategory.name,
    nameZh: chineseCategory.name,
    weight: englishCategory.weight,
    items: englishCategory.items.map((englishItem, itemIndex) => {
      const chineseItem = chineseCategory.items[itemIndex];
      return {
        id: englishItem.id,
        name: englishItem.name,
        nameZh: chineseItem.name,
        description: englishItem.description,
        descriptionZh: chineseItem.description,
        scoringReference: englishItem.scoringReference,
        scoringReferenceZh: chineseItem.scoringReference,
        maxScore: englishItem.maxScore,
      };
    }),
  };
});

const generatedModule = `// Generated from urdf_inspect_standard_en.md and urdf_inspect_stantard_zh.md by scripts/generate_inspection_criteria.mjs.
// Do not edit this file directly.

export const GENERATED_INSPECTION_CRITERIA = ${JSON.stringify(generatedCriteria, null, 2)};
`;

if (checkMode) {
  const currentOutput = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (currentOutput !== generatedModule) {
    console.error(`Generated inspection criteria are stale: ${outputPath}`);
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, generatedModule);
}
