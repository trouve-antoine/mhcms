import * as path from "path";
import * as yaml from "yaml";
import { IListFileOptions, IMhcmsFileAccess } from "./file-access/types";
import { IMhcmsFolderIndex, IMhcmsArticleHeaders, parseIndexFile } from "./folder-index";
import { Result, ok, ng } from "./result";
import { MhcmsArticle, getArticleContents, parseArticle } from "./articles";

type IndexMode = "off" | "forced" | "auto"

export class MhcmsClient<S extends string> {
    constructor(
        private fileAccess: IMhcmsFileAccess,
        readonly collections: readonly S[]
    ) {
        /** */
    }

    public static simpleBlog(fileAccess: IMhcmsFileAccess) {
        return new MhcmsClient(fileAccess, ["drafts", "published"]);
    }

    public async folder(folderPath: string): Promise<Result<MhcmsFolder<S>, string>> {
        const _index = await this.readIndex(folderPath);
        if (_index.isNg()) { return _index; }
        const index = _index.value;

        return ok(new MhcmsFolder<S>(folderPath, index, this.fileAccess));
    }

    public async indexFolder(folder: string, force: boolean = false): Promise<Result<IMhcmsFolderIndex<S>, string>> {
        const indexFilePath = path.join(folder, "index.yaml");
        const _currentIndex = await readIndexFile<S>(indexFilePath, this.collections, this.fileAccess);

        const currentIndex = _currentIndex.isNg() ? null : _currentIndex.value;

        const _newIndex = await this.generateOrUpdateIndex(folder, currentIndex, force ? "forced" : "auto");
        if (_newIndex.isNg()) { return _newIndex; }
        const newIndex = _newIndex.value;

        return await writeYamlIndexFile(indexFilePath, newIndex, this.fileAccess);
    }

    private async readIndex(folder: string): Promise<Result<IMhcmsFolderIndex<S>, string>> {
        const indexFilePath = path.join(folder, "index.yaml");
        return await readIndexFile<S>(indexFilePath, this.collections, this.fileAccess);
    }

    private async generateOrUpdateIndex(
        folder: string,
        currentIndex: IMhcmsFolderIndex<S> | null,
        indexMode: IndexMode
    ): Promise<Result<IMhcmsFolderIndex<S>, string>> {
        const res: IMhcmsFolderIndex<S> = currentIndex ?? {
            lastUpdate: new Date(),
            collections: {} as Record<S, IMhcmsArticleHeaders[]>
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
        for (let collection of this.collections) {
            const newFileEntries = await listFileEntriesInSection(
                folder, collection, fileSearchOptions, this.fileAccess);

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

export class MhcmsFolder<S extends string | symbol> {
    constructor(
        readonly folder: string,
        private index: IMhcmsFolderIndex<S>,
        private fileAccess: IMhcmsFileAccess)
    {
        /** */
    }

    sections(): S[] {
        /** TODO: I should not need the "as S[]"" */
        return Object.keys(this.index.collections) as S[];
    }

    articleHeaders(_options: IPostSearchOptions<S> | S): IMhcmsArticleHeaders[] {
        const res: IMhcmsArticleHeaders[] = [];

        const options = typeof _options === "object" ? _options : { collections: _options };

        const collections = Array.isArray(options.collections) ? options.collections : [options.collections];
        
        for (const section of collections) {
            const posts = this.index.collections[section];
            for (let post of posts) {
                if (options.title && (post.title !== options.title)) {
                    continue;
                }
                if (options.before && (post.date > options.before)) {
                    continue;
                }
                if (options.after && (post.date < options.after)) {
                    continue;
                }
                if (options.tags && (options.tags.length > 0)) {
                    let hasAllTags = arrayHasAllEntries(options.tags, post.tags);
                    if (!hasAllTags) { continue; }
                }
                if (options.authors && (options.authors.length > 0)) {
                    let hasAllAuthors = arrayHasAllEntries(options.authors, post.authors);
                    if (!hasAllAuthors) { continue; }
                }
                res.push(post)
            }
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

    async article(article: IMhcmsArticleHeaders): Promise<Result<MhcmsArticle, string>> {
        const _contents = await this.fileAccess.readTextFile(article.path);
        if (_contents.isNg()) { return ng("Unable to access contents of text file", _contents); }
        const contents = _contents.value;
        
        const res = parseArticle(contents, article.date, article.shortTitle, article.path);
        if (res.isNg()) {
            return ng("Unable to parse article", res);
        }

        if (!deepEqual(res.value.headers, article)) {
            console.warn("The parsed headers are not the same as the ones in param: you should update your index.");
        }

        return ok(res.value);
    }
}

export interface IPostSearchOptions<S> {
    collections: S | S[];
    before?: Date;
    after?: Date;
    offset?: number;
    limit?: number;
    tags?: string[];
    authors?: string[];
    title?: string;
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

async function readIndexFile<S extends string>(
    path: string,
    collections: readonly S[],
    fileAccess: IMhcmsFileAccess
): Promise<Result<IMhcmsFolderIndex<S>, string>> {
    try {
        const _indexFile = await fileAccess.readTextFile(path);
        if (_indexFile.isNg()) { return ng("Unable to read index file.", _indexFile) }
        return parseIndexFile(_indexFile.value, collections);
    } catch (e) {
        return ng("Unable to access index file.");
    }
}

async function writeYamlIndexFile<S extends string>(
    path: string,
    index: IMhcmsFolderIndex<S>,
    fileAccess: IMhcmsFileAccess
): Promise<Result<IMhcmsFolderIndex<S> & { location: string }, string>> {
    try {
        const indexFileContents = yaml.stringify(index);
        if (await fileAccess.writeTextFile(path, indexFileContents)) {
            return ok({ ...index, location: path });
        } else {
            return ng("Unable to write index file to " + path + " for unknown reason.");
        }
    } catch (e) {
        console.error(e);
        return ng("Unable to write index file to " + path);
    }
}

async function listFileEntriesInSection<S extends string>(
    folder: string, section: S, fileSearchOptions: IListFileOptions, fileAccess: IMhcmsFileAccess
): Promise<IMhcmsArticleHeaders[]> {
    const fileEntries = await fileAccess.listFiles(section, fileSearchOptions);
    const res: IMhcmsArticleHeaders[] = [];
    
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
            _fileContent.value, parsedName.date, parsedName.shortTitle, fileEntry.path);

        if (_post.isNg()) {
            console.error(`Skipping file ${fileEntry.name}: ${_post.pretty()}`);
            continue;
        }
        const post = _post.value;

        res.push(post.headers)
    }

    return res;
}

function mergeFileEntries(dst: IMhcmsArticleHeaders[], src: IMhcmsArticleHeaders[]) {
    const _dst = dst.reduce((acc, e) => {
        acc[e.path] = e;
        return acc;
    }, {} as Record<string, IMhcmsArticleHeaders>);
    const _src = src.reduce((acc, e) => {
        acc[e.path] = e;
        return acc;
    }, {} as Record<string, IMhcmsArticleHeaders>);

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

function deepEqual<T>(x: T, y: T) {
    /** deep-equal lib is faster, but I prefer to avoid external dependencies */
    return JSON.stringify(x) === JSON.stringify(y);
}