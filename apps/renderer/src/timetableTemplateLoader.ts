import type { TemplateLayout } from './timetableExport';
import verticalTemplateUrl from './assets/templates/vertical.xlsx?url';
import horizontalTemplateUrl from './assets/templates/horizontal.xlsx?url';

/** Load the approved vertical or horizontal workbook template. */
export async function loadTimetableTemplate(layout: TemplateLayout): Promise<ArrayBuffer> {
  const url = layout === 'horizontal' ? horizontalTemplateUrl : verticalTemplateUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error('无法读取课表模板（HTTP ' + response.status + '）');
  return response.arrayBuffer();
}
