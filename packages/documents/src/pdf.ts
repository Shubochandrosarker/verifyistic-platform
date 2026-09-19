/**
 * SimplePdfFallback — dependency-free, in-core PDF writer (decision D4: fallback ONLY;
 * the premium renderer is HTML/CSS → Chromium). Produces valid PDF 1.4 with Helvetica
 * text, multi-page flow, and a footer per page. WinAnsi text — non-Latin1 characters
 * are transliterated to '?' (Unicode is the Chromium renderer's job, doc 08 §6).
 *
 * Security: content is plain text, fully escaped; the renderer accepts no HTML, no
 * external resources, and performs no network access (no SSRF surface).
 */
import { TextEncoder } from "node:util";

export interface PdfSection {
	heading?: string;
	lines: string[];
}

export interface SimplePdfInput {
	title: string;
	subtitle?: string;
	sections: PdfSection[];
	footer: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LINE_HEIGHT = 14;
const BASE_SIZE = 10;
const LINES_PER_PAGE = Math.floor(
	(PAGE_HEIGHT - 2 * MARGIN - 20) / LINE_HEIGHT,
);

/** WinAnsi-transliterable characters only; escape PDF string specials. */
function sanitize(text: string): string {
	return [...text]
		.map((ch) => (ch.codePointAt(0)! > 255 ? "?" : ch))
		.join("")
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)");
}

interface LaidOutLine {
	text: string;
	bold: boolean;
	size: number;
}

function layout(input: SimplePdfInput): LaidOutLine[][] {
	const flat: LaidOutLine[] = [];
	flat.push({ text: input.title, bold: true, size: 16 });
	if (input.subtitle) flat.push({ text: input.subtitle, bold: false, size: 9 });
	flat.push({ text: "", bold: false, size: BASE_SIZE });

	for (const section of input.sections) {
		if (section.heading) {
			flat.push({ text: "", bold: false, size: 6 });
			flat.push({ text: section.heading, bold: true, size: 12 });
		}
		for (const line of section.lines) {
			flat.push({ text: line, bold: false, size: BASE_SIZE });
		}
	}

	const pages: LaidOutLine[][] = [];
	let page: LaidOutLine[] = [];
	for (const line of flat) {
		if (page.length >= LINES_PER_PAGE) {
			pages.push(page);
			page = [];
		}
		page.push(line);
	}
	if (page.length > 0) pages.push(page);
	return pages;
}

function contentStreamFor(
	lines: LaidOutLine[],
	pageCount: number,
	footer: string,
): Uint8Array {
	const ops: string[] = [];
	let y = PAGE_HEIGHT - MARGIN;
	for (const line of lines) {
		if (line.text.length > 0) {
			const font = line.bold ? "/F2" : "/F1";
			ops.push(
				`BT ${font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y} Tm (${sanitize(line.text)}) Tj ET`,
			);
		}
		y -= line.size >= 14 ? LINE_HEIGHT * 1.4 : LINE_HEIGHT;
	}
	ops.push(
		`BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 20} Tm (${sanitize(footer)} · page ${pageCount}) Tj ET`,
	);
	return new TextEncoder().encode(ops.join("\n"));
}

export function renderSimplePdf(input: SimplePdfInput): Uint8Array {
	const pages = layout(input);
	const objects: string[] = [];
	const streams: Uint8Array[] = [];
	let nextId = 1;

	const catalogId = nextId++;
	const pagesId = nextId++;
	const fontRegularId = nextId++;
	const fontBoldId = nextId++;
	const pageIds: number[] = [];
	const contentIds: number[] = [];

	for (let index = 0; index < pages.length; index++) {
		pageIds.push(nextId++);
		contentIds.push(nextId++);
	}

	objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
	objects[fontRegularId] =
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
	objects[fontBoldId] =
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

	const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
	objects[pagesId] =
		`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;

	pages.forEach((lines, index) => {
		const content = contentStreamFor(lines, index + 1, input.footer);
		streams[index] = content;
		objects[pageIds[index]] =
			`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
			`/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> ` +
			`/Contents ${contentIds[index]} 0 R >>`;
	});

	// Serialize: header, objects with xref-accurate offsets, streams, xref, trailer.
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let position = 0;
	const push = (text: string) => {
		const bytes = new TextEncoder().encode(text);
		chunks.push(bytes);
		position += bytes.byteLength;
	};
	const pushBytes = (bytes: Uint8Array) => {
		chunks.push(bytes);
		position += bytes.byteLength;
	};

	push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

	const emit = (id: number, body: string) => {
		offsets[id] = position;
		push(`${id} 0 obj\n${body}\nendobj\n`);
	};

	emit(catalogId, objects[catalogId]!);
	emit(pagesId, objects[pagesId]!);
	emit(fontRegularId, objects[fontRegularId]!);
	emit(fontBoldId, objects[fontBoldId]!);
	pageIds.forEach((id, index) => {
		emit(id, objects[id]!);
		const stream = streams[index]!;
		offsets[contentIds[index]] = position;
		push(
			`${contentIds[index]} 0 obj\n<< /Length ${stream.byteLength} >>\nstream\n`,
		);
		pushBytes(stream);
		push("\nendstream\nendobj\n");
	});

	const xrefStart = position;
	const maxId = contentIds[contentIds.length - 1] ?? 0;
	let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
	for (let id = 1; id <= maxId; id++) {
		xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
	}
	push(xref);
	push(
		`trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
	);

	const out = new Uint8Array(position);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
