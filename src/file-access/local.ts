import path from "path";
import { promises as fs } from "fs";
import { IFileEntry, IMhcmsFileAccess } from "./types";

export default class LocalFileAccess implements IMhcmsFileAccess {
    constructor(private root: string) {
        /** */
    }


    async listFiles(folder: string, options: { after?: Date }) {
        try {
            const folderPath = path.join(this.root, folder);
            const entries = await fs.readdir(folderPath, { withFileTypes: true });

            const res: IFileEntry[] = [];
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const entryFullPath = path.join(folderPath, entry.name);
                const fileStats = await fs.stat(entryFullPath);
                if (options.after && fileStats.mtime < options.after) {
                    continue;
                }
                res.push({
                    name: entry.name,
                    modified: fileStats.mtime,
                    path: path.join(folder, entry.name)
                });
            }

            return res;
        } catch(err) {
            console.error("Unable to open folder: " + folder + ". Error was: " + err + ".");
            return [];
        }
    }

    async readTextFile(file: string) {
        try {
            const filePath = path.join(this.root, file);
            const contents = await fs.readFile(filePath, { encoding: 'utf-8' });
            return contents;
        } catch(err) {
            return null;
        }
    }

    async writeTextFile(file: string, content: string) {
        try {
            const filePath = path.join(this.root, file);
            await fs.writeFile(filePath, content, { encoding: 'utf-8' });
            return true;
        } catch(err) {
            return false;
        }
    }
}