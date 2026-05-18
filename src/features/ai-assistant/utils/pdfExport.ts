import { exportInspectionReportPdf as exportSharedInspectionReportPdf } from '@/shared/utils/reports/inspectionReportPdfExport'
import type { Language } from '@/shared/i18n'
import type { InspectionReport, RobotInspectionContext } from '@/types'

interface ExportInspectionReportPdfParams {
  inspectionReport: InspectionReport | null
  robotName: string
  lang: Language
  inspectionContext?: RobotInspectionContext
}

export function exportInspectionReportPdf({
  inspectionReport,
  robotName,
  lang,
  inspectionContext
}: ExportInspectionReportPdfParams): Promise<void> {
  return exportSharedInspectionReportPdf({
    inspectionReport,
    robotName,
    lang,
    inspectionContext
  })
}
