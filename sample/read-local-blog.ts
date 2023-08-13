import * as path from 'path';

import * as t from 'io-ts';
import LocalFileAccess from '../src/file-access/local';
import MhcmsClient from '../src';

const SAMPLE_FOLDER_PATH = path.join(__dirname, "..", "sample");

async function main() {
    const fileAccess = new LocalFileAccess(SAMPLE_FOLDER_PATH);
    const client = new MhcmsClient(fileAccess);

    const _folder = await client.folder("blog", [ "drafts", "published" ], t.record(t.string, t.string), "forced");
    if (_folder.isNg()) {
        console.error("Failed to index the folder.");
        console.error(_folder.pretty());
        return;
    }
}

main();