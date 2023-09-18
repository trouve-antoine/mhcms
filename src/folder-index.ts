import * as yaml from 'yaml';
import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts'
import { Result, ok, ng } from './result';
import reporter from "io-ts-reporters";

export function parseIndexFile<H, S extends string | symbol>(
    contents: string,
    collections: readonly S[],
): Result<IMhcmsFolderIndex<S>, string> {
    const dateCodec = MIsoDateString;

    const entryCodec = t.type({
        date: dateCodec,
        shortTitle: t.string,
        path: t.string,
        title: t.string,
        subTitle: t.string,
        tags: t.array(t.string),
        authors: t.array(t.string),
        customHeaders: t.record(t.string, t.string)
    })

    const codec = t.type({
        lastUpdate: dateCodec,
        collections: t.record(t.string, t.array(entryCodec))
    })

    const _parsedContents = parseYaml(contents)
    if (_parsedContents.isNg()) { return ng("The index file is not a valid yaml", _parsedContents); }
    const parsedContents = _parsedContents.value;

    const _index = codec.decode(parsedContents);
    if (isLeft(_index)) {
        return ng(
            "The index file is a valid yaml, but does not have the expected structure",
            undefined, reporter.report(_index)
        );
    }
    const index = _index.right;

    for (let collectionName in index.collections) {
        if (!collections.includes(collectionName as S)) {
            return ng("Index file contains unknown section.");
        }
    }

    return ok({
        lastUpdate: index.lastUpdate,
        collections: Object.entries(index.collections).reduce((res, x) => {
            const [collectionName, entries] = x;
            res[collectionName as S] = entries;
            return res;
        }, {} as Record<S, IMhcmsArticleHeaders[]>)
    })
}

export interface IMhcmsFolderIndex<S extends string | symbol> {
    lastUpdate: Date;
    collections: Record<S, IMhcmsArticleHeaders[]>;
}

export interface ISerializableMhcmsArticleHeaders {
    date: string
    shortTitle: string
    path: string
    title: string
    subTitle: string
    tags: string[]
    authors: string[]
    /** */
    customHeaders: Record<string, string>
}

export interface IMhcmsArticleHeaders {
    date: Date
    shortTitle: string
    path: string
    title: string
    subTitle: string
    tags: string[]
    authors: string[]
    /** */
    customHeaders: Record<string, string>
}

export function serializeHeaders(header: IMhcmsArticleHeaders): ISerializableMhcmsArticleHeaders {
    return { ...header, date: header.date.toISOString() }
}

export function deserializeHeaders(header: ISerializableMhcmsArticleHeaders): IMhcmsArticleHeaders {
    return { ...header, date: new Date(header.date) }
}

export interface ISerializableMhcmsArticleHeaders extends Omit<IMhcmsArticleHeaders, "date"> {
    date: string
}

/** */

const MIsoDateString = new t.Type<Date, string, unknown>(
    'IsoDateString',
    (input: unknown): input is Date => input instanceof Date,
    (input, context) => {
        if (typeof input !== 'string') {
            return t.failure(input, context);
        }

        const date = new Date(input);
        if (isNaN(date.getTime())) {
            return t.failure(input, context);
        }

        return t.success(date);
    },
    (date: Date) => date.toISOString()
);

function parseYaml(contents: string): Result<unknown, string> {
    try {
        return ok(yaml.parse(contents));
    } catch(err) {
        return ng("Unable to parse YAML file.");
    }
}