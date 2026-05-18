import { useCallback } from 'react';
import { useUIStore, useRobotStore } from '@/store';
import type { InspectionReport } from '@/types';
import { exportInspectionReportPdf } from '@/shared/utils/reports/inspectionReportPdfExport';

interface UsePdfExportReturn {
  handleDownloadPDF: (inspectionReport: InspectionReport | null) => void;
}

export function usePdfExport(): UsePdfExportReturn {
  const lang = useUIStore((s) => s.lang);
  const robotName = useRobotStore((s) => s.name);

  const handleDownloadPDF = useCallback((inspectionReport: InspectionReport | null) => {
    void exportInspectionReportPdf({
      inspectionReport,
      robotName,
      lang,
    }).catch((error) => {
      console.error('Inspection report PDF export failed', error);
    });
  }, [lang, robotName]);

  return {
    handleDownloadPDF,
  };
}
