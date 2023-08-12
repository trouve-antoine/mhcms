import yaml from 'yaml';
import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts'
import { Result, ok, ng } from './result';

export function parseIndexFile<H, S extends string | symbol>(
    contents: string,
    collections: S[],
    customHeadersCodec: t.Type<H>
): Result<IMhcmsFolderIndex<H, S>, string> {
    const dateCodec = MIsoDateString;

    const entryCodec = t.type({
        date: dateCodec,
        shortTitle: t.string,
        path: t.string,
        title: t.string,
        subTitle: t.string,
        tags: t.array(t.string),
        authors: t.array(t.string),
        customHeaders: customHeadersCodec
    })

    const codec = t.type({
        lastUpdate: dateCodec,
        collections: t.record(t.string, t.array(entryCodec))
    })

    const _parsedContents = parseYaml(contents)
    if (_parsedContents.isNg()) { return ng("Unable to parse existing index file", _parsedContents); }
    const parsedContents = _parsedContents.value;

    const _index = codec.decode(parsedContents);
    if (isLeft(_index)) { return ng("Unable to parse existing index file"); }
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
        }, {} as Record<S, IMhcmsArticleHeaders<H>[]>)
    })
}

export interface IMhcmsFolderIndex<H, S extends string | symbol> {
    lastUpdate: Date;
    collections: Record<S, IMhcmsArticleHeaders<H>[]>;
}

export interface IMhcmsArticleHeaders<H> {
    date: Date
    shortTitle: string
    path: string
    title: string
    subTitle: string
    tags: string[]
    authors: string[]
    /** */
    customHeaders: H
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