import path from "path";
import * as t from "io-ts";
import yaml from "yaml";
import { IListFileOptions, IMhcmsFileAccess } from "./file-access/types";
import { IMhcmsFolderIndex, IMhcmsArticleHeaders, parseIndexFile } from "./folder-index";
import { Result, ok, ng } from "./result";
import { getArticleContents, parseArticle } from "./articles";

type IndexMode = "off" | "forced" | "auto"

export default class MhcmsClient {
    constructor(private fileAccess: IMhcmsFileAccess) {
        /** */
    }

    public async folder<H, S extends string>(
        folderPath: string,
        collections: S[],
        headersCodec: t.Type<H>,
        indexMode: IndexMode = "auto"
    ): Promise<Result<MhcmsFolder<H, S>, string>> {
        const _index = await this.indexFolder<H, S>(folderPath, headersCodec, collections, indexMode);
        if (_index.isNg()) { return _index; }
        const index = _index.value;

        return ok(new MhcmsFolder<H, S>(folderPath, index, this.fileAccess));
    }

    private async indexFolder<H, S extends string>(
        folder: string,
        headersCodec: t.Type<H>,
        collections: S[],
        indexMode: IndexMode
    ): Promise<Result<IMhcmsFolderIndex<H, S>, string>> {
        const indexFilePath = path.join(folder, "index.yaml");
        const _currentIndex = await readIndexFile<H, S>(indexFilePath, headersCodec, collections, this.fileAccess);
        
        const currentIndex = _currentIndex.isNg() ? null : _currentIndex.value;

        const _newIndex = await this.generateOrUpdateIndex<H, S>(
            folder, headersCodec, collections, currentIndex, indexMode);
        if (_newIndex.isNg()) { return _newIndex; }
        const newIndex = _newIndex.value;

        return await writeYamlIndexFile(indexFilePath, newIndex, this.fileAccess);
    }

    private async generateOrUpdateIndex<H, S extends string>(
        folder: string,
        headersCodec: t.Type<H>,
        collections: S[],
        currentIndex: IMhcmsFolderIndex<H, S> | null,
        indexMode: IndexMode
    ): Promise<Result<IMhcmsFolderIndex<H, S>, string>> {
        const res: IMhcmsFolderIndex<H, S> = currentIndex ?? {
            lastUpdate: new Date(),
            collections: {} as Record<S, IMhcmsArticleHeaders<H>[]>
        }

        if (indexMode === "off") {
            if (!currentIndex) {
                return ng("Index file does not exist.");
            }
            return ok(currentIndex);
        }

        const fileSearchOptions = ((indexMode == "auto") && currentIndex?.lastUpdate) ? {
            after: currentIndex.lastUpdate
        } : { /** all files */ };
        for (let collection of collections) {
            const newFileEntries = await listFileEntriesInSection(
                folder, collection, headersCodec, fileSearchOptions, this.fileAccess);

            if (collection in res.collections) {
                const existingFileEntries = res.collections[collection];
                const mergedFileEntries = mergeFileEntries(existingFileEntries, newFileEntries);
                res.collections[collection] = mergedFileEntries;
            } else {
                res.collections[collection] = newFileEntries;
            }
        }
        return ok(res);
    }
}

class MhcmsFolder<H, S extends string | symbol> {
    constructor(
        readonly folder: string,
        private index: IMhcmsFolderIndex<H, S>,
        private fileAccess: IMhcmsFileAccess)
    {
        /** */
    }

    async sections(): Promise<S[]> {
        /** TODO: I should not need the "as S[]"" */
        return Object.keys(this.index.collections) as S[];
    }

    async list(options: IPostSearchOptions<S>): Promise<IMhcmsArticleHeaders<H>[]> {
        const res: IMhcmsArticleHeaders<H>[] = [];
        for (const section of options.collections) {
            const posts = this.index.collections[section];
            for (let post of posts) {
                if (options.before && post.date > options.before) {
                    continue;
                }
                if (options.after && post.date < options.after) {
                    continue;
                }
                if (options.tags && options.tags.length > 0) {
                    let hasAllTags = arrayHasAllEntries(options.tags, post.tags);
                    if (!hasAllTags) { continue; }
                }
                if (options.authors && options.authors.length > 0) {
                    let hasAllAuthors = arrayHasAllEntries(options.authors, post.authors);
                    if (!hasAllAuthors) { continue; }
                }
            }
            res.push(...posts);
        }
        if (options.sorting) {
            const sortingOptions = options.sorting;
            res.sort((a, b) => {
                if (sortingOptions.direction === "ascending") {
                    return a[sortingOptions.key] > b[sortingOptions.key] ? 1 : -1;
                } else {
                    return a[sortingOptions.key] < b[sortingOptions.key] ? 1 : -1;
                }
            });
        }
        return res.splice(options.offset || 0, options.limit || res.length);
    }

    async article(article: IMhcmsArticleHeaders<H>) {
        const _contents = await this.fileAccess.readTextFile(article.path);
        if (_contents.isNg()) { return ng("Unable to access contents of text file", _contents); }
        const contents = _contents.value;
        
        const res = getArticleContents(contents);
        if (!res) {
            return ng("Got no article contents from file: " + article.path);
        }
        return ok(res);
    }
}

export interface IPostSearchOptions<S> {
    collections: S[];
    before?: Date;
    after?: Date;
    offset?: number;
    limit?: number;
    tags?: string[];
    authors?: string[];
    sorting?: { key: "date", direction: "ascending" | "descending" };
}

function arrayHasAllEntries<T>(entries: T[], a: T[]) {
    for (let entry of entries) {
        if (!a.includes(entry)) {
            return false;
        }
    }
    return true;
}
function parsePostFileName(name: string): Result<{date: Date, shortTitle: string}, string> {
    const match = name.match(/^(\d{4}\d{2}\d{2})_(.*)\.md$/);
    if (!match) {
        return ng("Cannot parse the file name: " + name + ".");
    }
    const _date = parseDate(match[1]);
    if (_date.isNg()) {
        return ng("Cannot parse the date in the file name: " + name + ".", _date);
    }
    const date = _date.value;

    const slug = match[2];
    
    if (!isValidDate(date)) {
        return ng("The parsed date was invalud: " + name + ".");
    }
    
    return ok({date, shortTitle: kebabCaseToSentence(slug)});
}

function kebabCaseToSentence(kebab: string): string {
    const space = kebab.replace(/-/g, ' ');

    return space[0].toUpperCase() + space.slice(1);
}

async function readIndexFile<H, S extends string>(
    path: string,
    headersCodec: t.Type<H>,
    collections: S[],
    fileAccess: IMhcmsFileAccess
): Promise<Result<IMhcmsFolderIndex<H, S>, string>> {
    try {
        const _indexFile = await fileAccess.readTextFile(path);
        if (_indexFile.isNg()) { return ng("Unable to read index file.", _indexFile) }
        return parseIndexFile(_indexFile.value, collections, headersCodec);
    } catch (e) {
        return ng("Unable to access index file.");
    }
}

async function writeYamlIndexFile<H, S extends string>(
    path: string,
    index: IMhcmsFolderIndex<H, S>,
    fileAccess: IMhcmsFileAccess
): Promise<Result<IMhcmsFolderIndex<H, S>, string>> {
    try {
        const indexFileContents = yaml.stringify(index);
        await fileAccess.writeTextFile(path, indexFileContents);
        return ok(index);
    } catch (e) {
        console.error(e);
        return ng("Unable to write index file.");
    }
}

async function listFileEntriesInSection<H, S extends string>(
    folder: string, section: S, headersCodec: t.Type<H>, fileSearchOptions: IListFileOptions, fileAccess: IMhcmsFileAccess
): Promise<IMhcmsArticleHeaders<H>[]> {
    const fileEntries = await fileAccess.listFiles(path.join(folder, section), fileSearchOptions);
    const res: IMhcmsArticleHeaders<H>[] = [];
    
    for (let fileEntry of fileEntries) {
        const _parsedName = parsePostFileName(fileEntry.name);
        if (_parsedName.isNg()) {
            console.warn(`Skipping file ${fileEntry.name}: ${_parsedName.pretty()}`);
            continue;
        }
        const parsedName = _parsedName.value;

        const _fileContent = await fileAccess.readTextFile(fileEntry.path);
        if (_fileContent.isNg()) {
            console.warn(`Cannot access file: ${fileEntry.name}. Will skip it.`);
            continue;
        }

        const _post = parseArticle(
            _fileContent.value, parsedName.date, parsedName.shortTitle, fileEntry.path, headersCodec);

        if (_post.isNg()) {
            console.error(`Skipping file ${fileEntry.name}: ${_post.pretty()}`);
            continue;
        }
        const post = _post.value;

        res.push(post.headers)
    }

    return res;
}

function mergeFileEntries<H>(dst: IMhcmsArticleHeaders<H>[], src: IMhcmsArticleHeaders<H>[]) {
    const _dst = dst.reduce((acc, e) => {
        acc[e.path] = e;
        return acc;
    }, {} as Record<string, IMhcmsArticleHeaders<H>>);
    const _src = src.reduce((acc, e) => {
        acc[e.path] = e;
        return acc;
    }, {} as Record<string, IMhcmsArticleHeaders<H>>);

    const _res = {..._dst, ..._src};

    return Object.values(_res);
}

function isValidDate(date: Date) {
    return date instanceof Date && !isNaN(date.getTime());
}

function parseDate(yyyyMMdd: string): Result<Date, string> {
    try {
        const year = Number(yyyyMMdd.slice(0, 4));
        const month = Number(yyyyMMdd.slice(4, 6));
        const day = Number(yyyyMMdd.slice(6, 8));

        return ok(new Date(year, month-1, day));
    } catch (e) {
        return ng("Cannot parse date: " + yyyyMMdd + ".");
    }
}