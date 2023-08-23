import * as path from 'path';

import * as t from 'io-ts';
import LocalFileAccess from '../src/file-access/local';
import {MhcmsClient} from '../src';

const SAMPLE_FOLDER_PATH = path.join(__dirname, "..", "sample");

async function main() {
    const fileAccess = new LocalFileAccess(SAMPLE_FOLDER_PATH);
    const client = new MhcmsClient(fileAccess, ["drafts", "published"], t.record(t.string, t.string));

    const _folder = await client.folder("blog");
    if (_folder.isNg()) {
        console.error("Failed to index the folder.");
        console.error(_folder.pretty());
        return;
    }
    const folder = _folder.value;

    const articles = await folder.list({ collections: ["published"] });
    const _article = await folder.article(articles[0]);
    if (_article.isNg()) {
        console.error("Failed to read the article.");
        return;
    }
    const article = _article.value;

    for (const section of article.sections()) {
        if (!["The Content", "Read-Only Features"].includes(section.name || "")) {
            continue;
        }
        console.log("Found section: " + section.name + ".")
        for (const p of section.content.paragraphs()) {
            if (p.type === "text") {
                console.log("Text paragraph. Starts with " + p.content.slice(0, 10) + "...");
            } else if (p.type === "empty") {
                console.log("Empty paragraph.");
            } else if (p.type === "code-block") {
                console.log("Code block paragraph.");
            } else {
                console.log("Found object paragraph: " + JSON.stringify(p.content) + ".");
            }
        }
    }
}

main();