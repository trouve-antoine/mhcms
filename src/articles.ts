import * as yaml from "yaml";
import { isLeft } from "fp-ts/lib/Either";
import * as t from "io-ts";
import { ok, ng, Result } from "./result";
import { IMhcmsArticleHeaders, ISerializableMhcmsArticleHeaders, deserializeHeaders, serializeHeaders } from "./folder-index";

const DEFAULT_OBJECT_PARSERS = {
    "yaml": yaml.parse,
    "json": JSON.parse
}

export class MhcmsArticle {
    constructor(readonly headers: IMhcmsArticleHeaders, readonly contents: MhcmsArticleContent) { /** */ }

    toJson(): ISerializableMhcmsArticle {
        return {
            headers: serializeHeaders(this.headers),
            lines: this.contents.lines
        }
    }
    static fromJson(json: ISerializableMhcmsArticle): MhcmsArticle {
        return new MhcmsArticle(
            deserializeHeaders(json.headers),
            new MhcmsArticleContent(json.lines)
        )
    }
}

export interface ISerializableMhcmsArticle {
    headers: ISerializableMhcmsArticleHeaders
    lines: string[]
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

export interface IMhcmsQuoteArticleParagraph {
    readonly type: "quote"
    readonly content: string;
    readonly author?: string;
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

export type IMhcmsArticleParagraph = IMhcmsEmptyArticleParagraph | IMhcmsTextArticleParagraph | IMhcmsObjectArticleParagraph | IMhcmsCodeBlockArticleParagraph | IMhcmsQuoteArticleParagraph;

export class MhcmsArticleContent {
    constructor(readonly lines: string[], private sectionLevel: number = 0) { /** */ }

    get content(): string {
        return this.lines.join("\n");
    }

    *sections(): Generator<MhcmsArticleSection> {
        const sectionStart = "#".repeat(this.sectionLevel + 1) + " ";
        // const sectionStartRegex = new RegExp(`^${sectionStart}\s+(.*)\s*$`);

        let inCodeBlock = false;
        
        let currentSectionInfos: { heading?: string, lines: string[] } = { lines: [] };
        for (let line of this.lines) {
            if (line.startsWith("```")) {
                inCodeBlock = !inCodeBlock;
            }
            if (inCodeBlock) {
                currentSectionInfos.lines.push(line);
                continue;
            }

            if (line.startsWith(sectionStart)) {
                if (currentSectionInfos.lines.filter(x => x.trim().length !== 0).length > 0) {
                    yield new MhcmsArticleSection(
                        currentSectionInfos.heading,
                        new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
                    )
                }
                currentSectionInfos = { heading: line.substring(sectionStart.length).trim(), lines: [] };
            } else {
                currentSectionInfos.lines.push(line);
            }
        }
        if (currentSectionInfos.lines.filter(x => x.trim().length !== 0).length > 0) {
            yield new MhcmsArticleSection(
                currentSectionInfos.heading,
                new MhcmsArticleContent(currentSectionInfos.lines, this.sectionLevel + 1)
            )
        }
    }

    *paragraphs(
        extraObjectParsers?: Record<string, (content: string) => object>,
    ): Generator<IMhcmsArticleParagraph> {
        const objectParsers = { ...DEFAULT_OBJECT_PARSERS, ...extraObjectParsers };

        let currentParagraph: string[] = [];
        let isCodeBlockParagraph = false;
        for (let line of this.lines) {
            if (line.trim() === "") {
                if (isCodeBlockParagraph) {
                    currentParagraph.push(line);
                } else if (currentParagraph.filter(x => x.trim().length !== 0).length > 0) {
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
        if (currentParagraph.filter(x => x.trim().length !== 0).length > 0) {
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
        if (codeBlock.options?.["@parse"] && codeBlock.language) {
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

    const isQuoteBlock = lines.every(l => l.startsWith(">"));
    if (isQuoteBlock) {
        const author = lines[lines.length - 1].match(/^>\s*-+\s*(?<author>.+)\s*$/)?.groups?.author;
        
        if (author) {
            return {
                type: "quote",
                content: lines.slice(0, lines.length - 1).map(l => l.slice(1).trim()).join("\n"),
                author
            }
        }
        return {
            type: "quote",
            content: lines.map(l => l.slice(1).trim()).join("\n")
        }
    }
    
    return { type: "text", content: lines.join("\n") };
}

export function parseArticle(
    content: string,
    date: Date,
    shortTitle: string,
    path: string,
): Result<MhcmsArticle, string> {
    /** From the content of an article, returns headers and content */
    const _lines = separateHeadersAndContentLines(content);
    if (_lines === null) { return ng("Unable to separate headers and contents"); }
    const [headerLines, contentLines] = _lines;
    
    const rawCamelHeaders = rawCamelHeadersFronLines(headerLines);
    const _headers = makeArticleEntryFromHeadersRawKeyValue(
        rawCamelHeaders, date, shortTitle, path);
    
    if (_headers.isNg()) {
        return ng("Got errors when parsing headers.", _headers);
    }

    return ok(
        new MhcmsArticle(_headers.value, new MhcmsArticleContent(contentLines))
    );
}

function makeArticleEntryFromHeadersRawKeyValue<H>(
    rawCamelHeaders: Record<string, string>,
    date: Date,
    shortTitle: string,
    path: string
): Result<IMhcmsArticleHeaders, string> {
    const entryWithoutCustomHeaders = {
        date,
        shortTitle,
        path,
        title: rawCamelHeaders.title,
        subTitle: rawCamelHeaders.subTitle,
        tags: rawCamelHeaders.tags ? rawCamelHeaders.tags.split(",").map(x => x.trim()).filter(Boolean) : [],
        authors: rawCamelHeaders.authors ? rawCamelHeaders.authors.split(",").map(x => x.trim()).filter(Boolean) : [],
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

    const _customHeaders = t.record(t.string, t.string).decode(rawCustomCamelHeaders);
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
        let languageParts = splitAroundSpaces(language.slice(1, language.length - 1)).map(x => x.trim()).filter(Boolean);
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

function splitAroundSpaces(s: string) {
    // Handles single and double quotes
    // e.g. toto="yes man" tata="yes mam"
    // return [...s.match(/[\w-]+="[^"]*"|[\w-]+='[^']*|[\w-]+=[^\s]+|![\w-]+|[\w-]+'/g)]
    const m = s.match(/[\w-]+="[^"]*"|[\w-]+='[^']*'|[\w-]+=[^\s]+|(!|@)[\w-]+|\w+/g)
    if (!m) { return []; }
    return [...m];
}