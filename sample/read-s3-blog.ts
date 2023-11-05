import * as S3 from "@aws-sdk/client-s3";

import {MhcmsClient} from '../src';
import {S3FileAccess} from '../src/file-access/s3';

async function main() {
    const fileAccess = new S3FileAccess("hoposhell-website");
    const client = new MhcmsClient(fileAccess, ["articles", "blog", "templates"]);

    const _folder = await client.folder("prod");
    if (_folder.isNg()) {
        console.error("Failed to index the folder.");
        console.error(_folder.pretty());
        return;
    }
}

main();