import { isLeft } from "fp-ts/lib/Either";
import * as t from "io-ts";
import { ok, ng, Result } from "./result";
import { IMhcmsArticleHeaders } from "./folder-index";

export interface IMhcmsArticle<H> {
    headers: IMhcmsArticleHeaders<H>;
    contents: MhcmsArticleContent;
}

export interface IMhcmsArticleSection {
    name?: string;
    content: MhcmsArticleContent;
}

export class MhcmsArticleContent {
    constructor(private lines: string[], private sectionLevel: number = 0) { /** */ }

    get content(): string {
        return this.lines.join("\n");
    }

    *sections() {
        const sectionStart = "#".repeat(this.sectionLevel + 1);
        const sectionStartRegex = new RegExp(`^${sectionStart}\s*(.*)\s*$`);

        let inCodeBlock = false;
        
        let currentSectionInfos: { name?: string, lines: string[] } = { lines: [] };
        for (let line of this.lines) {
            if (line.startsWith("```")) {
                inCodeBlock = !inCodeBlock;
            }
            if (inCodeBlock) {
                currentSectionInfos.lines.push(line);
                continue;
            }

            const match = line.match(sectionStartRegex);
            if (match !== null) {
                yield {
                    name: currentSectionInfos.name,
                    content: new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
                }
                currentSectionInfos = { name: match[1], lines: [] };
            } else {
                currentSectionInfos.lines.push(line);
            }
        }
        if (currentSectionInfos.lines.length > 0) {
            yield {
                name: currentSectionInfos.name,
                content: new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
            }
        }
    }
}

export function parseArticle<H>(
    content: string,
    date: Date,
    shortTitle: string,
    path: string,
    customHeadersCodec: t.Type<H>
): Result<IMhcmsArticle<H>, string> {
    /** From the content of an article, returns headers and content */
    const _lines = separateHeadersAndContentLines(content);
    if (_lines === null) { return ng("Unable to separate headers and contents"); }
    const [headerLines, contentLines] = _lines;
    
    const rawCamelHeaders = rawCamelHeadersFronLines(headerLines);
    const _headers = makeArticleEntryFromHeadersRawKeyValue(
        rawCamelHeaders, date, shortTitle, path, customHeadersCodec);
    
    if (_headers.isNg()) {
        return ng("Got errors when parsing headers.", _headers);
    }

    return ok({
        headers: _headers.value,
        contents: new MhcmsArticleContent(contentLines)
    });
}

function makeArticleEntryFromHeadersRawKeyValue<H>(
    rawCamelHeaders: Record<string, string>,
    date: Date,
    shortTitle: string,
    path: string,
    customHeadersCodec: t.Type<H>
): Result<IMhcmsArticleHeaders<H>, string> {
    const entryWithoutCustomHeaders = {
        date,
        shortTitle,
        path,
        title: rawCamelHeaders.title,
        subTitle: rawCamelHeaders.subTitle,
        tags: rawCamelHeaders.tags.split(",").map(x => x.trim()).filter(Boolean),
        authors: rawCamelHeaders.authors.split(",").map(x => x.trim()).filter(Boolean),
        customHeaders: null
    }

    const rawCustomCamelHeaders = Object.entries(rawCamelHeaders).reduce((res, x) => {
        const [key, value] = x;
        const isStandardHeader = key in entryWithoutCustomHeaders;
        if (!isStandardHeader) {
            res[key] = value;
        }
        return res;
    }, {} as Record<string, string>);

    const _customHeaders = customHeadersCodec.decode(rawCustomCamelHeaders);
    if (isLeft(_customHeaders)) {
        return ng(`Unable to parse custom headers: ${JSON.stringify(rawCustomCamelHeaders)}.`);
    }

    return ok({
        ...entryWithoutCustomHeaders,
        customHeaders: _customHeaders.right
    });
}

export function getArticleContents(content: string) {
    const _lines = separateHeadersAndContentLines(content);
    if (_lines === null) { return null; }

    return new MhcmsArticleContent(_lines[1]);
}

function separateHeadersAndContentLines(content: string) {
    const lines = content.split("\n");

    const hyphenLineIndex = lines.findIndex(line => line.trim().startsWith("---"));

    if (hyphenLineIndex === -1) { return null; }

    return [
        lines.slice(0, hyphenLineIndex),
        lines.slice(hyphenLineIndex + 1)
    ]
}

function rawCamelHeadersFronLines(headerLines: string[]) {
    const res: Record<string, string> = {};
    for (let l in headerLines) {
        const line = headerLines[l];
        const match = line.match(/^(\w+[\w\d_-]+[\w\d]):(.*)$/);
        if (!match) {
            console.log("Unable to parse header line: ", line);
            continue;
        }
        const key = match[1].trim();
        const value = match[2].trim();
        res[kebabOrSnakeCaseToCamel(key)] = value;
    }
    return res;
}

function kebabOrSnakeCaseToCamel(kebabOrCamel: string) {
    return kebabOrCamel.toLowerCase().replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}