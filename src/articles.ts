import * as yaml from "yaml";
import { isLeft } from "fp-ts/lib/Either";
import * as t from "io-ts";
import { ok, ng, Result } from "./result";
import { IMhcmsArticleHeaders } from "./folder-index";

const DEFAULT_OBJECT_PARSERS = {
    "yaml": yaml.parse,
    "json": JSON.parse
}

export interface IMhcmsArticle<H> {
    headers: IMhcmsArticleHeaders<H>;
    contents: MhcmsArticleContent;
}

export class MhcmsArticleSection {
    constructor(
        readonly heading: string | undefined,
        readonly content: MhcmsArticleContent
    ) { /** */ }

    get name(): string | undefined {
        if (this.heading === undefined) { return undefined; }
        return removeSharpPrefix(this.heading);
    }
}

export interface IMhcmsEmptyArticleParagraph {
    readonly type: "empty"
}

export interface IMhcmsTextArticleParagraph {
    readonly type: "text"
    readonly content: string;
}

export interface IMhcmsCodeBlockArticleParagraph {
    readonly type: "code-block"
    readonly language?: string;
    readonly content: string;
    readonly options?: Record<string, string | boolean | number>;
}

export interface IMhcmsObjectArticleParagraph {
    readonly type: "object"
    readonly content: object;
    readonly options?: Record<string, string | boolean | number>;
}

export type IMhcmsArticleParagraph = IMhcmsEmptyArticleParagraph | IMhcmsTextArticleParagraph | IMhcmsObjectArticleParagraph | IMhcmsCodeBlockArticleParagraph;

export class MhcmsArticleContent {
    constructor(private lines: string[], private sectionLevel: number = 0) { /** */ }

    get content(): string {
        return this.lines.join("\n");
    }

    *sections(): Generator<MhcmsArticleSection> {
        const sectionStart = "#".repeat(this.sectionLevel + 1);
        const sectionStartRegex = new RegExp(`^${sectionStart}\s*(.*)\s*$`);

        let inCodeBlock = false;
        
        let currentSectionInfos: { headingLine?: string, lines: string[] } = { lines: [] };
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
                yield new MhcmsArticleSection(
                    currentSectionInfos.headingLine,
                    new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
                )
                currentSectionInfos = { headingLine: match[1], lines: [] };
            } else {
                currentSectionInfos.lines.push(line);
            }
        }
        if (currentSectionInfos.lines.length > 0) {
            yield new MhcmsArticleSection(
                currentSectionInfos.headingLine,
                new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
            )
        }
    }

    *paragraphs(extraObjectParsers?: Record<string, (content: string) => object>): Generator<IMhcmsArticleParagraph> {
        const objectParsers = { ...DEFAULT_OBJECT_PARSERS, ...extraObjectParsers };

        let currentParagraph: string[] = [];
        let isCodeBlockParagraph = false;
        for (let line of this.lines) {
            if (line.trim() === "") {
                if (isCodeBlockParagraph) {
                    currentParagraph.push(line);
                } else if (currentParagraph.length > 0) {
                    yield postProcessParagraphLines(currentParagraph, objectParsers);
                    currentParagraph = [];
                }
            } else if (line.trim().startsWith("```")) {
                currentParagraph.push(line);
                if (isCodeBlockParagraph) {
                    yield postProcessParagraphLines(currentParagraph, objectParsers);
                    currentParagraph = [];
                }
                isCodeBlockParagraph = !isCodeBlockParagraph;
            } else {
                currentParagraph.push(line);
            }
        }
        if (currentParagraph.length > 0) {
            yield postProcessParagraphLines(currentParagraph, objectParsers);
        }
    }
}

function removeSharpPrefix(line: string) {
    return line.replace(/^#+\s*/, "").trim();
}

export function postProcessParagraphLines(
    lines: string[],
    objectParsers: Record<string, (content: string) => object> = DEFAULT_OBJECT_PARSERS
): IMhcmsArticleParagraph {
    if (lines.length === 0) {
        return { type: "empty" };
    }

    const nonEmptyLines = lines.filter(x => x.trim() !== "");
    if (nonEmptyLines.length === 0) {
        return { type: "empty" };
    }

    const isCodeBlock = lines[0].startsWith("```") && lines[lines.length-1].startsWith("```");
    if (isCodeBlock) {
        const codeBlock = parseCodeBlockParagraph(lines);
        if (codeBlock.options?.["@parse"]) {
            const objectContent = objectParsers.hasOwnProperty(codeBlock.language) ?
                objectParsers[codeBlock.language](codeBlock.content) : null
            
            if (objectContent !== null) {
                delete codeBlock.options["@parse"];
                return {
                    type: "object",
                    content: objectContent,
                    options: codeBlock.options
                }
            }
        }
        return codeBlock;
    }
    
    return { type: "text", content: lines.join("\n") };
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

export function parseCodeBlockParagraph(lines: string[]): IMhcmsCodeBlockArticleParagraph {
    const language = lines[0].slice(3).trim() || null;
    const isStructuredLanguageField = language?.startsWith("{") && language.endsWith("}");
    if (language === null) {
        return {
            type: "code-block",
            content: lines.slice(1, lines.length - 1).join("\n")
        }
    } else if (isStructuredLanguageField) {
        let languageParts = language.slice(1, language.length - 1).split(" ").map(x => x.trim()).filter(Boolean);
        if (languageParts.length === 0) {
            return {
                type: "code-block",
                language,
                content: lines.slice(1, lines.length - 1).join("\n")
            }
        }
        const languageName = languageParts[0];
        const options = languageParts.slice(1).reduce((res, x) => {
            const xx = splitAtFirstEqual(x);
            const [key, value] = xx.length === 2 ? [xx[0], cleanLanguageOptionsValue(xx[1])] : 
                xx[0].startsWith("!") ? [xx[0].slice(1), false] : [xx[0], true];
            res[key] = value;
            return res;
        }, {} as Record<string, string | boolean | number>);

        return {
            type: "code-block",
            language: languageName,
            content: lines.slice(1, lines.length - 1).join("\n"),
            options
        }
    } else {
        return {
            type: "code-block",
            language,
            content: lines.slice(1, lines.length - 1).join("\n")
        }
    }
}

function cleanLanguageOptionsValue(value: string) {
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, value.length - 1);
    } else if (["true", "yes"].includes(value.toLowerCase())) {
        return true;
    } else if (["false", "no"].includes(value.toLowerCase())) {
        return false;
    } else if (!isNaN(Number(value))) {
        return Number(value);
    } else {
        return value;
    }
}

function splitAtFirstEqual(s: string) {
    const index = s.indexOf("=");
    if (index === -1) {
        return [s];
    } else {
        return [s.slice(0, index), s.slice(index + 1)];
    }
}