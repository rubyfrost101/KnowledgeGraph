import { extractTextFromPdf } from './pdf';

export async function readKnowledgeFile(file: File): Promise<{ text: string; pageCount?: number }> {
  const lower = file.name.toLowerCase();
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    const extracted = await extractTextFromPdf(file);
    return {
      text: extracted.text,
      pageCount: extracted.pageCount,
    };
  }

  const text = await file.text();
  return { text };
}
