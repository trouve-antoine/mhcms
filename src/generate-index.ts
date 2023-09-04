#!/usr/bin/env node

/**
 * Helper script to generate the index.yaml file
 */

import { exit } from "process"
import { LocalFileAccess, MhcmsClient, S3FileAccess } from "."

/****** */
main();
/****** */

type IArgs = {
    variant: "local"
    folder: string
    collections: string[]
} | {
    variant: "s3"
    bucket: string
    prefix: string
    collections: string[]
}

async function main() {
    const args = parseArgs();
    if (args === null) { showUsage();exit(1); }

    const _folder = args.variant === "local" ?
        await getLocalFolder(args.folder, args.collections)
        : await getS3Folder(args.bucket, args.prefix, args.collections);

    if (_folder.isNg()) {
        console.error("Failed to index the folder: " + _folder.pretty());
        showUsage();
        exit(1);
    }

    console.info("Generated index file !");
}

function parseArgs(): IArgs | null {
    if (process.argv.length < 5) {
        return null;
    }
    const variant = process.argv[2];
    if (variant === "local") {
        const folder = process.argv[3];
        const collections = process.argv.slice(4);
        return { variant, folder, collections };
    } else if (variant === "s3") {
        const bucket = process.argv[3];
        const prefix = process.argv[4];
        const collections = process.argv.slice(5);
        return { variant, bucket, prefix, collections };
    } else {
        return null;
    }
}

function showUsage() {
    console.error("Usage: node generate-index.js local <folder>");
    console.error("       node generate-index.js s3 <bucket> <prefix>");
}

async function getLocalFolder(folder: string, collections: string[]) {
    const fileAccess = new LocalFileAccess(folder);
    const client = new MhcmsClient(fileAccess, collections);
    return await client.indexFolder(folder);
}

async function getS3Folder(bucket: string, prefix: string, collections: string[]) {
    const fileAccess = new S3FileAccess(bucket);
    const client = new MhcmsClient(fileAccess, collections);
    return await client.indexFolder(prefix);
}