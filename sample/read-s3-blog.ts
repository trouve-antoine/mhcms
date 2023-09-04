import {MhcmsClient} from '../src';
import s3FileAccess from '../src/file-access/s3';

async function main() {
    const fileAccess = new s3FileAccess("hoposhell-website");
    const client = new MhcmsClient(fileAccess, ["drafts"]);

    const _folder = await client.folder("www/blog");
    if (_folder.isNg()) {
        console.error("Failed to index the folder.");
        console.error(_folder.pretty());
        return;
    }
}

main();