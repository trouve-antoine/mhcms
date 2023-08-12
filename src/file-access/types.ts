export interface IFileEntry {
    name: string;
    modified: Date;
    path: string;
}

export interface IListFileOptions {
    after?: Date;
}

export interface IMhcmsFileAccess {
    listFiles(folder: string, options: IListFileOptions): Promise<IFileEntry[]>;
    readTextFile(path: string): Promise<string | null>;
    writeTextFile(path: string, content: string): Promise<boolean>;
}