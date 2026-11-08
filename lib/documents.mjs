import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';

export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

export function detectKind(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'docx';
  return null;
}

const SANITIZE = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'a'],
  allowedAttributes: { a: ['href'], img: ['src', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['data'] },
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
};

export const cleanHtml = (html) => sanitizeHtml(html, SANITIZE);

export async function convertDocx(buffer) {
  const { value } = await mammoth.convertToHtml({ buffer });
  return cleanHtml(value);
}
