import * as path from "path";
import { ok, ng } from "../result";

import * as S3 from "@aws-sdk/client-s3";

import { IFileEntry, IMhcmsFileAccess } from "./types";

export default class S3FileAccess implements IMhcmsFileAccess {
    s3: S3.S3Client;

    constructor(private bucketName: string) {
        this.s3 = new S3.S3Client({ });
    }


    async listFiles(folder: string, options: { after?: Date }) {
        const listComamnd = new S3.ListObjectsCommand({
            Bucket: this.bucketName,
            Prefix: folder
        });
        const _res = await this.s3.send(listComamnd);

        const files: IFileEntry[] = []; 

        for (let object of _res.Contents ?? []) {
            if (!object.Key) { continue; }
            
            if (object.Key.endsWith("/")) { continue; }
            
            const name = path.basename(object.Key);

            const modified = object.LastModified;
            if (!modified) { continue; }
            if (options.after && modified && modified < options.after) {
                /** There is a date filter and it is not satisfied */
                /** TODO: do this at server side */
                continue;
            }
            files.push({
                name,
                modified,
                path: object.Key
            });
        }

        return files;
    }

    async readTextFile(file: string) {
        const getCommand = new S3.GetObjectCommand({
            Bucket: this.bucketName,
            Key: file
        });

        try {
            const res = await this.s3.send(getCommand);
            if (!res.Body) {
                return ng("The body is null.")
            }

            return ok(await res.Body.transformToString("utf-8"));
        } catch(err) {
            return ng("Got an error when reading file: " + file + ".", undefined, err);
        }
    }

    async writeTextFile(file: string, content: string) {
        const putCommand = new S3.PutObjectCommand({
            Bucket: this.bucketName,
            Key: file,
            Body: content
        });

        try {
            await this.s3.send(putCommand);
            return true;
        } catch(err) {
            console.error(err);
            return false;
        }
    }
}